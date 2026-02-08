/**
 * @file db/turso.ts
 * @description Turso/libSQL database adapter for serverless environments (Vercel).
 * Turso provides SQLite-compatible API over HTTP, perfect for serverless.
 *
 * Setup:
 * 1. Create account at https://turso.tech
 * 2. Create a database
 * 3. Get DATABASE_URL and AUTH_TOKEN from dashboard
 * 4. Set env vars: DATABASE_TYPE=turso DATABASE_URL=libsql://... AUTH_TOKEN=...
 *
 * @see https://docs.turso.tech/
 */

import { createClient } from '@libsql/client';
import type { DatabaseAdapter } from './adapter.js';

export class TursoAdapter implements DatabaseAdapter {
  private client: ReturnType<typeof createClient>;

  constructor(databaseUrl: string) {
    const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;
    if (!authToken) {
      throw new Error('TURSO_AUTH_TOKEN or DATABASE_AUTH_TOKEN environment variable is required for Turso');
    }

    this.client = createClient({
      url: databaseUrl,
      authToken,
    });
  }

  async init(): Promise<void> {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        winner_id TEXT,
        duration_secs INTEGER,
        played_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    await this.client.execute({
      sql: 'INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)',
      args: [id, name],
    });

    const result = await this.client.execute({
      sql: 'SELECT * FROM players WHERE name = ?',
      args: [name],
    });

    return result.rows[0];
  }

  async recordMatch(
    matchId: string,
    winnerId: string,
    durationSecs: number,
    players: Array<{ id: string; color: string; faction: string }>
  ): Promise<void> {
    // Turso supports transactions via batch
    const statements = [
      {
        sql: 'INSERT INTO matches (id, winner_id, duration_secs) VALUES (?, ?, ?)',
        args: [matchId, winnerId, durationSecs],
      },
    ];

    for (const p of players) {
      statements.push({
        sql: 'INSERT INTO match_players (match_id, player_id, color, faction) VALUES (?, ?, ?, ?)',
        args: [matchId, p.id, p.color, p.faction],
      });
      if (p.id === winnerId) {
        statements.push({
          sql: 'UPDATE players SET wins = wins + 1 WHERE id = ?',
          args: [p.id],
        });
      } else {
        statements.push({
          sql: 'UPDATE players SET losses = losses + 1 WHERE id = ?',
          args: [p.id],
        });
      }
    }

    await this.client.batch(statements);
  }
}
