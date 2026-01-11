/**
 * Migration DAO - Database Access Object for Migration Ledger
 * 
 * Provides read-only access to the schema_migrations ledger table.
 * Supports parity checks and migration status queries.
 */

import { Pool } from 'pg';

export const AFU9_MIGRATIONS_LEDGER_TABLE = 'afu9_migrations_ledger' as const;

export const SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS = [
  'filename',
  'migration_id',
  'name',
  'migration_name',
  'version',
  'id',
] as const;

export type SupportedSchemaMigrationsIdentifierColumn =
  (typeof SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS)[number];

export class SchemaMigrationsUnsupportedSchemaError extends Error {
  public readonly detectedColumns: string[];
  public readonly supportedColumns: readonly string[];

  constructor(detectedColumns: string[]) {
    const sortedDetected = [...detectedColumns].sort((a, b) => a.localeCompare(b));
    const supported = SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS;
    super(
      `schema_migrations table has no supported identifier column. Detected columns: ${sortedDetected.join(', ') || '(none)'}; supported: ${supported.join(', ')}`
    );
    this.name = 'SchemaMigrationsUnsupportedSchemaError';
    this.detectedColumns = sortedDetected;
    this.supportedColumns = supported;
  }
}

export function pickSchemaMigrationsIdentifierColumn(
  detectedColumns: string[]
): SupportedSchemaMigrationsIdentifierColumn | null {
  const lower = new Set(detectedColumns.map(c => c.toLowerCase()));
  for (const candidate of SUPPORTED_SCHEMA_MIGRATIONS_IDENTIFIER_COLUMNS) {
    if (lower.has(candidate)) return candidate;
  }
  return null;
}

async function getSchemaMigrationsAdapter(pool: Pool): Promise<{
  detectedColumns: string[];
  identifierColumn: SupportedSchemaMigrationsIdentifierColumn;
  hasSha256: boolean;
  hasAppliedAt: boolean;
}> {
  const result = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'schema_migrations'`
  );

  const detectedColumns = (result.rows || [])
    .map(r => r.column_name)
    .filter(Boolean);

  const identifierColumn = pickSchemaMigrationsIdentifierColumn(detectedColumns);
  if (!identifierColumn) {
    throw new SchemaMigrationsUnsupportedSchemaError(detectedColumns);
  }

  const lower = new Set(detectedColumns.map(c => c.toLowerCase()));
  return {
    detectedColumns: [...detectedColumns].sort((a, b) => a.localeCompare(b)),
    identifierColumn,
    hasSha256: lower.has('sha256'),
    hasAppliedAt: lower.has('applied_at'),
  };
}

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
 * Check if afu9_migrations_ledger exists.
 * Never throws; callers decide how to surface diagnostics.
 */
export async function checkAfu9LedgerExists(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists`,
      [AFU9_MIGRATIONS_LEDGER_TABLE]
    );
    return result.rows[0]?.exists === true;
  } catch (error) {
    console.error('[Migration DAO] Error checking AFU9 ledger existence:', error);
    return false;
  }
}

