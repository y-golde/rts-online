/**
 * @file regression.test.ts
 * @description Regression tests for core game mechanics.
 *
 * Run: pnpm test
 *
 * Tests cover:
 *   - Mining cycle: move → mine → return gold → deposit → auto-repeat
 *   - Building placement: worker must walk to build site
 *   - Multiple buildings: player can build >1 house and barracks
 *   - Supply: recalculated when construction completes
 *   - Nearest depot: workers use closest completed depot
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState, Entity, GoldMine, TileType } from '@rts/shared';
import {
  WORKER_SPEED,
  WORKER_MINE_TICKS,
  WORKER_CARRY_CAPACITY,
  HOUSE_COST,
  HOUSE_HP,
  HOUSE_TILE_WIDTH,
  HOUSE_TILE_HEIGHT,
  HOUSE_SUPPLY,
  BARRACKS_COST,
  BARRACKS_TILE_WIDTH,
  BARRACKS_TILE_HEIGHT,
  HOME_BASE_SUPPLY,
  STARTING_GOLD,
  MAX_BUILD_DISTANCE,
  HOUSE_BUILD_TICKS,
  RESOURCE_DEPOT_COST,
  RESOURCE_DEPOT_HP,
  RESOURCE_DEPOT_TILE_WIDTH,
  RESOURCE_DEPOT_TILE_HEIGHT,
  RESOURCE_DEPOT_BUILD_TICKS,
  INFANTRY_DAMAGE,
  INFANTRY_ATTACK_COOLDOWN,
  INFANTRY_HP,
  INFANTRY_TRAIN_TICKS,
  FOCUS_FIRE_BONUS,
  TOWER_COST,
  TOWER_HP,
  TOWER_DAMAGE,
  TOWER_RANGE,
  TOWER_ATTACK_COOLDOWN,
  TOWER_BUILD_TICKS,
  TOWER_TILE_WIDTH,
  TOWER_TILE_HEIGHT,
  ARCHER_COST,
  ARCHER_SUPPLY,
  ARCHER_HP,
  ARCHER_DAMAGE,
  ARCHER_RANGE,
  ARCHER_ATTACK_COOLDOWN,
  ARCHER_TRAIN_TICKS,
  INFANTRY_RANGE,
  CAVALRY_COST,
  CAVALRY_SUPPLY,
  CAVALRY_HP,
  CAVALRY_DAMAGE,
  CAVALRY_TRAIN_TICKS,
  CAVALRY_SPEED,
  INFANTRY_SPEED,
  ARMORY_COST,
  ARMORY_HP,
  ARMORY_BUILD_TICKS,
  ARMORY_TILE_WIDTH,
  ARMORY_TILE_HEIGHT,
  getUpgradeCost,
  getUpgradeDamageMultiplier,
  getUpgradeHpMultiplier,
  HOME_BASE_DAMAGE,
  HOME_BASE_RANGE,
  HOME_BASE_ATTACK_COOLDOWN,
  HOME_BASE_HP,
  HOME_BASE_TILE_WIDTH,
  HOME_BASE_TILE_HEIGHT,
  BALLISTA_COST,
  BALLISTA_SUPPLY,
  BALLISTA_HP,
  BALLISTA_DAMAGE,
  BALLISTA_RANGE,
  BALLISTA_TRAIN_TICKS,
  BALLISTA_ATTACK_COOLDOWN,
  BALLISTA_SPEED,
} from '@rts/shared';
import {
  processEconomy,
  handleGatherResource,
  handleBuildStructure,
  handleTrainUnit,
  handleUpgradeUnit,
  resetEconomy,
} from '../src/game/systems/economy.js';
import { processMovement } from '../src/game/systems/movement.js';
import { processCombat, recalculateSupply, resetCombat } from '../src/game/systems/combat.js';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const MAP_W = 30;
const MAP_H = 30;

/** Creates a minimal valid game state for testing. */
function createTestState(overrides?: Partial<GameState>): GameState {
  const tiles: TileType[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    tiles.push(new Array(MAP_W).fill('grass') as TileType[]);
  }

  return {
    tick: 0,
    mapWidth: MAP_W,
    mapHeight: MAP_H,
    tiles,
    players: {
      p1: {
        id: 'p1',
        name: 'Tester',
        color: '#3498db',
        faction: 'humans',
        gold: STARTING_GOLD,
        supply: 1, // 1 worker
        maxSupply: HOME_BASE_SUPPLY,
      },
    },
    entities: {},
    goldMines: [],
    ...overrides,
  };
}

/** Creates a worker entity. */
function createWorker(id: string, x: number, y: number): Entity {
  return {
    id, type: 'worker', ownerId: 'p1',
    x, y, hp: 60, maxHp: 60, state: 'idle',
  };
}

/** Creates a home base entity. */
function createHomeBase(x: number, y: number): Entity {
  return {
    id: 'base1', type: 'homeBase', ownerId: 'p1',
    x, y, hp: 2000, maxHp: 2000, state: 'idle',
    tileWidth: 3, tileHeight: 3,
  };
}

/** Creates a gold mine. */
function createMine(id: string, x: number, y: number): GoldMine {
  return {
    id, x, y, goldRemaining: 2000, maxWorkers: 1, workerIds: [],
  };
}

/** Mark mine tiles as rock (non-walkable) in the tile grid. */
function markMineTiles(state: GameState, mine: GoldMine): void {
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      state.tiles[mine.y + dy][mine.x + dx] = 'rock';
    }
  }
}

/** Runs N ticks of economy + movement, same order as GameEngine. */
function runTicks(state: GameState, n: number, onSupplyChanged?: () => void): void {
  for (let i = 0; i < n; i++) {
    state.tick++;
    processEconomy(state, onSupplyChanged);
    processMovement(state);
  }
}

// ─── Mining Tests ───────────────────────────────────────────────────────────

describe('Mining cycle', () => {
  let state: GameState;
  let mine: GoldMine;

  beforeEach(() => {
    resetEconomy();
    mine = createMine('mine1', 10, 10);
    state = createTestState({
      entities: {
        base1: createHomeBase(2, 2),
        worker1: createWorker('worker1', 5, 5),
      },
      goldMines: [mine],
    });
    // Mark base tiles as non-walkable (handled by buildWalkableGrid, but mark mine tiles)
    markMineTiles(state, mine);
  });

  it('worker pathfinds to mine, gathers, returns, deposits, and auto-repeats', () => {
    handleGatherResource(state, 'p1', ['worker1'], 'mine1');

    const w = () => state.entities.worker1;
    expect(w().state).toBe('moving');
    expect(w().targetId).toBe('mine1');
    expect(w().path!.length).toBeGreaterThan(0);

    // Run until mining starts (max 200 ticks for safety)
    let miningStarted = false;
    for (let i = 0; i < 200; i++) {
      runTicks(state, 1);
      if (w().state === 'gathering') { miningStarted = true; break; }
    }
    expect(miningStarted).toBe(true);
    expect(mine.workerIds).toContain('worker1');

    // Run through mining duration
    runTicks(state, WORKER_MINE_TICKS + 5);
    // Worker should be returning with gold
    expect(w().carriedGold).toBe(WORKER_CARRY_CAPACITY);
    expect(w().state).toBe('returning');

    // Run until gold is deposited
    const initialGold = state.players.p1.gold;
    for (let i = 0; i < 300; i++) {
      runTicks(state, 1);
      if (state.players.p1.gold > initialGold) break;
    }
    expect(state.players.p1.gold).toBe(initialGold + WORKER_CARRY_CAPACITY);

    // Worker should auto-return to mine (moving or already gathering again)
    let secondCycleStarted = false;
    for (let i = 0; i < 300; i++) {
      runTicks(state, 1);
      if (w().state === 'gathering') { secondCycleStarted = true; break; }
    }
    expect(secondCycleStarted).toBe(true);
  });

  it('idle worker with targetId near mine auto-starts mining (movement→idle race)', () => {
    // This tests the specific bug: processMovement sets state='idle' before
    // processEconomy sees the worker. Economy must also check idle+targetId.
    const w = state.entities.worker1;
    // Place worker adjacent to mine manually
    w.x = 9;
    w.y = 9;
    w.targetId = 'mine1';
    w.state = 'idle';
    w.path = undefined;

    // One tick should start mining
    runTicks(state, 1);
    expect(w.state).toBe('gathering');
    expect(mine.workerIds).toContain('worker1');
  });
});

