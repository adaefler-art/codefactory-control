/**
 * Approval Gates Database Operations (E87.1)
 * 
 * Provides database operations for approval gates:
 * - Insert approval records (append-only)
 * - Query approvals by fingerprint/requestId
 * - Query recent approvals for audit
 * 
 * SECURITY:
 * - Append-only (no updates or deletes)
 * - Hash sensitive data (signed phrase)
 * - Capture full context for audit
 */

import { Pool } from 'pg';
import { 
  ApprovalRequest, 
  ApprovalDecision,
  ActionType,
  computeActionFingerprint,
  computeHash,
} from '../approvals/approval-gate';

// ========================================
// Type Definitions
// ========================================

export interface ApprovalRecord {
  id: number;
  request_id: string;
  session_id: string | null;
  action_type: ActionType;
  action_fingerprint: string;
  target_type: string;
  target_identifier: string;
  lawbook_version: string | null;
  lawbook_hash: string | null;
  context_pack_hash: string | null;
  context_summary: Record<string, any> | null;
  decision: ApprovalDecision;
  signed_phrase: string | null;
  signed_phrase_hash: string | null;
  reason: string | null;
  actor: string;
  created_at: Date;
}

// ========================================
// Insert Operations (Append-only)
// ========================================

/**
 * Insert approval record into database
 * 
 * APPEND-ONLY: Creates new record, never updates existing
 * 
 * @param pool - PostgreSQL connection pool
 * @param request - Approval request with all context
 * @param decision - Approval decision ('approved', 'denied', 'cancelled')
 * @returns Inserted approval record
 */
export async function insertApprovalRecord(
  pool: Pool,
  request: ApprovalRequest,
  decision: ApprovalDecision
): Promise<ApprovalRecord> {
  const actionFingerprint = computeActionFingerprint(request.actionContext);
  const signedPhraseHash = computeHash(request.signedPhrase);
  
  const query = `
    INSERT INTO approval_gates (
      request_id,
      session_id,
      action_type,
      action_fingerprint,
      target_type,
      target_identifier,
      lawbook_version,
      lawbook_hash,
      context_pack_hash,
      context_summary,
      decision,
      signed_phrase,
      signed_phrase_hash,
      reason,
      actor
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *
  `;
  
  const values = [
    request.approvalContext.requestId,
    request.approvalContext.sessionId || null,
    request.actionContext.actionType,
    actionFingerprint,
    request.actionContext.targetType,
    request.actionContext.targetIdentifier,
    request.approvalContext.lawbookVersion || null,
    request.approvalContext.lawbookHash || null,
    request.approvalContext.contextPackHash || null,
    request.approvalContext.contextSummary ? JSON.stringify(request.approvalContext.contextSummary) : null,
    decision,
    request.signedPhrase, // Store raw phrase for audit (consider redacting in production)
    signedPhraseHash,
    request.reason || null,
    request.actor,
  ];
  
  const result = await pool.query(query, values);
  return result.rows[0];
}

// ========================================
// Query Operations
// ========================================

/**
 * Get most recent approval for action fingerprint + request ID
 * 
 * Used by gate check to verify approval exists
 * 
 * @param pool - PostgreSQL connection pool
 * @param actionFingerprint - Deterministic action hash
 * @param requestId - Request ID
 * @returns Most recent approval record or null
 */
export async function getApprovalByFingerprint(
  pool: Pool,
  actionFingerprint: string,
  requestId: string
): Promise<ApprovalRecord | null> {
  const query = `
    SELECT * FROM approval_gates
    WHERE action_fingerprint = $1 AND request_id = $2
    ORDER BY created_at DESC
    LIMIT 1
  `;
  
  const result = await pool.query(query, [actionFingerprint, requestId]);
  return result.rows[0] || null;
}

/**
 * Get recent approvals by actor
 * 
 * @param pool - PostgreSQL connection pool
 * @param actor - User ID
 * @param limit - Max records to return
 * @returns List of approval records
 */
export async function getApprovalsByActor(
  pool: Pool,
  actor: string,
  limit: number = 50
): Promise<ApprovalRecord[]> {
  const query = `
    SELECT * FROM approval_gates
    WHERE actor = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  
  const result = await pool.query(query, [actor, limit]);
  return result.rows;
}

/**
 * Get recent approvals for action type
 * 
 * @param pool - PostgreSQL connection pool
 * @param actionType - Type of action
 * @param limit - Max records to return
 * @returns List of approval records
 */
export async function getApprovalsByActionType(
  pool: Pool,
  actionType: ActionType,
  limit: number = 50
): Promise<ApprovalRecord[]> {
  const query = `
    SELECT * FROM approval_gates
    WHERE action_type = $1
    ORDER BY created_at DESC
    LIMIT $2
  `;
  
  const result = await pool.query(query, [actionType, limit]);
  return result.rows;
}

/**
 * Get recent approvals (all types)
 * 
 * @param pool - PostgreSQL connection pool
 * @param limit - Max records to return
 * @returns List of approval records
 */
export async function getRecentApprovals(
  pool: Pool,
  limit: number = 100
): Promise<ApprovalRecord[]> {
  const query = `
    SELECT * FROM approval_gates
    ORDER BY created_at DESC
    LIMIT $1
  `;
  
  const result = await pool.query(query, [limit]);
  return result.rows;
}

/**
 * Count approvals by decision for time period
 * 
 * @param pool - PostgreSQL connection pool
 * @param hours - Time period in hours
 * @returns Count by decision type
 */
export async function getApprovalStats(
  pool: Pool,
  hours: number = 24
): Promise<Record<ApprovalDecision, number>> {
  const query = `
    SELECT decision, COUNT(*) as count
    FROM approval_gates
    WHERE created_at >= NOW() - INTERVAL '${hours} hours'
    GROUP BY decision
  `;
  
  const result = await pool.query(query);
  
  const stats: Record<string, number> = {
    approved: 0,
    denied: 0,
    cancelled: 0,
  };
  
  result.rows.forEach((row) => {
    stats[row.decision] = parseInt(row.count, 10);
  });
  
  return stats as Record<ApprovalDecision, number>;
}
