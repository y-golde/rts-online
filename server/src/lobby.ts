/**
 * @file lobby.ts
 * @description Room management for the multiplayer lobby.
 * Rooms are stored in memory (not DB) since they're transient.
 * Handles create, join, leave, ready, color selection, and start game.
 *
 * @see types.ts for Room and RoomPlayer interfaces
 */

import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';
import type {
  Room,
  RoomPlayer,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@rts/shared';
import { PLAYER_COLORS } from '@rts/shared';
import { GameEngine } from './game/GameEngine.js';

/** All active rooms, keyed by room ID. */
const rooms = new Map<string, Room>();

/** Map from socket ID → room ID they're currently in. */
const socketRoomMap = new Map<string, string>();

/** Map from socket ID → player ID (persistent across room changes). */
const socketPlayerMap = new Map<string, string>();

/** Active game engines, keyed by room ID. */
const activeGames = new Map<string, GameEngine>();

/**
 * Returns all rooms as an array (for the room browser).
 */
export function getRoomList(): Room[] {
  return Array.from(rooms.values()).filter((r) => r.status === 'waiting');
}

/**
 * Broadcasts the current room list to all sockets in the lobby namespace.
 */
function broadcastRoomList(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  io.emit('roomList', getRoomList());
}

/**
 * Validates a username on the server side.
 * Returns error message if invalid, null if valid.
 */
function validateUsername(username: string): string | null {
  if (!username || typeof username !== 'string') {
    return 'Username is required';
  }

  const trimmed = username.trim();

  if (trimmed.length === 0) {
    return 'Username cannot be empty';
  }

  if (trimmed.length < 2) {
    return 'Username must be at least 2 characters';
  }

  if (trimmed.length > 20) {
    return 'Username must be 20 characters or less';
  }

  // Allow alphanumeric, spaces, hyphens, underscores
  const validPattern = /^[a-zA-Z0-9 _-]+$/;
  if (!validPattern.test(trimmed)) {
    return 'Username can only contain letters, numbers, spaces, hyphens, and underscores';
  }

  // Disallow reserved names (like bot names)
  if (trimmed.toLowerCase().startsWith('[bot]')) {
    return 'Username cannot start with "[BOT]"';
  }

  return null;
}

/**
 * Registers all lobby socket events on a newly connected socket.
 */
export function registerLobbyEvents(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
) {
  // ─── Request Room List ──────────────────────────────────────────────
  socket.on('requestRoomList', () => {
    socket.emit('roomList', getRoomList());
  });

  // ─── Create Room ────────────────────────────────────────────────────
  socket.on('createRoom', ({ playerName, roomName, maxPlayers: requestedMax }) => {
    // Validate username
    const usernameError = validateUsername(playerName);
    if (usernameError) {
      socket.emit('error', { message: usernameError });
      return;
    }

    // Leave any existing room first
    leaveCurrentRoom(io, socket);

    const playerId = uuid();
    socketPlayerMap.set(socket.id, playerId);

    // Trim and sanitize username
    const sanitizedName = playerName.trim();

    const player: RoomPlayer = {
      id: playerId,
      name: sanitizedName,
      color: PLAYER_COLORS[0],
      faction: 'humans',
      ready: false,
    };

    // Clamp maxPlayers to 2 or 4
    const maxPlayers = requestedMax === 4 ? 4 : 2;

    const room: Room = {
      id: uuid(),
      name: roomName?.trim() || `${sanitizedName}'s Room`,
      hostId: playerId,
      players: [player],
      maxPlayers,
      status: 'waiting',
    };

    rooms.set(room.id, room);
    socketRoomMap.set(socket.id, room.id);
    socket.join(room.id);
    socket.emit('joinedRoom', { room, playerId });
    broadcastRoomList(io);
  });

  // ─── Create Single Player Game ──────────────────────────────────────
  socket.on('createSinglePlayerGame', (data: { playerName: string; maxPlayers?: number }) => {
    const { playerName } = data;
    
    // Validate username
    const usernameError = validateUsername(playerName);
    if (usernameError) {
      socket.emit('error', { message: usernameError });
      return;
    }

    // Leave any existing room first
    leaveCurrentRoom(io, socket);

    const playerId = uuid();
    socketPlayerMap.set(socket.id, playerId);

    // Trim and sanitize username
    const sanitizedName = playerName.trim();
    const maxPlayers = data.maxPlayers === 4 ? 4 : 2;
    const botCount = maxPlayers - 1;

    // Human player
    const humanPlayer: RoomPlayer = {
      id: playerId,
      name: sanitizedName,
      color: PLAYER_COLORS[0],
      faction: 'humans',
      ready: true,
    };

    // Bot players
    const botNames = ['[BOT] Alpha', '[BOT] Bravo', '[BOT] Charlie'];
    const bots: RoomPlayer[] = [];
    for (let i = 0; i < botCount; i++) {
      bots.push({
        id: uuid(),
        name: botNames[i] ?? `[BOT] Bot ${i + 1}`,
        color: PLAYER_COLORS[i + 1],
        faction: 'humans',
        ready: true,
      });
    }

    const modeName = maxPlayers === 4 ? 'FFA' : '1v1';
    const room: Room = {
      id: uuid(),
      name: `${playerName}'s ${modeName} Game`,
      hostId: playerId,
      players: [humanPlayer, ...bots],
      maxPlayers,
      status: 'waiting',
    };

    rooms.set(room.id, room);
    socketRoomMap.set(socket.id, room.id);
    socket.join(room.id);
    socket.emit('joinedRoom', { room, playerId });

    // Auto-start the game immediately
    room.status = 'playing';
    const engine = new GameEngine(room, io);
    activeGames.set(room.id, engine);
    const initialState = engine.getState();
    socket.emit('gameStart', { gameState: initialState, playerId });
    engine.start();

    broadcastRoomList(io);
  });

  // ─── Join Room ──────────────────────────────────────────────────────
  socket.on('joinRoom', ({ roomId, playerName }) => {
    // Validate username
    const usernameError = validateUsername(playerName);
    if (usernameError) {
      socket.emit('error', { message: usernameError });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found.' });
      return;
    }
    if (room.status !== 'waiting') {
      socket.emit('error', { message: 'Game already in progress.' });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', { message: 'Room is full.' });
      return;
    }

    leaveCurrentRoom(io, socket);

    const playerId = uuid();
    socketPlayerMap.set(socket.id, playerId);

    // Trim and sanitize username
    const sanitizedName = playerName.trim();

    // Pick first unused color
    const usedColors = new Set(room.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0];

    const player: RoomPlayer = {
      id: playerId,
      name: sanitizedName,
      color,
      faction: 'humans',
      ready: false,
    };

    room.players.push(player);
    socketRoomMap.set(socket.id, room.id);
    socket.join(room.id);
    socket.emit('joinedRoom', { room, playerId });
    io.to(room.id).emit('roomUpdate', room);
    broadcastRoomList(io);
  });

  // ─── Leave Room ─────────────────────────────────────────────────────
  socket.on('leaveRoom', () => {
    leaveCurrentRoom(io, socket);
    broadcastRoomList(io);
  });

  // ─── Set Color ──────────────────────────────────────────────────────
  socket.on('setColor', ({ color }) => {
    const { room, player } = getSocketRoomAndPlayer(socket);
    if (!room || !player) return;

    // Only allow colors from the palette, and not already taken
    if (!PLAYER_COLORS.includes(color as typeof PLAYER_COLORS[number])) return;
    const taken = room.players.some((p) => p.id !== player.id && p.color === color);
    if (taken) return;

    player.color = color;
    io.to(room.id).emit('roomUpdate', room);
  });

  // ─── Ready Toggle ──────────────────────────────────────────────────
  socket.on('playerReady', ({ ready }) => {
    const { room, player } = getSocketRoomAndPlayer(socket);
    if (!room || !player) return;

    player.ready = ready;
    io.to(room.id).emit('roomUpdate', room);
  });

  // ─── Start Game ─────────────────────────────────────────────────────
  socket.on('startGame', () => {
    const { room, player } = getSocketRoomAndPlayer(socket);
    if (!room || !player) return;

    // Only the host can start
    if (room.hostId !== player.id) {
      socket.emit('error', { message: 'Only the host can start the game.' });
      return;
    }

    // All players must be ready (except host)
    const othersReady = room.players
      .filter((p) => p.id !== room.hostId)
      .every((p) => p.ready);
    if (!othersReady && room.players.length > 1) {
      socket.emit('error', { message: 'Not all players are ready.' });
      return;
    }

    // Need at least 2 players for multiplayer
    if (room.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players.' });
      return;
    }

    room.status = 'playing';

    // Create the game engine
    const engine = new GameEngine(room, io);
    activeGames.set(room.id, engine);

    // Notify each player individually with their own playerId
    const initialState = engine.getState();
    for (const [socketId, pId] of socketPlayerMap) {
      const rp = room.players.find((p) => p.id === pId);
      if (!rp) continue;
      io.to(socketId).emit('gameStart', { gameState: initialState, playerId: rp.id });
    }

    // Start the game loop
    engine.start();

    broadcastRoomList(io);
  });

  // ─── Disconnect ────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    leaveCurrentRoom(io, socket);
    socketPlayerMap.delete(socket.id);
    broadcastRoomList(io);
  });
}

