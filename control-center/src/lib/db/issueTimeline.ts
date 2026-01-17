/**
 * Database Access Layer: Issue Timeline
 * 
 * Provides functions for managing issue timeline events.
 * Tracks lifecycle events for AFU-9 Issues (Issue → CR → Publish → GH Mirror → CP Assign).
 */

import { Pool } from 'pg';
import {
  IssueTimelineEventRow,
  IssueTimelineEventInput,
  IssueTimelineEventType,
  ActorType,
  validateTimelineEventInput,
} from '../contracts/issueTimeline';

/**
 * Operation result type
 */
export interface OperationResult<T = IssueTimelineEventRow> {
  success: boolean;
  data?: T;
  error?: string;
  rowCount?: number;
}

/**
 * Log a timeline event for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Timeline event data
 * @returns Operation result with created event or error
 */
export async function logTimelineEvent(
  pool: Pool,
  input: IssueTimelineEventInput
): Promise<OperationResult> {
  // Validate input
  const validation = validateTimelineEventInput(input);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid input',
    };
  }

  try {
    const result = await pool.query<IssueTimelineEventRow>(
      `INSERT INTO issue_timeline (
        issue_id,
        event_type,
        event_data,
        actor,
        actor_type
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        input.issue_id,
        input.event_type,
        input.event_data ? JSON.stringify(input.event_data) : '{}',
        input.actor || 'system',
        input.actor_type || ActorType.SYSTEM,
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
        created_at: row.created_at.toString(),
      },
    };
  } catch (error) {
    console.error('[IssueTimeline] Log event failed:', {
      error: error instanceof Error ? error.message : String(error),
      issue_id: input.issue_id,
      event_type: input.event_type,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get timeline events for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param limit - Maximum number of events to retrieve (default: 100)
 * @returns Operation result with events or error
 */
export async function getIssueTimelineEvents(
  pool: Pool,
  issueId: string,
  limit: number = 100
): Promise<OperationResult<IssueTimelineEventRow[]>> {
  try {
    const result = await pool.query<IssueTimelineEventRow>(
      `SELECT
        id,
        issue_id,
        event_type,
        event_data,
        actor,
        actor_type,
        created_at
       FROM issue_timeline
       WHERE issue_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [issueId, limit]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[IssueTimeline] Get events failed:', {
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
 * Get timeline events by event type
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param eventType - Event type to filter by
 * @param limit - Maximum number of events to retrieve (default: 50)
 * @returns Operation result with events or error
 */
export async function getIssueTimelineEventsByType(
  pool: Pool,
  issueId: string,
  eventType: IssueTimelineEventType,
  limit: number = 50
): Promise<OperationResult<IssueTimelineEventRow[]>> {
  try {
    const result = await pool.query<IssueTimelineEventRow>(
      `SELECT
        id,
        issue_id,
        event_type,
        event_data,
        actor,
        actor_type,
        created_at
       FROM issue_timeline
       WHERE issue_id = $1 AND event_type = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [issueId, eventType, limit]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[IssueTimeline] Get events by type failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      eventType,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get the most recent event of a specific type for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param eventType - Event type to retrieve
 * @returns Operation result with event or null if none found
 */
export async function getLatestTimelineEvent(
  pool: Pool,
  issueId: string,
  eventType: IssueTimelineEventType
): Promise<OperationResult<IssueTimelineEventRow | null>> {
  try {
    const result = await pool.query<IssueTimelineEventRow>(
      `SELECT
        id,
        issue_id,
        event_type,
        event_data,
        actor,
        actor_type,
        created_at
       FROM issue_timeline
       WHERE issue_id = $1 AND event_type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [issueId, eventType]
    );

    return {
      success: true,
      data: result.rows.length > 0 
        ? { ...result.rows[0], created_at: result.rows[0].created_at.toString() }
        : null,
    };
  } catch (error) {
    console.error('[IssueTimeline] Get latest event failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      eventType,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Count timeline events by type for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @returns Operation result with event type counts or error
 */
export async function countTimelineEventsByType(
  pool: Pool,
  issueId: string
): Promise<OperationResult<Record<string, number>>> {
  try {
    const result = await pool.query<{ event_type: string; count: string }>(
      `SELECT event_type, COUNT(*) as count
       FROM issue_timeline
       WHERE issue_id = $1
       GROUP BY event_type
       ORDER BY event_type`,
      [issueId]
    );

    const counts: Record<string, number> = {};
    result.rows.forEach((row) => {
      counts[row.event_type] = parseInt(row.count, 10);
    });

    return {
      success: true,
      data: counts,
    };
  } catch (error) {
    console.error('[IssueTimeline] Count events by type failed:', {
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
