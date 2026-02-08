/**
 * @file economy.ts
 * @description Economy system — handles worker gathering cycle, building construction,
 * and unit training queues.
 *
 * Worker gather cycle:
 *   1. Worker moves to mine (state: 'moving')
 *   2. Worker mines (state: 'gathering', ticks down)
 *   3. Worker returns to nearest depot/base (state: 'returning')
 *   4. Worker deposits gold, repeats
 *
 * @see constants.ts for all cost/timing values
 */

import { v4 as uuid } from 'uuid';
import type { GameState, Entity, GoldMine, Point, BuildingType, EntityType } from '@rts/shared';
import {
  WORKER_CARRY_CAPACITY,
  WORKER_MINE_TICKS,
  WORKER_TRAIN_TICKS,
  WORKER_COST,
  WORKER_SUPPLY,
  WORKER_HP,
  INFANTRY_TRAIN_TICKS,
  INFANTRY_COST,
  INFANTRY_SUPPLY,
  INFANTRY_HP,
  HOUSE_COST,
  HOUSE_HP,
  HOUSE_BUILD_TICKS,
  HOUSE_TILE_WIDTH,
  HOUSE_TILE_HEIGHT,
  HOUSE_SUPPLY,
  HOUSE_MAX_PER_PLAYER,
  BARRACKS_COST,
  BARRACKS_HP,
  BARRACKS_BUILD_TICKS,
  BARRACKS_TILE_WIDTH,
  BARRACKS_TILE_HEIGHT,
  RESOURCE_DEPOT_COST,
  RESOURCE_DEPOT_HP,
  RESOURCE_DEPOT_BUILD_TICKS,
  RESOURCE_DEPOT_TILE_WIDTH,
  RESOURCE_DEPOT_TILE_HEIGHT,
  HOME_BASE_TILE_WIDTH,
  HOME_BASE_TILE_HEIGHT,
  MAX_BUILD_DISTANCE,
  ARCHER_COST,
  ARCHER_SUPPLY,
  ARCHER_HP,
  ARCHER_TRAIN_TICKS,
  CAVALRY_COST,
  CAVALRY_SUPPLY,
  CAVALRY_HP,
  CAVALRY_TRAIN_TICKS,
  BALLISTA_COST,
  BALLISTA_SUPPLY,
  BALLISTA_HP,
  BALLISTA_TRAIN_TICKS,
  TOWER_COST,
  TOWER_HP,
  TOWER_BUILD_TICKS,
  TOWER_TILE_WIDTH,
  TOWER_TILE_HEIGHT,
  ARMORY_COST,
  ARMORY_HP,
  ARMORY_BUILD_TICKS,
  ARMORY_TILE_WIDTH,
  ARMORY_TILE_HEIGHT,
  getUpgradeCost,
  getUpgradeHpMultiplier,
} from '@rts/shared';
import { findPath } from '@rts/shared';
import { buildWalkableGrid, findAdjacentWalkable } from '../GameEngine.js';

/** Tracks per-worker gather timer (entity ID → ticks remaining at mine). */
const gatherTimers = new Map<string, number>();

/**
 * Processes economy each tick:
 * 1. Advance building construction (recalculates supply on completion).
 * 2. Advance training queues.
 * 3. Process pending build orders (workers walking to build sites).
 * 4. Process worker gather cycle.
 *
 * @param state - Current game state (mutated in place)
 * @param onSupplyChanged - Optional callback when supply needs recalculation.
 */
export function processEconomy(
  state: GameState,
  onSupplyChanged?: () => void
): void {
  const built = processConstruction(state);
  if (built && onSupplyChanged) onSupplyChanged();
  processTraining(state);
  processPendingBuilds(state);
  processGathering(state);
}

// ─── Construction ───────────────────────────────────────────────────────────