// ─── Building Placement Tests ───────────────────────────────────────────────

describe('Building placement', () => {
  let state: GameState;

  beforeEach(() => {
    resetEconomy();
    state = createTestState({
      entities: {
        base1: createHomeBase(2, 2),
        worker1: createWorker('worker1', 5, 5),
      },
      goldMines: [],
    });
    recalculateSupply(state);
  });

  it('worker close to build site places building immediately', () => {
    const buildX = 6;
    const buildY = 6;

    handleBuildStructure(state, 'p1', 'worker1', 'house', buildX, buildY);

    // Building should exist
    const buildings = Object.values(state.entities).filter(e => e.type === 'house');
    expect(buildings.length).toBe(1);
    expect(buildings[0].x).toBe(buildX);
    expect(buildings[0].y).toBe(buildY);
    expect(buildings[0].buildProgress).toBe(0);
    expect(state.players.p1.gold).toBe(STARTING_GOLD - HOUSE_COST);
  });

  it('worker far from build site walks there first (pendingBuild)', () => {
    const buildX = 20;
    const buildY = 20;

    handleBuildStructure(state, 'p1', 'worker1', 'house', buildX, buildY);

    const w = state.entities.worker1;
    // Worker should have pendingBuild and be moving
    expect(w.pendingBuild).toBeDefined();
    expect(w.pendingBuild!.buildingType).toBe('house');
    expect(w.state).toBe('moving');
    expect(w.path!.length).toBeGreaterThan(0);

    // Building should NOT exist yet
    const buildings = Object.values(state.entities).filter(e => e.type === 'house');
    expect(buildings.length).toBe(0);

    // Gold should be deducted (held in escrow)
    expect(state.players.p1.gold).toBe(STARTING_GOLD - HOUSE_COST);

    // Run ticks until building is placed
    let placed = false;
    for (let i = 0; i < 500; i++) {
      runTicks(state, 1);
      const houses = Object.values(state.entities).filter(e => e.type === 'house');
      if (houses.length > 0) { placed = true; break; }
    }
    expect(placed).toBe(true);
    expect(state.entities.worker1.pendingBuild).toBeUndefined();
  });

  it('can build multiple houses', () => {
    // Place worker centrally so all build sites are within MAX_BUILD_DISTANCE
    state.entities.worker1.x = 8;
    state.entities.worker1.y = 8;
    state.players.p1.gold = 500;

    // All positions within 3 tiles of worker and non-overlapping (2x2 each)
    handleBuildStructure(state, 'p1', 'worker1', 'house', 7, 7);  // dist ~1.4
    handleBuildStructure(state, 'p1', 'worker1', 'house', 7, 10); // dist ~2.2
    handleBuildStructure(state, 'p1', 'worker1', 'house', 10, 7); // dist ~2.2

    const houses = Object.values(state.entities).filter(e => e.type === 'house');
    expect(houses.length).toBe(3);
    expect(state.players.p1.gold).toBe(500 - HOUSE_COST * 3);
  });

  it('can build a barracks after a house', () => {
    state.entities.worker1.x = 8;
    state.entities.worker1.y = 8;
    state.players.p1.gold = 500;

    handleBuildStructure(state, 'p1', 'worker1', 'house', 7, 7);    // 2x2, dist ~1.4
    handleBuildStructure(state, 'p1', 'worker1', 'barracks', 10, 7); // 3x3, dist ~2.2

    const houses = Object.values(state.entities).filter(e => e.type === 'house');
    const barracks = Object.values(state.entities).filter(e => e.type === 'barracks');
    expect(houses.length).toBe(1);
    expect(barracks.length).toBe(1);
    expect(state.players.p1.gold).toBe(500 - HOUSE_COST - BARRACKS_COST);
  });

  it('rejects building on occupied tiles', () => {
    state.entities.worker1.x = 3;
    state.entities.worker1.y = 3;

    // Try to build on the home base (tiles 2,2 to 4,4)
    handleBuildStructure(state, 'p1', 'worker1', 'house', 3, 3);

    const houses = Object.values(state.entities).filter(e => e.type === 'house');
    expect(houses.length).toBe(0);
    // Gold should NOT be deducted
    expect(state.players.p1.gold).toBe(STARTING_GOLD);
  });

  it('refunds gold if worker cannot reach build site', () => {
    // Surround the build location with water so it's unreachable
    for (let y = 24; y <= 28; y++) {
      for (let x = 24; x <= 28; x++) {
        state.tiles[y][x] = 'water';
      }
    }
    // Leave the actual build spot as grass but surrounded by water
    state.tiles[26][26] = 'grass';
    state.tiles[26][27] = 'grass';
    state.tiles[27][26] = 'grass';
    state.tiles[27][27] = 'grass';

    handleBuildStructure(state, 'p1', 'worker1', 'house', 26, 26);

    // Gold should be refunded since worker can't reach
    expect(state.players.p1.gold).toBe(STARTING_GOLD);
    expect(state.entities.worker1.pendingBuild).toBeUndefined();
  });
});

// ─── Supply Recalculation Tests ─────────────────────────────────────────────

describe('Supply recalculation', () => {
  let state: GameState;

  beforeEach(() => {
    resetEconomy();
    state = createTestState({
      entities: {
        base1: createHomeBase(2, 2),
        worker1: createWorker('worker1', 6, 6),
      },
      goldMines: [],
    });
    recalculateSupply(state);
  });

  it('initial supply from home base is correct', () => {
    expect(state.players.p1.maxSupply).toBe(HOME_BASE_SUPPLY);
    expect(state.players.p1.supply).toBe(1); // 1 worker
  });

  it('maxSupply increases when house construction completes', () => {
    // Place a house (worker is close)
    handleBuildStructure(state, 'p1', 'worker1', 'house', 7, 7);
    recalculateSupply(state);

    // House is under construction — should NOT add supply yet
    const initialMax = state.players.p1.maxSupply;
    expect(initialMax).toBe(HOME_BASE_SUPPLY);

    // Run ticks until house finishes, with supply recalc callback
    let supplyUpdated = false;
    for (let i = 0; i < HOUSE_BUILD_TICKS + 10; i++) {
      runTicks(state, 1, () => {
        recalculateSupply(state);
        supplyUpdated = true;
      });
    }

    expect(supplyUpdated).toBe(true);
    expect(state.players.p1.maxSupply).toBe(HOME_BASE_SUPPLY + HOUSE_SUPPLY);
  });
});

