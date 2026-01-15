/**
 * Manual Touchpoints Database Operations (E88.1)
 * 
 * Provides database operations for manual touchpoint tracking:
 * - Insert touchpoint records (append-only with idempotency)
 * - Query touchpoints by cycle, issue, type
 * - Aggregate statistics for analysis
 * 
 * SECURITY:
 * - Append-only (no updates or deletes)
 * - Idempotent via unique idempotency_key
 * - Bounded metadata (max 4KB)
 */

import { Pool } from 'pg';

// ========================================
// Type Definitions
// ========================================

export type TouchpointType = 'ASSIGN' | 'REVIEW' | 'MERGE_APPROVAL' | 'DEBUG_INTERVENTION';
export type TouchpointSource = 'UI' | 'INTENT' | 'GH' | 'API';

export interface ManualTouchpointRecord {
  id: number;
  idempotency_key: string;
  cycle_id: string | null;
  issue_id: string | null;
  gh_issue_number: number | null;
  pr_number: number | null;
  session_id: string | null;
  type: TouchpointType;
  source: TouchpointSource;
  actor: string;
  request_id: string;
  metadata: Record<string, any>;
  created_at: Date;
}

export interface InsertTouchpointParams {
  idempotencyKey: string;
  cycleId?: string | null;
  issueId?: string | null;
  ghIssueNumber?: number | null;
  prNumber?: number | null;
  sessionId?: string | null;
  type: TouchpointType;
  source: TouchpointSource;
  actor: string;
  requestId: string;
  metadata?: Record<string, any>;
}

export interface TouchpointStats {
  total: number;
  byType: Record<TouchpointType, number>;
  bySource: Record<TouchpointSource, number>;
  uniqueActors: number;
}

// ========================================
// Insert Operations (Append-only)
// ========================================

/**
 * Insert touchpoint record into database
 * 
 * APPEND-ONLY: Creates new record, never updates existing
 * IDEMPOTENT: Uses unique idempotency_key to prevent duplicates
 * 
 * @param pool - PostgreSQL connection pool
 * @param params - Touchpoint parameters
 * @returns Inserted touchpoint record or existing if duplicate
 */
export async function insertTouchpoint(
  pool: Pool,
  params: InsertTouchpointParams
): Promise<ManualTouchpointRecord> {
  const {
    idempotencyKey,
    cycleId,
    issueId,
    ghIssueNumber,
    prNumber,
    sessionId,
    type,
    source,
    actor,
    requestId,
    metadata = {},
  } = params;

  // Try to insert with idempotency constraint
  // If duplicate, return existing record (idempotent)
  const query = `
    INSERT INTO manual_touchpoints (
      idempotency_key,
      cycle_id,
      issue_id,
      gh_issue_number,
      pr_number,
      session_id,
      type,
      source,
      actor,
      request_id,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
  `;

  const values = [
    idempotencyKey,
    cycleId || null,
    issueId || null,
    ghIssueNumber || null,
    prNumber || null,
    sessionId || null,
    type,
    source,
    actor,
    requestId,
    JSON.stringify(metadata),
  ];

  const result = await pool.query(query, values);

  // If conflict occurred (no rows returned), fetch existing record
  if (result.rows.length === 0) {
    const existingQuery = `
      SELECT * FROM manual_touchpoints
      WHERE idempotency_key = $1
      LIMIT 1
    `;
    const existingResult = await pool.query(existingQuery, [idempotencyKey]);
    return existingResult.rows[0];
  }

  return result.rows[0];
}

// ========================================
// Query Operations
// ========================================

/**
 * Get touchpoints by cycle ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param cycleId - Release cycle identifier
 * @param limit - Max records to return
 * @returns List of touchpoint records
 */
