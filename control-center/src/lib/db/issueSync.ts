/**
 * Issue Sync Database Helper
 * 
 * Handles database operations for AFU-9 Issue Sync:
 * - Recording sync runs
 * - Upserting issue snapshots
 * - Querying sync status and staleness
 */

import { Pool } from 'pg';

/**
 * Issue snapshot row from database
 */
export interface IssueSnapshotRow {
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  canonical_id: string | null;
  state: 'open' | 'closed';
  title: string;
  labels: any; // JSONB
  assignees: any; // JSONB
  updated_at: Date;
  gh_node_id: string | null;
  payload_json: any; // JSONB
  synced_at: Date;
  created_at: Date;
}

/**
 * Issue sync run row from database
 */
export interface IssueSyncRunRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  query: string;
  total_count: number;
  upserted_count: number;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  error: string | null;
  created_at: Date;
}

/**
 * Sync staleness info
 */
export interface SyncStaleness {
  last_synced_at: Date | null;
  staleness_hours: number | null;
  total_snapshots: number;
}

/**
 * Operation result type
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Create a new issue sync run record
 * 
 * @param pool - PostgreSQL connection pool
 * @param query - GitHub search query used for sync
 * @returns Sync run ID
 */
export async function createIssueSyncRun(
  pool: Pool,
  query: string
): Promise<OperationResult<string>> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO issue_sync_runs (query, status, started_at)
       VALUES ($1, 'RUNNING', NOW())
       RETURNING id`,
      [query]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Failed to create sync run',
      };
    }

    return {
      success: true,
      data: result.rows[0].id,
    };
  } catch (error) {
    console.error('[createIssueSyncRun] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update issue sync run with results
 * 
 * @param pool - PostgreSQL connection pool
 * @param runId - Sync run ID
 * @param params - Update parameters
 */
export async function updateIssueSyncRun(
  pool: Pool,
  runId: string,
  params: {
    status: 'SUCCESS' | 'FAILED';
    total_count: number;
    upserted_count: number;
    error?: string | null;
  }
): Promise<OperationResult> {
  try {
    await pool.query(
      `UPDATE issue_sync_runs
       SET status = $1, 
           total_count = $2, 
           upserted_count = $3,
           error = $4,
           finished_at = NOW()
       WHERE id = $5`,
      [params.status, params.total_count, params.upserted_count, params.error || null, runId]
    );

    return { success: true };
  } catch (error) {
    console.error('[updateIssueSyncRun] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Upsert an issue snapshot (idempotent)
 * 
 * @param pool - PostgreSQL connection pool
 * @param snapshot - Issue snapshot data
 */
export async function upsertIssueSnapshot(
  pool: Pool,
  snapshot: {
    repo_owner: string;
    repo_name: string;
    issue_number: number;
    canonical_id: string | null;
    state: 'open' | 'closed';
    title: string;
    labels: any;
    assignees: any;
    updated_at: Date | string;
    gh_node_id: string | null;
    payload_json: any;
  }
): Promise<OperationResult> {
  try {
    await pool.query(
      `SELECT upsert_issue_snapshot($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        snapshot.repo_owner,
        snapshot.repo_name,
        snapshot.issue_number,
        snapshot.canonical_id,
        snapshot.state,
        snapshot.title,
        JSON.stringify(snapshot.labels),
        JSON.stringify(snapshot.assignees),
        snapshot.updated_at,
        snapshot.gh_node_id,
        JSON.stringify(snapshot.payload_json),
      ]
    );

    return { success: true };
  } catch (error) {
    console.error('[upsertIssueSnapshot] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get sync staleness information
 * 
 * @param pool - PostgreSQL connection pool
 */
export async function getSyncStaleness(
  pool: Pool
): Promise<OperationResult<SyncStaleness>> {
  try {
    const result = await pool.query<{
      last_synced_at: Date | null;
      staleness_hours: number | null;
      total_snapshots: number;
    }>(
      `SELECT last_synced_at, staleness_hours, total_snapshots
       FROM issue_sync_staleness`
    );

    if (result.rows.length === 0) {
      // No snapshots yet
      return {
        success: true,
        data: {
          last_synced_at: null,
          staleness_hours: null,
          total_snapshots: 0,
        },
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[getSyncStaleness] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List issue snapshots with cursor-based pagination
 * 
 * @param pool - PostgreSQL connection pool
 * @param options - Query options with cursor support
 */
export async function listIssueSnapshotsWithCursor(
  pool: Pool,
  options: {
    repo_owner?: string;
    repo_name?: string;
    state?: 'open' | 'closed';
    limit?: number;
    before?: string; // Cursor format: "timestamp:id"
  } = {}
): Promise<OperationResult<{ snapshots: IssueSnapshotRow[] }>> {
  try {
    const { repo_owner, repo_name, state, limit = 50, before } = options;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (repo_owner) {
      conditions.push(`repo_owner = $${paramIndex++}`);
      params.push(repo_owner);
    }

    if (repo_name) {
      conditions.push(`repo_name = $${paramIndex++}`);
      params.push(repo_name);
    }

    if (state) {
      conditions.push(`state = $${paramIndex++}`);
      params.push(state);
    }

    // Parse cursor for pagination
    if (before) {
      const [timestamp, issueNumber] = before.split(':');
      if (timestamp && issueNumber) {
        // Cursor-based pagination: WHERE (updated_at, issue_number) < (cursor_timestamp, cursor_id)
        // Using composite comparison for stable ordering
        conditions.push(`(updated_at, issue_number) < ($${paramIndex}::timestamptz, $${paramIndex + 1}::integer)`);
        params.push(timestamp, parseInt(issueNumber, 10));
        paramIndex += 2;
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);

    // Deterministic ordering: updated_at DESC, issue_number DESC (stable composite)
    const result = await pool.query<IssueSnapshotRow>(
      `SELECT * FROM issue_snapshots
       ${whereClause}
       ORDER BY updated_at DESC, issue_number DESC
       LIMIT $${paramIndex++}`,
      params
    );

    return {
      success: true,
      data: {
        snapshots: result.rows,
      },
    };
  } catch (error) {
    console.error('[listIssueSnapshotsWithCursor] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List issue snapshots with optional filtering
 * 
 * @param pool - PostgreSQL connection pool
 * @param options - Query options
 */
export async function listIssueSnapshots(
  pool: Pool,
  options: {
    repo_owner?: string;
    repo_name?: string;
    state?: 'open' | 'closed';
    limit?: number;
    offset?: number;
  } = {}
): Promise<OperationResult<{ snapshots: IssueSnapshotRow[]; total: number }>> {
  try {
    const { repo_owner, repo_name, state, limit = 100, offset = 0 } = options;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (repo_owner) {
      conditions.push(`repo_owner = $${paramIndex++}`);
      params.push(repo_owner);
    }

    if (repo_name) {
      conditions.push(`repo_name = $${paramIndex++}`);
      params.push(repo_name);
    }

    if (state) {
      conditions.push(`state = $${paramIndex++}`);
      params.push(state);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM issue_snapshots ${whereClause}`,
      params.slice(0, paramIndex - 1)
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get paginated results
    params.push(limit, offset);

    const result = await pool.query<IssueSnapshotRow>(
      `SELECT * FROM issue_snapshots
       ${whereClause}
       ORDER BY updated_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );

    return {
      success: true,
      data: {
        snapshots: result.rows,
        total,
      },
    };
  } catch (error) {
    console.error('[listIssueSnapshots] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get recent sync runs
 * 
 * @param pool - PostgreSQL connection pool
 * @param limit - Maximum number of runs to return
 */
export async function getRecentSyncRuns(
  pool: Pool,
  limit: number = 10
): Promise<OperationResult<IssueSyncRunRow[]>> {
  try {
    const result = await pool.query<IssueSyncRunRow>(
      `SELECT * FROM issue_sync_recent_runs LIMIT $1`,
      [limit]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[getRecentSyncRuns] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
