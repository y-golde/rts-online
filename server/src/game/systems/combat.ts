/**
 * @file combat.ts
 * @description Combat system — resolves attacks, applies damage, removes dead entities.
 * Also handles auto-aggro: idle infantry attack nearby enemies.
 *
 * @see constants.ts for INFANTRY_DAMAGE, INFANTRY_RANGE, INFANTRY_ATTACK_COOLDOWN, INFANTRY_AGGRO_RANGE
 */

import type { GameState, Entity, Point } from '@rts/shared';
import {
  INFANTRY_DAMAGE,
  INFANTRY_RANGE,
  INFANTRY_ATTACK_COOLDOWN,
  INFANTRY_AGGRO_RANGE,
  ARCHER_DAMAGE,
  ARCHER_RANGE,
  ARCHER_ATTACK_COOLDOWN,
  ARCHER_AGGRO_RANGE,
  CAVALRY_DAMAGE,
  CAVALRY_RANGE,
  CAVALRY_ATTACK_COOLDOWN,
  CAVALRY_AGGRO_RANGE,
  FOCUS_FIRE_BONUS,
  HOME_BASE_SUPPLY,
  HOUSE_SUPPLY,
  TOWER_DAMAGE,
  TOWER_RANGE,
  TOWER_ATTACK_COOLDOWN,
  HOME_BASE_DAMAGE,
  HOME_BASE_RANGE,
  HOME_BASE_ATTACK_COOLDOWN,
  BALLISTA_DAMAGE,
  BALLISTA_RANGE,
  BALLISTA_ATTACK_COOLDOWN,
  BALLISTA_AGGRO_RANGE,
  getUpgradeDamageMultiplier,
} from '@rts/shared';
import { findPath } from '@rts/shared';
import { buildWalkableGrid, findAllAdjacentWalkable } from '../GameEngine.js';

/** Per-entity cooldown tracker (entity ID → ticks until next attack). */
const attackCooldowns = new Map<string, number>();

/**
 * Processes combat each tick:
 * 1. Auto-aggro: idle infantry acquire nearby enemy targets.
 * 2. Attacking units deal damage if in range, or move toward target.
 * 3. Dead entities (HP <= 0) are removed and supply is recalculated.
 *
 * @param state - Current game state (mutated in place)
 */
