/**
 * @file GameEngine.ts
 * @description Main server-side game loop. Runs at 20 ticks/sec.
 * Orchestrates all game systems (movement, combat, economy) each tick.
 *
 * Key flow: dequeueCommands -> validateCommands -> runSystems -> broadcastState
 *
 * @see shared/src/types.ts for GameState shape
 * @see server/src/game/systems/ for individual system implementations
 */

import { v4 as uuid } from 'uuid';
import type { Server } from 'socket.io';
import type {
  GameState,
  Entity,
  Player,
  Room,
  ClientToServerEvents,
  ServerToClientEvents,
  BuildingType,
  EntityType,
} from '@rts/shared';
import {
  TICK_MS,
  getMapSize,
  STARTING_GOLD,
  HOME_BASE_HP,
  HOME_BASE_SUPPLY,
  HOME_BASE_TILE_WIDTH,
  HOME_BASE_TILE_HEIGHT,
  WORKER_HP,
  GOLD_MINE_TILE_WIDTH,
  GOLD_MINE_TILE_HEIGHT,
} from '@rts/shared';
import { findPath } from '@rts/shared';
import type { Point } from '@rts/shared';
import { generateMap } from './mapGenerator.js';
import { processMovement } from './systems/movement.js';
import { processCombat, recalculateSupply, resetCombat } from './systems/combat.js';
import {
  processEconomy,
  handleTrainUnit,
  handleBuildStructure,
  handleGatherResource,
  handleUpgradeUnit,
  resetEconomy,
} from './systems/economy.js';
import { BotAI } from './BotAI.js';

/** A queued command from a player. */
interface QueuedCommand {
  playerId: string;
  event: string;
  data: unknown;
}

/**
 * Builds a 2D walkability grid from the current game state.
 * A tile is walkable if it's grass and not occupied by a building/mine.
 */
export function buildWalkableGrid(state: GameState): boolean[][] {
  const walkable: boolean[][] = [];
  for (let y = 0; y < state.mapHeight; y++) {
    walkable[y] = [];
    for (let x = 0; x < state.mapWidth; x++) {
      walkable[y][x] = state.tiles[y][x] === 'grass';
    }
  }

  // Mark building footprints as non-walkable
  for (const entity of Object.values(state.entities) as Entity[]) {
    if (entity.tileWidth && entity.tileHeight) {
      for (let dy = 0; dy < entity.tileHeight; dy++) {
        for (let dx = 0; dx < entity.tileWidth; dx++) {
          const tx = Math.round(entity.x) + dx;
          const ty = Math.round(entity.y) + dy;
          if (tx >= 0 && tx < state.mapWidth && ty >= 0 && ty < state.mapHeight) {
            walkable[ty][tx] = false;
          }
        }
      }
    }
  }

  // Mark gold mine footprints as non-walkable
  for (const mine of state.goldMines) {
    for (let dy = 0; dy < GOLD_MINE_TILE_HEIGHT; dy++) {
      for (let dx = 0; dx < GOLD_MINE_TILE_WIDTH; dx++) {
        const tx = Math.round(mine.x) + dx;
        const ty = Math.round(mine.y) + dy;
        if (tx >= 0 && tx < state.mapWidth && ty >= 0 && ty < state.mapHeight) {
          walkable[ty][tx] = false;
        }
      }
    }
  }

  return walkable;
}

/**
 * Returns all walkable tiles adjacent to a building/mine footprint.
 * Useful for spreading multiple units around a target.
 */
