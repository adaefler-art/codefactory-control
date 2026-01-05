/**
 * Migration DAO - Database Access Object for Migration Ledger
 * 
 * Provides read-only access to the schema_migrations ledger table.
 * Supports parity checks and migration status queries.
 */

import { Pool } from 'pg';

export interface MigrationLedgerEntry {
  filename: string;
  sha256: string;
  applied_at: Date;
}

export interface DbInfo {
  reachable: boolean;
  host: string;
  port: number;
  database: string;
  error?: string;
}

/**
 * Check if database is reachable
 */
export async function checkDbReachability(pool: Pool): Promise<DbInfo> {
  const host = process.env.DATABASE_HOST || 'localhost';
  const port = parseInt(process.env.DATABASE_PORT || '5432', 10);
  const database = process.env.DATABASE_NAME || 'afu9';

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    return {
      reachable: true,
      host,
      port,
      database,
    };
  } catch (error) {
    console.error('[Migration DAO] Database reachability check failed:', error);
    return {
      reachable: false,
      host,
      port,
      database,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if schema_migrations ledger table exists
 */
export async function checkLedgerExists(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      ) AS exists`
    );
    return result.rows[0]?.exists === true;
  } catch (error) {
    console.error('[Migration DAO] Error checking ledger existence:', error);
    return false;
  }
}

/**
 * List all applied migrations from schema_migrations table
 * Returns sorted array for deterministic output
 */
export async function listAppliedMigrations(
  pool: Pool,
  limit: number = 500
): Promise<MigrationLedgerEntry[]> {
  try {
    const result = await pool.query<any>(
      `SELECT filename, sha256, applied_at
       FROM schema_migrations
       ORDER BY filename ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      filename: row.filename,
      sha256: row.sha256,
      applied_at: new Date(row.applied_at),
    }));
  } catch (error) {
    console.error('[Migration DAO] Error listing applied migrations:', error);
    throw error;
  }
}

/**
 * Get the last applied migration (latest by applied_at timestamp)
 */
export async function getLastAppliedMigration(pool: Pool): Promise<MigrationLedgerEntry | null> {
  try {
    const result = await pool.query<any>(
      `SELECT filename, sha256, applied_at
       FROM schema_migrations
       ORDER BY applied_at DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      filename: row.filename,
      sha256: row.sha256,
      applied_at: new Date(row.applied_at),
    };
  } catch (error) {
    console.error('[Migration DAO] Error getting last applied migration:', error);
    throw error;
  }
}

/**
 * Get count of applied migrations
 */
export async function getAppliedMigrationCount(pool: Pool): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM schema_migrations`
    );
    return parseInt(result.rows[0]?.count || '0', 10);
  } catch (error) {
    console.error('[Migration DAO] Error getting migration count:', error);
    throw error;
  }
}