export function processCombat(state: GameState): void {
  const entities = Object.values(state.entities) as Entity[];

  // ─── Tick down cooldowns ────────────────────────────────────────
  for (const [id, cd] of attackCooldowns) {
    if (cd > 0) attackCooldowns.set(id, cd - 1);
    else attackCooldowns.delete(id);
  }

  // ─── Auto-aggro for idle combat units ──────────────────────────
  for (const entity of entities) {
    if (!isCombatUnit(entity.type)) continue;
    if (entity.state !== 'idle') continue;

    const aggroRange = getAggroRange(entity);
    // Ballista only auto-targets enemy buildings
    const nearest = entity.type === 'ballista'
      ? findNearestEnemyBuilding(entity, entities)
      : findNearestEnemy(entity, entities);
    if (nearest && tileDistance(entity, nearest) <= aggroRange) {
      entity.targetId = nearest.id;
      entity.state = 'attacking';
    }
  }

  // ─── Defensive building auto-attack (towers + homeBase) ──────────────────
  for (const entity of entities) {
    if (entity.type !== 'tower' && entity.type !== 'homeBase') continue;
    if (entity.hp <= 0) continue;
    // Only completed buildings attack
    if (entity.buildProgress !== undefined && entity.buildProgress < 1) continue;

    const cd = attackCooldowns.get(entity.id) ?? 0;
    if (cd > 0) continue;

    // Stats differ per building type
    const bDamage = entity.type === 'homeBase' ? HOME_BASE_DAMAGE : TOWER_DAMAGE;
    const bRange = entity.type === 'homeBase' ? HOME_BASE_RANGE : TOWER_RANGE;
    const bCooldown = entity.type === 'homeBase' ? HOME_BASE_ATTACK_COOLDOWN : TOWER_ATTACK_COOLDOWN;

    // Find nearest enemy within range (use building center for distance)
    const centerX = entity.x + (entity.tileWidth ?? 2) / 2;
    const centerY = entity.y + (entity.tileHeight ?? 2) / 2;

    let bestTarget: Entity | null = null;
    let bestDist = Infinity;

    for (const other of entities) {
      if (other.ownerId === entity.ownerId) continue;
      if (other.hp <= 0) continue;

      let d: number;
      if (other.tileWidth && other.tileHeight) {
        const cx = Math.max(other.x, Math.min(other.x + other.tileWidth - 1, centerX));
        const cy = Math.max(other.y, Math.min(other.y + other.tileHeight - 1, centerY));
        d = Math.sqrt(Math.pow(centerX - cx, 2) + Math.pow(centerY - cy, 2));
      } else {
        d = Math.sqrt(Math.pow(centerX - other.x, 2) + Math.pow(centerY - other.y, 2));
      }

      if (d <= bRange && d < bestDist) {
        bestDist = d;
        bestTarget = other;
      }
    }

    if (bestTarget) {
      bestTarget.hp -= bDamage;
      attackCooldowns.set(entity.id, bCooldown);
      entity.targetId = bestTarget.id;
    } else {
      entity.targetId = undefined;
    }
  }

  // ─── Process attacks (two passes: resolve targeting, then apply batched damage) ─

  // Pass 1: resolve targeting & movement, collect who is hitting what this tick.
  // Map of targetId → list of attacker IDs that will deal damage this tick.
  const attackersPerTarget = new Map<string, string[]>();

  for (const entity of entities) {
    if (entity.state !== 'attacking') continue;
    if (!isCombatUnit(entity.type)) continue;
    if (!entity.targetId) {
      entity.state = 'idle';
      continue;
    }

    const target = state.entities[entity.targetId];
    if (!target || target.hp <= 0) {
      // Target dead or gone — find new target or go idle
      entity.targetId = undefined;
      entity.state = 'idle';
      continue;
    }

    // Use edge-to-edge distance for buildings so units next to
    // a large building are correctly considered "in range".
    const dist = distToEntity(entity, target);
    const attackRange = getAttackRange(entity);

    if (dist <= attackRange) {
      // In range — register this attacker if cooldown allows
      const cd = attackCooldowns.get(entity.id) ?? 0;
      if (cd <= 0) {
        const list = attackersPerTarget.get(entity.targetId) ?? [];
        list.push(entity.id);
        attackersPerTarget.set(entity.targetId, list);
      }
      // Stop moving while attacking
      entity.path = undefined;
    } else {
      // Out of range — move toward target
      if (!entity.path || entity.path.length === 0) {
        const walkable = buildWalkableGrid(state);

        // For buildings: pathfind to an adjacent walkable tile (not INTO the building).
        // For units: pathfind to the unit's tile directly.
        let destination: { x: number; y: number } | null = null;

        if (target.tileWidth && target.tileHeight) {
          // Building target — find adjacent tiles, pick closest to this attacker
          const candidates = findAllAdjacentWalkable(walkable, target);
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const da = Math.pow(a.x - entity.x, 2) + Math.pow(a.y - entity.y, 2);
              const db = Math.pow(b.x - entity.x, 2) + Math.pow(b.y - entity.y, 2);
              return da - db;
            });
            destination = candidates[0];
          }
        } else {
          destination = { x: Math.round(target.x), y: Math.round(target.y) };
        }

        if (destination) {
          const start = { x: Math.round(entity.x), y: Math.round(entity.y) };
          // Already at destination?
          if (start.x === destination.x && start.y === destination.y) {
            // Close enough — will be in range next distance check
            entity.path = undefined;
          } else {
            const path = findPath(walkable, start, destination);
            if (path.length > 0) {
              entity.path = path;
            } else {
              // Can't reach target
              entity.targetId = undefined;
              entity.state = 'idle';
            }
          }
        } else {
          entity.targetId = undefined;
          entity.state = 'idle';
        }
      }
    }
  }

  // Pass 2: apply batched damage with focus-fire bonus.
  // Each attacker deals baseDamage * (1 + FOCUS_FIRE_BONUS * (numCoAttackers - 1)).
  for (const [targetId, attackerIds] of attackersPerTarget) {
    const target = state.entities[targetId];
    if (!target || target.hp <= 0) continue;

    const count = attackerIds.length;
    const multiplier = 1 + FOCUS_FIRE_BONUS * (count - 1);

    for (const attackerId of attackerIds) {
      const attacker = state.entities[attackerId];
      if (!attacker) continue;
      const baseDmg = getAttackDamage(attacker, target);
      const cooldown = getAttackCooldown(attacker);
      // Apply player's upgrade bonus
      const upgradeLevel = getAttackerUpgradeLevel(state, attacker);
      const upgradeMult = upgradeLevel > 0 ? getUpgradeDamageMultiplier(upgradeLevel) : 1;
      target.hp -= Math.round(baseDmg * multiplier * upgradeMult);
      attackCooldowns.set(attackerId, cooldown);
    }
  }

  // ─── Remove dead entities ───────────────────────────────────────
  const deadIds: string[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.hp <= 0) {
      deadIds.push(entity.id);
    }
  }

  for (const id of deadIds) {
    const dead = state.entities[id];
    if (dead) {
      delete state.entities[id];
      attackCooldowns.delete(id);
    }
  }

  // ─── Recalculate supply after deaths ────────────────────────────
  if (deadIds.length > 0) {
    recalculateSupply(state);
  }
}

