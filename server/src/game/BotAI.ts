/**
 * @file BotAI.ts
 * @description Simple bot AI for single-player mode.
 * Makes decisions each tick: build workers, gather resources, build structures, train units, attack.
 *
 * Strategy:
 * 1. Always train workers if supply allows and gold available
 * 2. Assign idle workers to gather from nearest gold mine
 * 3. Build houses when supply is getting low (at 70% capacity)
 * 4. Build barracks when have enough gold and supply
 * 5. Train infantry when barracks exists and have resources
 * 6. Attack with infantry when have a small army (3+ units)
 *
 * @see GameEngine.ts for how bot commands are processed
 */

import type { GameState, Entity, GoldMine, Point } from '@rts/shared';
import {
  WORKER_COST,
  WORKER_SUPPLY,
  HOUSE_COST,
  HOUSE_MAX_PER_PLAYER,
  BARRACKS_COST,
  INFANTRY_COST,
  INFANTRY_SUPPLY,
  INFANTRY_AGGRO_RANGE,
} from '@rts/shared';
import { findPath } from '@rts/shared';
import { buildWalkableGrid } from './GameEngine.js';

/**
 * Bot AI controller. One instance per bot player.
 * Called each tick by GameEngine to make decisions.
 */
export class BotAI {
  /** Last tick when we checked for actions (throttle decision-making). */
  private lastDecisionTick = 0;
  /** Decision interval: make a decision every N ticks. */
  private readonly DECISION_INTERVAL = 5;

  /**
   * Processes bot decisions for this tick.
   * Returns an array of commands to execute.
   */
  processTick(state: GameState, botPlayerId: string): Array<{
    type: 'trainUnit' | 'buildStructure' | 'moveUnits' | 'attackTarget' | 'gatherResource';
    data: unknown;
  }> {
    const commands: Array<{
      type: 'trainUnit' | 'buildStructure' | 'moveUnits' | 'attackTarget' | 'gatherResource';
      data: unknown;
    }> = [];

    // Throttle decisions (don't spam commands every tick)
    if (state.tick - this.lastDecisionTick < this.DECISION_INTERVAL) {
      return commands;
    }
    this.lastDecisionTick = state.tick;

    const player = state.players[botPlayerId];
    if (!player) return commands;

    const myEntities = Object.values(state.entities).filter((e) => e.ownerId === botPlayerId);
    const homeBase = myEntities.find((e) => e.type === 'homeBase');
    const workers = myEntities.filter((e) => e.type === 'worker');
    const houses = myEntities.filter((e) => e.type === 'house' && (e.buildProgress === undefined || e.buildProgress >= 1));
    const barracks = myEntities.filter((e) => e.type === 'barracks' && (e.buildProgress === undefined || e.buildProgress >= 1));
    const infantry = myEntities.filter((e) => e.type === 'infantry');

    // ─── 1. Train Workers ──────────────────────────────────────────
    if (homeBase && player.gold >= WORKER_COST && player.supply + WORKER_SUPPLY <= player.maxSupply) {
      const hasQueueSpace = !homeBase.trainingQueue || homeBase.trainingQueue.length < 3;
      if (hasQueueSpace) {
        commands.push({
          type: 'trainUnit',
          data: { buildingId: homeBase.id, unitType: 'worker' },
        });
      }
    }

    // ─── 2. Assign idle workers to gather ─────────────────────────
    const idleWorkers = workers.filter((w) => w.state === 'idle' || w.state === 'moving');
    if (idleWorkers.length > 0) {
      const nearestMine = findNearestGoldMine(state, idleWorkers[0]);
      if (nearestMine && nearestMine.goldRemaining > 0) {
        const workerIds = idleWorkers.slice(0, Math.min(3, nearestMine.maxWorkers - nearestMine.workerIds.length))
          .map((w) => w.id);
        if (workerIds.length > 0) {
          commands.push({
            type: 'gatherResource',
            data: { workerIds, mineId: nearestMine.id },
          });
        }
      }
    }

    // ─── 3. Build houses if supply is getting low ──────────────────
    if (houses.length < HOUSE_MAX_PER_PLAYER && player.gold >= HOUSE_COST) {
      const supplyPercent = player.maxSupply > 0 ? player.supply / player.maxSupply : 0;
      if (supplyPercent >= 0.7) {
        const idleWorker = workers.find((w) => w.state === 'idle' || w.state === 'moving');
        if (idleWorker) {
          const buildPos = findBuildPosition(state, idleWorker, 2, 2);
          if (buildPos) {
            commands.push({
              type: 'buildStructure',
              data: { workerId: idleWorker.id, buildingType: 'house', x: buildPos.x, y: buildPos.y },
            });
          }
        }
      }
    }

    // ─── 4. Build barracks if have enough resources ───────────────
    if (barracks.length === 0 && player.gold >= BARRACKS_COST && player.supply + INFANTRY_SUPPLY <= player.maxSupply) {
      const idleWorker = workers.find((w) => w.state === 'idle' || w.state === 'moving');
      if (idleWorker) {
        const buildPos = findBuildPosition(state, idleWorker, 3, 3);
        if (buildPos) {
          commands.push({
            type: 'buildStructure',
            data: { workerId: idleWorker.id, buildingType: 'barracks', x: buildPos.x, y: buildPos.y },
          });
        }
      }
    }

    // ─── 5. Train infantry ────────────────────────────────────────
    if (barracks.length > 0 && player.gold >= INFANTRY_COST && player.supply + INFANTRY_SUPPLY <= player.maxSupply) {
      for (const barrack of barracks) {
        const hasQueueSpace = !barrack.trainingQueue || barrack.trainingQueue.length < 2;
        if (hasQueueSpace) {
          commands.push({
            type: 'trainUnit',
            data: { buildingId: barrack.id, unitType: 'infantry' },
          });
          break; // Only queue one at a time
        }
      }
    }

    // ─── 6. Attack with infantry ───────────────────────────────────
    if (infantry.length >= 3) {
      const idleInfantry = infantry.filter((i) => i.state === 'idle' || i.state === 'moving');
      if (idleInfantry.length >= 2) {
        // Find nearest enemy base
        const enemyBase = findNearestEnemyBase(state, idleInfantry[0], botPlayerId);
        if (enemyBase) {
          const dist = tileDistance(idleInfantry[0], enemyBase);
          if (dist <= INFANTRY_AGGRO_RANGE * 2) {
            // Close enough — attack!
            commands.push({
              type: 'attackTarget',
              data: { unitIds: idleInfantry.map((i) => i.id), targetId: enemyBase.id },
            });
          } else {
            // Move toward enemy base
            const walkable = buildWalkableGrid(state);
            const path = findPath(
              walkable,
              { x: Math.round(idleInfantry[0].x), y: Math.round(idleInfantry[0].y) },
              { x: Math.round(enemyBase.x), y: Math.round(enemyBase.y) }
            );
            if (path.length > 0) {
              commands.push({
                type: 'moveUnits',
                data: {
                  unitIds: idleInfantry.map((i) => i.id),
                  targetX: path[path.length - 1].x,
                  targetY: path[path.length - 1].y,
                },
              });
            }
          }
        }
      }
    }

    return commands;
  }
}