// ─── Nearest Depot Tests ────────────────────────────────────────────────────

describe('Nearest depot selection', () => {
  let state: GameState;
  let mine: GoldMine;

  beforeEach(() => {
    resetEconomy();
    mine = createMine('mine1', 20, 20);
    state = createTestState({
      entities: {
        base1: createHomeBase(2, 2), // far from mine
        worker1: createWorker('worker1', 15, 15), // a few tiles away from mine
      },
      goldMines: [mine],
    });
    markMineTiles(state, mine);
  });

  it('worker returns to closer completed depot instead of distant home base', () => {
    // Place a completed resource depot near the mine
    const depot: Entity = {
      id: 'depot1', type: 'resourceDepot', ownerId: 'p1',
      x: 17, y: 17,
      hp: RESOURCE_DEPOT_HP, maxHp: RESOURCE_DEPOT_HP,
      state: 'idle',
      buildProgress: 1, // completed
      tileWidth: RESOURCE_DEPOT_TILE_WIDTH,
      tileHeight: RESOURCE_DEPOT_TILE_HEIGHT,
    };
    state.entities.depot1 = depot;

    // Start mining
    handleGatherResource(state, 'p1', ['worker1'], 'mine1');

    // Run until worker starts returning
    let returning = false;
    for (let i = 0; i < 200; i++) {
      runTicks(state, 1);
      if (state.entities.worker1.state === 'returning') {
        returning = true;
        break;
      }
    }
    expect(returning).toBe(true);

    // The path should lead toward the depot (17,17), not the home base (2,2)
    const w = state.entities.worker1;
    const lastPathPoint = w.path![w.path!.length - 1];
    // Last path point should be near the depot, not near the home base
    const distToDepot = Math.sqrt(
      Math.pow(lastPathPoint.x - 18, 2) + Math.pow(lastPathPoint.y - 18, 2)
    );
    const distToBase = Math.sqrt(
      Math.pow(lastPathPoint.x - 3.5, 2) + Math.pow(lastPathPoint.y - 3.5, 2)
    );
    expect(distToDepot).toBeLessThan(distToBase);
  });

  it('worker ignores depot still under construction', () => {
    // Manually set up a worker that just finished mining and needs to return.
    // This avoids the timing issue where the depot finishes construction
    // during the mining duration.
    const w = state.entities.worker1;
    w.x = 19;
    w.y = 19;
    w.carriedGold = WORKER_CARRY_CAPACITY;
    w.targetId = 'mine1';
    w.state = 'gathering'; // Will complete immediately on next tick

    // Place an under-construction depot near the mine
    const depot: Entity = {
      id: 'depot1', type: 'resourceDepot', ownerId: 'p1',
      x: 17, y: 17,
      hp: RESOURCE_DEPOT_HP, maxHp: RESOURCE_DEPOT_HP,
      state: 'building',
      buildProgress: 0.5, // still building
      tileWidth: RESOURCE_DEPOT_TILE_WIDTH,
      tileHeight: RESOURCE_DEPOT_TILE_HEIGHT,
    };
    state.entities.depot1 = depot;

    // Add worker to mine's workerIds
    mine.workerIds = [w.id];

    // Run 1 tick — worker should finish "gathering" (timer starts at WORKER_MINE_TICKS,
    // but since we didn't set a timer, it defaults to WORKER_MINE_TICKS and needs more ticks)
    // Set timer to 1 so it finishes immediately
    // We need to run enough ticks for the gather timer to expire
    // Actually, just run 2 ticks: economy will see gathering and set timer, then decrement
    runTicks(state, 2);

    // Fast-forward gather timer by running remaining WORKER_MINE_TICKS
    for (let i = 0; i < WORKER_MINE_TICKS + 2; i++) {
      // Freeze depot construction so it doesn't finish
      depot.buildProgress = 0.5;
      runTicks(state, 1);
      if (w.state === 'returning') break;
    }

    expect(w.state).toBe('returning');

    // Path should go toward home base (2,2), not the unfinished depot (17,17)
    if (w.path && w.path.length > 0) {
      const lastPathPoint = w.path[w.path.length - 1];
      const distToDepot = Math.sqrt(
        Math.pow(lastPathPoint.x - 18, 2) + Math.pow(lastPathPoint.y - 18, 2)
      );
      const distToBase = Math.sqrt(
        Math.pow(lastPathPoint.x - 3.5, 2) + Math.pow(lastPathPoint.y - 3.5, 2)
      );
      expect(distToBase).toBeLessThan(distToDepot);
    }
  });
});

// ─── Combat / Focus Fire Tests ──────────────────────────────────────────────

