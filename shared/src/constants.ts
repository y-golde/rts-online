/**
 * @file constants.ts
 * @description All game balance numbers, tick rate, unit/building stats, and costs.
 * This is the single source of truth — no magic numbers elsewhere in the codebase.
 *
 * @see types.ts for the interfaces these stats apply to.
 */

// ─── Tick & Timing ──────────────────────────────────────────────────────────

/** Server game loop ticks per second. */
export const TICK_RATE = 20;
/** Milliseconds per tick. */
export const TICK_MS = 1000 / TICK_RATE;

// ─── Map ────────────────────────────────────────────────────────────────────

/** Map dimensions in tiles. Scaled by player count. */
export const MAP_WIDTH_BASE = 60; // Base size for 1v1
export const MAP_HEIGHT_BASE = 60;
/** Additional tiles per extra player beyond 2. */
export const MAP_SIZE_PER_PLAYER = 20;

/**
 * Calculates map dimensions based on player count.
 * 1v1: 60x60, 2v2: 80x80, 3v3: 100x100, etc.
 */
export function getMapSize(playerCount: number): { width: number; height: number } {
  const extraPlayers = Math.max(0, playerCount - 2);
  const size = MAP_WIDTH_BASE + extraPlayers * MAP_SIZE_PER_PLAYER;
  return { width: size, height: size };
}

/** Legacy constants for backwards compatibility (use getMapSize instead). */
export const MAP_WIDTH = MAP_WIDTH_BASE;
export const MAP_HEIGHT = MAP_HEIGHT_BASE;

/** Pixel size of a single tile at default zoom. */
export const TILE_SIZE = 32;

/** Number of gold mines to place on the map. */
export const GOLD_MINE_COUNT = 8;

// ─── Starting Resources ────────────────────────────────────────────────────

export const STARTING_GOLD = 300;
export const STARTING_SUPPLY = 0;

// ─── Home Base ──────────────────────────────────────────────────────────────

export const HOME_BASE_HP = 2000;
export const HOME_BASE_SUPPLY = 10;
/** Home base footprint in tiles. */
export const HOME_BASE_TILE_WIDTH = 3;
export const HOME_BASE_TILE_HEIGHT = 3;
/** Home base attack damage (2x tower damage). */
export const HOME_BASE_DAMAGE = 30;
/** Home base attack range in tiles. */
export const HOME_BASE_RANGE = 7;
/** Ticks between home base attacks. */
export const HOME_BASE_ATTACK_COOLDOWN = 20;

// ─── Worker ─────────────────────────────────────────────────────────────────

export const WORKER_COST = 50;
export const WORKER_SUPPLY = 1;
export const WORKER_HP = 60;
/** Tiles per tick a worker moves. */
export const WORKER_SPEED = 0.15;
/** Gold a worker carries per trip. */
export const WORKER_CARRY_CAPACITY = 10;
/** Ticks a worker spends mining before carrying gold back. */
export const WORKER_MINE_TICKS = 40;
/** Ticks to train a worker. */
export const WORKER_TRAIN_TICKS = 30;

// ─── Infantry ───────────────────────────────────────────────────────────────

export const INFANTRY_COST = 100;
export const INFANTRY_SUPPLY = 2;
export const INFANTRY_HP = 120;
export const INFANTRY_SPEED = 0.12;
export const INFANTRY_DAMAGE = 12;
/** Attack range in tiles. */
export const INFANTRY_RANGE = 1.5;
/** Ticks between attacks. */
export const INFANTRY_ATTACK_COOLDOWN = 15;
/** Ticks to train infantry. */
export const INFANTRY_TRAIN_TICKS = 40;
/** Aggro range — auto-attack enemies within this tile radius. */
export const INFANTRY_AGGRO_RANGE = 6;
/** Bonus damage per additional attacker on the same target (e.g. 0.15 = +15% per extra unit). */
export const FOCUS_FIRE_BONUS = 0.15;

// ─── Archer ─────────────────────────────────────────────────────────────────

export const ARCHER_COST = 150;
export const ARCHER_SUPPLY = 3;
export const ARCHER_HP = 80;
export const ARCHER_SPEED = 0.11;
export const ARCHER_DAMAGE = 10;
/** Archer attack range in tiles (ranged unit). */
export const ARCHER_RANGE = 5;
/** Ticks between archer attacks. */
export const ARCHER_ATTACK_COOLDOWN = 18;
/** Ticks to train an archer. */
export const ARCHER_TRAIN_TICKS = 50;
/** Aggro range — auto-attack enemies within this tile radius. */
export const ARCHER_AGGRO_RANGE = 7;

// ─── Cavalry ────────────────────────────────────────────────────────────────

export const CAVALRY_COST = 200;
export const CAVALRY_SUPPLY = 4;
export const CAVALRY_HP = 130;
export const CAVALRY_SPEED = 0.24;
export const CAVALRY_DAMAGE = 14;
/** Cavalry attack range in tiles (melee). */
export const CAVALRY_RANGE = 1.5;
/** Ticks between cavalry attacks. */
export const CAVALRY_ATTACK_COOLDOWN = 14;
/** Ticks to train cavalry. */
export const CAVALRY_TRAIN_TICKS = 55;
/** Aggro range — auto-attack enemies within this tile radius. */
export const CAVALRY_AGGRO_RANGE = 7;

// ─── Ballista ───────────────────────────────────────────────────────────────

