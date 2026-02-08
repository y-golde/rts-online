/**
 * @file pathfinding.ts
 * @description A* pathfinding on a 2D tile grid. Pure function with no side effects.
 * Used server-side to compute unit paths.
 *
 * @see types.ts for Point interface
 * @see constants.ts for MAP_WIDTH / MAP_HEIGHT
 */

import type { Point } from './types.js';

/** A node in the A* open set. */
interface AStarNode {
  x: number;
  y: number;
  /** Cost from start to this node. */
  g: number;
  /** Estimated total cost (g + heuristic). */
  f: number;
  parent: AStarNode | null;
}

/**
 * Finds the shortest path between two tiles using A* algorithm.
 * Returns empty array if no path exists (target is blocked/unreachable).
 * Path excludes the start tile but includes the destination tile.
 *
 * Supports 8-directional movement (diagonal costs sqrt(2)).
 *
 * @param walkable - 2D grid where true = walkable, false = blocked.
 *                   Indexed as walkable[y][x].
 * @param start - Starting tile coordinates
 * @param end - Target tile coordinates
 * @returns Array of tile coordinates forming the path, or [] if unreachable
 */
export function findPath(
  walkable: boolean[][],
  start: Point,
  end: Point
): Point[] {
  const height = walkable.length;
  const width = walkable[0]?.length ?? 0;

  // Out of bounds or target not walkable → no path
  if (
    start.x < 0 || start.x >= width || start.y < 0 || start.y >= height ||
    end.x < 0 || end.x >= width || end.y < 0 || end.y >= height ||
    !walkable[end.y][end.x]
  ) {
    return [];
  }

  // Same tile
  if (start.x === end.x && start.y === end.y) {
    return [];
  }

  const SQRT2 = Math.SQRT2;

  // 8-directional neighbors: dx, dy, cost
  const dirs: [number, number, number][] = [
    [0, -1, 1], [0, 1, 1], [-1, 0, 1], [1, 0, 1],
    [-1, -1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [1, 1, SQRT2],
  ];

  /** Heuristic: octile distance. */
  function heuristic(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  }

  const startNode: AStarNode = {
    x: start.x,
    y: start.y,
    g: 0,
    f: heuristic(start.x, start.y, end.x, end.y),
    parent: null,
  };

  // Open set as a simple sorted array (fine for RTS-scale maps)
  const open: AStarNode[] = [startNode];
  const closed = new Set<number>();

  /** Pack x,y into a single number for Set lookup. */
  const key = (x: number, y: number) => y * width + x;

  // Map from key → best g found so far
  const gScores = new Map<number, number>();
  gScores.set(key(start.x, start.y), 0);

  while (open.length > 0) {
    // Pop node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open[bestIdx] = open[open.length - 1];
    open.pop();

    // Reached destination
    if (current.x === end.x && current.y === end.y) {
      const path: Point[] = [];
      let node: AStarNode | null = current;
      while (node && !(node.x === start.x && node.y === start.y)) {
        path.push({ x: node.x, y: node.y });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    const ck = key(current.x, current.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [dx, dy, cost] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (!walkable[ny][nx]) continue;

      // Prevent diagonal cutting through walls
      if (dx !== 0 && dy !== 0) {
        if (!walkable[current.y + dy][current.x] || !walkable[current.y][current.x + dx]) {
          continue;
        }
      }

      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const tentativeG = current.g + cost;
      const prevG = gScores.get(nk);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScores.set(nk, tentativeG);
      open.push({
        x: nx,
        y: ny,
        g: tentativeG,
        f: tentativeG + heuristic(nx, ny, end.x, end.y),
        parent: current,
      });
    }
  }

  return []; // No path found
}
