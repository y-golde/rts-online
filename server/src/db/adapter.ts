/**
 * @file db/adapter.ts
 * @description Database adapter interface.
 * All database implementations must implement this interface.
 */

export interface DatabaseAdapter {
  /**
   * Initializes the database (creates tables, etc.).
   */
  init(): Promise<void>;

  /**
   * Ensures a player exists in the database. Creates them if they don't exist.
   * @returns The player row from the database.
   */
  ensurePlayer(id: string, name: string): Promise<any>;

  /**
   * Records a completed match in the database.
   * Updates win/loss counts for all participants.
   */
  recordMatch(
    matchId: string,
    winnerId: string,
    durationSecs: number,
    players: Array<{ id: string; color: string; faction: string }>
  ): Promise<void>;
}
