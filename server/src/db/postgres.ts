/**
 * @file db/postgres.ts
 * @description PostgreSQL database adapter.
 * Works with Railway Postgres, Vercel Postgres, Neon, Supabase, etc.
 *
 * Setup:
 *   DATABASE_TYPE=postgres DATABASE_URL=postgresql://user:pass@host:5432/dbname
 *
 * Note: Requires pg package: pnpm add pg @types/pg
 */

import type { DatabaseAdapter } from './adapter.js';

export class PostgresAdapter implements DatabaseAdapter {
  private pool: any; // pg.Pool

  constructor(databaseUrl: string) {
    // Lazy import pg to avoid requiring it unless using postgres
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        winner_id TEXT,
        duration_secs INTEGER,
        played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT,
        player_id TEXT,
        color TEXT,
        faction TEXT,
        PRIMARY KEY (match_id, player_id)
      );
    `);
  }

  async ensurePlayer(id: string, name: string): Promise<any> {
    await this.pool.query(
      'INSERT INTO players (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [id, name]
    );

    const result = await this.pool.query('SELECT * FROM players WHERE name = $1', [name]);
    return result.rows[0];
  }

  async recordMatch(
    matchId: string,
    winnerId: string,
    durationSecs: number,
    players: Array<{ id: string; color: string; faction: string }>
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO matches (id, winner_id, duration_secs) VALUES ($1, $2, $3)',
        [matchId, winnerId, durationSecs]
      );

      for (const p of players) {
        await client.query(
          'INSERT INTO match_players (match_id, player_id, color, faction) VALUES ($1, $2, $3, $4)',
          [matchId, p.id, p.color, p.faction]
        );
        if (p.id === winnerId) {
          await client.query('UPDATE players SET wins = wins + 1 WHERE id = $1', [p.id]);
        } else {
          await client.query('UPDATE players SET losses = losses + 1 WHERE id = $1', [p.id]);
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
