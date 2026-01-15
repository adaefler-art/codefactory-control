/**
 * Automation Policy Audit Database Operations (E87.2)
 * 
 * CRUD operations for automation policy execution audit trail:
 * - Record policy evaluations (allowed/denied)
 * - Query execution history for cooldown/rate limit enforcement
 * - Idempotency checks
 * 
 * Guarantees:
 * - Append-only audit trail
 * - Efficient lookups for rate limiting and cooldown enforcement
 */

import { Pool } from 'pg';
import { getPool } from '../db';
import { PolicyEvaluationResult } from '../lawbook/automation-policy';

// ========================================
// Types
// ========================================

export interface AutomationPolicyExecutionRecord {
  id: number;
  request_id: string;
  session_id: string | null;
  action_type: string;
  action_fingerprint: string;
  idempotency_key: string;
  idempotency_key_hash: string;
  target_type: string;
  target_identifier: string;
  decision: 'allowed' | 'denied';
  decision_reason: string;
  next_allowed_at: string | null;
  lawbook_version: string | null;
  lawbook_hash: string | null;
  policy_name: string | null;
  enforcement_data: Record<string, unknown>;
  context_data: Record<string, unknown>;
  deployment_env: string | null;
  actor: string | null;
  created_at: string;
}

export interface RecordPolicyExecutionInput {
  requestId: string;
  sessionId?: string;
  actionType: string;
  actionFingerprint: string;
  targetType: string;
  targetIdentifier: string;
  evaluationResult: PolicyEvaluationResult;
  contextData: Record<string, unknown>;
  deploymentEnv?: string;
  actor?: string;
}

export interface RecordPolicyExecutionResult {
  success: boolean;
  data?: AutomationPolicyExecutionRecord;
  error?: string;
}

export interface QueryExecutionsInput {
  actionType?: string;
  targetIdentifier?: string;
  idempotencyKeyHash?: string;
  decision?: 'allowed' | 'denied';
  sinceTimestamp?: Date;
  limit?: number;
}

// ========================================
// Record Policy Execution
// ========================================

/**
 * Record a policy evaluation decision in the audit trail
 * 
 * Append-only operation for audit purposes.
 */