export function findAllAdjacentWalkable(
  walkable: boolean[][],
  target: { x: number; y: number; tileWidth?: number; tileHeight?: number }
): Point[] {
  const w = target.tileWidth ?? 2;
  const h = target.tileHeight ?? 2;
  const height = walkable.length;
  const width = walkable[0]?.length ?? 0;

  const candidates: Point[] = [];
  for (let dx = -1; dx <= w; dx++) {
    for (let dy = -1; dy <= h; dy++) {
      // Only perimeter tiles
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue;

      const tx = Math.round(target.x) + dx;
      const ty = Math.round(target.y) + dy;
      if (tx >= 0 && tx < width && ty >= 0 && ty < height && walkable[ty] && walkable[ty][tx]) {
        candidates.push({ x: tx, y: ty });
      }
    }
  }
  return candidates;
}

/** Finds a walkable tile adjacent to a building/mine (first available). */
export function findAdjacentWalkable(
  walkable: boolean[][],
  target: { x: number; y: number; tileWidth?: number; tileHeight?: number }
): Point | null {
  const candidates = findAllAdjacentWalkable(walkable, target);
  return candidates.length > 0 ? candidates[0] : null;
}

/**
 * The main game engine. One instance per active game.
 * Created when a room host clicks "Start Game".
 */
export class GameEngine {
  private state: GameState;
  private commandQueue: QueuedCommand[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private io: Server<ClientToServerEvents, ServerToClientEvents>;
  private roomId: string;
  private startTime: number = Date.now();
  /** Bot AI instances, keyed by bot player ID. */
  private botAIs = new Map<string, BotAI>();

  constructor(
    room: Room,
    io: Server<ClientToServerEvents, ServerToClientEvents>
  ) {
    this.io = io;
    this.roomId = room.id;

    // Generate map (size scales with player count)
    const mapData = generateMap(room.players.length);
    const { width: mapWidth, height: mapHeight } = getMapSize(room.players.length);

    // Initialize players
    const players: Record<string, Player> = {};
    for (let i = 0; i < room.players.length; i++) {
      const rp = room.players[i];
      const isBot = rp.name.startsWith('[BOT]');
      players[rp.id] = {
        id: rp.id,
        name: rp.name,
        color: rp.color,
        faction: rp.faction,
        gold: STARTING_GOLD,
        supply: 0,
        maxSupply: HOME_BASE_SUPPLY,
        upgrades: { infantry: 0, archer: 0, cavalry: 0 },
      };
      // Create bot AI for bot players
      if (isBot) {
        this.botAIs.set(rp.id, new BotAI());
      }
    }

    // Initialize game state
    this.state = {
      tick: 0,
      mapWidth,
      mapHeight,
      tiles: mapData.tiles,
      players,
      entities: {},
      goldMines: mapData.goldMines,
    };

    // Place home bases and starting workers for each player
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
      const pid = playerIds[i];
      const spawn = mapData.spawnPoints[i];

      // Home base
      const homeBase: Entity = {
        id: uuid(),
        type: 'homeBase',
        ownerId: pid,
        x: spawn.x,
        y: spawn.y,
        hp: HOME_BASE_HP,
        maxHp: HOME_BASE_HP,
        state: 'idle',
        tileWidth: HOME_BASE_TILE_WIDTH,
        tileHeight: HOME_BASE_TILE_HEIGHT,
        trainingQueue: [],
      };
      this.state.entities[homeBase.id] = homeBase;

      // Starting worker
      const worker: Entity = {
        id: uuid(),
        type: 'worker',
        ownerId: pid,
        x: spawn.x + HOME_BASE_TILE_WIDTH + 1,
        y: spawn.y + 1,
        hp: WORKER_HP,
        maxHp: WORKER_HP,
        state: 'idle',
      };
      this.state.entities[worker.id] = worker;
    }

    // Calculate initial supply
    recalculateSupply(this.state);
  }

  /** Returns the current game state snapshot. */
  getState(): GameState {
    return this.state;
  }

  /** Queues a command from a player to be processed next tick. */
  handleCommand(playerId: string, event: string, data: unknown): void {
    this.commandQueue.push({ playerId, event, data });
  }

  /** Starts the game loop at TICK_RATE ticks per second. */
  start(): void {
    this.startTime = Date.now();
    this.intervalId = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stops the game loop. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    resetCombat();
    resetEconomy();
  }

