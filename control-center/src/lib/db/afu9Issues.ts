/**
 * AFU9 Issues Database Helper
 * 
 * Centralized database operations for afu9_issues table.
 * Provides type-safe CRUD operations with proper error handling.
 * Enforces Single-Active constraint at service layer.
 * 
 * E61.1: Issue Lifecycle State Machine & Events Ledger
 * - Centralized state transition validation
 * - Atomic event logging for all transitions
 */

import { Pool } from 'pg';
import {
  Afu9IssueInput,
  Afu9IssueRow,
  Afu9IssueStatus,
  Afu9HandoffState,
  sanitizeAfu9IssueInput,
} from '../contracts/afu9Issue';
import { IssueState, isValidTransition } from '../types/issue-state';

/**
 * Helper function to build parameter array for INSERT queries
 * Reduces duplication and potential parameter misalignment errors
 * 
 * Note: execution_output and kpi_context are already objects (not stringified)
 * in the sanitized input. This function handles JSON.stringify for DB storage.
 * 
 * @param sanitized - Sanitized AFU9 issue input
 * @returns Array of parameters in the correct order for INSERT query
 */
function buildIssueInsertParams(sanitized: Afu9IssueInput): unknown[] {
  return [
    sanitized.title,
    sanitized.body,
    sanitized.status,
    sanitized.labels,
    sanitized.priority,
    sanitized.assignee,
    sanitized.source,
    sanitized.handoff_state,
    sanitized.github_issue_number,
    sanitized.github_url,
    sanitized.last_error,
    sanitized.activated_at,
    sanitized.activated_by,
    sanitized.execution_state,
    sanitized.execution_started_at,
    sanitized.execution_completed_at,
    // execution_output is an object in sanitized input, stringify for DB
    sanitized.execution_output ? JSON.stringify(sanitized.execution_output) : null,
    sanitized.handoff_at,
    sanitized.handoff_error,
    sanitized.github_repo,
    sanitized.github_issue_last_sync_at,
    sanitized.github_status_raw,
    sanitized.github_status_updated_at,
    sanitized.status_source,
    sanitized.github_mirror_status,
    sanitized.github_sync_error,
    sanitized.source_session_id,
    sanitized.current_draft_id,
    sanitized.active_cr_id,
    sanitized.github_synced_at,
    // kpi_context is an object in sanitized input, stringify for DB
    sanitized.kpi_context ? JSON.stringify(sanitized.kpi_context) : null,
    sanitized.publish_batch_id,
    sanitized.publish_request_id,
    sanitized.canonical_id,
  ];
}

/**
 * Operation result type
 */
export interface OperationResult<T = Afu9IssueRow> {
  success: boolean;
  data?: T;
  error?: string;
  rowCount?: number;
}

/**
 * Query options for listing issues
 */
export interface ListIssuesOptions {
  status?: Afu9IssueStatus;
  handoff_state?: Afu9HandoffState;
  limit?: number;
  offset?: number;
}

/**
 * Create a new AFU9 issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Validated and sanitized issue input
 * @returns Operation result with created issue or error
 */
