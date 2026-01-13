/**
 * DB Repair Runs DAO - Database Access Object
 * 
 * Issue: E86.5 - Staging DB Repair Mechanism
 * 
 * Provides append-only persistence for DB repair run audit records.
 * No update/delete operations allowed - enforced by DB triggers.
 */

import { Pool } from 'pg';
import {
  DbRepairRun,
  DbRepairRunInput,
  DbRepairRunStatus,
} from '../contracts/db-repair';

/**
 * Insert a DB repair run record (append-only)
 */
export async function insertDbRepairRun(
  pool: Pool,
  input: DbRepairRunInput
): Promise<DbRepairRun> {
  const result = await pool.query<any>(
    `INSERT INTO db_repair_runs (
      repair_id, expected_hash, actual_hash, executed_by,
      deployment_env, lawbook_hash, request_id, status,
      error_code, error_message, pre_missing_tables, post_missing_tables
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING 
      id, repair_id, expected_hash, actual_hash, executed_at,
      executed_by, deployment_env, lawbook_hash, request_id,
      status, error_code, error_message,
      pre_missing_tables, post_missing_tables`,
    [
      input.repair_id,
      input.expected_hash,
      input.actual_hash,
      input.executed_by,
      input.deployment_env,
      input.lawbook_hash,
      input.request_id,
      input.status,
      input.error_code,
      input.error_message,
      JSON.stringify(input.pre_missing_tables),
      JSON.stringify(input.post_missing_tables),
    ]
  );

  const row = result.rows[0];
  return mapRowToDbRepairRun(row);
}

/**
 * Get a DB repair run by ID
 */
export async function getDbRepairRun(
  pool: Pool,
  id: string
): Promise<DbRepairRun | null> {
  const result = await pool.query<any>(
    `SELECT 
      id, repair_id, expected_hash, actual_hash, executed_at,
      executed_by, deployment_env, lawbook_hash, request_id,
      status, error_code, error_message,
      pre_missing_tables, post_missing_tables
    FROM db_repair_runs
    WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDbRepairRun(result.rows[0]);
}

/**
 * List recent DB repair runs (stable-sorted by executed_at DESC)
 */
export async function listDbRepairRuns(
  pool: Pool,
  limit: number = 50
): Promise<DbRepairRun[]> {
  const result = await pool.query<any>(
    `SELECT 
      id, repair_id, expected_hash, actual_hash, executed_at,
      executed_by, deployment_env, lawbook_hash, request_id,
      status, error_code, error_message,
      pre_missing_tables, post_missing_tables
    FROM db_repair_runs
    ORDER BY executed_at DESC
    LIMIT $1`,
    [limit]
  );

  return result.rows.map(mapRowToDbRepairRun);
}

/**
 * List DB repair runs for a specific repair ID (stable-sorted)
 */
export async function listDbRepairRunsByRepairId(
  pool: Pool,
  repairId: string,
  limit: number = 50
): Promise<DbRepairRun[]> {
  const result = await pool.query<any>(
    `SELECT 
      id, repair_id, expected_hash, actual_hash, executed_at,
      executed_by, deployment_env, lawbook_hash, request_id,
      status, error_code, error_message,
      pre_missing_tables, post_missing_tables
    FROM db_repair_runs
    WHERE repair_id = $1
    ORDER BY executed_at DESC
    LIMIT $2`,
    [repairId, limit]
  );

  return result.rows.map(mapRowToDbRepairRun);
}

/**
 * Map database row to DbRepairRun
 */
function mapRowToDbRepairRun(row: any): DbRepairRun {
  return {
    id: row.id,
    repair_id: row.repair_id,
    expected_hash: row.expected_hash,
    actual_hash: row.actual_hash,
    executed_at: new Date(row.executed_at),
    executed_by: row.executed_by,
    deployment_env: row.deployment_env,
    lawbook_hash: row.lawbook_hash,
    request_id: row.request_id,
    status: row.status as DbRepairRunStatus,
    error_code: row.error_code,
    error_message: row.error_message,
    pre_missing_tables: Array.isArray(row.pre_missing_tables)
      ? row.pre_missing_tables
      : JSON.parse(row.pre_missing_tables || '[]'),
    post_missing_tables: Array.isArray(row.post_missing_tables)
      ? row.post_missing_tables
      : JSON.parse(row.post_missing_tables || '[]'),
  };
}
