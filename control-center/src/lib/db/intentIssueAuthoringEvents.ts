/**
 * Database Access Layer: INTENT Issue Authoring Events
 * 
 * Provides append-only storage for INTENT issue authoring evidence.
 * Issue E81.5: Evidence Pack for Issue Authoring
 * 
 * GUARANTEES:
 * - Append-only: No UPDATE or DELETE (enforced by DB triggers)
 * - Deterministic hashes stored
 * - Secrets redacted before storage
 * - lawbookVersion tracked for determinism
 */

import { Pool } from 'pg';
import type { EvidenceRecord, EvidenceAction } from '../intent-issue-evidence';

/**
 * Helper to safely convert timestamp to ISO string
 * Handles both Date objects and string timestamps from PostgreSQL
 */
function toISOString(timestamp: Date | string): string {
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  return new Date(timestamp).toISOString();
}

/**
 * Database row structure
 */
export interface IntentIssueAuthoringEvent {
  id: string;
  request_id: string;
  session_id: string;
  sub: string;
  action: EvidenceAction;
  params_hash: string;
  result_hash: string;
  lawbook_version: string | null;
  created_at: string;
  params_json: Record<string, any> | null;
  result_json: Record<string, any> | null;
}

/**
 * Insert evidence event (append-only)
 * 
 * @param pool Database pool
 * @param record Evidence record to insert
 * @returns Success with event ID, or error
 */
export async function insertEvent(
  pool: Pool,
  record: EvidenceRecord
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `INSERT INTO intent_issue_authoring_events (
        request_id,
        session_id,
        sub,
        action,
        params_hash,
        result_hash,
        lawbook_version,
        created_at,
        params_json,
        result_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        record.requestId,
        record.sessionId,
        record.sub,
        record.action,
        record.paramsHash,
        record.resultHash,
        record.lawbookVersion || null,
        record.createdAt,
        record.paramsJson || null,
        record.resultJson || null,
      ]
    );
    
    return {
      success: true,
      id: result.rows[0].id,
    };
  } catch (error) {
    console.error('[DB] Error inserting intent authoring event:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query events by session ID
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param options Pagination options
 * @returns List of events ordered by created_at DESC
 */
export async function queryEventsBySession(
  pool: Pool,
  sessionId: string,
  options?: {
    limit?: number;
    offset?: number;
    action?: EvidenceAction;
  }
): Promise<{ success: true; data: IntentIssueAuthoringEvent[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    let query = `
      SELECT 
        id,
        request_id,
        session_id,
        sub,
        action,
        params_hash,
        result_hash,
        lawbook_version,
        created_at,
        params_json,
        result_json
      FROM intent_issue_authoring_events
      WHERE session_id = $1
    `;
    
    const params: any[] = [sessionId];
    
    if (options?.action) {
      query += ` AND action = $${params.length + 1}`;
      params.push(options.action);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        request_id: row.request_id,
        session_id: row.session_id,
        sub: row.sub,
        action: row.action,
        params_hash: row.params_hash,
        result_hash: row.result_hash,
        lawbook_version: row.lawbook_version,
        created_at: toISOString(row.created_at),
        params_json: row.params_json || null,
        result_json: row.result_json || null,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying events by session:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query events by request ID
 * 
 * @param pool Database pool
 * @param requestId Request ID
 * @param options Pagination options
 * @returns List of events ordered by created_at DESC
 */
export async function queryEventsByRequest(
  pool: Pool,
  requestId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: IntentIssueAuthoringEvent[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    const result = await pool.query(
      `SELECT 
        id,
        request_id,
        session_id,
        sub,
        action,
        params_hash,
        result_hash,
        lawbook_version,
        created_at,
        params_json,
        result_json
      FROM intent_issue_authoring_events
      WHERE request_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
      [requestId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        request_id: row.request_id,
        session_id: row.session_id,
        sub: row.sub,
        action: row.action,
        params_hash: row.params_hash,
        result_hash: row.result_hash,
        lawbook_version: row.lawbook_version,
        created_at: toISOString(row.created_at),
        params_json: row.params_json || null,
        result_json: row.result_json || null,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying events by request:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query events by user (sub)
 * 
 * @param pool Database pool
 * @param sub User subject identifier
 * @param options Pagination options
 * @returns List of events ordered by created_at DESC
 */
export async function queryEventsByUser(
  pool: Pool,
  sub: string,
  options?: {
    limit?: number;
    offset?: number;
    action?: EvidenceAction;
  }
): Promise<{ success: true; data: IntentIssueAuthoringEvent[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    let query = `
      SELECT 
        id,
        request_id,
        session_id,
        sub,
        action,
        params_hash,
        result_hash,
        lawbook_version,
        created_at,
        params_json,
        result_json
      FROM intent_issue_authoring_events
      WHERE sub = $1
    `;
    
    const params: any[] = [sub];
    
    if (options?.action) {
      query += ` AND action = $${params.length + 1}`;
      params.push(options.action);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        request_id: row.request_id,
        session_id: row.session_id,
        sub: row.sub,
        action: row.action,
        params_hash: row.params_hash,
        result_hash: row.result_hash,
        lawbook_version: row.lawbook_version,
        created_at: toISOString(row.created_at),
        params_json: row.params_json || null,
        result_json: row.result_json || null,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying events by user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Count events by session
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param action Optional action filter
 * @returns Event count
 */
export async function countEventsBySession(
  pool: Pool,
  sessionId: string,
  action?: EvidenceAction
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    let query = 'SELECT COUNT(*) FROM intent_issue_authoring_events WHERE session_id = $1';
    const params: any[] = [sessionId];
    
    if (action) {
      query += ' AND action = $2';
      params.push(action);
    }
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      count: parseInt(result.rows[0].count, 10),
    };
  } catch (error) {
    console.error('[DB] Error counting events:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