export async function createAfu9Issue(
  pool: Pool,
  input: Afu9IssueInput
): Promise<OperationResult> {
  // Sanitize input to ensure all constraints are met
  const sanitized = sanitizeAfu9IssueInput(input);

  // E61.2: Check Single-Active constraint before creating
  if (sanitized.status === Afu9IssueStatus.SPEC_READY) {
    const canSetActive = await canSetIssueActive(pool, null);
    if (!canSetActive.success) {
      return {
        success: false,
        error: canSetActive.error,
      };
    }
  }

  try {
    const params = buildIssueInsertParams(sanitized);
    const result = await pool.query<Afu9IssueRow>(
      `INSERT INTO afu9_issues (
        title, body, status, labels, priority, assignee, source,
        handoff_state, github_issue_number, github_url, last_error, activated_at, activated_by,
        execution_state, execution_started_at, execution_completed_at, execution_output,
        handoff_at, handoff_error, github_repo, github_issue_last_sync_at,
        github_status_raw, github_status_updated_at, status_source, github_mirror_status, github_sync_error,
        source_session_id, current_draft_id, active_cr_id, github_synced_at, kpi_context, publish_batch_id, publish_request_id, canonical_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
      RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No row returned from insert',
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    // Log error for debugging (without exposing sensitive data)
    console.error('[afu9Issues] Create failed:', {
      error: error instanceof Error ? error.message : String(error),
      title: sanitized.title,
      status: sanitized.status,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get an AFU9 issue by ID (canonical UUID)
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Issue UUID (canonical identifier)
 * @returns Operation result with issue or error
 */
export async function getAfu9IssueById(
  pool: Pool,
  id: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      'SELECT * FROM afu9_issues WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found: ${id}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Issues] Get by ID failed:', {
      error: error instanceof Error ? error.message : String(error),
      id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get an AFU9 issue by publicId (8-hex display format).
 *
 * **Issue #3: Identifier Consistency**
 * 
 * The publicId is an 8-hex display format derived from the UUID prefix.
 * Example: UUID "c300abd8-1234-..." -> publicId "c300abd8"
 * 
 * This is a read-only lookup mechanism. The canonical identifier is
 * always the full UUID stored in the `id` column.
 *
 * @param pool - PostgreSQL connection pool
 * @param publicId - 8-hex issue publicId (display format)
 * @returns Operation result with issue or error
 */
export async function getAfu9IssueByPublicId(
  pool: Pool,
  publicId: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      `SELECT *
       FROM afu9_issues
       WHERE LOWER(LEFT(id::text, 8)) = LOWER($1)
       ORDER BY created_at DESC
       LIMIT 1`,
      [publicId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found: ${publicId}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Issues] Get by publicId failed:', {
      error: error instanceof Error ? error.message : String(error),
      publicId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get the currently active issue (if any)
 * 
 * E61.2: Active is defined as status = SPEC_READY
 * 
 * @param pool - PostgreSQL connection pool
 * @returns Operation result with active issue or null if none
 */
export async function getActiveIssue(pool: Pool): Promise<OperationResult<Afu9IssueRow | null>> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      'SELECT * FROM afu9_issues WHERE status = $1',
      [Afu9IssueStatus.SPEC_READY]
    );

    return {
      success: true,
      data: result.rows.length > 0 ? result.rows[0] : null,
    };
  } catch (error) {
    console.error('[afu9Issues] Get active issue failed:', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * List AFU9 issues with optional filtering
 * 
 * @param pool - PostgreSQL connection pool
 * @param options - Query options for filtering and pagination
 * @returns Operation result with list of issues or error
 */
export async function listAfu9Issues(
  pool: Pool,
  options: ListIssuesOptions = {}
): Promise<OperationResult<Afu9IssueRow[]>> {
  const { status, handoff_state, limit = 100, offset = 0 } = options;

  try {
    let query = 'SELECT * FROM afu9_issues WHERE deleted_at IS NULL';
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (handoff_state) {
      query += ` AND handoff_state = $${paramIndex}`;
      params.push(handoff_state);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query<Afu9IssueRow>(query, params);

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[afu9Issues] List failed:', {
      error: error instanceof Error ? error.message : String(error),
      options,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update an AFU9 issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Issue UUID
 * @param updates - Partial issue data to update
 * @returns Operation result with updated issue or error
 */
export async function updateAfu9Issue(
  pool: Pool,
  id: string,
  updates: Partial<Afu9IssueInput>
): Promise<OperationResult> {
  // E61.2: Check Single-Active constraint if updating to SPEC_READY status
  if (updates.status === Afu9IssueStatus.SPEC_READY) {
    const canSetActive = await canSetIssueActive(pool, id);
    if (!canSetActive.success) {
      return {
        success: false,
        error: canSetActive.error,
      };
    }
  }

  try {
    // Build dynamic UPDATE query
    const fields: string[] = [];
    const values: (string | string[] | number | null)[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      fields.push(`title = $${paramIndex}`);
      values.push(updates.title.trim());
      paramIndex++;
    }

    if (updates.body !== undefined) {
      fields.push(`body = $${paramIndex}`);
      values.push(updates.body);
      paramIndex++;
    }

    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex}`);
      values.push(updates.status);
      paramIndex++;
    }

    if (updates.labels !== undefined) {
      fields.push(`labels = $${paramIndex}`);
      values.push(updates.labels);
      paramIndex++;
    }

    if (updates.priority !== undefined) {
      fields.push(`priority = $${paramIndex}`);
      values.push(updates.priority);
      paramIndex++;
    }

    if (updates.assignee !== undefined) {
      fields.push(`assignee = $${paramIndex}`);
      values.push(updates.assignee);
      paramIndex++;
    }

    if (updates.handoff_state !== undefined) {
      fields.push(`handoff_state = $${paramIndex}`);
      values.push(updates.handoff_state);
      paramIndex++;
    }

    if (updates.github_issue_number !== undefined) {
      fields.push(`github_issue_number = $${paramIndex}`);
      values.push(updates.github_issue_number);
      paramIndex++;
    }

    if (updates.github_url !== undefined) {
      fields.push(`github_url = $${paramIndex}`);
      values.push(updates.github_url);
      paramIndex++;
    }

    if (updates.last_error !== undefined) {
      fields.push(`last_error = $${paramIndex}`);
      values.push(updates.last_error);
      paramIndex++;
    }

    if (updates.activated_at !== undefined) {
      fields.push(`activated_at = $${paramIndex}`);
      values.push(updates.activated_at);
      paramIndex++;
    }

    if (updates.activated_by !== undefined) {
      fields.push(`activated_by = $${paramIndex}`);
      values.push(updates.activated_by);
      paramIndex++;
    }

    if (updates.execution_state !== undefined) {
      fields.push(`execution_state = $${paramIndex}`);
      values.push(updates.execution_state);
      paramIndex++;
    }

    if (updates.execution_started_at !== undefined) {
      fields.push(`execution_started_at = $${paramIndex}`);
      values.push(updates.execution_started_at);
      paramIndex++;
    }

    if (updates.execution_completed_at !== undefined) {
      fields.push(`execution_completed_at = $${paramIndex}`);
      values.push(updates.execution_completed_at);
      paramIndex++;
    }

    if (updates.execution_output !== undefined) {
      fields.push(`execution_output = $${paramIndex}`);
      // execution_output should be a plain object (validated by contract)
      // PostgreSQL JSONB expects a JSON string, so we stringify if it's not null
      values.push(updates.execution_output ? JSON.stringify(updates.execution_output) : null);
      paramIndex++;
    }

    // E61.3: Handoff metadata fields
    if (updates.handoff_at !== undefined) {
      fields.push(`handoff_at = $${paramIndex}`);
      values.push(updates.handoff_at);
      paramIndex++;
    }

    if (updates.handoff_error !== undefined) {
      fields.push(`handoff_error = $${paramIndex}`);
      values.push(updates.handoff_error);
      paramIndex++;
    }

    if (updates.github_repo !== undefined) {
      fields.push(`github_repo = $${paramIndex}`);
      values.push(updates.github_repo);
      paramIndex++;
    }

    if (updates.github_issue_last_sync_at !== undefined) {
      fields.push(`github_issue_last_sync_at = $${paramIndex}`);
      values.push(updates.github_issue_last_sync_at);
      paramIndex++;
    }

    // E7_extra: GitHub status parity fields
    if (updates.github_status_raw !== undefined) {
      fields.push(`github_status_raw = $${paramIndex}`);
      values.push(updates.github_status_raw);
      paramIndex++;
    }

    if (updates.github_status_updated_at !== undefined) {
      fields.push(`github_status_updated_at = $${paramIndex}`);
      values.push(updates.github_status_updated_at);
      paramIndex++;
    }

    if (updates.status_source !== undefined) {
      fields.push(`status_source = $${paramIndex}`);
      values.push(updates.status_source);
      paramIndex++;
    }

    // I2: State Model v1 fields
    if (updates.github_mirror_status !== undefined) {
      fields.push(`github_mirror_status = $${paramIndex}`);
      values.push(updates.github_mirror_status);
      paramIndex++;
    }

    if (updates.github_sync_error !== undefined) {
      fields.push(`github_sync_error = $${paramIndex}`);
      values.push(updates.github_sync_error);
      paramIndex++;
    }

    // AFU-9 Issue Lifecycle fields
    if (updates.source_session_id !== undefined) {
      fields.push(`source_session_id = $${paramIndex}`);
      values.push(updates.source_session_id);
      paramIndex++;
    }

    if (updates.current_draft_id !== undefined) {
      fields.push(`current_draft_id = $${paramIndex}`);
      values.push(updates.current_draft_id);
      paramIndex++;
    }

    if (updates.active_cr_id !== undefined) {
      fields.push(`active_cr_id = $${paramIndex}`);
      values.push(updates.active_cr_id);
      paramIndex++;
    }

    if (updates.github_synced_at !== undefined) {
      fields.push(`github_synced_at = $${paramIndex}`);
      values.push(updates.github_synced_at);
      paramIndex++;
    }

    if (updates.kpi_context !== undefined) {
      fields.push(`kpi_context = $${paramIndex}`);
      values.push(updates.kpi_context ? JSON.stringify(updates.kpi_context) : null);
      paramIndex++;
    }

    if (updates.publish_batch_id !== undefined) {
      fields.push(`publish_batch_id = $${paramIndex}`);
      values.push(updates.publish_batch_id);
      paramIndex++;
    }

    if (updates.publish_request_id !== undefined) {
      fields.push(`publish_request_id = $${paramIndex}`);
      values.push(updates.publish_request_id);
      paramIndex++;
    }

    if (updates.canonical_id !== undefined) {
      fields.push(`canonical_id = $${paramIndex}`);
      values.push(updates.canonical_id);
      paramIndex++;
    }

    if (fields.length === 0) {
      return {
        success: false,
        error: 'No fields to update',
      };
    }

    // Add id parameter
    values.push(id);

    const query = `
      UPDATE afu9_issues 
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query<Afu9IssueRow>(query, values);

    if (result.rows.length === 0) {
      return {
        success: false,
        rowCount: result.rowCount ?? 0,
        error: `Issue not found: ${id}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
      rowCount: result.rowCount ?? result.rows.length,
    };
  } catch (error) {
    console.error('[afu9Issues] Update failed:', {
      error: error instanceof Error ? error.message : String(error),
      id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Soft delete an AFU9 issue
 * Only allowed for issues with status=CREATED and handoff_state=NOT_SENT
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Issue UUID
 * @returns Operation result with success or error
 */
export async function softDeleteAfu9Issue(
  pool: Pool,
  id: string
): Promise<OperationResult<void>> {
  try {
    // First, check if the issue can be deleted
    const issueResult = await pool.query<Afu9IssueRow>(
      'SELECT status, handoff_state FROM afu9_issues WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (issueResult.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found or already deleted: ${id}`,
      };
    }

    const issue = issueResult.rows[0];

    // Enforce guardrails: only allow deletion for CREATED + NOT_SENT
    if (issue.status !== Afu9IssueStatus.CREATED || issue.handoff_state !== Afu9HandoffState.NOT_SENT) {
      return {
        success: false,
        error: `Cannot delete issue: deletion only allowed for status=CREATED and handoff_state=NOT_SENT. Current status=${issue.status}, handoff_state=${issue.handoff_state}`,
      };
    }

    // Perform soft delete by setting deleted_at timestamp
    const result = await pool.query(
      'UPDATE afu9_issues SET deleted_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Failed to delete issue: ${id}`,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error('[afu9Issues] Soft delete failed:', {
      error: error instanceof Error ? error.message : String(error),
      id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Delete an AFU9 issue (hard delete - use with caution)
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Issue UUID
 * @returns Operation result with success or error
 * @deprecated Use softDeleteAfu9Issue instead for safety
 */
export async function deleteAfu9Issue(
  pool: Pool,
  id: string
): Promise<OperationResult<void>> {
  try {
    const result = await pool.query(
      'DELETE FROM afu9_issues WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found: ${id}`,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error('[afu9Issues] Delete failed:', {
      error: error instanceof Error ? error.message : String(error),
      id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Check if an issue can be set to ACTIVE status (Single-Active enforcement)
 * 
 * E61.2: Active is defined as status = SPEC_READY
 * 
 * @param pool - PostgreSQL connection pool
 * @param excludeId - Issue ID to exclude from check (for updates)
 * @returns Operation result indicating if the issue can be set to ACTIVE
 */
export async function canSetIssueActive(
  pool: Pool,
  excludeId: string | null
): Promise<OperationResult<boolean>> {
  try {
    let query = 'SELECT id, title FROM afu9_issues WHERE status = $1';
    const params: (string | Afu9IssueStatus)[] = [Afu9IssueStatus.SPEC_READY];

    if (excludeId) {
      query += ' AND id != $2';
      params.push(excludeId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length > 0) {
      const activeIssue = result.rows[0];
      return {
        success: false,
        error: `Single-Active constraint: Issue ${activeIssue.id} ("${activeIssue.title}") is already SPEC_READY. Only one issue can have status=SPEC_READY at a time.`,
      };
    }

    return {
      success: true,
      data: true,
    };
  } catch (error) {
    console.error('[afu9Issues] Can set active check failed:', {
      error: error instanceof Error ? error.message : String(error),
      excludeId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Count issues by status
 * 
 * @param pool - PostgreSQL connection pool
 * @returns Operation result with count map or error
 */
export async function countIssuesByStatus(
  pool: Pool
): Promise<OperationResult<Record<Afu9IssueStatus, number>>> {
  try {
    const result = await pool.query<{ status: Afu9IssueStatus; count: string }>(
      'SELECT status, COUNT(*) as count FROM afu9_issues GROUP BY status'
    );

    const counts: Record<Afu9IssueStatus, number> = {
      [Afu9IssueStatus.CREATED]: 0,
      [Afu9IssueStatus.DRAFT_READY]: 0,
      [Afu9IssueStatus.VERSION_COMMITTED]: 0,
      [Afu9IssueStatus.CR_BOUND]: 0,
      [Afu9IssueStatus.SPEC_READY]: 0,
      [Afu9IssueStatus.PUBLISHING]: 0,
      [Afu9IssueStatus.PUBLISHED]: 0,
      [Afu9IssueStatus.IMPLEMENTING]: 0,
      [Afu9IssueStatus.VERIFIED]: 0,
      [Afu9IssueStatus.MERGE_READY]: 0,
      [Afu9IssueStatus.DONE]: 0,
      [Afu9IssueStatus.HOLD]: 0,
      [Afu9IssueStatus.KILLED]: 0,
    };

    result.rows.forEach((row) => {
      counts[row.status] = parseInt(row.count, 10);
    });

    return {
      success: true,
      data: counts,
    };
  } catch (error) {
    console.error('[afu9Issues] Count by status failed:', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * AFU9 Issue Event Row
 * Represents a row from the afu9_issue_events table
 * Updated for E61.1: Issue Lifecycle State Machine & Events Ledger
 */
export interface Afu9IssueEventRow {
  id: string;
  issue_id: string;
  type: string;
  payload_json: Record<string, unknown>;
  from_status: string | null;
  to_status: string | null;
  at: string;
  actor: string | null;
}

/**
 * Get activity log events for an AFU9 issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param limit - Maximum number of events to retrieve (default: 100)
 * @returns Operation result with events or error
 */
export async function getIssueEvents(
  pool: Pool,
  issueId: string,
  limit: number = 100
): Promise<OperationResult<Afu9IssueEventRow[]>> {
  try {
    const result = await pool.query<Afu9IssueEventRow>(
      `SELECT 
        id, issue_id, type, payload_json, 
        from_status, to_status, 
        at, actor
       FROM afu9_issue_events 
       WHERE issue_id = $1 
       ORDER BY at DESC 
       LIMIT $2`,
      [issueId, limit]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[afu9Issues] Get issue events failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * E61.1: Centralized Issue State Transition Function
 * 
 * Transitions an issue from one state to another with:
 * - Validation of allowed transitions
 * - Atomic event logging
 * - Deterministic state changes
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param toState - Target state (as Afu9IssueStatus)
 * @param actor - Who/what is triggering the transition (user, system, etc.)
 * @param payload - Optional metadata for the transition
 * @returns Operation result with updated issue or error
 */
export async function transitionIssue(
  pool: Pool,
  issueId: string,
  toState: Afu9IssueStatus,
  actor: string = 'system',
  payload?: Record<string, unknown>
): Promise<OperationResult> {
  // Get current issue state
  const issueResult = await getAfu9IssueById(pool, issueId);
  if (!issueResult.success || !issueResult.data) {
    return {
      success: false,
      error: issueResult.error || `Issue not found: ${issueId}`,
    };
  }

  const currentIssue = issueResult.data;
  const fromState = currentIssue.status as unknown as IssueState;
  const targetState = toState as unknown as IssueState;

  // Validate transition
  if (!isValidTransition(fromState, targetState)) {
    return {
      success: false,
      error: `Invalid transition: ${fromState} -> ${targetState}. This transition is not allowed by the state machine.`,
    };
  }

  // Use a transaction to ensure atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update issue status
    const updateResult = await client.query<Afu9IssueRow>(
      'UPDATE afu9_issues SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [toState, issueId]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: `Issue not found: ${issueId}`,
      };
    }

    // Write transition event explicitly (in addition to trigger)
    await client.query(
      `INSERT INTO afu9_issue_events (
        issue_id, type, from_status, to_status, actor, payload_json
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        issueId,
        'TRANSITION',
        fromState,
        targetState,
        actor,
        payload ? JSON.stringify(payload) : '{}',
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      data: updateResult.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[afu9Issues] Transition failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      fromState,
      toState: targetState,
      actor,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  } finally {
    client.release();
  }
}

/**
 * Bind a Change Request to an AFU-9 Issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param crId - CR version UUID
 * @returns Operation result with updated issue or error
 */
export async function bindCrToIssue(
  pool: Pool,
  issueId: string,
  crId: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      `UPDATE afu9_issues 
       SET active_cr_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [crId, issueId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found: ${issueId}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Issues] Bind CR failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      crId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Unbind a Change Request from an AFU-9 Issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @returns Operation result with updated issue or error
 */
export async function unbindCrFromIssue(
  pool: Pool,
  issueId: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      `UPDATE afu9_issues 
       SET active_cr_id = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [issueId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found: ${issueId}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Issues] Unbind CR failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get public ID from issue UUID (first 8 characters)
 * 
 * @param issueId - Issue UUID
 * @returns 8-character public ID
 */
export function getPublicId(issueId: string): string {
  const PUBLIC_ID_LENGTH = 8;
  return issueId.substring(0, PUBLIC_ID_LENGTH).toLowerCase();
}

/**
 * Get an AFU9 issue by GitHub issue number
 * 
 * @param pool - PostgreSQL connection pool
 * @param githubIssueNumber - GitHub issue number
 * @param owner - Repository owner (optional, for uniqueness)
 * @param repo - Repository name (optional, for uniqueness)
 * @returns Operation result with issue or error
 */
export async function getAfu9IssueByGithubNumber(
  pool: Pool,
  githubIssueNumber: number,
  owner?: string,
  repo?: string
): Promise<OperationResult> {
  try {
    let query = 'SELECT * FROM afu9_issues WHERE github_issue_number = $1';
    const params: (number | string)[] = [githubIssueNumber];

    if (owner && repo) {
      query += ' AND github_repo = $2';
      params.push(`${owner}/${repo}`);
    }

    query += ' ORDER BY created_at DESC LIMIT 1';

    const result = await pool.query<Afu9IssueRow>(query, params);

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found with GitHub issue number: ${githubIssueNumber}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Issues] Get by GitHub number failed:', {
      error: error instanceof Error ? error.message : String(error),
      githubIssueNumber,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get an AFU9 issue by canonical ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param canonicalId - Canonical ID (e.g., I811, E81.1, CID:E81.1)
 * @returns Operation result with issue or error
 */
export async function getAfu9IssueByCanonicalId(
  pool: Pool,
  canonicalId: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      'SELECT * FROM afu9_issues WHERE canonical_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [canonicalId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Issue not found with canonical ID: ${canonicalId}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[afu9Issues] Get by canonical ID failed:', {
      error: error instanceof Error ? error.message : String(error),
      canonicalId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Idempotently ensure an AFU-9 Issue exists for a committed draft
 * 
 * AFU9-I-P1.4: Create canonical AFU-9 Issue on committed IssueDraft
 * 
 * Creates an AFU-9 Issue if it doesn't exist for the given canonical ID,
 * or returns the existing issue. Uses transaction to ensure atomicity and
 * exactly-once ISSUE_CREATED timeline event.
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Issue input data (must include canonical_id)
 * @param sessionId - Source session ID
 * @param draftVersionId - Committed draft version ID (optional)
 * @returns Operation result with issue and isNew flag
 */
export async function ensureIssueForCommittedDraft(
  pool: Pool,
  input: Afu9IssueInput,
  sessionId: string,
  draftVersionId?: string,
  issueHash?: string
): Promise<OperationResult<{ issue: Afu9IssueRow; isNew: boolean }>> {
  // Validate that canonical_id is provided
  if (!input.canonical_id || input.canonical_id.trim().length === 0) {
    return {
      success: false,
      error: 'canonical_id is required for issue creation',
    };
  }

  const canonicalId = input.canonical_id.trim();

  // Use a transaction to ensure atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert issue (idempotent) using canonical_id as unique key
    // Note: source is always 'afu9' for database constraint compliance
    // The origin is tracked via source_session_id and timeline event
    const sanitized = sanitizeAfu9IssueInput({
      ...input,
      status: Afu9IssueStatus.CREATED,
      source: 'afu9',
      source_session_id: sessionId,
      current_draft_id: draftVersionId || null,
      canonical_id: canonicalId,
    });

    const insertResult = await client.query<Afu9IssueRow & { is_new: boolean }>(
      `INSERT INTO afu9_issues (
        title, body, status, labels, priority, assignee, source,
        handoff_state, github_issue_number, github_url, last_error, activated_at, activated_by,
        execution_state, execution_started_at, execution_completed_at, execution_output,
        handoff_at, handoff_error, github_repo, github_issue_last_sync_at,
        github_status_raw, github_status_updated_at, status_source, github_mirror_status, github_sync_error,
        source_session_id, current_draft_id, active_cr_id, github_synced_at, kpi_context, publish_batch_id, publish_request_id, canonical_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
      ON CONFLICT (canonical_id)
      DO UPDATE SET
        source_session_id = EXCLUDED.source_session_id,
        current_draft_id = CASE
          WHEN EXCLUDED.current_draft_id IS NULL THEN afu9_issues.current_draft_id
          ELSE EXCLUDED.current_draft_id
        END,
        updated_at = NOW()
      RETURNING *, (xmax = 0) AS is_new`,
      buildIssueInsertParams(sanitized)
    );

    if (insertResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Failed to create issue',
      };
    }

    const upsertedIssue = insertResult.rows[0];
    const isNew = Boolean(upsertedIssue.is_new);
    const issue = upsertedIssue as Afu9IssueRow;

    if (!isNew) {
      await client.query('COMMIT');
      return {
        success: true,
        data: {
          issue,
          isNew: false,
        },
      };
    }

    // Log ISSUE_CREATED timeline event (exactly once)
    // Timeline event uses INTENT_COMMIT source to track the creation context
    await client.query(
      `INSERT INTO issue_timeline (
        issue_id,
        event_type,
        event_data,
        actor,
        actor_type
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        issue.id,
        'ISSUE_CREATED',
        JSON.stringify({
          canonical_id: canonicalId,
          session_id: sessionId,
          draft_version_id: draftVersionId || null,
          issue_hash: issueHash || null,
          source: 'INTENT_COMMIT', // Event source, not issue source
        }),
        'system',
        'system',
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      data: {
        issue,
        isNew: true,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    
    console.error('[afu9Issues] Ensure issue for committed draft failed:', {
      error: error instanceof Error ? error.message : String(error),
      canonical_id: input.canonical_id,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
    });

    // Check if it's a unique constraint violation
    const err = error as any;
    if (err?.code === '23505' && err?.constraint?.includes('canonical_id')) {
      // Race condition - another process created the issue
      // Retry by fetching the existing issue
      try {
        const retryResult = await pool.query<Afu9IssueRow>(
          'SELECT * FROM afu9_issues WHERE canonical_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
          [canonicalId]
        );

        if (retryResult.rows.length > 0) {
          return {
            success: true,
            data: {
              issue: retryResult.rows[0],
              isNew: false,
            },
          };
        }
      } catch (retryError) {
        console.error('[afu9Issues] Retry fetch after constraint violation failed:', retryError);
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  } finally {
    client.release();
  }
}

