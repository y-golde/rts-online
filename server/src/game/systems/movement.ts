/**
 * @file movement.ts
 * @description Movement system — advances entities along their A* paths each tick.
 * Handles smooth tile-to-tile movement by stepping fractional amounts per tick.
 *
 * @see pathfinding.ts for A* algorithm
 * @see constants.ts for WORKER_SPEED, INFANTRY_SPEED
 */

import type { GameState, Entity } from '@rts/shared';
import { WORKER_SPEED, INFANTRY_SPEED, ARCHER_SPEED, CAVALRY_SPEED, BALLISTA_SPEED } from '@rts/shared';

/**
 * Returns movement speed (tiles per tick) for a given entity.
 */
function getSpeed(entity: Entity): number {
  switch (entity.type) {
    case 'worker':
      return WORKER_SPEED;
    case 'infantry':
      return INFANTRY_SPEED;
    case 'archer':
      return ARCHER_SPEED;
    case 'cavalry':
      return CAVALRY_SPEED;
    case 'ballista':
      return BALLISTA_SPEED;
    default:
      return 0; // buildings don't move
  }
}

/**
 * Processes movement for all entities with a non-empty path.
 * Moves each entity towards the next tile in its path by its speed per tick.
 * When the entity reaches a path node, it shifts to the next one.
 * When the path is exhausted, entity state becomes 'idle'.
 * 
 * Units can share tiles - only buildings block movement.
 *
 * @param state - Current game state (mutated in place)
 */
export function processMovement(state: GameState): void {
  for (const entity of Object.values(state.entities)) {
    if (!entity.path || entity.path.length === 0) continue;
    // Only move if state is 'moving', 'returning', or 'attacking'
    if (entity.state !== 'moving' && entity.state !== 'returning' && entity.state !== 'attacking') {
      continue;
    }

    const speed = getSpeed(entity);
    if (speed <= 0) continue;

    let remaining = speed;

    while (remaining > 0 && entity.path && entity.path.length > 0) {
      const target = entity.path[0];
      const dx = target.x - entity.x;
      const dy = target.y - entity.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Use a small epsilon to handle floating point precision
      const epsilon = 0.01;
      if (dist <= remaining + epsilon) {
        // Reached this waypoint (allow small tolerance for multiple units sharing tiles)
        entity.x = target.x;
        entity.y = target.y;
        remaining -= dist;
        entity.path.shift();
      } else {
        // Move towards target
        const ratio = remaining / dist;
        entity.x += dx * ratio;
        entity.y += dy * ratio;
        remaining = 0;
      }
    }

    // Path exhausted → go idle (unless a higher-level system changes state)
    if (!entity.path || entity.path.length === 0) {
      if (entity.state === 'moving') {
        entity.state = 'idle';
      }
      // 'returning' and 'attacking' states are handled by other systems
    }
  }
}