export const BALLISTA_COST = 250;
export const BALLISTA_SUPPLY = 5;
export const BALLISTA_HP = 50;
export const BALLISTA_SPEED = 0.06;
/** Ballista damage (buildings only). */
export const BALLISTA_DAMAGE = 40;
/** Ballista attack range — outranges towers and castles. */
export const BALLISTA_RANGE = 10;
/** Ticks between ballista attacks. */
export const BALLISTA_ATTACK_COOLDOWN = 30;
/** Ticks to train a ballista. */
export const BALLISTA_TRAIN_TICKS = 70;
/** Aggro range for auto-targeting buildings. */
export const BALLISTA_AGGRO_RANGE = 12;

// ─── House ──────────────────────────────────────────────────────────────────

export const HOUSE_COST = 100;
export const HOUSE_HP = 400;
export const HOUSE_SUPPLY = 10;
/** Maximum houses per player. */
export const HOUSE_MAX_PER_PLAYER = 5;
export const HOUSE_BUILD_TICKS = 60;
export const HOUSE_TILE_WIDTH = 2;
export const HOUSE_TILE_HEIGHT = 2;

// ─── Barracks ───────────────────────────────────────────────────────────────

export const BARRACKS_COST = 200;
export const BARRACKS_HP = 600;
export const BARRACKS_BUILD_TICKS = 80;
export const BARRACKS_TILE_WIDTH = 3;
export const BARRACKS_TILE_HEIGHT = 3;

// ─── Resource Depot ─────────────────────────────────────────────────────────

export const RESOURCE_DEPOT_COST = 150;
export const RESOURCE_DEPOT_HP = 500;
export const RESOURCE_DEPOT_BUILD_TICKS = 50;
export const RESOURCE_DEPOT_TILE_WIDTH = 2;
export const RESOURCE_DEPOT_TILE_HEIGHT = 2;

// ─── Tower ──────────────────────────────────────────────────────────────────

export const TOWER_COST = 100;
export const TOWER_HP = 500;
export const TOWER_BUILD_TICKS = 60;
export const TOWER_TILE_WIDTH = 2;
export const TOWER_TILE_HEIGHT = 2;
/** Tower attack damage per shot. */
export const TOWER_DAMAGE = 15;
/** Tower attack range in tiles. */
export const TOWER_RANGE = 7;
/** Ticks between tower attacks. */
export const TOWER_ATTACK_COOLDOWN = 20;

// ─── Armory ─────────────────────────────────────────────────────────────────

export const ARMORY_COST = 250;
export const ARMORY_HP = 600;
export const ARMORY_BUILD_TICKS = 80;
export const ARMORY_TILE_WIDTH = 3;
export const ARMORY_TILE_HEIGHT = 3;

// ─── Upgrades (from Armory) ─────────────────────────────────────────────────

/** Base gold cost for the first upgrade. */
export const UPGRADE_BASE_COST = 100;
/** Cost multiplier per level: cost = base * scale^level. (100, 200, 400, 800, 1600, ...) */
export const UPGRADE_COST_SCALE = 2.0;
/** Damage bonus per upgrade level (e.g. 0.12 = +12% per level, compounding). */
export const UPGRADE_DAMAGE_BONUS = 0.12;
/** HP bonus per upgrade level. */
export const UPGRADE_HP_BONUS = 0.10;

/**
 * Returns the gold cost for the next upgrade at a given level.
 * Level 0 → 100, Level 1 → 200, Level 2 → 400, Level 3 → 800, ...
 */
export function getUpgradeCost(currentLevel: number): number {
  return Math.round(UPGRADE_BASE_COST * Math.pow(UPGRADE_COST_SCALE, currentLevel));
}

/**
 * Returns the damage multiplier for a given upgrade level.
 * Level 0 → 1.0, Level 1 → 1.12, Level 2 → 1.2544, ...
 */
export function getUpgradeDamageMultiplier(level: number): number {
  return Math.pow(1 + UPGRADE_DAMAGE_BONUS, level);
}

/**
 * Returns the HP multiplier for a given upgrade level.
 * Level 0 → 1.0, Level 1 → 1.10, Level 2 → 1.21, ...
 */
export function getUpgradeHpMultiplier(level: number): number {
  return Math.pow(1 + UPGRADE_HP_BONUS, level);
}

// ─── Building Placement ─────────────────────────────────────────────────────

/** Max distance (tiles) a worker can be from a build site to place instantly. */
export const MAX_BUILD_DISTANCE = 3;

// ─── Gold Mine ──────────────────────────────────────────────────────────────

export const GOLD_MINE_STARTING_GOLD = 2000;
export const GOLD_MINE_MAX_WORKERS = 1; // Only one worker per mine (Warcraft-style)
export const GOLD_MINE_TILE_WIDTH = 2;
export const GOLD_MINE_TILE_HEIGHT = 2;

// ─── Player Colors ──────────────────────────────────────────────────────────

export const PLAYER_COLORS = [
  '#3498db', // blue
  '#e74c3c', // red
  '#2ecc71', // green
  '#f39c12', // orange
] as const;

// ─── Visuals (emoji + render hints) ─────────────────────────────────────────

export const ENTITY_VISUALS: Record<string, { emoji: string; label: string }> = {
  homeBase: { emoji: '🏰', label: 'Home Base' },
  worker: { emoji: '👷', label: 'Worker' },
  house: { emoji: '🏠', label: 'House' },
  barracks: { emoji: '🛡️', label: 'Barracks' },
  resourceDepot: { emoji: '📦', label: 'Depot' },
  tower: { emoji: '🗼', label: 'Tower' },
  armory: { emoji: '🔨', label: 'Armory' },
  infantry: { emoji: '⚔️', label: 'Infantry' },
  archer: { emoji: '🏹', label: 'Archer' },
  cavalry: { emoji: '🐴', label: 'Cavalry' },
  ballista: { emoji: '🎯', label: 'Ballista' },
  goldMine: { emoji: '⛏️', label: 'Gold Mine' },
};
