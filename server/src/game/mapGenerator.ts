/**
 * @file mapGenerator.ts
 * @description Generates the tile map, places gold mines, and sets spawn points.
 * Uses seeded randomness for reproducible maps.
 *
 * @see constants.ts for MAP_WIDTH, MAP_HEIGHT, GOLD_MINE_COUNT
 * @see types.ts for TileType, GoldMine
 */

import { v4 as uuid } from 'uuid';
import type { TileType, GoldMine } from '@rts/shared';
import {
  getMapSize,
  GOLD_MINE_COUNT,
  GOLD_MINE_STARTING_GOLD,
  GOLD_MINE_MAX_WORKERS,
} from '@rts/shared';

/** Simple seeded PRNG (mulberry32). */
function createRng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MapData {
  tiles: TileType[][];
  goldMines: GoldMine[];
  /** Spawn tile coordinates for each player slot (index 0 = player 1, etc.). */
  spawnPoints: Array<{ x: number; y: number }>;
}

/**
 * Generates a game map with terrain, gold mines, and spawn points.
 *
 * @param playerCount - Number of players (determines spawn point count)
 * @param seed - Random seed for reproducible generation
 * @returns MapData with tiles, gold mines, and spawn points
 */
export function generateMap(playerCount: number, seed: number = Date.now()): MapData {
  const rng = createRng(seed);
  const { width: MAP_WIDTH, height: MAP_HEIGHT } = getMapSize(playerCount);
  const tiles: TileType[][] = [];

  // ─── Generate base terrain ────────────────────────────────────────
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const r = rng();
      // Edges have more water/rock for natural boundaries
      const edgeDist = Math.min(x, y, MAP_WIDTH - 1 - x, MAP_HEIGHT - 1 - y);
      if (edgeDist < 2) {
        row.push('rock');
      } else if (r < 0.03) {
        row.push('water');
      } else if (r < 0.08) {
        row.push('rock');
      } else if (r < 0.15) {
        row.push('trees');
      } else {
        row.push('grass');
      }
      row.push(row.pop()!); // keep last pushed
    }
    tiles.push(row);
  }

  // ─── Spawn points (opposite corners for 1v1, corners for more players) ─────────────────────
  // Scale margin with map size (smaller maps = smaller margins)
  const margin = Math.max(5, Math.min(10, MAP_WIDTH / 8));
  const spawnPoints = [
    { x: margin, y: margin },
    { x: MAP_WIDTH - margin - 3, y: MAP_HEIGHT - margin - 3 },
    { x: MAP_WIDTH - margin - 3, y: margin },
    { x: margin, y: MAP_HEIGHT - margin - 3 },
  ].slice(0, Math.max(playerCount, 2));

  // Clear area around spawns (ensure walkable)
  for (const sp of spawnPoints) {
    for (let dy = -4; dy <= 6; dy++) {
      for (let dx = -4; dx <= 6; dx++) {
        const tx = Math.floor(sp.x + dx);
        const ty = Math.floor(sp.y + dy);
        if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
          tiles[ty][tx] = 'grass';
        }
      }
    }
  }

  // ─── Gold mines ───────────────────────────────────────────────────
  const goldMines: GoldMine[] = [];

  // Place one mine near each spawn point
  for (const sp of spawnPoints) {
    const offsetX = 6 + Math.floor(rng() * 4);
    const offsetY = 6 + Math.floor(rng() * 4);
    const mx = Math.min(MAP_WIDTH - 4, Math.max(2, Math.floor(sp.x) + offsetX));
    const my = Math.min(MAP_HEIGHT - 4, Math.max(2, Math.floor(sp.y) + offsetY));
    clearArea(tiles, mx, my, 2, 2, MAP_WIDTH, MAP_HEIGHT);
    goldMines.push(createGoldMine(mx, my));
  }

  // Place remaining mines around the map
  // Scale mine count and spacing with map size
  const targetMineCount = Math.min(GOLD_MINE_COUNT, Math.max(4, Math.floor(MAP_WIDTH / 15)));
  const minMineDistance = Math.max(8, Math.floor(MAP_WIDTH / 8));
  
  let attempts = 0;
  while (goldMines.length < targetMineCount && attempts < 200) {
    attempts++;
    const mx = 5 + Math.floor(rng() * (MAP_WIDTH - 10));
    const my = 5 + Math.floor(rng() * (MAP_HEIGHT - 10));

    // Check minimum distance from existing mines
    const tooClose = goldMines.some(
      (m) => Math.abs(m.x - mx) < minMineDistance && Math.abs(m.y - my) < minMineDistance
    );
    if (tooClose) continue;

    clearArea(tiles, mx, my, 2, 2, MAP_WIDTH, MAP_HEIGHT);
    goldMines.push(createGoldMine(mx, my));
  }

  return { tiles, goldMines, spawnPoints };
}

/** Creates a GoldMine object at the given tile position. */
function createGoldMine(x: number, y: number): GoldMine {
  return {
    id: uuid(),
    x,
    y,
    goldRemaining: GOLD_MINE_STARTING_GOLD,
    maxWorkers: GOLD_MINE_MAX_WORKERS,
    workerIds: [],
  };
}

/** Clears tiles to grass in a rectangular area. */
function clearArea(
  tiles: TileType[][],
  x: number,
  y: number,
  w: number,
  h: number,
  mapWidth: number,
  mapHeight: number
) {
  const startX = Math.floor(x);
  const startY = Math.floor(y);
  for (let dy = -1; dy < h + 1; dy++) {
    for (let dx = -1; dx < w + 1; dx++) {
      const tx = startX + dx;
      const ty = startY + dy;
      if (tx >= 0 && tx < mapWidth && ty >= 0 && ty < mapHeight) {
        tiles[ty][tx] = 'grass';
      }
    }
  }
}
