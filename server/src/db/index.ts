/**
 * @file db/index.ts
 * @description Database adapter abstraction.
 * Supports SQLite (local/Railway) and Turso/libSQL (Vercel/serverless).
 *
 * Environment variables:
 * - DATABASE_URL: Connection string (for Turso) or file path (for SQLite)
 * - DATABASE_TYPE: 'sqlite' | 'turso' | 'postgres' (defaults to 'sqlite')
 *
 * @see db/sqlite.ts for SQLite implementation
 * @see db/turso.ts for Turso/libSQL implementation
 */

import type { DatabaseAdapter } from './adapter.js';

let dbAdapter: DatabaseAdapter | null = null;
let initPromise: Promise<void> | null = null;

async function getDbAdapter(): Promise<DatabaseAdapter> {
  if (dbAdapter) return dbAdapter;

  const dbType = process.env.DATABASE_TYPE || 'sqlite';

  if (dbType === 'turso') {
    // Turso/libSQL for serverless (Vercel)
    const { TursoAdapter } = await import('./turso.js');
    dbAdapter = new TursoAdapter(process.env.DATABASE_URL!);
  } else if (dbType === 'postgres') {
    // PostgreSQL (Railway, Vercel Postgres, etc.)
    const { PostgresAdapter } = await import('./postgres.js');
    dbAdapter = new PostgresAdapter(process.env.DATABASE_URL!);
  } else {
    // SQLite (default, works locally and on Railway with persistent volumes)
    const { SQLiteAdapter } = await import('./sqlite.js');
    const dbPath = process.env.DATABASE_URL || process.env.DATABASE_PATH || './rts-online.db';
    dbAdapter = new SQLiteAdapter(dbPath);
  }

  // Initialize schema
  if (!initPromise) {
    initPromise = dbAdapter.init();
  }
  await initPromise;

  return dbAdapter;
}

// Initialize on module load (catch errors to prevent server crash)
const adapterPromise = getDbAdapter().catch((err) => {
  console.error('[DB] Failed to initialize database adapter:', err.message ?? err);
  console.warn('[DB] Server will continue without database — game is fully in-memory.');
  return null; // DB is optional; game works without it
});

export async function ensurePlayer(id: string, name: string) {
  try {
    const adapter = await adapterPromise;
    if (!adapter) return { id, name, wins: 0, losses: 0 };
    return adapter.ensurePlayer(id, name);
  } catch (err) {
    console.error('[DB] ensurePlayer failed:', (err as Error).message);
    return { id, name, wins: 0, losses: 0 };
  }
}

export async function recordMatch(
  matchId: string,
  winnerId: string,
  durationSecs: number,
  players: Array<{ id: string; color: string; faction: string }>
) {
  try {
    const adapter = await adapterPromise;
    if (!adapter) return;
    return adapter.recordMatch(matchId, winnerId, durationSecs, players);
  } catch (err) {
    console.error('[DB] recordMatch failed (match not saved):', (err as Error).message);
  }
}

export default adapterPromise;
