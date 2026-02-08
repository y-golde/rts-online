/**
 * @file Interpolator.ts
 * @description Buffers the last two server state snapshots and lerps entity positions
 * for smooth 60fps rendering between 20-tick/sec server updates.
 *
 * @see types.ts for GameState, Entity
 * @see constants.ts for TICK_MS
 */

import type { GameState, Entity } from '@rts/shared';
import { TICK_MS } from '@rts/shared';

/**
 * Stores previous and current server snapshots for interpolation.
 */
export class Interpolator {
  /** Previous server snapshot. */
  private prevState: GameState | null = null;
  /** Latest server snapshot. */
  private currState: GameState | null = null;
  /** Timestamp when currState was received. */
  private receiveTime = 0;

  /**
   * Feeds a new server snapshot into the interpolator.
   * The previous "current" becomes "previous".
   */
  pushState(state: GameState): void {
    this.prevState = this.currState;
    this.currState = state;
    this.receiveTime = performance.now();
  }

  /**
   * Returns the latest state (no interpolation on non-position fields).
   */
  getLatestState(): GameState | null {
    return this.currState;
  }

  /**
   * Returns interpolated entity positions for smooth rendering.
   * Non-position fields come from the latest snapshot.
   *
   * @param now - Current timestamp from performance.now()
   * @returns Map of entity ID → interpolated {x, y}, or null if no data
   */
  getInterpolatedPositions(now: number): Map<string, { x: number; y: number }> | null {
    if (!this.currState) return null;
    if (!this.prevState) {
      // No previous state yet — use current positions as-is
      const positions = new Map<string, { x: number; y: number }>();
      for (const [id, entity] of Object.entries(this.currState.entities)) {
        positions.set(id, { x: entity.x, y: entity.y });
      }
      return positions;
    }

    // Calculate interpolation factor (0 = prevState, 1 = currState, can extrapolate slightly)
    const elapsed = now - this.receiveTime;
    const t = Math.min(elapsed / TICK_MS, 1.5); // Cap extrapolation

    const positions = new Map<string, { x: number; y: number }>();
    for (const [id, curr] of Object.entries(this.currState.entities)) {
      const prev = this.prevState.entities[id];
      if (prev) {
        // Lerp between previous and current position
        positions.set(id, {
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
        });
      } else {
        // New entity — use current position
        positions.set(id, { x: curr.x, y: curr.y });
      }
    }

    return positions;
  }
}
