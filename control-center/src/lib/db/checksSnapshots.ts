/**
 * Database Access Layer: Checks Snapshots
 * 
 * E9.3-CTRL-02: Checks Mirror (PR/Commit Checks Snapshot)
 * 
 * Provides functions for managing checks snapshot records.
 * Enables deterministic, stable view of GitHub check status for S4/S5 gate decisions.
 */

import { Pool } from 'pg';
import {
  ChecksSnapshotRow,
  ChecksSnapshotInput,
  ChecksSnapshotQuery,
  CheckEntry,
  calculateSnapshotHash,
  calculateChecksSummary,
  validateSnapshotInput,
} from '../contracts/checksSnapshot';

/**
 * Operation result type
 */
export interface OperationResult<T = ChecksSnapshotRow> {
  success: boolean;
  data?: T;
  error?: string;
  rowCount?: number;
}

/**
 * Create a checks snapshot (idempotent)
 * 
 * If a snapshot with the same hash already exists, returns the existing snapshot.
 * Otherwise, creates a new snapshot.
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Snapshot data
 * @returns Operation result with created/existing snapshot or error
 */
export async function createChecksSnapshot(
  pool: Pool,
  input: ChecksSnapshotInput
): Promise<OperationResult> {
  // Validate input
  const validation = validateSnapshotInput(input);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid input',
    };
  }

  try {
    const { repo_owner, repo_name, ref, checks, run_id, issue_id, request_id } = input;

    // Calculate hash and summary
    const snapshot_hash = calculateSnapshotHash(repo_owner, repo_name, ref, checks);
    const { total_checks, failed_checks, pending_checks } = calculateChecksSummary(checks);

    // Check if snapshot with this hash already exists
    const existingResult = await pool.query<ChecksSnapshotRow>(
      `SELECT
        id,
        run_id,
        issue_id,
        repo_owner,
        repo_name,
        ref,
        captured_at,
        checks,
        total_checks,
        failed_checks,
        pending_checks,
        snapshot_hash,
        request_id,
        created_at,
        updated_at
       FROM checks_snapshots
       WHERE snapshot_hash = $1
       LIMIT 1`,
      [snapshot_hash]
    );

    // If exists, return existing snapshot (idempotent)
    if (existingResult.rows.length > 0) {
      const row = existingResult.rows[0];
      return {
        success: true,
        data: {
          ...row,
          captured_at: row.captured_at.toString(),
          created_at: row.created_at.toString(),
          updated_at: row.updated_at.toString(),
        },
      };
    }

    // Create new snapshot
    const result = await pool.query<ChecksSnapshotRow>(
      `INSERT INTO checks_snapshots (
        run_id,
        issue_id,
        repo_owner,
        repo_name,
        ref,
        checks,
        total_checks,
        failed_checks,
        pending_checks,
        snapshot_hash,
        request_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        run_id || null,
        issue_id || null,
        repo_owner,
        repo_name,
        ref,
        JSON.stringify(checks),
        total_checks,
        failed_checks,
        pending_checks,
        snapshot_hash,
        request_id || null,
      ]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No row returned from insert',
      };
    }

    const row = result.rows[0];
    return {
      success: true,
      data: {
        ...row,
        captured_at: row.captured_at.toString(),
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      },
    };
  } catch (error) {
    console.error('[ChecksSnapshots] Create snapshot failed:', {
      error: error instanceof Error ? error.message : String(error),
      repo_owner: input.repo_owner,
      repo_name: input.repo_name,
      ref: input.ref,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get checks snapshots by query filter
 * 
 * @param pool - PostgreSQL connection pool
 * @param query - Query filter
 * @returns Operation result with snapshot records or error
 */
export async function getChecksSnapshots(
  pool: Pool,
  query: ChecksSnapshotQuery
): Promise<OperationResult<ChecksSnapshotRow[]>> {
  try {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Build WHERE clause
    if (query.run_id) {
      conditions.push(`run_id = $${paramIndex++}`);
      params.push(query.run_id);
    }

    if (query.issue_id) {
      conditions.push(`issue_id = $${paramIndex++}`);
      params.push(query.issue_id);
    }

    if (query.repo_owner && query.repo_name && query.ref) {
      conditions.push(`repo_owner = $${paramIndex++}`);
      params.push(query.repo_owner);
      conditions.push(`repo_name = $${paramIndex++}`);
      params.push(query.repo_name);
      conditions.push(`ref = $${paramIndex++}`);
      params.push(query.ref);
    }

    if (query.snapshot_hash) {
      conditions.push(`snapshot_hash = $${paramIndex++}`);
      params.push(query.snapshot_hash);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit || 10;

    const result = await pool.query<ChecksSnapshotRow>(
      `SELECT
        id,
        run_id,
        issue_id,
        repo_owner,
        repo_name,
        ref,
        captured_at,
        checks,
        total_checks,
        failed_checks,
        pending_checks,
        snapshot_hash,
        request_id,
        created_at,
        updated_at
       FROM checks_snapshots
       ${whereClause}
       ORDER BY captured_at DESC
       LIMIT $${paramIndex}`,
      [...params, limit]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        captured_at: row.captured_at.toString(),
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[ChecksSnapshots] Get snapshots failed:', {
      error: error instanceof Error ? error.message : String(error),
      query,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get the latest snapshot for a specific ref
 * 
 * @param pool - PostgreSQL connection pool
 * @param repo_owner - Repository owner
 * @param repo_name - Repository name
 * @param ref - Git ref (commit SHA or PR ref)
 * @returns Operation result with latest snapshot or null if none found
 */
export async function getLatestSnapshot(
  pool: Pool,
  repo_owner: string,
  repo_name: string,
  ref: string
): Promise<OperationResult<ChecksSnapshotRow | null>> {
  try {
    const result = await pool.query<ChecksSnapshotRow>(
      `SELECT
        id,
        run_id,
        issue_id,
        repo_owner,
        repo_name,
        ref,
        captured_at,
        checks,
        total_checks,
        failed_checks,
        pending_checks,
        snapshot_hash,
        request_id,
        created_at,
        updated_at
       FROM checks_snapshots
       WHERE repo_owner = $1 AND repo_name = $2 AND ref = $3
       ORDER BY captured_at DESC
       LIMIT 1`,
      [repo_owner, repo_name, ref]
    );

    return {
      success: true,
      data: result.rows.length > 0
        ? {
            ...result.rows[0],
            captured_at: result.rows[0].captured_at.toString(),
            created_at: result.rows[0].created_at.toString(),
            updated_at: result.rows[0].updated_at.toString(),
          }
        : null,
    };
  } catch (error) {
    console.error('[ChecksSnapshots] Get latest snapshot failed:', {
      error: error instanceof Error ? error.message : String(error),
      repo_owner,
      repo_name,
      ref,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get snapshot by ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param snapshot_id - Snapshot UUID
 * @returns Operation result with snapshot or null if not found
 */
export async function getSnapshotById(
  pool: Pool,
  snapshot_id: string
): Promise<OperationResult<ChecksSnapshotRow | null>> {
  try {
    const result = await pool.query<ChecksSnapshotRow>(
      `SELECT
        id,
        run_id,
        issue_id,
        repo_owner,
        repo_name,
        ref,
        captured_at,
        checks,
        total_checks,
        failed_checks,
        pending_checks,
        snapshot_hash,
        request_id,
        created_at,
        updated_at
       FROM checks_snapshots
       WHERE id = $1`,
      [snapshot_id]
    );

    return {
      success: true,
      data: result.rows.length > 0
        ? {
            ...result.rows[0],
            captured_at: result.rows[0].captured_at.toString(),
            created_at: result.rows[0].created_at.toString(),
            updated_at: result.rows[0].updated_at.toString(),
          }
        : null,
    };
  } catch (error) {
    console.error('[ChecksSnapshots] Get snapshot by ID failed:', {
      error: error instanceof Error ? error.message : String(error),
      snapshot_id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