describe('Combat focus fire', () => {
  /** Creates an infantry entity for a given player. */
  function createInfantry(id: string, owner: string, x: number, y: number): Entity {
    return {
      id, type: 'infantry', ownerId: owner,
      x, y, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
  }

  let state: GameState;

  beforeEach(() => {
    resetEconomy();
    resetCombat();
    state = createTestState({
      entities: {},
      goldMines: [],
      players: {
        p1: { id: 'p1', name: 'Attacker', color: '#3498db', faction: 'humans',
              gold: 300, supply: 6, maxSupply: 20 },
        p2: { id: 'p2', name: 'Defender', color: '#e74c3c', faction: 'humans',
              gold: 300, supply: 0, maxSupply: 20 },
      },
    });
  });

  it('single attacker deals base damage', () => {
    const target: Entity = {
      id: 'target', type: 'homeBase', ownerId: 'p2',
      x: 10, y: 10, hp: 2000, maxHp: 2000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.target = target;

    // Place one infantry in range
    const inf1 = createInfantry('inf1', 'p1', 10, 10);
    inf1.state = 'attacking';
    inf1.targetId = 'target';
    state.entities.inf1 = inf1;

    processCombat(state);

    // 1 attacker → multiplier = 1 + 0.15 * 0 = 1.0 → damage = 12
    expect(target.hp).toBe(2000 - INFANTRY_DAMAGE);
  });

  it('multiple attackers get focus-fire bonus damage', () => {
    const target: Entity = {
      id: 'target', type: 'homeBase', ownerId: 'p2',
      x: 10, y: 10, hp: 2000, maxHp: 2000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.target = target;

    // Place 3 infantry all in range (same tile — units can share tiles)
    for (let i = 1; i <= 3; i++) {
      const inf = createInfantry(`inf${i}`, 'p1', 10, 10);
      inf.state = 'attacking';
      inf.targetId = 'target';
      state.entities[inf.id] = inf;
    }

    processCombat(state);

    // 3 attackers → multiplier = 1 + 0.15 * 2 = 1.3 → damage per unit = round(12 * 1.3) = 16
    // Total = 16 * 3 = 48
    const expectedPerUnit = Math.round(INFANTRY_DAMAGE * (1 + FOCUS_FIRE_BONUS * 2));
    const expectedTotal = expectedPerUnit * 3;
    expect(target.hp).toBe(2000 - expectedTotal);
  });

  it('focus fire deals more total damage than separate attacks', () => {
    // Scenario A: 3 infantry attacking the SAME target (focus fire)
    const targetA: Entity = {
      id: 'tA', type: 'homeBase', ownerId: 'p2',
      x: 10, y: 10, hp: 2000, maxHp: 2000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.tA = targetA;

    for (let i = 1; i <= 3; i++) {
      const inf = createInfantry(`infA${i}`, 'p1', 10, 10);
      inf.state = 'attacking';
      inf.targetId = 'tA';
      state.entities[inf.id] = inf;
    }

    processCombat(state);
    const focusDamage = 2000 - targetA.hp;

    // Scenario B: compare to 3 × single-attacker damage
    const singleDamage = INFANTRY_DAMAGE * 3; // no bonus

    expect(focusDamage).toBeGreaterThan(singleDamage);
  });

  it('attackers on different targets do not share bonus', () => {
    const t1: Entity = {
      id: 't1', type: 'house', ownerId: 'p2',
      x: 10, y: 10, hp: 400, maxHp: 400, state: 'idle',
      tileWidth: 2, tileHeight: 2,
    };
    const t2: Entity = {
      id: 't2', type: 'house', ownerId: 'p2',
      x: 15, y: 15, hp: 400, maxHp: 400, state: 'idle',
      tileWidth: 2, tileHeight: 2,
    };
    state.entities.t1 = t1;
    state.entities.t2 = t2;

    // 1 infantry on each target — no bonus
    const inf1 = createInfantry('inf1', 'p1', 10, 10);
    inf1.state = 'attacking';
    inf1.targetId = 't1';
    state.entities.inf1 = inf1;

    const inf2 = createInfantry('inf2', 'p1', 15, 15);
    inf2.state = 'attacking';
    inf2.targetId = 't2';
    state.entities.inf2 = inf2;

    processCombat(state);

    // Each target takes base damage only (multiplier = 1.0)
    expect(t1.hp).toBe(400 - INFANTRY_DAMAGE);
    expect(t2.hp).toBe(400 - INFANTRY_DAMAGE);
  });

  it('infantry adjacent to building edge are in range (edge distance)', () => {
    // 3x3 building at (10,10) → occupies tiles 10-12 in x and y.
    // Infantry at (9, 11) is adjacent to the left edge → distance should be ~1, in range.
    const target: Entity = {
      id: 'target', type: 'homeBase', ownerId: 'p2',
      x: 10, y: 10, hp: 2000, maxHp: 2000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.target = target;

    const inf = createInfantry('inf1', 'p1', 9, 11);
    inf.state = 'attacking';
    inf.targetId = 'target';
    state.entities.inf1 = inf;

    processCombat(state);
    // Infantry at (9,11), building edge at (10,11) → dist = 1 ≤ INFANTRY_RANGE(1.5)
    expect(target.hp).toBe(2000 - INFANTRY_DAMAGE);
  });

  it('multiple infantry pathfind to a building and deal damage', () => {
    // Place building and infantry far apart — infantry must walk to building
    const target: Entity = {
      id: 'target', type: 'homeBase', ownerId: 'p2',
      x: 15, y: 15, hp: 2000, maxHp: 2000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.target = target;

    // 3 infantry start at (5, 5) — far from the building
    for (let i = 1; i <= 3; i++) {
      const inf = createInfantry(`inf${i}`, 'p1', 5, 5 + i - 1);
      inf.state = 'attacking';
      inf.targetId = 'target';
      state.entities[inf.id] = inf;
    }

    // Run ticks until the building takes damage
    let damageTick = -1;
    for (let t = 0; t < 500; t++) {
      state.tick++;
      processCombat(state);
      processMovement(state);
      if (target.hp < 2000) {
        damageTick = t;
        break;
      }
    }

    expect(damageTick).toBeGreaterThan(0);
    // At least 2 infantry should have dealt damage (they arrive at similar times)
    // With focus fire bonus, damage should be > 1 * INFANTRY_DAMAGE
    expect(2000 - target.hp).toBeGreaterThanOrEqual(INFANTRY_DAMAGE);
  });
});

// ─── Tower Tests ────────────────────────────────────────────────────────────

describe('Tower', () => {
  let state: GameState;

  beforeEach(() => {
    resetEconomy();
    resetCombat();
    state = createTestState({
      entities: {},
      goldMines: [],
      players: {
        p1: { id: 'p1', name: 'Builder', color: '#3498db', faction: 'humans',
              gold: 500, supply: 1, maxSupply: 20 },
        p2: { id: 'p2', name: 'Attacker', color: '#e74c3c', faction: 'humans',
              gold: 300, supply: 2, maxSupply: 20 },
      },
    });
  });

  it('can be built by a worker', () => {
    state.entities.worker1 = createWorker('worker1', 10, 10);

    handleBuildStructure(state, 'p1', 'worker1', 'tower', 11, 11);

    const towers = Object.values(state.entities).filter(e => e.type === 'tower');
    expect(towers.length).toBe(1);
    expect(towers[0].buildProgress).toBe(0);
    expect(towers[0].tileWidth).toBe(TOWER_TILE_WIDTH);
    expect(towers[0].tileHeight).toBe(TOWER_TILE_HEIGHT);
    expect(state.players.p1.gold).toBe(500 - TOWER_COST);
  });

  it('completes construction after TOWER_BUILD_TICKS', () => {
    state.entities.worker1 = createWorker('worker1', 10, 10);

    handleBuildStructure(state, 'p1', 'worker1', 'tower', 11, 11);

    const tower = Object.values(state.entities).find(e => e.type === 'tower')!;
    expect(tower.buildProgress).toBe(0);

    // Run until construction completes
    runTicks(state, TOWER_BUILD_TICKS + 2);

    expect(tower.buildProgress).toBe(1);
    expect(tower.state).toBe('idle');
  });

  it('auto-attacks nearest enemy in range', () => {
    // Place a completed tower
    const tower: Entity = {
      id: 'tower1', type: 'tower', ownerId: 'p1',
      x: 10, y: 10, hp: TOWER_HP, maxHp: TOWER_HP, state: 'idle',
      buildProgress: 1,
      tileWidth: TOWER_TILE_WIDTH, tileHeight: TOWER_TILE_HEIGHT,
    };
    state.entities.tower1 = tower;

    // Place enemy infantry within tower range
    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 14, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    // Tower center is (11, 11), enemy at (14, 10) → dist ≈ 3.16, within TOWER_RANGE (7)
    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP - TOWER_DAMAGE);
    expect(tower.targetId).toBe('enemy1');
  });

  it('does not attack enemies outside range', () => {
    const tower: Entity = {
      id: 'tower1', type: 'tower', ownerId: 'p1',
      x: 10, y: 10, hp: TOWER_HP, maxHp: TOWER_HP, state: 'idle',
      buildProgress: 1,
      tileWidth: TOWER_TILE_WIDTH, tileHeight: TOWER_TILE_HEIGHT,
    };
    state.entities.tower1 = tower;

    // Place enemy far away (tower center is ~(11,11), range = 7)
    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 25, y: 25, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP); // no damage
    expect(tower.targetId).toBeUndefined();
  });

  it('does not attack while under construction', () => {
    const tower: Entity = {
      id: 'tower1', type: 'tower', ownerId: 'p1',
      x: 10, y: 10, hp: TOWER_HP, maxHp: TOWER_HP, state: 'building',
      buildProgress: 0.5,
      tileWidth: TOWER_TILE_WIDTH, tileHeight: TOWER_TILE_HEIGHT,
    };
    state.entities.tower1 = tower;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 12, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP); // no damage
  });

  it('respects attack cooldown', () => {
    const tower: Entity = {
      id: 'tower1', type: 'tower', ownerId: 'p1',
      x: 10, y: 10, hp: TOWER_HP, maxHp: TOWER_HP, state: 'idle',
      buildProgress: 1,
      tileWidth: TOWER_TILE_WIDTH, tileHeight: TOWER_TILE_HEIGHT,
    };
    state.entities.tower1 = tower;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 12, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    // First attack
    processCombat(state);
    expect(enemy.hp).toBe(INFANTRY_HP - TOWER_DAMAGE);

    // Immediate second tick — should NOT deal damage (cooldown)
    processCombat(state);
    expect(enemy.hp).toBe(INFANTRY_HP - TOWER_DAMAGE);

    // Run through cooldown ticks
    for (let i = 0; i < TOWER_ATTACK_COOLDOWN; i++) {
      processCombat(state);
    }

    // Now it should fire again
    expect(enemy.hp).toBe(INFANTRY_HP - TOWER_DAMAGE * 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Archer tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Archer', () => {
  let state: GameState;

  beforeEach(() => {
    resetCombat();

    const tiles: TileType[][] = Array.from({ length: 30 }, () => Array(30).fill('grass'));
    state = {
      tick: 0,
      mapWidth: 30,
      mapHeight: 30,
      tiles,
      entities: {},
      players: {
        p1: { id: 'p1', name: 'P1', color: '#f00', gold: STARTING_GOLD, supply: 0, maxSupply: HOME_BASE_SUPPLY },
        p2: { id: 'p2', name: 'P2', color: '#00f', gold: STARTING_GOLD, supply: 0, maxSupply: HOME_BASE_SUPPLY },
      },
      goldMines: [],
      status: 'playing',
    };
  });

  it('can be trained from barracks', () => {
    const barracks: Entity = {
      id: 'b1', type: 'barracks', ownerId: 'p1',
      x: 10, y: 10, hp: 500, maxHp: 500, state: 'idle',
      buildProgress: 1,
      tileWidth: BARRACKS_TILE_WIDTH, tileHeight: BARRACKS_TILE_HEIGHT,
    };
    state.entities.b1 = barracks;

    handleTrainUnit(state, 'p1', 'b1', 'archer');

    expect(state.players.p1.gold).toBe(STARTING_GOLD - ARCHER_COST);
    expect(state.players.p1.supply).toBe(ARCHER_SUPPLY);
    expect(barracks.trainingQueue).toHaveLength(1);
    expect(barracks.trainingQueue![0].unitType).toBe('archer');
    expect(barracks.trainingQueue![0].ticksRemaining).toBe(ARCHER_TRAIN_TICKS);
  });

  it('cannot be trained from homeBase', () => {
    const hb: Entity = {
      id: 'hb1', type: 'homeBase', ownerId: 'p1',
      x: 5, y: 5, hp: 1000, maxHp: 1000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.hb1 = hb;

    handleTrainUnit(state, 'p1', 'hb1', 'archer');

    expect(state.players.p1.gold).toBe(STARTING_GOLD); // no gold spent
    expect(hb.trainingQueue).toBeUndefined();
  });

  it('costs 3 supply', () => {
    const barracks: Entity = {
      id: 'b1', type: 'barracks', ownerId: 'p1',
      x: 10, y: 10, hp: 500, maxHp: 500, state: 'idle',
      buildProgress: 1,
      tileWidth: BARRACKS_TILE_WIDTH, tileHeight: BARRACKS_TILE_HEIGHT,
    };
    state.entities.b1 = barracks;

    handleTrainUnit(state, 'p1', 'b1', 'archer');

    expect(state.players.p1.supply).toBe(ARCHER_SUPPLY);
    expect(ARCHER_SUPPLY).toBe(3);
  });

  it('has less HP than infantry', () => {
    expect(ARCHER_HP).toBeLessThan(INFANTRY_HP);
  });

  it('deals less damage than infantry', () => {
    expect(ARCHER_DAMAGE).toBeLessThan(INFANTRY_DAMAGE);
  });

  it('attacks from range (farther than infantry)', () => {
    expect(ARCHER_RANGE).toBeGreaterThan(INFANTRY_RANGE);
  });

  it('attacks an enemy within range', () => {
    const archer: Entity = {
      id: 'a1', type: 'archer', ownerId: 'p1',
      x: 10, y: 10, hp: ARCHER_HP, maxHp: ARCHER_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    state.entities.a1 = archer;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 14, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    // Distance = 4, which is within ARCHER_RANGE (5) but outside INFANTRY_RANGE (1.5)
    processCombat(state);

    expect(enemy.hp).toBeLessThan(INFANTRY_HP);
    expect(enemy.hp).toBe(INFANTRY_HP - ARCHER_DAMAGE);
  });

  it('does not attack enemies outside range', () => {
    const archer: Entity = {
      id: 'a1', type: 'archer', ownerId: 'p1',
      x: 10, y: 10, hp: ARCHER_HP, maxHp: ARCHER_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    state.entities.a1 = archer;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 16, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    // Distance = 6, which is outside ARCHER_RANGE (5)
    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP); // no damage — out of range
  });

  it('gets focus-fire bonus with other archers', () => {
    const a1: Entity = {
      id: 'a1', type: 'archer', ownerId: 'p1',
      x: 10, y: 10, hp: ARCHER_HP, maxHp: ARCHER_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    const a2: Entity = {
      id: 'a2', type: 'archer', ownerId: 'p1',
      x: 10, y: 10, hp: ARCHER_HP, maxHp: ARCHER_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    state.entities.a1 = a1;
    state.entities.a2 = a2;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 14, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    processCombat(state);

    // 2 archers → multiplier = 1 + 0.15 * (2-1) = 1.15
    // Each deals round(10 * 1.15) = round(11.5) = 12 → total 24
    const expectedDmgEach = Math.round(ARCHER_DAMAGE * (1 + FOCUS_FIRE_BONUS));
    expect(enemy.hp).toBe(INFANTRY_HP - expectedDmgEach * 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cavalry tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cavalry', () => {
  let state: GameState;

  beforeEach(() => {
    resetCombat();
    const tiles: TileType[][] = Array.from({ length: 30 }, () => Array(30).fill('grass'));
    state = {
      tick: 0,
      mapWidth: 30,
      mapHeight: 30,
      tiles,
      entities: {},
      players: {
        p1: { id: 'p1', name: 'P1', color: '#f00', gold: STARTING_GOLD, supply: 0, maxSupply: HOME_BASE_SUPPLY },
        p2: { id: 'p2', name: 'P2', color: '#00f', gold: STARTING_GOLD, supply: 0, maxSupply: HOME_BASE_SUPPLY },
      },
      goldMines: [],
      status: 'playing',
    };
  });

  it('can be trained from barracks', () => {
    const barracks: Entity = {
      id: 'b1', type: 'barracks', ownerId: 'p1',
      x: 10, y: 10, hp: 500, maxHp: 500, state: 'idle',
      buildProgress: 1,
      tileWidth: BARRACKS_TILE_WIDTH, tileHeight: BARRACKS_TILE_HEIGHT,
    };
    state.entities.b1 = barracks;

    handleTrainUnit(state, 'p1', 'b1', 'cavalry');

    expect(state.players.p1.gold).toBe(STARTING_GOLD - CAVALRY_COST);
    expect(state.players.p1.supply).toBe(CAVALRY_SUPPLY);
    expect(barracks.trainingQueue).toHaveLength(1);
    expect(barracks.trainingQueue![0].unitType).toBe('cavalry');
    expect(barracks.trainingQueue![0].ticksRemaining).toBe(CAVALRY_TRAIN_TICKS);
  });

  it('costs 4 supply', () => {
    expect(CAVALRY_SUPPLY).toBe(4);
  });

  it('costs 200 gold', () => {
    expect(CAVALRY_COST).toBe(200);
  });

  it('is twice as fast as infantry', () => {
    expect(CAVALRY_SPEED).toBe(INFANTRY_SPEED * 2);
  });

  it('deals more damage than infantry', () => {
    expect(CAVALRY_DAMAGE).toBeGreaterThan(INFANTRY_DAMAGE);
  });

  it('attacks an enemy within melee range', () => {
    const cav: Entity = {
      id: 'c1', type: 'cavalry', ownerId: 'p1',
      x: 10, y: 10, hp: CAVALRY_HP, maxHp: CAVALRY_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    state.entities.c1 = cav;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 11, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP - CAVALRY_DAMAGE);
  });

  it('cannot be trained from homeBase', () => {
    const hb: Entity = {
      id: 'hb1', type: 'homeBase', ownerId: 'p1',
      x: 5, y: 5, hp: 1000, maxHp: 1000, state: 'idle',
      tileWidth: 3, tileHeight: 3,
    };
    state.entities.hb1 = hb;

    handleTrainUnit(state, 'p1', 'hb1', 'cavalry');

    expect(state.players.p1.gold).toBe(STARTING_GOLD);
    expect(hb.trainingQueue).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Armory + Upgrade tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Armory & Upgrades', () => {
  let state: GameState;

  beforeEach(() => {
    resetCombat();
    resetEconomy();
    const tiles: TileType[][] = Array.from({ length: 30 }, () => Array(30).fill('grass'));
    state = {
      tick: 0,
      mapWidth: 30,
      mapHeight: 30,
      tiles,
      entities: {},
      players: {
        p1: { id: 'p1', name: 'P1', color: '#f00', gold: 2000, supply: 0, maxSupply: HOME_BASE_SUPPLY, upgrades: { infantry: 0, archer: 0, cavalry: 0 } },
        p2: { id: 'p2', name: 'P2', color: '#00f', gold: 2000, supply: 0, maxSupply: HOME_BASE_SUPPLY, upgrades: { infantry: 0, archer: 0, cavalry: 0 } },
      },
      goldMines: [],
      status: 'playing',
    };
  });

  it('armory can be built by a worker', () => {
    const worker: Entity = {
      id: 'w1', type: 'worker', ownerId: 'p1',
      x: 10, y: 10, hp: 60, maxHp: 60, state: 'idle',
    };
    state.entities.w1 = worker;

    handleBuildStructure(state, 'p1', 'w1', 'armory', 10, 12);

    // Armory should be placed (worker is close enough)
    const armory = Object.values(state.entities).find((e) => e.type === 'armory');
    expect(armory).toBeDefined();
    expect(armory!.buildProgress).toBeDefined();
    expect(state.players.p1.gold).toBe(2000 - ARMORY_COST);
  });

  it('upgrade costs scale exponentially', () => {
    const cost0 = getUpgradeCost(0);
    const cost1 = getUpgradeCost(1);
    const cost2 = getUpgradeCost(2);
    const cost3 = getUpgradeCost(3);

    expect(cost0).toBe(100);   // 100 * 2^0
    expect(cost1).toBe(200);   // 100 * 2^1
    expect(cost2).toBe(400);   // 100 * 2^2
    expect(cost3).toBe(800);   // 100 * 2^3
  });

  it('can upgrade infantry at a completed armory', () => {
    const armory: Entity = {
      id: 'a1', type: 'armory', ownerId: 'p1',
      x: 10, y: 10, hp: ARMORY_HP, maxHp: ARMORY_HP, state: 'idle',
      buildProgress: 1,
      tileWidth: ARMORY_TILE_WIDTH, tileHeight: ARMORY_TILE_HEIGHT,
    };
    state.entities.a1 = armory;

    handleUpgradeUnit(state, 'p1', 'a1', 'infantry');

    expect(state.players.p1.upgrades.infantry).toBe(1);
    expect(state.players.p1.gold).toBe(2000 - getUpgradeCost(0));
  });

  it('cannot upgrade at an unfinished armory', () => {
    const armory: Entity = {
      id: 'a1', type: 'armory', ownerId: 'p1',
      x: 10, y: 10, hp: ARMORY_HP, maxHp: ARMORY_HP, state: 'building',
      buildProgress: 0.5,
      tileWidth: ARMORY_TILE_WIDTH, tileHeight: ARMORY_TILE_HEIGHT,
    };
    state.entities.a1 = armory;

    handleUpgradeUnit(state, 'p1', 'a1', 'infantry');

    expect(state.players.p1.upgrades.infantry).toBe(0);
    expect(state.players.p1.gold).toBe(2000);
  });

  it('cannot upgrade at a barracks (wrong building)', () => {
    const barracks: Entity = {
      id: 'b1', type: 'barracks', ownerId: 'p1',
      x: 10, y: 10, hp: 500, maxHp: 500, state: 'idle',
      buildProgress: 1,
      tileWidth: BARRACKS_TILE_WIDTH, tileHeight: BARRACKS_TILE_HEIGHT,
    };
    state.entities.b1 = barracks;

    handleUpgradeUnit(state, 'p1', 'b1', 'infantry');

    expect(state.players.p1.upgrades.infantry).toBe(0);
    expect(state.players.p1.gold).toBe(2000);
  });

  it('multiple upgrades increase cost each time', () => {
    const armory: Entity = {
      id: 'a1', type: 'armory', ownerId: 'p1',
      x: 10, y: 10, hp: ARMORY_HP, maxHp: ARMORY_HP, state: 'idle',
      buildProgress: 1,
      tileWidth: ARMORY_TILE_WIDTH, tileHeight: ARMORY_TILE_HEIGHT,
    };
    state.entities.a1 = armory;

    // Upgrade 1: costs 100
    handleUpgradeUnit(state, 'p1', 'a1', 'archer');
    expect(state.players.p1.upgrades.archer).toBe(1);
    expect(state.players.p1.gold).toBe(2000 - 100);

    // Upgrade 2: costs 200
    handleUpgradeUnit(state, 'p1', 'a1', 'archer');
    expect(state.players.p1.upgrades.archer).toBe(2);
    expect(state.players.p1.gold).toBe(2000 - 100 - 200);

    // Upgrade 3: costs 400
    handleUpgradeUnit(state, 'p1', 'a1', 'archer');
    expect(state.players.p1.upgrades.archer).toBe(3);
    expect(state.players.p1.gold).toBe(2000 - 100 - 200 - 400);
  });

  it('upgrade fails if not enough gold', () => {
    state.players.p1.gold = 50; // Not enough for first upgrade (100)
    const armory: Entity = {
      id: 'a1', type: 'armory', ownerId: 'p1',
      x: 10, y: 10, hp: ARMORY_HP, maxHp: ARMORY_HP, state: 'idle',
      buildProgress: 1,
      tileWidth: ARMORY_TILE_WIDTH, tileHeight: ARMORY_TILE_HEIGHT,
    };
    state.entities.a1 = armory;

    handleUpgradeUnit(state, 'p1', 'a1', 'cavalry');

    expect(state.players.p1.upgrades.cavalry).toBe(0);
    expect(state.players.p1.gold).toBe(50);
  });

  it('upgraded units deal more damage in combat', () => {
    // Give p1 one infantry upgrade
    state.players.p1.upgrades.infantry = 1;

    const inf: Entity = {
      id: 'i1', type: 'infantry', ownerId: 'p1',
      x: 10, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    state.entities.i1 = inf;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 11, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    processCombat(state);

    const expectedDmg = Math.round(INFANTRY_DAMAGE * getUpgradeDamageMultiplier(1));
    expect(expectedDmg).toBeGreaterThan(INFANTRY_DAMAGE);
    expect(enemy.hp).toBe(INFANTRY_HP - expectedDmg);
  });

  it('upgraded units spawn with more HP', () => {
    state.players.p1.upgrades.infantry = 2;

    const barracks: Entity = {
      id: 'b1', type: 'barracks', ownerId: 'p1',
      x: 5, y: 5, hp: 500, maxHp: 500, state: 'idle',
      buildProgress: 1,
      tileWidth: BARRACKS_TILE_WIDTH, tileHeight: BARRACKS_TILE_HEIGHT,
    };
    state.entities.b1 = barracks;

    // Train an infantry
    handleTrainUnit(state, 'p1', 'b1', 'infantry');
    expect(barracks.trainingQueue).toHaveLength(1);

    // Run ticks to complete training
    for (let i = 0; i < INFANTRY_TRAIN_TICKS; i++) {
      processEconomy(state);
    }

    // Find the spawned infantry
    const newInf = Object.values(state.entities).find(
      (e) => e.type === 'infantry' && e.ownerId === 'p1'
    );
    expect(newInf).toBeDefined();

    const expectedHp = Math.round(INFANTRY_HP * getUpgradeHpMultiplier(2));
    expect(newInf!.maxHp).toBe(expectedHp);
    expect(newInf!.hp).toBe(expectedHp);
    expect(expectedHp).toBeGreaterThan(INFANTRY_HP);
  });

  it('upgrades are per-unit-type (infantry upgrade does not affect archers)', () => {
    state.players.p1.upgrades.infantry = 3;

    const archer: Entity = {
      id: 'a1', type: 'archer', ownerId: 'p1',
      x: 10, y: 10, hp: ARCHER_HP, maxHp: ARCHER_HP, state: 'attacking',
      targetId: 'enemy1',
    };
    state.entities.a1 = archer;

    const enemy: Entity = {
      id: 'enemy1', type: 'infantry', ownerId: 'p2',
      x: 14, y: 10, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.enemy1 = enemy;

    processCombat(state);

    // Archer should deal base damage (no archer upgrade), not infantry upgrade bonus
    expect(enemy.hp).toBe(INFANTRY_HP - ARCHER_DAMAGE);
  });
});

// ─── Home Base Attack ───────────────────────────────────────────────────────

describe('Home Base Attack', () => {
  let state: GameState;

  beforeEach(() => {
    const tiles: TileType[][] = Array.from({ length: MAP_H }, () =>
      Array.from({ length: MAP_W }, () => 'grass' as TileType),
    );

    state = {
      tick: 0,
      mapWidth: MAP_W,
      mapHeight: MAP_H,
      tiles,
      entities: {},
      goldMines: [],
      players: {
        p1: { id: 'p1', name: 'A', color: '#ff0000', gold: 1000, supply: 0, maxSupply: 10, upgrades: { infantry: 0, archer: 0, cavalry: 0 } },
        p2: { id: 'p2', name: 'B', color: '#0000ff', gold: 1000, supply: 0, maxSupply: 10, upgrades: { infantry: 0, archer: 0, cavalry: 0 } },
      },
    } as GameState;

    resetCombat();
  });

  it('home base auto-attacks nearest enemy within range', () => {
    const base: Entity = {
      id: 'hb1', type: 'homeBase', ownerId: 'p1',
      x: 10, y: 10, hp: HOME_BASE_HP, maxHp: HOME_BASE_HP, state: 'idle',
      tileWidth: HOME_BASE_TILE_WIDTH, tileHeight: HOME_BASE_TILE_HEIGHT,
    };
    state.entities.hb1 = base;

    // Enemy infantry within range (base center ~11.5, enemy at 15 = 3.5 tiles away < 7)
    const enemy: Entity = {
      id: 'e1', type: 'infantry', ownerId: 'p2',
      x: 15, y: 11, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.e1 = enemy;

    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP - HOME_BASE_DAMAGE);
  });

  it('home base deals 2x tower damage', () => {
    expect(HOME_BASE_DAMAGE).toBe(TOWER_DAMAGE * 2);
  });

  it('home base does NOT attack enemies outside range', () => {
    const base: Entity = {
      id: 'hb1', type: 'homeBase', ownerId: 'p1',
      x: 10, y: 10, hp: HOME_BASE_HP, maxHp: HOME_BASE_HP, state: 'idle',
      tileWidth: HOME_BASE_TILE_WIDTH, tileHeight: HOME_BASE_TILE_HEIGHT,
    };
    state.entities.hb1 = base;

    // Enemy far away (base center ~11.5, enemy at 25 = 13.5 tiles away > 7)
    const enemy: Entity = {
      id: 'e1', type: 'infantry', ownerId: 'p2',
      x: 25, y: 11, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.e1 = enemy;

    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP); // No damage
  });

  it('unfinished home base does not attack (buildProgress < 1)', () => {
    const base: Entity = {
      id: 'hb1', type: 'homeBase', ownerId: 'p1',
      x: 10, y: 10, hp: HOME_BASE_HP, maxHp: HOME_BASE_HP, state: 'idle',
      tileWidth: HOME_BASE_TILE_WIDTH, tileHeight: HOME_BASE_TILE_HEIGHT,
      buildProgress: 0.5,
    };
    state.entities.hb1 = base;

    const enemy: Entity = {
      id: 'e1', type: 'infantry', ownerId: 'p2',
      x: 12, y: 11, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.e1 = enemy;

    processCombat(state);

    expect(enemy.hp).toBe(INFANTRY_HP); // No damage
  });
});

// ─── Ballista ───────────────────────────────────────────────────────────────

describe('Ballista', () => {
  let state: GameState;

  beforeEach(() => {
    const tiles: TileType[][] = Array.from({ length: MAP_H }, () =>
      Array.from({ length: MAP_W }, () => 'grass' as TileType),
    );

    state = {
      tick: 0,
      mapWidth: MAP_W,
      mapHeight: MAP_H,
      tiles,
      entities: {},
      goldMines: [],
      players: {
        p1: { id: 'p1', name: 'A', color: '#ff0000', gold: 1000, supply: 0, maxSupply: 20, upgrades: { infantry: 0, archer: 0, cavalry: 0 } },
        p2: { id: 'p2', name: 'B', color: '#0000ff', gold: 1000, supply: 0, maxSupply: 20, upgrades: { infantry: 0, archer: 0, cavalry: 0 } },
      },
    } as GameState;

    resetCombat();
    resetEconomy();
  });

  it('can be trained from barracks', () => {
    const barracks: Entity = {
      id: 'b1', type: 'barracks', ownerId: 'p1',
      x: 5, y: 5, hp: 500, maxHp: 500, state: 'idle',
      buildProgress: 1,
      tileWidth: BARRACKS_TILE_WIDTH, tileHeight: BARRACKS_TILE_HEIGHT,
    };
    state.entities.b1 = barracks;

    handleTrainUnit(state, 'p1', 'b1', 'ballista');
    expect(barracks.trainingQueue).toHaveLength(1);
    expect(state.players.p1.gold).toBe(1000 - BALLISTA_COST);
  });

  it('costs 250 gold', () => {
    expect(BALLISTA_COST).toBe(250);
  });

  it('costs 5 supply', () => {
    expect(BALLISTA_SUPPLY).toBe(5);
  });

  it('has very low HP (fragile)', () => {
    expect(BALLISTA_HP).toBe(50);
    expect(BALLISTA_HP).toBeLessThan(INFANTRY_HP);
  });

  it('has longer range than towers', () => {
    expect(BALLISTA_RANGE).toBeGreaterThan(TOWER_RANGE);
    expect(BALLISTA_RANGE).toBeGreaterThan(HOME_BASE_RANGE);
  });

  it('deals heavy damage to buildings', () => {
    const ballista: Entity = {
      id: 'bal1', type: 'ballista', ownerId: 'p1',
      x: 5, y: 5, hp: BALLISTA_HP, maxHp: BALLISTA_HP, state: 'attacking',
      targetId: 'tower1',
    };
    state.entities.bal1 = ballista;

    const tower: Entity = {
      id: 'tower1', type: 'tower', ownerId: 'p2',
      x: 14, y: 5, hp: TOWER_HP, maxHp: TOWER_HP, state: 'idle',
      tileWidth: TOWER_TILE_WIDTH, tileHeight: TOWER_TILE_HEIGHT,
      buildProgress: 1,
    };
    state.entities.tower1 = tower;

    processCombat(state);

    // Ballista range is 10, tower edge is at x=14, ballista at x=5, distance ~9 (in range)
    expect(tower.hp).toBe(TOWER_HP - BALLISTA_DAMAGE);
  });

  it('deals 0 damage to non-building units', () => {
    const ballista: Entity = {
      id: 'bal1', type: 'ballista', ownerId: 'p1',
      x: 5, y: 5, hp: BALLISTA_HP, maxHp: BALLISTA_HP, state: 'attacking',
      targetId: 'inf1',
    };
    state.entities.bal1 = ballista;

    const infantry: Entity = {
      id: 'inf1', type: 'infantry', ownerId: 'p2',
      x: 6, y: 5, hp: INFANTRY_HP, maxHp: INFANTRY_HP, state: 'idle',
    };
    state.entities.inf1 = infantry;

    processCombat(state);

    // Ballista should deal 0 to units
    expect(infantry.hp).toBe(INFANTRY_HP);
  });

  it('outranges tower (attacks from outside tower range)', () => {
    // Place ballista 9 tiles from tower edge — within ballista range (10) but outside tower range (7)
    const ballista: Entity = {
      id: 'bal1', type: 'ballista', ownerId: 'p1',
      x: 2, y: 10, hp: BALLISTA_HP, maxHp: BALLISTA_HP, state: 'attacking',
      targetId: 'tower1',
    };
    state.entities.bal1 = ballista;

    // Tower at (12, 10), width 2, so edge at x=12, distance from ballista at x=2 = 10 tiles
    const tower: Entity = {
      id: 'tower1', type: 'tower', ownerId: 'p2',
      x: 12, y: 10, hp: TOWER_HP, maxHp: TOWER_HP, state: 'idle',
      tileWidth: TOWER_TILE_WIDTH, tileHeight: TOWER_TILE_HEIGHT,
      buildProgress: 1,
    };
    state.entities.tower1 = tower;

    processCombat(state);

    // Ballista hits tower (range 10, dist ~10)
    expect(tower.hp).toBeLessThan(TOWER_HP);
    // Tower should NOT hit ballista (range 7, tower center ~13, ballista at 2, dist ~11)
    expect(ballista.hp).toBe(BALLISTA_HP);
  });

  it('ballista can move (pathfinding works)', () => {
    const ballista: Entity = {
      id: 'bal1', type: 'ballista', ownerId: 'p1',
      x: 5, y: 5, hp: BALLISTA_HP, maxHp: BALLISTA_HP, state: 'moving',
      path: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
    };
    state.entities.bal1 = ballista;

    const startX = ballista.x;
    // Run a few movement ticks
    for (let i = 0; i < 40; i++) {
      processMovement(state);
    }

    // Ballista should have moved (even if slowly)
    expect(ballista.x).toBeGreaterThan(startX);
  });

  it('ballista is included in supply calculation', () => {
    const ballista: Entity = {
      id: 'bal1', type: 'ballista', ownerId: 'p1',
      x: 5, y: 5, hp: BALLISTA_HP, maxHp: BALLISTA_HP, state: 'idle',
    };
    state.entities.bal1 = ballista;

    const base: Entity = {
      id: 'hb1', type: 'homeBase', ownerId: 'p1',
      x: 0, y: 0, hp: HOME_BASE_HP, maxHp: HOME_BASE_HP, state: 'idle',
      tileWidth: HOME_BASE_TILE_WIDTH, tileHeight: HOME_BASE_TILE_HEIGHT,
    };
    state.entities.hb1 = base;

    recalculateSupply(state);
    expect(state.players.p1.supply).toBe(BALLISTA_SUPPLY);
  });
});