export async function recordPolicyExecution(
  input: RecordPolicyExecutionInput,
  pool?: Pool
): Promise<RecordPolicyExecutionResult> {
  const db = pool || getPool();

  try {
    const query = `
      INSERT INTO automation_policy_executions (
        request_id, session_id, action_type, action_fingerprint,
        idempotency_key, idempotency_key_hash,
        target_type, target_identifier,
        decision, decision_reason, next_allowed_at,
        lawbook_version, lawbook_hash, policy_name,
        enforcement_data, context_data,
        deployment_env, actor
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING 
        id, request_id, session_id, action_type, action_fingerprint,
        idempotency_key, idempotency_key_hash,
        target_type, target_identifier,
        decision, decision_reason, next_allowed_at,
        lawbook_version, lawbook_hash, policy_name,
        enforcement_data, context_data,
        deployment_env, actor, created_at
    `;

    const result = await db.query<AutomationPolicyExecutionRecord>(query, [
      input.requestId,
      input.sessionId || null,
      input.actionType,
      input.actionFingerprint,
      input.evaluationResult.idempotencyKey,
      input.evaluationResult.idempotencyKeyHash,
      input.targetType,
      input.targetIdentifier,
      input.evaluationResult.decision,
      input.evaluationResult.reason,
      input.evaluationResult.nextAllowedAt?.toISOString() || null,
      input.evaluationResult.lawbookVersion || null,
      input.evaluationResult.lawbookHash || null,
      input.evaluationResult.policyName,
      JSON.stringify(input.evaluationResult.enforcementData),
      JSON.stringify(input.contextData),
      input.deploymentEnv || null,
      input.actor || null,
    ]);

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[DB] Failed to record policy execution:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ========================================
// Query Executions
// ========================================

/**
 * Query policy executions for rate limiting and cooldown enforcement
 * 
 * Supports filtering by action type, target, time window, etc.
 */
export async function queryPolicyExecutions(
  input: QueryExecutionsInput,
  pool?: Pool
): Promise<AutomationPolicyExecutionRecord[]> {
  const db = pool || getPool();

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.actionType) {
      conditions.push(`action_type = $${paramIndex++}`);
      params.push(input.actionType);
    }

    if (input.targetIdentifier) {
      conditions.push(`target_identifier = $${paramIndex++}`);
      params.push(input.targetIdentifier);
    }

    if (input.idempotencyKeyHash) {
      conditions.push(`idempotency_key_hash = $${paramIndex++}`);
      params.push(input.idempotencyKeyHash);
    }

    if (input.decision) {
      conditions.push(`decision = $${paramIndex++}`);
      params.push(input.decision);
    }

    if (input.sinceTimestamp) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(input.sinceTimestamp.toISOString());
    }

    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const limit = input.limit || 100;

    const query = `
      SELECT 
        id, request_id, session_id, action_type, action_fingerprint,
        idempotency_key, idempotency_key_hash,
        target_type, target_identifier,
        decision, decision_reason, next_allowed_at,
        lawbook_version, lawbook_hash, policy_name,
        enforcement_data, context_data,
        deployment_env, actor, created_at
      FROM automation_policy_executions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;

    params.push(limit);

    const result = await db.query<AutomationPolicyExecutionRecord>(query, params);
    return result.rows;
  } catch (error) {
    console.error('[DB] Failed to query policy executions:', error);
    throw error;
  }
}

// ========================================
// Check Last Execution
// ========================================

/**
 * Get the most recent execution for a specific action+target
 * 
 * Used for cooldown enforcement.
 */
export async function getLastExecution(
  actionType: string,
  targetIdentifier: string,
  pool?: Pool
): Promise<AutomationPolicyExecutionRecord | null> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        id, request_id, session_id, action_type, action_fingerprint,
        idempotency_key, idempotency_key_hash,
        target_type, target_identifier,
        decision, decision_reason, next_allowed_at,
        lawbook_version, lawbook_hash, policy_name,
        enforcement_data, context_data,
        deployment_env, actor, created_at
      FROM automation_policy_executions
      WHERE action_type = $1 AND target_identifier = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await db.query<AutomationPolicyExecutionRecord>(query, [
      actionType,
      targetIdentifier,
    ]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[DB] Failed to get last execution:', error);
    throw error;
  }
}

// ========================================
// Count Executions in Window
// ========================================

/**
 * Count allowed executions in a time window
 * 
 * Used for rate limit enforcement (maxRunsPerWindow).
 */
export async function countExecutionsInWindow(
  actionType: string,
  targetIdentifier: string,
  windowSeconds: number,
  pool?: Pool
): Promise<number> {
  const db = pool || getPool();

  try {
    const windowStart = new Date(Date.now() - windowSeconds * 1000);

    const query = `
      SELECT COUNT(*) as count
      FROM automation_policy_executions
      WHERE action_type = $1 
        AND target_identifier = $2
        AND decision = 'allowed'
        AND created_at >= $3
    `;

    const result = await db.query<{ count: string }>(query, [
      actionType,
      targetIdentifier,
      windowStart.toISOString(),
    ]);

    return parseInt(result.rows[0]?.count || '0', 10);
  } catch (error) {
    console.error('[DB] Failed to count executions in window:', error);
    throw error;
  }
}

// ========================================
// Check Idempotency
// ========================================

/**
 * Check if an identical request has been processed before
 * 
 * Used for idempotent operations.
 */
export async function checkIdempotency(
  idempotencyKeyHash: string,
  pool?: Pool
): Promise<AutomationPolicyExecutionRecord | null> {
  const db = pool || getPool();

  try {
    const query = `
      SELECT 
        id, request_id, session_id, action_type, action_fingerprint,
        idempotency_key, idempotency_key_hash,
        target_type, target_identifier,
        decision, decision_reason, next_allowed_at,
        lawbook_version, lawbook_hash, policy_name,
        enforcement_data, context_data,
        deployment_env, actor, created_at
      FROM automation_policy_executions
      WHERE idempotency_key_hash = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await db.query<AutomationPolicyExecutionRecord>(query, [
      idempotencyKeyHash,
    ]);

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[DB] Failed to check idempotency:', error);
    throw error;
  }
}