// ─── Helper Functions ───────────────────────────────────────────────

/**
 * Finds the nearest gold mine to a worker that has gold remaining.
 */
function findNearestGoldMine(state: GameState, worker: Entity): GoldMine | null {
  let nearest: GoldMine | null = null;
  let nearestDist = Infinity;

  for (const mine of state.goldMines) {
    if (mine.goldRemaining <= 0) continue;
    const dist = Math.sqrt(
      Math.pow(mine.x - worker.x, 2) + Math.pow(mine.y - worker.y, 2)
    );
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = mine;
    }
  }

  return nearest;
}

/**
 * Finds a valid build position near a worker.
 * Returns null if no valid position found.
 */
function findBuildPosition(
  state: GameState,
  worker: Entity,
  tileW: number,
  tileH: number
): Point | null {
  const walkable = buildWalkableGrid(state);
  const searchRadius = 8;

  // Search in a spiral around the worker
  for (let r = 2; r <= searchRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) < r && Math.abs(dy) < r) continue; // Skip inner ring

        const tx = Math.round(worker.x) + dx;
        const ty = Math.round(worker.y) + dy;

        // Check if all tiles are clear and walkable
        let valid = true;
        for (let h = 0; h < tileH && valid; h++) {
          for (let w = 0; w < tileW && valid; w++) {
            const checkX = tx + w;
            const checkY = ty + h;
            if (
              checkX < 0 || checkX >= state.mapWidth ||
              checkY < 0 || checkY >= state.mapHeight ||
              !walkable[checkY][checkX]
            ) {
              valid = false;
            }
            // Check no building occupies this tile
            for (const e of Object.values(state.entities)) {
              if (e.tileWidth && e.tileHeight) {
                if (
                  checkX >= e.x && checkX < e.x + e.tileWidth &&
                  checkY >= e.y && checkY < e.y + e.tileHeight
                ) {
                  valid = false;
                  break;
                }
              }
            }
          }
        }

        if (valid) {
          return { x: tx, y: ty };
        }
      }
    }
  }

  return null;
}

/**
 * Finds the nearest enemy home base.
 */
function findNearestEnemyBase(
  state: GameState,
  from: Entity,
  myPlayerId: string
): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const entity of Object.values(state.entities)) {
    if (entity.type !== 'homeBase') continue;
    if (entity.ownerId === myPlayerId) continue;
    if (entity.hp <= 0) continue;

    const dist = tileDistance(from, entity);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = entity;
    }
  }

  return nearest;
}

/**
 * Euclidean distance between two entities in tile coords.
 */
function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
