/**
 * Unified Timeline Events DAO (E87.3)
 * 
 * Database operations for unified_timeline_events table:
 * - Append-only event recording
 * - Filterable queries (sessionId, canonicalId, ghIssueNumber, etc.)
 * - Deterministic sorting
 * 
 * MUST be kept in sync with database/migrations/069_unified_timeline_events.sql
 */

import { Pool } from 'pg';
import {
  UnifiedTimelineEvent,
  UnifiedTimelineEventInput,
  TimelineQueryFilter,
  sanitizeDetails,
} from '../timeline/unifiedTimelineEvents';

// ========================================
// Insert Operations (Append-only)
// ========================================

/**
 * Record a unified timeline event (append-only)
 * 
 * @param pool - PostgreSQL connection pool
 * @param event - Event input data
 * @returns Created event record
 */
export async function recordTimelineEvent(
  pool: Pool,
  event: UnifiedTimelineEventInput
): Promise<UnifiedTimelineEvent> {
  // Sanitize details to remove secrets and enforce size limits
  const sanitizedDetails = sanitizeDetails(event.details || {});
  
  // Convert timestamp to Date if string
  const timestamp = typeof event.timestamp === 'string' 
    ? new Date(event.timestamp) 
    : event.timestamp;
  
  const query = `
    INSERT INTO unified_timeline_events (
      event_type,
      timestamp,
      actor,
      session_id,
      canonical_id,
      gh_issue_number,
      pr_number,
      workflow_run_id,
      subject_type,
      subject_identifier,
      request_id,
      lawbook_hash,
      evidence_hash,
      context_pack_id,
      links,
      summary,
      details
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    RETURNING *
  `;
  
  const values = [
    event.event_type,
    timestamp,
    event.actor,
    event.session_id || null,
    event.canonical_id || null,
    event.gh_issue_number || null,
    event.pr_number || null,
    event.workflow_run_id || null,
    event.subject_type,
    event.subject_identifier,
    event.request_id,
    event.lawbook_hash || null,
    event.evidence_hash || null,
    event.context_pack_id || null,
    JSON.stringify(event.links || {}),
    event.summary,
    JSON.stringify(sanitizedDetails),
  ];
  
  const result = await pool.query(query, values);
  const row = result.rows[0];
  
  return {
    id: row.id,
    event_type: row.event_type,
    timestamp: row.timestamp.toISOString(),
    actor: row.actor,
    session_id: row.session_id,
    canonical_id: row.canonical_id,
    gh_issue_number: row.gh_issue_number,
    pr_number: row.pr_number,
    workflow_run_id: row.workflow_run_id,
    subject_type: row.subject_type,
    subject_identifier: row.subject_identifier,
    request_id: row.request_id,
    lawbook_hash: row.lawbook_hash,
    evidence_hash: row.evidence_hash,
    context_pack_id: row.context_pack_id,
    links: row.links,
    summary: row.summary,
    details: row.details,
    created_at: row.created_at.toISOString(),
  };
}

// ========================================
// Query Operations
// ========================================

/**
 * Query timeline events with flexible filters
 * 
 * @param pool - PostgreSQL connection pool
 * @param filter - Query filters (sessionId, canonicalId, etc.)
 * @returns Array of timeline events (sorted by timestamp DESC)
 */
export async function queryTimelineEvents(
  pool: Pool,
  filter: TimelineQueryFilter
): Promise<UnifiedTimelineEvent[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  // Build WHERE clause based on filters
  if (filter.session_id) {
    conditions.push(`session_id = $${paramIndex++}`);
    values.push(filter.session_id);
  }
  
  if (filter.canonical_id) {
    conditions.push(`canonical_id = $${paramIndex++}`);
    values.push(filter.canonical_id);
  }
  
  if (filter.gh_issue_number) {
    conditions.push(`gh_issue_number = $${paramIndex++}`);
    values.push(filter.gh_issue_number);
  }
  
  if (filter.pr_number) {
    conditions.push(`pr_number = $${paramIndex++}`);
    values.push(filter.pr_number);
  }
  
  if (filter.event_type) {
    conditions.push(`event_type = $${paramIndex++}`);
    values.push(filter.event_type);
  }
  
  if (filter.actor) {
    conditions.push(`actor = $${paramIndex++}`);
    values.push(filter.actor);
  }
  
  if (filter.subject_type) {
    conditions.push(`subject_type = $${paramIndex++}`);
    values.push(filter.subject_type);
  }
  
  if (filter.start_time) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    values.push(new Date(filter.start_time));
  }
  
  if (filter.end_time) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    values.push(new Date(filter.end_time));
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Add pagination
  const limit = filter.limit || 100;
  const offset = filter.offset || 0;
  
  const query = `
    SELECT *
    FROM unified_timeline_events
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${paramIndex++}
    OFFSET $${paramIndex++}
  `;
  
  values.push(limit, offset);
  
  const result = await pool.query(query, values);
  
  return result.rows.map(row => ({
    id: row.id,
    event_type: row.event_type,
    timestamp: row.timestamp.toISOString(),
    actor: row.actor,
    session_id: row.session_id,
    canonical_id: row.canonical_id,
    gh_issue_number: row.gh_issue_number,
    pr_number: row.pr_number,
    workflow_run_id: row.workflow_run_id,
    subject_type: row.subject_type,
    subject_identifier: row.subject_identifier,
    request_id: row.request_id,
    lawbook_hash: row.lawbook_hash,
    evidence_hash: row.evidence_hash,
    context_pack_id: row.context_pack_id,
    links: row.links,
    summary: row.summary,
    details: row.details,
    created_at: row.created_at.toISOString(),
  }));
}