/** Advances build progress for buildings under construction. Returns true if any building completed. */
function processConstruction(state: GameState): boolean {
  let anyCompleted = false;
  for (const entity of Object.values(state.entities)) {
    if (entity.buildProgress === undefined) continue;
    if (entity.buildProgress >= 1) continue;

    const totalTicks = getBuildTicks(entity.type as BuildingType);
    if (totalTicks <= 0) continue;

    entity.buildProgress += 1 / totalTicks;
    if (entity.buildProgress >= 1) {
      entity.buildProgress = 1;
      entity.state = 'idle';
      anyCompleted = true;
    }
  }
  return anyCompleted;
}

// ─── Training ───────────────────────────────────────────────────────────────

/** Advances training queues and spawns units when ready. */
function processTraining(state: GameState): void {
  for (const building of Object.values(state.entities)) {
    if (!building.trainingQueue || building.trainingQueue.length === 0) continue;
    if (building.buildProgress !== undefined && building.buildProgress < 1) continue;

    const order = building.trainingQueue[0];
    order.ticksRemaining--;

    if (order.ticksRemaining <= 0) {
      // Spawn the unit near the building
      const spawnPos = findSpawnPosition(state, building);
      if (spawnPos) {
        const unitType = order.unitType;
        const player = state.players[building.ownerId];
        const baseHp = getUnitHp(unitType);
        // Apply upgrade HP bonus (only for combat units)
        const upgradeLevel = getPlayerUpgradeLevel(player, unitType);
        const hp = upgradeLevel > 0
          ? Math.round(baseHp * getUpgradeHpMultiplier(upgradeLevel))
          : baseHp;
        const newUnit: Entity = {
          id: uuid(),
          type: unitType,
          ownerId: building.ownerId,
          x: spawnPos.x,
          y: spawnPos.y,
          hp,
          maxHp: hp,
          state: 'idle',
        };
        state.entities[newUnit.id] = newUnit;

        // Auto-move to rally point if set
        if (building.rallyPoint) {
          const walkable = buildWalkableGrid(state);
          const start = { x: Math.round(spawnPos.x), y: Math.round(spawnPos.y) };
          const dest = { x: building.rallyPoint.x, y: building.rallyPoint.y };
          if (start.x !== dest.x || start.y !== dest.y) {
            const path = findPath(walkable, start, dest);
            if (path.length > 0) {
              newUnit.path = path;
              newUnit.state = 'moving';
            }
          }
        }
      }

      building.trainingQueue.shift();
      if (building.trainingQueue.length === 0) {
        building.state = 'idle';
      }
    }
  }
}

// ─── Gathering ──────────────────────────────────────────────────────────────

