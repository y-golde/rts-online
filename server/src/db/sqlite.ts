/**
 * @file db/sqlite.ts
 * @description SQLite database adapter using better-sqlite3.
 * Works locally and on Railway with persistent volumes.
 *
 * Usage:
 *   DATABASE_TYPE=sqlite DATABASE_PATH=./data/rts-online.db
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import type { DatabaseAdapter } from './adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    // If relative path, resolve relative to server root
    const resolvedPath = path.isAbsolute(dbPath)
      ? dbPath
      : path.resolve(__dirname, '..', '..', dbPath);

    // Ensure directory exists (sync for constructor)
    const dir = path.dirname(resolvedPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
  }

  async init(): Promise<void> {
    this.db.exec(`
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
    const insertPlayer = this.db.prepare(
      'INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)'
    );
    const getPlayerByName = this.db.prepare(
      'SELECT * FROM players WHERE name = ?'
    );

    insertPlayer.run(id, name);
    return getPlayerByName.get(name);
  }

  async recordMatch(
    matchId: string,
    winnerId: string,
    durationSecs: number,
    players: Array<{ id: string; color: string; faction: string }>
  ): Promise<void> {
    const insertMatch = this.db.prepare(
      'INSERT INTO matches (id, winner_id, duration_secs) VALUES (?, ?, ?)'
    );
    const insertMatchPlayer = this.db.prepare(
      'INSERT INTO match_players (match_id, player_id, color, faction) VALUES (?, ?, ?, ?)'
    );
    const incrementWins = this.db.prepare(
      'UPDATE players SET wins = wins + 1 WHERE id = ?'
    );
    const incrementLosses = this.db.prepare(
      'UPDATE players SET losses = losses + 1 WHERE id = ?'
    );

    const txn = this.db.transaction(() => {
      insertMatch.run(matchId, winnerId, durationSecs);
      for (const p of players) {
        insertMatchPlayer.run(matchId, p.id, p.color, p.faction);
        if (p.id === winnerId) {
          incrementWins.run(p.id);
        } else {
          incrementLosses.run(p.id);
        }
      }
    });
    txn();
  }
}
