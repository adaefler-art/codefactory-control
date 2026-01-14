/**
 * Approval Gate Service (E87.1)
 * 
 * Provides unified approval gate framework for dangerous operations:
 * - merge (PR merge)
 * - prod operations (all against production env)
 * - destructive ops (delete/reset/force-migration/rollback)
 * 
 * SECURITY PRINCIPLE: Fail-closed
 * - Missing approval → deny
 * - Invalid phrase → deny
 * - Expired approval → deny
 * 
 * NON-NEGOTIABLES:
 * - Deterministic action fingerprints (same inputs → same hash)
 * - Append-only audit (no updates/deletes)
 * - Signed phrase verification (exact match required)
 * - Context capture (lawbook version, inputs hash, summary)
 */

import { createHash } from 'crypto';
import { stableStringify } from '../contracts/remediation-playbook';

// ========================================
// Type Definitions
// ========================================

export type ActionType = 'merge' | 'prod_operation' | 'destructive_operation';

export type ApprovalDecision = 'approved' | 'denied' | 'cancelled';

export interface ActionContext {
  actionType: ActionType;
  targetType: string; // 'pr', 'env', 'database', etc.
  targetIdentifier: string; // 'owner/repo#123', 'production', etc.
  params?: Record<string, any>; // Additional action parameters
}

export interface ApprovalContext {
  requestId: string;
  sessionId?: string;
  lawbookVersion?: string;
  lawbookHash?: string;
  contextPackHash?: string;
  contextSummary?: Record<string, any>; // Human-readable summary
}

export interface ApprovalRequest {
  actionContext: ActionContext;
  approvalContext: ApprovalContext;
  actor: string; // User ID from x-afu9-sub
  signedPhrase: string; // Required phrase (e.g., "YES MERGE")
  reason?: string; // Optional reason
}

export interface ApprovalGateResult {
  allowed: boolean;
  reason: string;
  actionFingerprint: string;
  approvalId?: number;
}

// ========================================
// Phrase Templates
// ========================================

/**
 * Required phrases for each action type
 * User must type these EXACTLY (case-sensitive)
 */
export const REQUIRED_PHRASES: Record<ActionType, string> = {
  merge: 'YES MERGE',
  prod_operation: 'YES PROD',
  destructive_operation: 'YES DESTRUCTIVE',
};

/**
 * Get required phrase for action type
 */
export function getRequiredPhrase(actionType: ActionType): string {
  return REQUIRED_PHRASES[actionType];
}

/**
 * Validate signed phrase matches required phrase for action type
 * Case-sensitive exact match required
 */
export function validateSignedPhrase(
  signedPhrase: string,
  actionType: ActionType
): { valid: boolean; expectedPhrase: string } {
  const expectedPhrase = getRequiredPhrase(actionType);
  const valid = signedPhrase === expectedPhrase;
  
  return { valid, expectedPhrase };
}

// ========================================
// Action Fingerprint
// ========================================

/**
 * Compute deterministic action fingerprint
 * 
 * Creates stable SHA-256 hash of action context:
 * - actionType
 * - targetType
 * - targetIdentifier
 * - params (sorted keys)
 * 
 * Same inputs always produce same hash.
 * Used for idempotency and deduplication.
 */
export function computeActionFingerprint(context: ActionContext): string {
  const canonical = stableStringify({
    actionType: context.actionType,
    targetType: context.targetType,
    targetIdentifier: context.targetIdentifier,
    params: context.params || {},
  });
  
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Compute SHA-256 hash of a string
 */
export function computeHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ========================================
// Approval Gate Logic
// ========================================

/**
 * Check if approval exists and is valid for given action
 * 
 * FAIL-CLOSED: Returns false unless valid approval found
 * 
 * @param actionFingerprint - Deterministic hash of action
 * @param requestId - Request ID to match
 * @param approvalWindow - Max age of approval in seconds (default: 300 = 5 minutes)
 * @param getApproval - Callback to fetch approval from DB
 * @returns Whether approval is valid
 */
export async function checkApprovalGate(
  actionFingerprint: string,
  requestId: string,
  approvalWindow: number = 300,
  getApproval: (fingerprint: string, requestId: string) => Promise<any | null>
): Promise<ApprovalGateResult> {
  // Fetch most recent approval for this action+request
  const approval = await getApproval(actionFingerprint, requestId);
  
  // FAIL-CLOSED: No approval found
  if (!approval) {
    return {
      allowed: false,
      reason: 'No approval found for this action',
      actionFingerprint,
    };
  }
  
  // Check decision
  if (approval.decision !== 'approved') {
    return {
      allowed: false,
      reason: `Approval was ${approval.decision}`,
      actionFingerprint,
      approvalId: approval.id,
    };
  }
  
  // Check approval age (prevent replay attacks with old approvals)
  const approvalAge = (Date.now() - new Date(approval.created_at).getTime()) / 1000;
  if (approvalAge > approvalWindow) {
    return {
      allowed: false,
      reason: `Approval expired (${Math.floor(approvalAge)}s old, max ${approvalWindow}s)`,
      actionFingerprint,
      approvalId: approval.id,
    };
  }
  
  // All checks passed
  return {
    allowed: true,
    reason: 'Valid approval found',
    actionFingerprint,
    approvalId: approval.id,
  };
}

/**
 * Validate approval request before persisting
 * 
 * Checks:
 * - Action type is valid
 * - Signed phrase matches required phrase
 * - Request ID is present
 * - Actor is present
 * 
 * @returns Validation result with errors if invalid
 */
export function validateApprovalRequest(request: ApprovalRequest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check action type
  const validActionTypes: ActionType[] = ['merge', 'prod_operation', 'destructive_operation'];
  if (!validActionTypes.includes(request.actionContext.actionType)) {
    errors.push(`Invalid action type: ${request.actionContext.actionType}`);
  }
  
  // Check request ID
  if (!request.approvalContext.requestId || !request.approvalContext.requestId.trim()) {
    errors.push('Request ID is required');
  }
  
  // Check actor
  if (!request.actor || !request.actor.trim()) {
    errors.push('Actor is required');
  }
  
  // Check signed phrase
  const phraseValidation = validateSignedPhrase(
    request.signedPhrase,
    request.actionContext.actionType
  );
  
  if (!phraseValidation.valid) {
    errors.push(
      `Invalid signed phrase. Expected: "${phraseValidation.expectedPhrase}"`
    );
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ========================================
// Exports
// ========================================

export {
  ActionContext,
  ApprovalContext,
  ApprovalRequest,
  ApprovalGateResult,
  ActionType,
  ApprovalDecision,
};