/**
 * Get recent timeline events (last N events)
 * 
 * @param pool - PostgreSQL connection pool
 * @param limit - Number of events to return (default: 100)
 * @returns Array of recent timeline events
 */
export async function getRecentTimelineEvents(
  pool: Pool,
  limit: number = 100
): Promise<UnifiedTimelineEvent[]> {
  return queryTimelineEvents(pool, { limit, offset: 0 });
}

/**
 * Get timeline events for a specific session
 * 
 * @param pool - PostgreSQL connection pool
 * @param sessionId - AFU-9 session ID
 * @param limit - Number of events to return (default: 100)
 * @returns Array of timeline events for the session
 */
export async function getTimelineEventsBySession(
  pool: Pool,
  sessionId: string,
  limit: number = 100
): Promise<UnifiedTimelineEvent[]> {
  return queryTimelineEvents(pool, { session_id: sessionId, limit, offset: 0 });
}

/**
 * Get timeline events for a specific canonical ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param canonicalId - AFU-9 canonical ID (e.g., CR-2026-01-02-001)
 * @param limit - Number of events to return (default: 100)
 * @returns Array of timeline events for the canonical ID
 */
export async function getTimelineEventsByCanonicalId(
  pool: Pool,
  canonicalId: string,
  limit: number = 100
): Promise<UnifiedTimelineEvent[]> {
  return queryTimelineEvents(pool, { canonical_id: canonicalId, limit, offset: 0 });
}

/**
 * Get timeline events for a specific GitHub issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueNumber - GitHub issue number
 * @param limit - Number of events to return (default: 100)
 * @returns Array of timeline events for the issue
 */
export async function getTimelineEventsByGitHubIssue(
  pool: Pool,
  issueNumber: number,
  limit: number = 100
): Promise<UnifiedTimelineEvent[]> {
  return queryTimelineEvents(pool, { gh_issue_number: issueNumber, limit, offset: 0 });
}

/**
 * Get timeline events for a specific PR
 * 
 * @param pool - PostgreSQL connection pool
 * @param prNumber - GitHub PR number
 * @param limit - Number of events to return (default: 100)
 * @returns Array of timeline events for the PR
 */
export async function getTimelineEventsByPR(
  pool: Pool,
  prNumber: number,
  limit: number = 100
): Promise<UnifiedTimelineEvent[]> {
  return queryTimelineEvents(pool, { pr_number: prNumber, limit, offset: 0 });
}

/**
 * Count timeline events matching filters
 * 
 * @param pool - PostgreSQL connection pool
 * @param filter - Query filters
 * @returns Count of matching events
 */
export async function countTimelineEvents(
  pool: Pool,
  filter: Omit<TimelineQueryFilter, 'limit' | 'offset'>
): Promise<number> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;
  
  // Build WHERE clause (same logic as queryTimelineEvents)
  if (filter.session_id) {
    conditions.push(`session_id = $${paramIndex++}`);
    values.push(filter.session_id);
  }
  
  if (filter.canonical_id) {
    conditions.push(`canonical_id = $${paramIndex++}`);
    values.push(filter.canonical_id);
  }
  
  if (filter.gh_issue_number) {
    conditions.push(`gh_issue_number = $${paramIndex++}`);
    values.push(filter.gh_issue_number);
  }
  
  if (filter.pr_number) {
    conditions.push(`pr_number = $${paramIndex++}`);
    values.push(filter.pr_number);
  }
  
  if (filter.event_type) {
    conditions.push(`event_type = $${paramIndex++}`);
    values.push(filter.event_type);
  }
  
  if (filter.actor) {
    conditions.push(`actor = $${paramIndex++}`);
    values.push(filter.actor);
  }
  
  if (filter.subject_type) {
    conditions.push(`subject_type = $${paramIndex++}`);
    values.push(filter.subject_type);
  }
  
  if (filter.start_time) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    values.push(new Date(filter.start_time));
  }
  
  if (filter.end_time) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    values.push(new Date(filter.end_time));
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT COUNT(*) as count
    FROM unified_timeline_events
    ${whereClause}
  `;
  
  const result = await pool.query(query, values);
  return parseInt(result.rows[0].count, 10);
}
