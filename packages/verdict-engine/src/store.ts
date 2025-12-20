/**
 * AFU-9 Verdict Engine Database Layer
 * 
 * Handles persistence of verdicts and policy snapshots
 * Implements Issue 2.1: Policy Snapshotting per Run
 */

import { Pool, QueryResult } from 'pg';
import { 
  Verdict, 
  PolicySnapshot, 
  CreateVerdictInput,
  VerdictWithPolicy,
  VerdictStatistics,
  VerdictQueryParams,
  VerdictAuditEntry
} from './types';
import { MAX_QUERY_LIMIT } from './constants';

/**
 * Store a policy snapshot in the database
 * 
 * Issue 2.1: Immutable policy snapshots
 * 
 * @param pool Database connection pool
 * @param snapshot Policy snapshot to store
 * @returns Stored policy snapshot with ID
 */
export async function storePolicySnapshot(
  pool: Pool,
  snapshot: Omit<PolicySnapshot, 'id' | 'created_at'>
): Promise<PolicySnapshot> {
  const query = `
    INSERT INTO policy_snapshots (version, policies, metadata)
    VALUES ($1, $2, $3)
    RETURNING id, version, policies, created_at, metadata
  `;

  const result = await pool.query(query, [
    snapshot.version,
    JSON.stringify(snapshot.policies),
    snapshot.metadata ? JSON.stringify(snapshot.metadata) : null,
  ]);

  const row = result.rows[0];
  return {
    id: row.id,
    version: row.version,
    policies: row.policies,
    created_at: row.created_at.toISOString(),
    metadata: row.metadata,
  };
}

/**
 * Get the latest policy snapshot
 * 
 * @param pool Database connection pool
 * @returns Latest policy snapshot
 */
export async function getLatestPolicySnapshot(
  pool: Pool
): Promise<PolicySnapshot | null> {
  const query = `
    SELECT id, version, policies, created_at, metadata
    FROM policy_snapshots
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const result = await pool.query(query);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    version: row.version,
    policies: row.policies,
    created_at: row.created_at.toISOString(),
    metadata: row.metadata,
  };
}

/**
 * Get a policy snapshot by ID
 * 
 * @param pool Database connection pool
 * @param snapshotId Policy snapshot ID
 * @returns Policy snapshot or null
 */
export async function getPolicySnapshot(
  pool: Pool,
  snapshotId: string
): Promise<PolicySnapshot | null> {
  const query = `
    SELECT id, version, policies, created_at, metadata
    FROM policy_snapshots
    WHERE id = $1
  `;

  const result = await pool.query(query, [snapshotId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    version: row.version,
    policies: row.policies,
    created_at: row.created_at.toISOString(),
    metadata: row.metadata,
  };
}

/**
 * Store a verdict in the database
 * 
 * @param pool Database connection pool
 * @param verdict Verdict to store
 * @returns Stored verdict with ID
 */
export async function storeVerdict(
  pool: Pool,
  verdict: Omit<Verdict, 'id' | 'created_at'>
): Promise<Verdict> {
  const query = `
    INSERT INTO verdicts (
      execution_id,
      policy_snapshot_id,
      fingerprint_id,
      error_class,
      service,
      confidence_score,
      proposed_action,
      verdict_type,
      tokens,
      signals,
      playbook_id,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING 
      id,
      execution_id,
      policy_snapshot_id,
      fingerprint_id,
      error_class,
      service,
      confidence_score,
      proposed_action,
      verdict_type,
      tokens,
      signals,
      playbook_id,
      created_at,
      metadata
  `;

  const result = await pool.query(query, [
    verdict.execution_id,
    verdict.policy_snapshot_id,
    verdict.fingerprint_id,
    verdict.error_class,
    verdict.service,
    verdict.confidence_score,
    verdict.proposed_action,
    verdict.verdict_type,
    verdict.tokens,
    JSON.stringify(verdict.signals),
    verdict.playbook_id,
    verdict.metadata ? JSON.stringify(verdict.metadata) : null,
  ]);

  const row = result.rows[0];
  return {
    id: row.id,
    execution_id: row.execution_id,
    policy_snapshot_id: row.policy_snapshot_id,
    fingerprint_id: row.fingerprint_id,
    error_class: row.error_class,
    service: row.service,
    confidence_score: row.confidence_score,
    proposed_action: row.proposed_action,
    verdict_type: row.verdict_type,
    tokens: row.tokens,
    signals: row.signals,
    playbook_id: row.playbook_id,
    created_at: row.created_at.toISOString(),
    metadata: row.metadata,
  };
}

/**
 * Get verdicts for a workflow execution
 * 
 * @param pool Database connection pool
 * @param executionId Workflow execution ID
 * @returns Array of verdicts
 */
export async function getVerdictsByExecution(
  pool: Pool,
  executionId: string
): Promise<Verdict[]> {
  const query = `
    SELECT 
      id,
      execution_id,
      policy_snapshot_id,
      fingerprint_id,
      error_class,
      service,
      confidence_score,
      proposed_action,
      verdict_type,
      tokens,
      signals,
      playbook_id,
      created_at,
      metadata
    FROM verdicts
    WHERE execution_id = $1
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query, [executionId]);
  return result.rows.map(mapRowToVerdict);
}

/**
 * Query verdicts with filters
 * 
 * @param pool Database connection pool
 * @param params Query parameters
 * @returns Array of verdicts matching filters
 */