/** Recalculates maxSupply for all players based on their buildings. */
export function recalculateSupply(state: GameState): void {
  // Reset max supply
  for (const player of Object.values(state.players)) {
    player.maxSupply = 0;
    player.supply = 0;
  }

  for (const entity of Object.values(state.entities)) {
    const player = state.players[entity.ownerId];
    if (!player) continue;

    if (entity.type === 'homeBase' && entity.hp > 0) {
      player.maxSupply += HOME_BASE_SUPPLY;
    } else if (entity.type === 'house' && entity.hp > 0 && (entity.buildProgress === undefined || entity.buildProgress >= 1)) {
      player.maxSupply += HOUSE_SUPPLY;
    } else if (entity.type === 'worker' || entity.type === 'infantry' || entity.type === 'archer' || entity.type === 'cavalry' || entity.type === 'ballista') {
      const supplyCost = entity.type === 'worker' ? 1 : entity.type === 'infantry' ? 2 : entity.type === 'archer' ? 3 : entity.type === 'cavalry' ? 4 : 5;
      player.supply += supplyCost;
    }
  }
}

/**
 * Finds the nearest enemy entity to the given entity.
 */
function findNearestEnemy(entity: Entity, all: Entity[]): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const other of all) {
    if (other.ownerId === entity.ownerId) continue;
    if (other.hp <= 0) continue;

    const d = tileDistance(entity, other);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = other;
    }
  }

  return nearest;
}

/**
 * Finds the nearest enemy building (has tileWidth) to the given entity.
 * Used by ballista auto-aggro.
 */
function findNearestEnemyBuilding(entity: Entity, all: Entity[]): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const other of all) {
    if (other.ownerId === entity.ownerId) continue;
    if (other.hp <= 0) continue;
    if (!other.tileWidth || !other.tileHeight) continue; // Only buildings

    const d = distToEntity(entity, other);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = other;
    }
  }

  return nearest;
}

/** Euclidean distance between two points in tile coords. */
function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distance from entity `a` to the nearest edge of entity `b`.
 * For buildings (with tileWidth/tileHeight), clamps to the footprint rect.
 * For units, falls back to simple point-to-point distance.
 */
function distToEntity(a: Entity, b: Entity): number {
  if (b.tileWidth && b.tileHeight) {
    // Clamp a's position to b's footprint, then measure distance
    const cx = Math.max(b.x, Math.min(b.x + b.tileWidth - 1, a.x));
    const cy = Math.max(b.y, Math.min(b.y + b.tileHeight - 1, a.y));
    return Math.sqrt(Math.pow(a.x - cx, 2) + Math.pow(a.y - cy, 2));
  }
  return tileDistance(a, b);
}

// ─── Combat-unit helpers ────────────────────────────────────────────────────

/** Returns true if the entity type is a combat unit. */
function isCombatUnit(type: string): boolean {
  return type === 'infantry' || type === 'archer' || type === 'cavalry' || type === 'ballista';
}

/** Returns the attack range for a combat entity. */
function getAttackRange(entity: Entity): number {
  switch (entity.type) {
    case 'archer': return ARCHER_RANGE;
    case 'cavalry': return CAVALRY_RANGE;
    case 'ballista': return BALLISTA_RANGE;
    default: return INFANTRY_RANGE;
  }
}

/** Returns the base attack damage for a combat entity against a given target. */
function getAttackDamage(entity: Entity, target?: Entity): number {
  switch (entity.type) {
    case 'archer': return ARCHER_DAMAGE;
    case 'cavalry': return CAVALRY_DAMAGE;
    case 'ballista':
      // Ballista only damages buildings — 0 damage to units
      if (target && !target.tileWidth) return 0;
      return BALLISTA_DAMAGE;
    default: return INFANTRY_DAMAGE;
  }
}

/** Returns the attack cooldown (ticks) for a combat entity. */
function getAttackCooldown(entity: Entity): number {
  switch (entity.type) {
    case 'archer': return ARCHER_ATTACK_COOLDOWN;
    case 'cavalry': return CAVALRY_ATTACK_COOLDOWN;
    case 'ballista': return BALLISTA_ATTACK_COOLDOWN;
    default: return INFANTRY_ATTACK_COOLDOWN;
  }
}

/** Returns the auto-aggro range for a combat entity. */
function getAggroRange(entity: Entity): number {
  switch (entity.type) {
    case 'archer': return ARCHER_AGGRO_RANGE;
    case 'cavalry': return CAVALRY_AGGRO_RANGE;
    case 'ballista': return BALLISTA_AGGRO_RANGE;
    default: return INFANTRY_AGGRO_RANGE;
  }
}

/** Returns the player's upgrade level for a given combat unit. */
function getAttackerUpgradeLevel(state: GameState, entity: Entity): number {
  const player = state.players[entity.ownerId];
  if (!player?.upgrades) return 0;
  if (entity.type === 'infantry') return player.upgrades.infantry;
  if (entity.type === 'archer') return player.upgrades.archer;
  if (entity.type === 'cavalry') return player.upgrades.cavalry;
  return 0;
}

/**
 * Resets combat state (call when game ends or restarts).
 */
export function resetCombat(): void {
  attackCooldowns.clear();
}
