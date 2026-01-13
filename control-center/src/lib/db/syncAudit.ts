/**
 * Database Access Layer: Sync Audit Events
 * E85.2: Bi-directional Sync (AFU-9 ↔ GitHub)
 * 
 * Provides functions for recording and querying sync audit events and conflicts.
 */

import { Pool } from 'pg';
import {
  SyncAuditEventInput,
  SyncAuditEventRow,
  SyncConflictInput,
  SyncConflictRow,
} from '../contracts/sync-audit';

/**
 * Operation result type
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Record a sync audit event (idempotent via event hashing)
 * 
 * @param pool - PostgreSQL connection pool
 * @param event - Sync audit event data
 * @returns Event ID (null if duplicate event)
 */
export async function recordSyncAuditEvent(
  pool: Pool,
  event: SyncAuditEventInput
): Promise<OperationResult<string | null>> {
  try {
    const result = await pool.query<{ id: string | null }>(
      `SELECT record_sync_event(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      ) as id`,
      [
        event.event_type,
        event.issue_id || null,
        event.github_owner || null,
        event.github_repo || null,
        event.github_issue_number || null,
        event.sync_direction,
        event.old_status || null,
        event.new_status || null,
        event.transition_allowed || null,
        event.transition_blocked_reason || null,
        event.evidence_type || null,
        JSON.stringify(event.evidence_payload || {}),
        event.github_pr_state || null,
        event.github_pr_merged || null,
        event.github_checks_status || null,
        event.github_review_status || null,
        JSON.stringify(event.github_labels || []),
        event.dry_run || false,
        event.conflict_detected || false,
        event.conflict_reason || null,
        event.sync_run_id || null,
        event.created_by || null,
      ]
    );

    return {
      success: true,
      data: result.rows[0]?.id || null,
    };
  } catch (error) {
    console.error('[recordSyncAuditEvent] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query sync audit events by issue ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - AFU-9 issue UUID
 * @param options - Query options
 * @returns List of sync audit events
 */
export async function querySyncAuditEventsByIssue(
  pool: Pool,
  issueId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<OperationResult<SyncAuditEventRow[]>> {
  try {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const result = await pool.query<SyncAuditEventRow>(
      `SELECT * FROM sync_audit_events
       WHERE issue_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [issueId, limit, offset]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[querySyncAuditEventsByIssue] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query sync audit events by GitHub issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @param issueNumber - GitHub issue number
 * @param options - Query options
 * @returns List of sync audit events
 */
export async function querySyncAuditEventsByGitHubIssue(
  pool: Pool,
  owner: string,
  repo: string,
  issueNumber: number,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<OperationResult<SyncAuditEventRow[]>> {
  try {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const result = await pool.query<SyncAuditEventRow>(
      `SELECT * FROM sync_audit_events
       WHERE github_owner = $1 AND github_repo = $2 AND github_issue_number = $3
       ORDER BY created_at DESC
       LIMIT $4 OFFSET $5`,
      [owner, repo, issueNumber, limit, offset]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[querySyncAuditEventsByGitHubIssue] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get recent sync audit events
 * 
 * @param pool - PostgreSQL connection pool
 * @param limit - Maximum number of events to return
 * @returns List of recent sync audit events
 */
export async function getRecentSyncAuditEvents(
  pool: Pool,
  limit: number = 100
): Promise<OperationResult<SyncAuditEventRow[]>> {
  try {
    const result = await pool.query<SyncAuditEventRow>(
      `SELECT * FROM sync_audit_recent_events LIMIT $1`,
      [limit]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[getRecentSyncAuditEvents] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create a sync conflict record
 * 
 * @param pool - PostgreSQL connection pool
 * @param conflict - Sync conflict data
 * @returns Conflict ID
 */
export async function createSyncConflict(
  pool: Pool,
  conflict: SyncConflictInput
): Promise<OperationResult<string>> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO sync_conflicts (
        issue_id,
        github_owner,
        github_repo,
        github_issue_number,
        conflict_type,
        afu9_status,
        github_status_raw,
        github_pr_state,
        description,
        resolution_required,
        audit_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        conflict.issue_id,
        conflict.github_owner,
        conflict.github_repo,
        conflict.github_issue_number,
        conflict.conflict_type,
        conflict.afu9_status,
        conflict.github_status_raw || null,
        conflict.github_pr_state || null,
        conflict.description,
        conflict.resolution_required !== false,
        conflict.audit_event_id || null,
      ]
    );

    return {
      success: true,
      data: result.rows[0].id,
    };
  } catch (error) {
    console.error('[createSyncConflict] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get unresolved sync conflicts
 * 
 * @param pool - PostgreSQL connection pool
 * @param options - Query options
 * @returns List of unresolved sync conflicts
 */
export async function getUnresolvedSyncConflicts(
  pool: Pool,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<OperationResult<SyncConflictRow[]>> {
  try {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;

    const result = await pool.query<SyncConflictRow>(
      `SELECT * FROM sync_conflicts
       WHERE resolved = FALSE
       ORDER BY detected_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[getUnresolvedSyncConflicts] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Resolve a sync conflict
 * 
 * @param pool - PostgreSQL connection pool
 * @param conflictId - Sync conflict UUID
 * @param resolution - Resolution details
 * @returns Success status
 */
export async function resolveSyncConflict(
  pool: Pool,
  conflictId: string,
  resolution: {
    resolved_by: string;
    resolution_action?: string | null;
    resolution_notes?: string | null;
  }
): Promise<OperationResult> {
  try {
    await pool.query(
      `UPDATE sync_conflicts
       SET resolved = TRUE,
           resolved_at = NOW(),
           resolved_by = $1,
           resolution_action = $2,
           resolution_notes = $3
       WHERE id = $4`,
      [
        resolution.resolved_by,
        resolution.resolution_action || null,
        resolution.resolution_notes || null,
        conflictId,
      ]
    );

    return { success: true };
  } catch (error) {
    console.error('[resolveSyncConflict] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query sync conflicts by issue ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - AFU-9 issue UUID
 * @param options - Query options
 * @returns List of sync conflicts
 */
export async function querySyncConflictsByIssue(
  pool: Pool,
  issueId: string,
  options?: {
    includeResolved?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<OperationResult<SyncConflictRow[]>> {
  try {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    const includeResolved = options?.includeResolved !== false;

    const whereClause = includeResolved
      ? 'WHERE issue_id = $1'
      : 'WHERE issue_id = $1 AND resolved = FALSE';

    const result = await pool.query<SyncConflictRow>(
      `SELECT * FROM sync_conflicts
       ${whereClause}
       ORDER BY detected_at DESC
       LIMIT $2 OFFSET $3`,
      [issueId, limit, offset]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[querySyncConflictsByIssue] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