/** Processes the worker gather cycle for all gathering/returning workers. */
function processGathering(state: GameState): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.type !== 'worker') continue;

    // State: gathering (at mine, mining ticks)
    if (entity.state === 'gathering') {
      const timer = gatherTimers.get(entity.id) ?? WORKER_MINE_TICKS;
      // Update mining progress for client visualization
      entity.miningProgress = 1 - (timer / WORKER_MINE_TICKS);
      
      if (timer <= 1) {
        // Done mining — pick up gold, head back to depot
        gatherTimers.delete(entity.id);
        entity.miningProgress = undefined; // Clear progress when done
        entity.carriedGold = WORKER_CARRY_CAPACITY;

        // Remove worker from mine
        const mine = state.goldMines.find((m) => m.workerIds.includes(entity.id));
        if (mine) {
          mine.workerIds = mine.workerIds.filter((id) => id !== entity.id);
          mine.goldRemaining = Math.max(0, mine.goldRemaining - WORKER_CARRY_CAPACITY);
        }

        // Find nearest depot/base to return to
        const depot = findNearestDepot(state, entity);
        if (depot) {
          const walkable = buildWalkableGrid(state);
          const depotAdjacentTile = findAdjacentWalkable(walkable, depot);
          if (depotAdjacentTile) {
            const path = findPath(
              walkable,
              { x: Math.round(entity.x), y: Math.round(entity.y) },
              depotAdjacentTile
            );
            entity.path = path;
            entity.state = 'returning';
          } else {
            entity.state = 'idle';
          }
        } else {
          entity.state = 'idle';
        }
      } else {
        gatherTimers.set(entity.id, timer - 1);
      }
    }

    // State: returning (moving back to depot, handled by movement system)
    if (entity.state === 'returning' && (!entity.path || entity.path.length === 0)) {
      // Arrived at depot — deposit gold
      const player = state.players[entity.ownerId];
      if (player && entity.carriedGold && entity.carriedGold > 0) {
        player.gold += entity.carriedGold;
        entity.carriedGold = 0;
      }

      // Automatically go back to the mine if target still exists (continuous mining)
      if (entity.targetId) {
        const mine = state.goldMines.find((m) => m.id === entity.targetId);
        if (mine && mine.goldRemaining > 0) {
          // Check if mine is available (only one worker per mine)
          if (mine.workerIds.length < mine.maxWorkers) {
            const walkable = buildWalkableGrid(state);
            const mineAdjacentTile = findAdjacentWalkable(walkable, {
              x: mine.x,
              y: mine.y,
              tileWidth: 2,
              tileHeight: 2
            });
            if (mineAdjacentTile) {
              const path = findPath(
                walkable,
                { x: Math.round(entity.x), y: Math.round(entity.y) },
                mineAdjacentTile
              );
              if (path.length > 0) {
                entity.path = path;
                entity.state = 'moving';
                // Keep targetId so worker will auto-mine when arriving
              } else {
                // Can't reach mine - but keep targetId to retry
                entity.state = 'idle';
              }
            } else {
              // No adjacent walkable tile - but keep targetId to retry
              entity.state = 'idle';
            }
          } else {
            // Mine is occupied by another worker - wait and keep targetId
            // Worker will retry when mine becomes available
            entity.state = 'idle';
            // Keep targetId so worker will retry
          }
        } else {
          // Mine exhausted — clear target
          entity.state = 'idle';
          entity.targetId = undefined;
        }
      } else {
        entity.state = 'idle';
      }
    }

    // State: arrived at mine (path exhausted → automatically start gathering)
    // NOTE: movement.ts sets state to 'idle' when path is exhausted, so we must
    // check BOTH 'moving' (same-tick arrival) and 'idle' (next-tick after movement set idle).
    if ((entity.state === 'moving' || entity.state === 'idle') && entity.targetId && (!entity.path || entity.path.length === 0)) {
      const mine = state.goldMines.find((m) => m.id === entity.targetId);
      if (mine) {
        // Check if worker is adjacent to mine (within 2 tiles of mine center)
        const mineCenterX = mine.x + 1; // Center of 2x2 mine
        const mineCenterY = mine.y + 1;
        const dist = Math.sqrt(
          Math.pow(entity.x - mineCenterX, 2) + Math.pow(entity.y - mineCenterY, 2)
        );
        
        // Auto-start mining when worker arrives near mine (if mine is available)
        // Adjacent tiles are typically 1.5-2.5 tiles from center, use 3.0 as threshold
        if (dist <= 3.0) {
          if (mine.workerIds.length < mine.maxWorkers && mine.goldRemaining > 0) {
            // Mine is available - start mining
            mine.workerIds.push(entity.id);
            entity.state = 'gathering';
            entity.miningProgress = 0; // Start mining progress
            gatherTimers.set(entity.id, WORKER_MINE_TICKS);
          } else {
            // Mine unavailable (occupied or exhausted) - but keep targetId to retry later
            // Worker will wait/idle but keep trying
            entity.state = 'idle';
            // Don't clear targetId - worker will retry when mine becomes available
          }
        } else if (mine.workerIds.length < mine.maxWorkers && mine.goldRemaining > 0) {
          // Not close enough yet and mine has capacity — pathfind to adjacent tile.
          // Only pathfind when mine is available to avoid expensive A* every tick.
          const walkable = buildWalkableGrid(state);
          const mineAdjacentTile = findAdjacentWalkable(walkable, {
            x: mine.x,
            y: mine.y,
            tileWidth: 2,
            tileHeight: 2
          });
          if (mineAdjacentTile) {
            const path = findPath(
              walkable,
              { x: Math.round(entity.x), y: Math.round(entity.y) },
              mineAdjacentTile
            );
            if (path.length > 0) {
              entity.path = path;
              entity.state = 'moving';
              // Keep targetId so worker will mine when arriving
            } else {
              // Can't reach mine - clear target
              entity.targetId = undefined;
              entity.state = 'idle';
            }
          } else {
            // No adjacent walkable tile - clear target
            entity.targetId = undefined;
            entity.state = 'idle';
          }
        }
        // else: mine occupied or exhausted, stay idle with targetId to retry later
      } else {
        // Mine not found (maybe destroyed) - clear target
        entity.targetId = undefined;
        entity.state = 'idle';
      }
    }
  }
}