  /** Single tick of the game loop. */
  private tick(): void {
    this.state.tick++;

    // 0. Process bot AI decisions (before human commands)
    this.processBotCommands();

    // 1. Process queued commands (from human players)
    this.processCommands();

    // 2. Run game systems in order
    processEconomy(this.state, () => recalculateSupply(this.state));
    processMovement(this.state);
    processCombat(this.state);

    // 3. Check win/loss conditions
    this.checkGameOver();

    // 4. Broadcast state to all players in the room
    this.io.to(this.roomId).emit('gameState', this.state);
  }

  /** Processes bot AI decisions and queues their commands. */
  private processBotCommands(): void {
    for (const [botPlayerId, botAI] of this.botAIs) {
      const commands = botAI.processTick(this.state, botPlayerId);
      for (const cmd of commands) {
        // Queue bot commands as if they came from the bot player
        this.commandQueue.push({
          playerId: botPlayerId,
          event: cmd.type,
          data: cmd.data,
        });
      }
    }
  }

  /** Processes all queued commands from players. */
  private processCommands(): void {
    const commands = this.commandQueue.splice(0);

    for (const cmd of commands) {
      switch (cmd.event) {
        case 'moveUnits':
          this.handleMoveUnits(cmd);
          break;
        case 'attackTarget':
          this.handleAttackTarget(cmd);
          break;
        case 'buildStructure':
          this.handleBuildStructure(cmd);
          break;
        case 'trainUnit':
          this.handleTrainUnit(cmd);
          break;
        case 'gatherResource':
          this.handleGatherResource(cmd);
          break;
        case 'upgradeUnit':
          this.handleUpgradeUnit(cmd);
          break;
        case 'depositGold':
          this.handleDepositGold(cmd);
          break;
        case 'setRallyPoint':
          this.handleSetRallyPoint(cmd);
          break;
      }
    }
  }

  private handleMoveUnits(cmd: QueuedCommand): void {
    const { unitIds, targetX, targetY } = cmd.data as {
      unitIds: string[];
      targetX: number;
      targetY: number;
    };

    const walkable = buildWalkableGrid(this.state);
    const baseTarget = { x: Math.round(targetX), y: Math.round(targetY) };

    // Check if target is a gold mine (for workers)
    let targetMine = this.state.goldMines.find((mine) => {
      return (
        baseTarget.x >= mine.x && baseTarget.x < mine.x + 2 &&
        baseTarget.y >= mine.y && baseTarget.y < mine.y + 2
      );
    }) || null;

    // For multiple units, spread them around the target to avoid all trying to occupy exact same tile
    const unitCount = unitIds.length;
    const spreadRadius = unitCount > 1 ? 1 : 0; // 1 tile radius for multiple units

    for (let i = 0; i < unitIds.length; i++) {
      const unitId = unitIds[i];
      const entity = this.state.entities[unitId];
      if (!entity || entity.ownerId !== cmd.playerId) continue;
      if (entity.type !== 'worker' && entity.type !== 'infantry' && entity.type !== 'archer' && entity.type !== 'cavalry' && entity.type !== 'ballista') continue;

      // If worker clicked on a mine, automatically set it as target and pathfind to adjacent tile
      if (entity.type === 'worker' && targetMine && targetMine.goldRemaining > 0) {
        // Check if mine is available (only one worker per mine)
        if (targetMine.workerIds.length < 1) {
          entity.targetId = targetMine.id;
          
          // Pathfind to adjacent tile of the mine (not the mine itself)
          const mineAdjacentTile = findAdjacentWalkable(walkable, {
            x: targetMine.x,
            y: targetMine.y,
            tileWidth: 2,
            tileHeight: 2
          });
          
          if (mineAdjacentTile) {
            const start = { x: Math.round(entity.x), y: Math.round(entity.y) };
            const path = findPath(walkable, start, mineAdjacentTile);
            if (path.length > 0) {
              entity.path = path;
              entity.state = 'moving';
              continue; // Skip normal pathfinding for this worker
            }
          }
          // If can't find adjacent tile, fall through to normal movement
        }
      }

      // Calculate offset for this unit (spread in a circle around target)
      let target = baseTarget;
      if (spreadRadius > 0 && unitCount > 1) {
        const angle = (i / unitCount) * Math.PI * 2;
        const offsetX = Math.round(Math.cos(angle) * spreadRadius);
        const offsetY = Math.round(Math.sin(angle) * spreadRadius);
        target = { 
          x: baseTarget.x + offsetX, 
          y: baseTarget.y + offsetY 
        };
        // Clamp to map bounds
        target.x = Math.max(0, Math.min(this.state.mapWidth - 1, target.x));
        target.y = Math.max(0, Math.min(this.state.mapHeight - 1, target.y));
      }

      const start = { x: Math.round(entity.x), y: Math.round(entity.y) };
      
      // Try to find path to offset target, fallback to base target if unreachable
      let path = findPath(walkable, start, target);
      if (path.length === 0 && (target.x !== baseTarget.x || target.y !== baseTarget.y)) {
        path = findPath(walkable, start, baseTarget);
      }

      if (path.length > 0) {
        entity.path = path;
        entity.state = 'moving';
        // Clear targetId for normal moves (not mine-targeted) to prevent stale auto-mining
        entity.targetId = undefined;
      }
    }
  }