/**
 * Registers game command events on a socket.
 * These forward to the active GameEngine for the player's room.
 */
export function registerGameEvents(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
) {
  const gameEvents: Array<keyof ClientToServerEvents> = [
    'moveUnits',
    'attackTarget',
    'buildStructure',
    'trainUnit',
    'gatherResource',
    'upgradeUnit',
    'depositGold',
    'setRallyPoint',
  ];

  for (const event of gameEvents) {
    socket.on(event, ((data: unknown) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const engine = activeGames.get(roomId);
      if (!engine) return;
      const playerId = socketPlayerMap.get(socket.id);
      if (!playerId) return;

      engine.handleCommand(playerId, event, data);
    }) as ClientToServerEvents[typeof event]);
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

function getSocketRoomAndPlayer(socket: Socket) {
  const roomId = socketRoomMap.get(socket.id);
  const playerId = socketPlayerMap.get(socket.id);
  if (!roomId || !playerId) return { room: null, player: null };

  const room = rooms.get(roomId);
  if (!room) return { room: null, player: null };

  const player = room.players.find((p) => p.id === playerId);
  return { room, player: player ?? null };
}

function leaveCurrentRoom(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents>
) {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;

  const room = rooms.get(roomId);
  const playerId = socketPlayerMap.get(socket.id);

  if (room && playerId) {
    room.players = room.players.filter((p) => p.id !== playerId);
    socket.leave(room.id);

    if (room.players.length === 0) {
      // Room empty → clean up
      rooms.delete(room.id);
      const engine = activeGames.get(room.id);
      if (engine) {
        engine.stop();
        activeGames.delete(room.id);
      }
    } else {
      // Transfer host if needed
      if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
      }
      io.to(room.id).emit('roomUpdate', room);
    }
  }

  socketRoomMap.delete(socket.id);
  socket.emit('leftRoom');
}

/** Expose for game engine to call when game ends. */
export function onGameEnd(roomId: string) {
  const engine = activeGames.get(roomId);
  if (engine) {
    engine.stop();
    activeGames.delete(roomId);
  }
  const room = rooms.get(roomId);
  if (room) {
    room.status = 'finished';
  }
}