export async function getTouchpointsByCycle(
  pool: Pool,
  cycleId: string,
  limit: number = 100
): Promise<ManualTouchpointRecord[]> {
  const query = `
    SELECT * FROM manual_touchpoints
    WHERE cycle_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await pool.query(query, [cycleId, limit]);
  return result.rows;
}

/**
 * Get touchpoints by issue ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - AFU-9 issue UUID
 * @param limit - Max records to return
 * @returns List of touchpoint records
 */
export async function getTouchpointsByIssue(
  pool: Pool,
  issueId: string,
  limit: number = 100
): Promise<ManualTouchpointRecord[]> {
  const query = `
    SELECT * FROM manual_touchpoints
    WHERE issue_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await pool.query(query, [issueId, limit]);
  return result.rows;
}

/**
 * Get touchpoints by GitHub issue number
 * 
 * @param pool - PostgreSQL connection pool
 * @param ghIssueNumber - GitHub issue number
 * @param limit - Max records to return
 * @returns List of touchpoint records
 */
export async function getTouchpointsByGhIssue(
  pool: Pool,
  ghIssueNumber: number,
  limit: number = 100
): Promise<ManualTouchpointRecord[]> {
  const query = `
    SELECT * FROM manual_touchpoints
    WHERE gh_issue_number = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await pool.query(query, [ghIssueNumber, limit]);
  return result.rows;
}

/**
 * Get touchpoints by PR number
 * 
 * @param pool - PostgreSQL connection pool
 * @param prNumber - GitHub PR number
 * @param limit - Max records to return
 * @returns List of touchpoint records
 */
export async function getTouchpointsByPr(
  pool: Pool,
  prNumber: number,
  limit: number = 100
): Promise<ManualTouchpointRecord[]> {
  const query = `
    SELECT * FROM manual_touchpoints
    WHERE pr_number = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;

  const result = await pool.query(query, [prNumber, limit]);
  return result.rows;
}

/**
 * Get recent touchpoints (all types)
 * 
 * @param pool - PostgreSQL connection pool
 * @param limit - Max records to return
 * @returns List of touchpoint records
 */