  private handleAttackTarget(cmd: QueuedCommand): void {
    const { unitIds, targetId } = cmd.data as {
      unitIds: string[];
      targetId: string;
    };

    const target = this.state.entities[targetId];
    if (!target) return;

    const walkable = buildWalkableGrid(this.state);

    // For building targets, get all adjacent walkable tiles so units can spread around it
    let adjTiles: Point[] = [];
    if (target.tileWidth && target.tileHeight) {
      adjTiles = findAllAdjacentWalkable(walkable, target);
    }

    let adjIdx = 0;
    for (const unitId of unitIds) {
      const entity = this.state.entities[unitId];
      if (!entity || entity.ownerId !== cmd.playerId) continue;
      if (entity.type !== 'infantry' && entity.type !== 'archer' && entity.type !== 'cavalry' && entity.type !== 'ballista') continue;

      entity.targetId = targetId;
      entity.state = 'attacking';
      entity.pendingBuild = undefined;

      // Immediately pathfind toward the target so units start moving this tick
      const start = { x: Math.round(entity.x), y: Math.round(entity.y) };

      if (target.tileWidth && target.tileHeight && adjTiles.length > 0) {
        // Building: spread units across adjacent tiles (round-robin)
        const dest = adjTiles[adjIdx % adjTiles.length];
        adjIdx++;
        if (start.x !== dest.x || start.y !== dest.y) {
          const path = findPath(walkable, start, dest);
          if (path.length > 0) entity.path = path;
        }
      } else {
        // Unit target: pathfind directly
        const dest = { x: Math.round(target.x), y: Math.round(target.y) };
        if (start.x !== dest.x || start.y !== dest.y) {
          const path = findPath(walkable, start, dest);
          if (path.length > 0) entity.path = path;
        }
      }
    }
  }

  private handleBuildStructure(cmd: QueuedCommand): void {
    const { workerId, buildingType, x, y } = cmd.data as {
      workerId: string;
      buildingType: BuildingType;
      x: number;
      y: number;
    };
    handleBuildStructure(this.state, cmd.playerId, workerId, buildingType, x, y);
    // Recalculate supply in case a house was built
    recalculateSupply(this.state);
  }

  private handleTrainUnit(cmd: QueuedCommand): void {
    const { buildingId, unitType } = cmd.data as {
      buildingId: string;
      unitType: EntityType;
    };
    handleTrainUnit(this.state, cmd.playerId, buildingId, unitType);
  }