export async function queryVerdicts(
  pool: Pool,
  params: VerdictQueryParams
): Promise<Verdict[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (params.execution_id) {
    conditions.push(`execution_id = $${paramIndex++}`);
    values.push(params.execution_id);
  }

  if (params.error_class) {
    conditions.push(`error_class = $${paramIndex++}`);
    values.push(params.error_class);
  }

  if (params.service) {
    conditions.push(`service = $${paramIndex++}`);
    values.push(params.service);
  }

  if (params.min_confidence !== undefined) {
    conditions.push(`confidence_score >= $${paramIndex++}`);
    values.push(params.min_confidence);
  }

  if (params.max_confidence !== undefined) {
    conditions.push(`confidence_score <= $${paramIndex++}`);
    values.push(params.max_confidence);
  }

  if (params.proposed_action) {
    conditions.push(`proposed_action = $${paramIndex++}`);
    values.push(params.proposed_action);
  }

  if (params.verdict_type) {
    conditions.push(`verdict_type = $${paramIndex++}`);
    values.push(params.verdict_type);
  }

  const whereClause = conditions.length > 0 
    ? `WHERE ${conditions.join(' AND ')}` 
    : '';

  const limit = Math.min(params.limit || 50, MAX_QUERY_LIMIT);
  const offset = params.offset || 0;

  const query = `
    SELECT 
      id,
      execution_id,
      policy_snapshot_id,
      fingerprint_id,
      error_class,
      service,
      confidence_score,
      proposed_action,
      verdict_type,
      tokens,
      signals,
      playbook_id,
      created_at,
      metadata
    FROM verdicts
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;

  values.push(limit, offset);

  const result = await pool.query(query, values);
  return result.rows.map(mapRowToVerdict);
}

/**
 * Get verdict with policy information for auditability
 * 
 * Issue 2.1: Full auditability with policy reference
 * 
 * @param pool Database connection pool
 * @param verdictId Verdict ID
 * @returns Verdict with policy information
 */
export async function getVerdictWithPolicy(
  pool: Pool,
  verdictId: string
): Promise<VerdictWithPolicy | null> {
  const query = `
    SELECT 
      id,
      execution_id,
      policy_snapshot_id,
      fingerprint_id,
      error_class,
      service,
      confidence_score,
      proposed_action,
      verdict_type,
      tokens,
      signals,
      playbook_id,
      created_at,
      metadata,
      policy_version,
      policy_definition,
      workflow_id,
      execution_status,
      execution_started_at
    FROM verdicts_with_policy
    WHERE id = $1
  `;

  const result = await pool.query(query, [verdictId]);
  
  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    execution_id: row.execution_id,
    policy_snapshot_id: row.policy_snapshot_id,
    fingerprint_id: row.fingerprint_id,
    error_class: row.error_class,
    service: row.service,
    confidence_score: row.confidence_score,
    proposed_action: row.proposed_action,
    verdict_type: row.verdict_type,
    tokens: row.tokens,
    signals: row.signals,
    playbook_id: row.playbook_id,
    created_at: row.created_at.toISOString(),
    metadata: row.metadata,
    policy_version: row.policy_version,
    policy_definition: row.policy_definition,
    workflow_id: row.workflow_id,
    execution_status: row.execution_status,
    execution_started_at: row.execution_started_at.toISOString(),
  };
}

/**
 * Get verdict statistics
 * 
 * Supports Issue 2.2 KPI: Verdict Consistency
 * 
 * @param pool Database connection pool
 * @returns Verdict statistics by error class and service
 */
export async function getVerdictStatistics(
  pool: Pool
): Promise<VerdictStatistics[]> {
  const query = `
    SELECT 
      error_class,
      service,
      total_count,
      avg_confidence,
      min_confidence,
      max_confidence,
      most_common_action,
      affected_executions
    FROM verdict_statistics
    ORDER BY total_count DESC
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Log verdict audit event
 * 
 * @param pool Database connection pool
 * @param entry Audit log entry
 * @returns Created audit entry
 */
export async function logVerdictAudit(
  pool: Pool,
  entry: Omit<VerdictAuditEntry, 'id' | 'created_at'>
): Promise<VerdictAuditEntry> {
  const query = `
    INSERT INTO verdict_audit_log (verdict_id, event_type, event_data, created_by)
    VALUES ($1, $2, $3, $4)
    RETURNING id, verdict_id, event_type, event_data, created_at, created_by
  `;

  const result = await pool.query(query, [
    entry.verdict_id,
    entry.event_type,
    entry.event_data ? JSON.stringify(entry.event_data) : null,
    entry.created_by,
  ]);

  const row = result.rows[0];
  return {
    id: row.id,
    verdict_id: row.verdict_id,
    event_type: row.event_type,
    event_data: row.event_data,
    created_at: row.created_at.toISOString(),
    created_by: row.created_by,
  };
}

/**
 * Helper function to map database row to Verdict object
 */
function mapRowToVerdict(row: any): Verdict {
  return {
    id: row.id,
    execution_id: row.execution_id,
    policy_snapshot_id: row.policy_snapshot_id,
    fingerprint_id: row.fingerprint_id,
    error_class: row.error_class,
    service: row.service,
    confidence_score: row.confidence_score,
    proposed_action: row.proposed_action,
    verdict_type: row.verdict_type,
    tokens: row.tokens,
    signals: row.signals,
    playbook_id: row.playbook_id,
    created_at: row.created_at.toISOString(),
    metadata: row.metadata,
  };
}