// ─── Command Handlers ───────────────────────────────────────────────────────

/**
 * Handles the 'trainUnit' command — queues a unit for training at a building.
 * Validates cost, supply, and building type.
 */
export function handleTrainUnit(
  state: GameState,
  playerId: string,
  buildingId: string,
  unitType: EntityType
): void {
  const building = state.entities[buildingId];
  if (!building || building.ownerId !== playerId) return;

  const player = state.players[playerId];
  if (!player) return;

  // Validate building can train this unit
  if (unitType === 'worker' && building.type !== 'homeBase') return;
  if (unitType === 'infantry' && building.type !== 'barracks') return;
  if (unitType === 'archer' && building.type !== 'barracks') return;
  if (unitType === 'cavalry' && building.type !== 'barracks') return;
  if (unitType === 'ballista' && building.type !== 'barracks') return;

  // Look up unit stats
  const { cost, supplyCost, trainTicks, hp } = getUnitTrainStats(unitType);
  if (cost <= 0) return; // Unknown unit type

  // Check cost and supply
  if (player.gold < cost) return;
  if (player.supply + supplyCost > player.maxSupply) return;

  // Building must be finished
  if (building.buildProgress !== undefined && building.buildProgress < 1) return;

  // Deduct cost and reserve supply
  player.gold -= cost;
  player.supply += supplyCost;

  // Add to training queue
  if (!building.trainingQueue) building.trainingQueue = [];
  building.trainingQueue.push({ unitType, ticksRemaining: trainTicks });
  building.state = 'training';
}

/**
 * Handles the 'buildStructure' command — a worker walks to the site then constructs.
 * Validates cost, placement, and building limits. If the worker is far from the site,
 * it pathfinds there first (pendingBuild). If close enough, it places immediately.
 */
export function handleBuildStructure(
  state: GameState,
  playerId: string,
  workerId: string,
  buildingType: BuildingType,
  x: number,
  y: number
): void {
  const worker = state.entities[workerId];
  if (!worker || worker.ownerId !== playerId || worker.type !== 'worker') return;

  const player = state.players[playerId];
  if (!player) return;

  const { cost, hp, tileW, tileH } = getBuildingStats(buildingType);

  // Check cost
  if (player.gold < cost) return;

  // House limit
  if (buildingType === 'house') {
    const houseCount = Object.values(state.entities).filter(
      (e) => e.type === 'house' && e.ownerId === playerId
    ).length;
    if (houseCount >= HOUSE_MAX_PER_PLAYER) return;
  }

  // Validate placement: tiles are clear and walkable
  if (!isPlacementValid(state, x, y, tileW, tileH)) return;

  // Deduct cost upfront (refunded if worker dies before placing)
  player.gold -= cost;

  // Check if worker is close enough to place immediately
  const distToSite = distToFootprint(worker, x, y, tileW, tileH);

  if (distToSite <= MAX_BUILD_DISTANCE) {
    // Close enough — place building now
    placeBuilding(state, playerId, buildingType, x, y, hp, tileW, tileH);
    worker.state = 'idle';
    worker.path = undefined;
    worker.targetId = undefined;
    worker.pendingBuild = undefined;
  } else {
    // Too far — walk to site first, then build on arrival
    worker.pendingBuild = { buildingType, x, y };
    worker.targetId = undefined;
    worker.miningProgress = undefined;

    // Pathfind worker to adjacent tile of the build footprint
    const walkable = buildWalkableGrid(state);
    const adjTile = findAdjacentWalkable(walkable, { x, y, tileWidth: tileW, tileHeight: tileH });
    if (adjTile) {
      const path = findPath(
        walkable,
        { x: Math.round(worker.x), y: Math.round(worker.y) },
        adjTile
      );
      if (path.length > 0) {
        worker.path = path;
        worker.state = 'moving';
      } else {
        // Can't reach — refund gold
        player.gold += cost;
        worker.pendingBuild = undefined;
        worker.state = 'idle';
      }
    } else {
      // No adjacent walkable tile — refund gold
      player.gold += cost;
      worker.pendingBuild = undefined;
      worker.state = 'idle';
    }
  }
}

