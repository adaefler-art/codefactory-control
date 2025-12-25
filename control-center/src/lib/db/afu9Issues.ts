/**
 * AFU9 Issues Database Helper
 * 
 * Centralized database operations for afu9_issues table.
 * Provides type-safe CRUD operations with proper error handling.
 * Enforces Single-Active constraint at service layer.
 */

import { Pool } from 'pg';
import {
  Afu9IssueInput,
  Afu9IssueRow,
  Afu9IssueStatus,
  Afu9HandoffState,
  sanitizeAfu9IssueInput,
} from '../contracts/afu9Issue';

/**
 * Operation result type
 */
export interface OperationResult<T = Afu9IssueRow> {
  success: boolean;
  data?: T;
  error?: string;
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

  // Check Single-Active constraint before creating
  if (sanitized.status === Afu9IssueStatus.IMPLEMENTING) {
    const canSetActive = await canSetIssueActive(pool, null);
    if (!canSetActive.success) {
      return {
        success: false,
        error: canSetActive.error,
      };
    }
  }

  try {
    const result = await pool.query<Afu9IssueRow>(
      `INSERT INTO afu9_issues (
        title, body, status, labels, priority, assignee, source,
        handoff_state, github_issue_number, github_url, last_error, activated_at,
        execution_state, execution_started_at, execution_completed_at, execution_output
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
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
        sanitized.execution_state,
        sanitized.execution_started_at,
        sanitized.execution_completed_at,
        sanitized.execution_output,
      ]
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
 * Get an AFU9 issue by ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Issue UUID
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
 * Get an AFU9 issue by publicId/shortId.
 *
 * The Control Center UI uses an 8-hex public id derived from the UUID prefix
 * (e.g. uuid "c300abd8-..." => publicId "c300abd8").
 *
 * @param pool - PostgreSQL connection pool
 * @param publicId - 8-hex issue public id
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
 * @param pool - PostgreSQL connection pool
 * @returns Operation result with active issue or null if none
 */
export async function getActiveIssue(pool: Pool): Promise<OperationResult<Afu9IssueRow | null>> {
  try {
    const result = await pool.query<Afu9IssueRow>(
      'SELECT * FROM afu9_issues WHERE status = $1',
      [Afu9IssueStatus.IMPLEMENTING]
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
    let query = 'SELECT * FROM afu9_issues WHERE 1=1';
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
  // Check Single-Active constraint if updating to IMPLEMENTING status
  if (updates.status === Afu9IssueStatus.IMPLEMENTING) {
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
        error: `Issue not found: ${id}`,
      };
    }

    return {
      success: true,
      data: result.rows[0],
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
 * Delete an AFU9 issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param id - Issue UUID
 * @returns Operation result with success or error
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
    const params: (string | Afu9IssueStatus)[] = [Afu9IssueStatus.IMPLEMENTING];

    if (excludeId) {
      query += ' AND id != $2';
      params.push(excludeId);
    }

    const result = await pool.query(query, params);

    if (result.rows.length > 0) {
      const activeIssue = result.rows[0];
      return {
        success: false,
        error: `Single-Active constraint: Issue ${activeIssue.id} ("${activeIssue.title}") is already IMPLEMENTING. Only one issue can have status=IMPLEMENTING at a time.`,
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
      [Afu9IssueStatus.SPEC_READY]: 0,
      [Afu9IssueStatus.IMPLEMENTING]: 0,
      [Afu9IssueStatus.ACTIVE]: 0,
      [Afu9IssueStatus.BLOCKED]: 0,
      [Afu9IssueStatus.DONE]: 0,
      [Afu9IssueStatus.FAILED]: 0,
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
 */
export interface Afu9IssueEventRow {
  id: string;
  issue_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  old_status: string | null;
  new_status: string | null;
  old_handoff_state: string | null;
  new_handoff_state: string | null;
  created_at: string;
  created_by: string | null;
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
        id, issue_id, event_type, event_data, 
        old_status, new_status, 
        old_handoff_state, new_handoff_state,
        created_at, created_by
       FROM afu9_issue_events 
       WHERE issue_id = $1 
       ORDER BY created_at DESC 
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