export async function getRecentTouchpoints(
  pool: Pool,
  limit: number = 100
): Promise<ManualTouchpointRecord[]> {
  const query = `
    SELECT * FROM manual_touchpoints
    ORDER BY created_at DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

// ========================================
// Aggregation Operations
// ========================================

/**
 * Get touchpoint statistics for a cycle
 * 
 * @param pool - PostgreSQL connection pool
 * @param cycleId - Release cycle identifier
 * @returns Aggregated statistics
 */
export async function getTouchpointStatsByCycle(
  pool: Pool,
  cycleId: string
): Promise<TouchpointStats> {
  const query = `
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE type = 'ASSIGN') as assign_count,
      COUNT(*) FILTER (WHERE type = 'REVIEW') as review_count,
      COUNT(*) FILTER (WHERE type = 'MERGE_APPROVAL') as merge_approval_count,
      COUNT(*) FILTER (WHERE type = 'DEBUG_INTERVENTION') as debug_intervention_count,
      COUNT(*) FILTER (WHERE source = 'UI') as ui_count,
      COUNT(*) FILTER (WHERE source = 'INTENT') as intent_count,
      COUNT(*) FILTER (WHERE source = 'GH') as gh_count,
      COUNT(*) FILTER (WHERE source = 'API') as api_count,
      COUNT(DISTINCT actor) as unique_actors
    FROM manual_touchpoints
    WHERE cycle_id = $1
  `;

  const result = await pool.query(query, [cycleId]);
  const row = result.rows[0];

  return {
    total: parseInt(row.total, 10),
    byType: {
      ASSIGN: parseInt(row.assign_count, 10),
      REVIEW: parseInt(row.review_count, 10),
      MERGE_APPROVAL: parseInt(row.merge_approval_count, 10),
      DEBUG_INTERVENTION: parseInt(row.debug_intervention_count, 10),
    },
    bySource: {
      UI: parseInt(row.ui_count, 10),
      INTENT: parseInt(row.intent_count, 10),
      GH: parseInt(row.gh_count, 10),
      API: parseInt(row.api_count, 10),
    },
    uniqueActors: parseInt(row.unique_actors, 10),
  };
}

/**
 * Get touchpoint statistics for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - AFU-9 issue UUID
 * @returns Aggregated statistics
 */
export async function getTouchpointStatsByIssue(
  pool: Pool,
  issueId: string
): Promise<TouchpointStats> {
  const query = `
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE type = 'ASSIGN') as assign_count,
      COUNT(*) FILTER (WHERE type = 'REVIEW') as review_count,
      COUNT(*) FILTER (WHERE type = 'MERGE_APPROVAL') as merge_approval_count,
      COUNT(*) FILTER (WHERE type = 'DEBUG_INTERVENTION') as debug_intervention_count,
      COUNT(*) FILTER (WHERE source = 'UI') as ui_count,
      COUNT(*) FILTER (WHERE source = 'INTENT') as intent_count,
      COUNT(*) FILTER (WHERE source = 'GH') as gh_count,
      COUNT(*) FILTER (WHERE source = 'API') as api_count,
      COUNT(DISTINCT actor) as unique_actors
    FROM manual_touchpoints
    WHERE issue_id = $1
  `;

  const result = await pool.query(query, [issueId]);
  const row = result.rows[0];

  return {
    total: parseInt(row.total, 10),
    byType: {
      ASSIGN: parseInt(row.assign_count, 10),
      REVIEW: parseInt(row.review_count, 10),
      MERGE_APPROVAL: parseInt(row.merge_approval_count, 10),
      DEBUG_INTERVENTION: parseInt(row.debug_intervention_count, 10),
    },
    bySource: {
      UI: parseInt(row.ui_count, 10),
      INTENT: parseInt(row.intent_count, 10),
      GH: parseInt(row.gh_count, 10),
      API: parseInt(row.api_count, 10),
    },
    uniqueActors: parseInt(row.unique_actors, 10),
  };
}

/**
 * Get global touchpoint statistics
 * 
 * @param pool - PostgreSQL connection pool
 * @param hours - Time period in hours (optional)
 * @returns Aggregated statistics
 */
export async function getGlobalTouchpointStats(
  pool: Pool,
  hours?: number
): Promise<TouchpointStats> {
  const timeFilter = hours 
    ? `WHERE created_at >= NOW() - INTERVAL '${hours} hours'`
    : '';

  const query = `
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE type = 'ASSIGN') as assign_count,
      COUNT(*) FILTER (WHERE type = 'REVIEW') as review_count,
      COUNT(*) FILTER (WHERE type = 'MERGE_APPROVAL') as merge_approval_count,
      COUNT(*) FILTER (WHERE type = 'DEBUG_INTERVENTION') as debug_intervention_count,
      COUNT(*) FILTER (WHERE source = 'UI') as ui_count,
      COUNT(*) FILTER (WHERE source = 'INTENT') as intent_count,
      COUNT(*) FILTER (WHERE source = 'GH') as gh_count,
      COUNT(*) FILTER (WHERE source = 'API') as api_count,
      COUNT(DISTINCT actor) as unique_actors
    FROM manual_touchpoints
    ${timeFilter}
  `;

  const result = await pool.query(query);
  const row = result.rows[0];

  return {
    total: parseInt(row.total, 10),
    byType: {
      ASSIGN: parseInt(row.assign_count, 10),
      REVIEW: parseInt(row.review_count, 10),
      MERGE_APPROVAL: parseInt(row.merge_approval_count, 10),
      DEBUG_INTERVENTION: parseInt(row.debug_intervention_count, 10),
    },
    bySource: {
      UI: parseInt(row.ui_count, 10),
      INTENT: parseInt(row.intent_count, 10),
      GH: parseInt(row.gh_count, 10),
      API: parseInt(row.api_count, 10),
    },
    uniqueActors: parseInt(row.unique_actors, 10),
  };
}