/**
 * Processes workers with pending build orders who have arrived at the build site.
 * Called each tick from processEconomy.
 */
function processPendingBuilds(state: GameState): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.type !== 'worker' || !entity.pendingBuild) continue;

    // Only act when worker has stopped moving (idle or moving with empty path)
    if (entity.state !== 'idle' && !(entity.state === 'moving' && (!entity.path || entity.path.length === 0))) {
      continue;
    }

    const { buildingType, x, y } = entity.pendingBuild;
    const { hp, tileW, tileH } = getBuildingStats(buildingType);

    const dist = distToFootprint(entity, x, y, tileW, tileH);

    if (dist <= MAX_BUILD_DISTANCE) {
      // Arrived — verify placement is still valid (another building may have been placed there)
      if (isPlacementValid(state, x, y, tileW, tileH)) {
        placeBuilding(state, entity.ownerId, buildingType, x, y, hp, tileW, tileH);
      } else {
        // Placement no longer valid — refund gold
        const player = state.players[entity.ownerId];
        const { cost } = getBuildingStats(buildingType);
        if (player) player.gold += cost;
      }
      entity.pendingBuild = undefined;
      entity.state = 'idle';
      entity.path = undefined;
    }
    // else: still walking, movement system handles it
  }
}

/** Checks if building placement at (x, y) with given dimensions is valid. */
function isPlacementValid(
  state: GameState, x: number, y: number, tileW: number, tileH: number
): boolean {
  for (let dy = 0; dy < tileH; dy++) {
    for (let dx = 0; dx < tileW; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || tx >= state.mapWidth || ty < 0 || ty >= state.mapHeight) return false;
      if (state.tiles[ty][tx] !== 'grass') return false;
      // Check no other building occupies this tile
      for (const e of Object.values(state.entities)) {
        if (e.tileWidth && e.tileHeight) {
          if (
            tx >= e.x && tx < e.x + e.tileWidth &&
            ty >= e.y && ty < e.y + e.tileHeight
          ) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

/** Actually creates the building entity in the game state. */
function placeBuilding(
  state: GameState,
  ownerId: string,
  buildingType: BuildingType,
  x: number, y: number,
  hp: number,
  tileW: number, tileH: number
): void {
  const building: Entity = {
    id: uuid(),
    type: buildingType,
    ownerId,
    x,
    y,
    hp,
    maxHp: hp,
    state: 'building',
    buildProgress: 0,
    tileWidth: tileW,
    tileHeight: tileH,
  };
  state.entities[building.id] = building;
}

/** Distance from a unit to the nearest edge of a building footprint. */
function distToFootprint(
  unit: Entity, bx: number, by: number, bw: number, bh: number
): number {
  // Clamp unit position to footprint rect, then compute distance
  const cx = Math.max(bx, Math.min(bx + bw - 1, unit.x));
  const cy = Math.max(by, Math.min(by + bh - 1, unit.y));
  return Math.sqrt(Math.pow(unit.x - cx, 2) + Math.pow(unit.y - cy, 2));
}

/**
 * Handles the 'gatherResource' command — assigns workers to mine gold.
 * Sets the mine as target and pathfinds to it. Worker will auto-mine when arriving.
 */
export function handleGatherResource(
  state: GameState,
  playerId: string,
  workerIds: string[],
  mineId: string
): void {
  const mine = state.goldMines.find((m) => m.id === mineId);
  if (!mine || mine.goldRemaining <= 0) return;

  const walkable = buildWalkableGrid(state);

  for (const workerId of workerIds) {
    const worker = state.entities[workerId];
    if (!worker || worker.ownerId !== playerId || worker.type !== 'worker') continue;

    // Check if mine is available (only one worker per mine)
    if (mine.workerIds.length >= mine.maxWorkers) {
      // Mine already occupied, skip this worker
      continue;
    }

    // Set target mine (this will persist through the mining cycle)
    worker.targetId = mineId;

    // Pathfind to adjacent tile of the mine
    const mineAdjacentTile = findAdjacentWalkable(walkable, {
      x: mine.x,
      y: mine.y,
      tileWidth: 2,
      tileHeight: 2
    });
    if (mineAdjacentTile) {
      const workerTile = { x: Math.round(worker.x), y: Math.round(worker.y) };

      // If worker is already at the adjacent tile, start mining immediately
      if (workerTile.x === mineAdjacentTile.x && workerTile.y === mineAdjacentTile.y) {
        worker.path = [];
        worker.state = 'idle'; // economy tick will pick up idle+targetId and start gathering
      } else {
        const path = findPath(walkable, workerTile, mineAdjacentTile);
        if (path.length > 0) {
          worker.path = path;
          worker.state = 'moving';
          // targetId is already set, so worker will auto-mine when arriving
        } else {
          // Can't reach mine, clear target
          worker.targetId = undefined;
        }
      }
    } else {
      // No adjacent walkable tile found
      worker.targetId = undefined;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBuildTicks(type: BuildingType): number {
  switch (type) {
    case 'house': return HOUSE_BUILD_TICKS;
    case 'barracks': return BARRACKS_BUILD_TICKS;
    case 'resourceDepot': return RESOURCE_DEPOT_BUILD_TICKS;
    case 'tower': return TOWER_BUILD_TICKS;
    case 'armory': return ARMORY_BUILD_TICKS;
    default: return 60;
  }
}

function getBuildingStats(type: BuildingType) {
  switch (type) {
    case 'house':
      return { cost: HOUSE_COST, hp: HOUSE_HP, tileW: HOUSE_TILE_WIDTH, tileH: HOUSE_TILE_HEIGHT, buildTicks: HOUSE_BUILD_TICKS };
    case 'barracks':
      return { cost: BARRACKS_COST, hp: BARRACKS_HP, tileW: BARRACKS_TILE_WIDTH, tileH: BARRACKS_TILE_HEIGHT, buildTicks: BARRACKS_BUILD_TICKS };
    case 'resourceDepot':
      return { cost: RESOURCE_DEPOT_COST, hp: RESOURCE_DEPOT_HP, tileW: RESOURCE_DEPOT_TILE_WIDTH, tileH: RESOURCE_DEPOT_TILE_HEIGHT, buildTicks: RESOURCE_DEPOT_BUILD_TICKS };
    case 'tower':
      return { cost: TOWER_COST, hp: TOWER_HP, tileW: TOWER_TILE_WIDTH, tileH: TOWER_TILE_HEIGHT, buildTicks: TOWER_BUILD_TICKS };
    case 'armory':
      return { cost: ARMORY_COST, hp: ARMORY_HP, tileW: ARMORY_TILE_WIDTH, tileH: ARMORY_TILE_HEIGHT, buildTicks: ARMORY_BUILD_TICKS };
  }
}

function getUnitHp(type: EntityType): number {
  switch (type) {
    case 'worker': return WORKER_HP;
    case 'infantry': return INFANTRY_HP;
    case 'archer': return ARCHER_HP;
    case 'cavalry': return CAVALRY_HP;
    case 'ballista': return BALLISTA_HP;
    default: return 100;
  }
}

/** Returns cost, supply, train ticks, and HP for a trainable unit type. */
function getUnitTrainStats(type: EntityType) {
  switch (type) {
    case 'worker':
      return { cost: WORKER_COST, supplyCost: WORKER_SUPPLY, trainTicks: WORKER_TRAIN_TICKS, hp: WORKER_HP };
    case 'infantry':
      return { cost: INFANTRY_COST, supplyCost: INFANTRY_SUPPLY, trainTicks: INFANTRY_TRAIN_TICKS, hp: INFANTRY_HP };
    case 'archer':
      return { cost: ARCHER_COST, supplyCost: ARCHER_SUPPLY, trainTicks: ARCHER_TRAIN_TICKS, hp: ARCHER_HP };
    case 'cavalry':
      return { cost: CAVALRY_COST, supplyCost: CAVALRY_SUPPLY, trainTicks: CAVALRY_TRAIN_TICKS, hp: CAVALRY_HP };
    case 'ballista':
      return { cost: BALLISTA_COST, supplyCost: BALLISTA_SUPPLY, trainTicks: BALLISTA_TRAIN_TICKS, hp: BALLISTA_HP };
    default:
      return { cost: 0, supplyCost: 0, trainTicks: 0, hp: 0 };
  }
}

/**
 * Finds the nearest completed home base or resource depot owned by the worker's player.
 * Uses center-to-center distance for accuracy.
 */
function findNearestDepot(state: GameState, worker: Entity): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const e of Object.values(state.entities)) {
    if (e.ownerId !== worker.ownerId) continue;
    if (e.type !== 'homeBase' && e.type !== 'resourceDepot') continue;
    if (e.hp <= 0) continue;
    // Skip depots still under construction
    if (e.buildProgress !== undefined && e.buildProgress < 1) continue;

    // Use center of the building for distance calculation
    const centerX = e.x + (e.tileWidth ?? 1) / 2;
    const centerY = e.y + (e.tileHeight ?? 1) / 2;
    const d = Math.sqrt(Math.pow(centerX - worker.x, 2) + Math.pow(centerY - worker.y, 2));
    if (d < nearestDist) {
      nearestDist = d;
      nearest = e;
    }
  }

  return nearest;
}

/** Finds a spawn position adjacent to a building for newly trained units. */
function findSpawnPosition(state: GameState, building: Entity): Point | null {
  const walkable = buildWalkableGrid(state);
  return findAdjacentWalkable(walkable, building);
}

// ─── Upgrades (Armory) ──────────────────────────────────────────────────────

type UpgradeableUnit = 'infantry' | 'archer' | 'cavalry';

/** Returns the upgrade level for a specific unit type from a player's upgrades. */
function getPlayerUpgradeLevel(player: { upgrades?: { infantry: number; archer: number; cavalry: number } } | undefined, unitType: EntityType): number {
  if (!player?.upgrades) return 0;
  if (unitType === 'infantry') return player.upgrades.infantry;
  if (unitType === 'archer') return player.upgrades.archer;
  if (unitType === 'cavalry') return player.upgrades.cavalry;
  return 0;
}

/**
 * Handles the 'upgradeUnit' command — purchases an upgrade for a unit type at an armory.
 * Validates cost, building type, and completion state.
 */
export function handleUpgradeUnit(
  state: GameState,
  playerId: string,
  armoryId: string,
  unitType: UpgradeableUnit
): void {
  const armory = state.entities[armoryId];
  if (!armory || armory.ownerId !== playerId) return;
  if (armory.type !== 'armory') return;
  if (armory.buildProgress !== undefined && armory.buildProgress < 1) return;

  const player = state.players[playerId];
  if (!player) return;

  // Ensure upgrades object exists
  if (!player.upgrades) {
    player.upgrades = { infantry: 0, archer: 0, cavalry: 0 };
  }

  const currentLevel = player.upgrades[unitType];
  const cost = getUpgradeCost(currentLevel);

  if (player.gold < cost) return;

  player.gold -= cost;
  player.upgrades[unitType] = currentLevel + 1;
}

/**
 * Resets economy state (call when game ends or restarts).
 */
export function resetEconomy(): void {
  gatherTimers.clear();
}
