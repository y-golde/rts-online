/**
 * @file types.ts
 * @description Core type definitions for the RTS game. This is the single source of truth
 * for all data structures shared between client and server.
 *
 * @see constants.ts for numeric values (costs, stats, tick rate)
 */

// ─── Geometry ───────────────────────────────────────────────────────────────

/** A 2D point in tile coordinates. */
export interface Point {
  x: number;
  y: number;
}

// ─── Tiles ──────────────────────────────────────────────────────────────────

export type TileType = 'grass' | 'water' | 'rock' | 'trees';

// ─── Players ────────────────────────────────────────────────────────────────

export type Faction = 'humans';

/** Tracks per-unit-type upgrade levels for a player. */
export interface UpgradeLevels {
  infantry: number;
  archer: number;
  cavalry: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  faction: Faction;
  gold: number;
  /** Current supply used. */
  supply: number;
  /** Maximum supply available (base + houses). */
  maxSupply: number;
  /** Per-unit-type upgrade levels (from armory). */
  upgrades: UpgradeLevels;
}

// ─── Entities ───────────────────────────────────────────────────────────────

export type EntityType =
  | 'homeBase'
  | 'worker'
  | 'house'
  | 'barracks'
  | 'resourceDepot'
  | 'tower'
  | 'armory'
  | 'infantry'
  | 'archer'
  | 'cavalry'
  | 'ballista';

export type EntityState =
  | 'idle'
  | 'moving'
  | 'gathering'
  | 'building'
  | 'attacking'
  | 'training'
  | 'returning';

export type BuildingType = 'house' | 'barracks' | 'resourceDepot' | 'tower' | 'armory';

/** Queued training order inside a building. */
export interface TrainOrder {
  unitType: EntityType;
  /** Ticks remaining until the unit is produced. */
  ticksRemaining: number;
}

/** A game entity — any unit or building on the map. */
export interface Entity {
  id: string;
  type: EntityType;
  ownerId: string;
  /** Tile X coordinate (can be fractional during movement interpolation on client). */
  x: number;
  /** Tile Y coordinate. */
  y: number;
  hp: number;
  maxHp: number;
  state: EntityState;

  /** A* path the unit is following (tile coords). Next step is index 0. */
  path?: Point[];
  /** ID of the entity this unit is targeting (attack, gather, etc.). */
  targetId?: string;
  /** Training queue for buildings that produce units. */
  trainingQueue?: TrainOrder[];

  /** Gold currently being carried by a worker. */
  carriedGold?: number;

  /** Build progress for buildings under construction (0..1). */
  buildProgress?: number;
  /** Mining progress for workers gathering resources (0..1). */
  miningProgress?: number;

  /** For buildings: tile width/height (e.g. homeBase is 3x3). */
  tileWidth?: number;
  tileHeight?: number;

  /** Pending build order — worker walks to site then places building. */
  pendingBuild?: { buildingType: BuildingType; x: number; y: number };

  /** Rally point for buildings — newly trained units auto-move here. */
  rallyPoint?: Point;
}

// ─── Gold Mines ─────────────────────────────────────────────────────────────

export interface GoldMine {
  id: string;
  x: number;
  y: number;
  /** Gold remaining in this mine. */
  goldRemaining: number;
  /** Max workers that can mine simultaneously. */
  maxWorkers: number;
  /** IDs of workers currently inside the mine. */
  workerIds: string[];
}

// ─── Game State ─────────────────────────────────────────────────────────────

export interface GameState {
  tick: number;
  mapWidth: number;
  mapHeight: number;
  tiles: TileType[][];
  players: Record<string, Player>;
  entities: Record<string, Entity>;
  goldMines: GoldMine[];
}

// ─── Lobby Types ────────────────────────────────────────────────────────────

export interface RoomPlayer {
  id: string;
  name: string;
  color: string;
  faction: Faction;
  ready: boolean;
}

export interface Room {
  id: string;
  name: string;
  hostId: string;
  players: RoomPlayer[];
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'finished';
}

// ─── Socket Event Payloads ──────────────────────────────────────────────────

/** Client → Server lobby events. */
export interface ClientLobbyEvents {
  createRoom: (data: { playerName: string; roomName: string }) => void;
  createSinglePlayerGame: (data: { playerName: string }) => void;
  joinRoom: (data: { roomId: string; playerName: string }) => void;
  leaveRoom: () => void;
  playerReady: (data: { ready: boolean }) => void;
  setColor: (data: { color: string }) => void;
  startGame: () => void;
  requestRoomList: () => void;
}

/** Server → Client lobby events. */
export interface ServerLobbyEvents {
  roomList: (rooms: Room[]) => void;
  roomUpdate: (room: Room) => void;
  joinedRoom: (data: { room: Room; playerId: string }) => void;
  leftRoom: () => void;
  error: (data: { message: string }) => void;
  gameStart: (data: { gameState: GameState; playerId: string }) => void;
}

/** Client → Server game commands. */
export interface ClientGameEvents {
  moveUnits: (data: { unitIds: string[]; targetX: number; targetY: number }) => void;
  attackTarget: (data: { unitIds: string[]; targetId: string }) => void;
  buildStructure: (data: { workerId: string; buildingType: BuildingType; x: number; y: number }) => void;
  trainUnit: (data: { buildingId: string; unitType: EntityType }) => void;
  gatherResource: (data: { workerIds: string[]; mineId: string }) => void;
  upgradeUnit: (data: { armoryId: string; unitType: 'infantry' | 'archer' | 'cavalry' }) => void;
  depositGold: (data: { workerIds: string[]; depotId: string }) => void;
  setRallyPoint: (data: { buildingId: string; x: number; y: number }) => void;
}

/** Server → Client game events. */
export interface ServerGameEvents {
  gameState: (state: GameState) => void;
  gameOver: (data: { winnerId: string; reason: string }) => void;
}

/** Combined typed events for Socket.io. */
export type ClientToServerEvents = ClientLobbyEvents & ClientGameEvents;
export type ServerToClientEvents = ServerLobbyEvents & ServerGameEvents;
