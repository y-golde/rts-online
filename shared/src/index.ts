/**
 * @file index.ts
 * @description Barrel export for the @rts/shared package.
 * Import everything from '@rts/shared' rather than reaching into individual files.
 */

export * from './types.js';
export * from './constants.js';
export { findPath } from './pathfinding.js';