export async function validateAfu9LedgerShape(pool: Pool): Promise<{
  ok: boolean;
  detectedColumns: string[];
  missingColumns: string[];
}> {
  const required = ['filename', 'sha256', 'applied_at', 'applied_by', 'runner_version'];
  try {
    const result = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1`,
      [AFU9_MIGRATIONS_LEDGER_TABLE]
    );

    const detectedColumns = (result.rows || [])
      .map(r => (r.column_name || '').toLowerCase())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const detectedSet = new Set(detectedColumns);
    const missingColumns = required.filter(c => !detectedSet.has(c));

    return {
      ok: missingColumns.length === 0,
      detectedColumns,
      missingColumns,
    };
  } catch (error) {
    console.error('[Migration DAO] Error validating AFU9 ledger shape:', error);
    return {
      ok: false,
      detectedColumns: [],
      missingColumns: required,
    };
  }
}

export async function listAppliedAfu9Migrations(
  pool: Pool,
  limit: number = 500
): Promise<MigrationLedgerEntry[]> {
  const result = await pool.query<any>(
    `SELECT filename, sha256, applied_at
     FROM ${AFU9_MIGRATIONS_LEDGER_TABLE}
     ORDER BY filename ASC
     LIMIT $1`,
    [limit]
  );

  return (result.rows || []).map((row: any) => ({
    filename: String(row.filename || ''),
    sha256: String(row.sha256 || ''),
    applied_at: row.applied_at ? new Date(row.applied_at) : new Date(0),
  }));
}

export async function getLastAppliedAfu9Migration(pool: Pool): Promise<MigrationLedgerEntry | null> {
  const result = await pool.query<any>(
    `SELECT filename, sha256, applied_at
     FROM ${AFU9_MIGRATIONS_LEDGER_TABLE}
     ORDER BY applied_at DESC, filename DESC
     LIMIT 1`
  );

  if (!result.rows || result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    filename: String(row.filename || ''),
    sha256: String(row.sha256 || ''),
    applied_at: row.applied_at ? new Date(row.applied_at) : new Date(0),
  };
}

export async function getAppliedAfu9MigrationCount(pool: Pool): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${AFU9_MIGRATIONS_LEDGER_TABLE}`);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Check existence of required tables in public schema.
 * Returns a stable, sorted list of missing table names.
 */
export async function getMissingTables(
  pool: Pool,
  requiredTables: string[]
): Promise<string[]> {
  const normalizedRequired = (requiredTables || [])
    .map(t => String(t || '').trim())
    .filter(Boolean)
    .map(t => t.toLowerCase());

  const uniqueRequired = Array.from(new Set(normalizedRequired)).sort((a, b) => a.localeCompare(b));
  if (uniqueRequired.length === 0) return [];

  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [uniqueRequired]
  );

  const present = new Set(
    (result.rows || [])
      .map(r => (r.table_name || '').toLowerCase())
      .filter(Boolean)
  );

  return uniqueRequired.filter(t => !present.has(t));
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
 * 
 * Supports both old (migration_id) and new (filename) column structures
 */
export async function listAppliedMigrations(
  pool: Pool,
  limit: number = 500
): Promise<MigrationLedgerEntry[]> {
  try {
    const adapter = await getSchemaMigrationsAdapter(pool);

    const sha256Select = adapter.hasSha256 ? 'COALESCE(sha256::text, \'\')' : "''";
    const appliedAtSelect = adapter.hasAppliedAt ? 'applied_at' : 'NULL';
    const identifierSelect = `COALESCE(${adapter.identifierColumn}::text, '')`;

    const result = await pool.query<any>(
      `SELECT ${identifierSelect} as filename,
              ${sha256Select} as sha256,
              ${appliedAtSelect} as applied_at
       FROM schema_migrations
       ORDER BY ${adapter.identifierColumn} ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      filename: String(row.filename || ''),
      sha256: row.sha256 || '',
      // Deterministic: if applied_at is not available in the ledger, use a stable epoch timestamp.
      applied_at: row.applied_at ? new Date(row.applied_at) : new Date(0),
    }));
  } catch (error) {
    console.error('[Migration DAO] Error listing applied migrations:', error);
    throw error;
  }
}

/**
 * Get the last applied migration (latest by applied_at timestamp)
 * Supports both old (migration_id) and new (filename) column structures
 */
export async function getLastAppliedMigration(pool: Pool): Promise<MigrationLedgerEntry | null> {
  try {
    const adapter = await getSchemaMigrationsAdapter(pool);

    const sha256Select = adapter.hasSha256 ? 'COALESCE(sha256::text, \'\')' : "''";
    const appliedAtSelect = adapter.hasAppliedAt ? 'applied_at' : 'NULL';
    const identifierSelect = `COALESCE(${adapter.identifierColumn}::text, '')`;
    const orderBy = adapter.hasAppliedAt
      ? `ORDER BY applied_at DESC NULLS LAST, ${adapter.identifierColumn} DESC`
      : `ORDER BY ${adapter.identifierColumn} DESC`;

    const result = await pool.query<any>(
      `SELECT ${identifierSelect} as filename,
              ${sha256Select} as sha256,
              ${appliedAtSelect} as applied_at
       FROM schema_migrations
       ${orderBy}
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      filename: String(row.filename || ''),
      sha256: row.sha256 || '',
      // Deterministic: if applied_at is not available in the ledger, use a stable epoch timestamp.
      applied_at: row.applied_at ? new Date(row.applied_at) : new Date(0),
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