  private handleUpgradeUnit(cmd: QueuedCommand): void {
    const { armoryId, unitType } = cmd.data as {
      armoryId: string;
      unitType: 'infantry' | 'archer' | 'cavalry';
    };
    handleUpgradeUnit(this.state, cmd.playerId, armoryId, unitType);
  }

  private handleDepositGold(cmd: QueuedCommand): void {
    const { workerIds, depotId } = cmd.data as {
      workerIds: string[];
      depotId: string;
    };

    const depot = this.state.entities[depotId];
    if (!depot || depot.ownerId !== cmd.playerId) return;
    if (depot.type !== 'homeBase' && depot.type !== 'resourceDepot') return;
    if (depot.hp <= 0) return;

    const walkable = buildWalkableGrid(this.state);

    for (const workerId of workerIds) {
      const worker = this.state.entities[workerId];
      if (!worker || worker.ownerId !== cmd.playerId) continue;
      if (worker.type !== 'worker') continue;
      if (!worker.carriedGold || worker.carriedGold <= 0) continue;

      // Pathfind to an adjacent tile of the depot
      const adj = findAdjacentWalkable(walkable, depot);
      if (adj) {
        const start = { x: Math.round(worker.x), y: Math.round(worker.y) };
        const path = findPath(walkable, start, adj);
        if (path.length > 0) {
          worker.path = path;
          worker.state = 'returning';
          // Clear any mining target so the worker just deposits
          worker.targetId = undefined;
          worker.pendingBuild = undefined;
        }
      }
    }
  }

  private handleSetRallyPoint(cmd: QueuedCommand): void {
    const { buildingId, x, y } = cmd.data as {
      buildingId: string;
      x: number;
      y: number;
    };

    const building = this.state.entities[buildingId];
    if (!building || building.ownerId !== cmd.playerId) return;
    // Only buildings that train units can have rally points
    if (building.type !== 'homeBase' && building.type !== 'barracks') return;

    building.rallyPoint = { x: Math.round(x), y: Math.round(y) };
  }

  private handleGatherResource(cmd: QueuedCommand): void {
    const { workerIds, mineId } = cmd.data as {
      workerIds: string[];
      mineId: string;
    };
    handleGatherResource(this.state, cmd.playerId, workerIds, mineId);
  }

  /** Checks if any player has lost their home base → game over. */
  private checkGameOver(): void {
    const playerIds = Object.keys(this.state.players);
    const playersWithBase = new Set<string>();

    for (const entity of Object.values(this.state.entities) as Entity[]) {
      if (entity.type === 'homeBase' && entity.hp > 0) {
        playersWithBase.add(entity.ownerId);
      }
    }

    // Check if any player lost their base
    const eliminated = playerIds.filter((pid) => !playersWithBase.has(pid));
    if (eliminated.length > 0 && playersWithBase.size === 1) {
      const winnerId = Array.from(playersWithBase)[0];
      const durationSecs = Math.floor((Date.now() - this.startTime) / 1000);

      this.io.to(this.roomId).emit('gameOver', {
        winnerId,
        reason: `${this.state.players[winnerId]?.name ?? 'Unknown'} wins! Enemy base destroyed.`,
      });

      this.stop();

      // Import dynamically to avoid circular dep at module level
      import('../lobby.js').then(({ onGameEnd }) => onGameEnd(this.roomId));
      import('../db/index.js').then(({ recordMatch }) => {
        recordMatch(
          uuid(),
          winnerId,
          durationSecs,
          playerIds.map((pid) => ({
            id: pid,
            color: this.state.players[pid]?.color ?? '',
            faction: this.state.players[pid]?.faction ?? 'humans',
          }))
        ).catch((err) => console.error('Failed to record match:', err));
      });
    }
  }
}
