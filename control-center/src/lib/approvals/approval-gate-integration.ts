/**
 * Approval Gate Integration Helper (E87.1)
 * 
 * Helper function to integrate approval gate checks into existing endpoints.
 * 
 * Usage pattern:
 * 1. Before dangerous operation, call requireApprovalGate()
 * 2. If returns error, return to client (403/409)
 * 3. If returns success, proceed with operation
 * 
 * Example:
 * ```typescript
 * const approvalCheck = await requireApprovalGate({
 *   actionType: 'merge',
 *   targetType: 'pr',
 *   targetIdentifier: `${owner}/${repo}#${prNumber}`,
 *   requestId,
 * }, pool);
 * 
 * if (approvalCheck.error) {
 *   return errorResponse(approvalCheck.error.message, {
 *     status: approvalCheck.error.status,
 *     requestId,
 *     code: approvalCheck.error.code,
 *   });
 * }
 * 
 * // Proceed with operation...
 * ```
 */

import { Pool } from 'pg';
import {
  ActionType,
  ActionContext,
  computeActionFingerprint,
  checkApprovalGate,
} from './approval-gate';
import { getApprovalByFingerprint } from '../db/approvals';

export interface ApprovalGateCheckParams {
  actionType: ActionType;
  targetType: string;
  targetIdentifier: string;
  params?: Record<string, any>;
  requestId: string;
  approvalWindow?: number; // Seconds (default: 300 = 5 minutes)
}

export interface ApprovalGateCheckResult {
  allowed: boolean;
  error?: {
    message: string;
    code: string;
    status: number;
    details?: string;
  };
  actionFingerprint: string;
  approvalId?: number;
}

/**
 * Require approval gate for dangerous operation
 * 
 * FAIL-CLOSED: Returns error unless valid approval found
 * 
 * @param params - Action context and request details
 * @param pool - Database connection pool
 * @returns Check result with error if approval missing/invalid
 */
export async function requireApprovalGate(
  params: ApprovalGateCheckParams,
  pool: Pool
): Promise<ApprovalGateCheckResult> {
  const actionContext: ActionContext = {
    actionType: params.actionType,
    targetType: params.targetType,
    targetIdentifier: params.targetIdentifier,
    params: params.params,
  };

  const actionFingerprint = computeActionFingerprint(actionContext);

  // Check if approval exists
  const getApproval = async (fingerprint: string, requestId: string) => {
    return getApprovalByFingerprint(pool, fingerprint, requestId);
  };

  const gateResult = await checkApprovalGate(
    actionFingerprint,
    params.requestId,
    params.approvalWindow || 300,
    getApproval
  );

  if (!gateResult.allowed) {
    // Determine appropriate status code
    let status = 403; // Forbidden (default)
    let code = 'APPROVAL_REQUIRED';

    if (gateResult.reason.includes('expired')) {
      status = 409; // Conflict (expired approval)
      code = 'APPROVAL_EXPIRED';
    } else if (gateResult.reason.includes('denied') || gateResult.reason.includes('cancelled')) {
      code = 'APPROVAL_DENIED';
    }

    return {
      allowed: false,
      error: {
        message: 'Approval required for this operation',
        code,
        status,
        details: gateResult.reason,
      },
      actionFingerprint,
    };
  }

  // Approval is valid
  return {
    allowed: true,
    actionFingerprint,
    approvalId: gateResult.approvalId,
  };
}

/**
 * Check if approval gate is required for action type
 * 
 * Helper to determine if approval gate should be enforced.
 * Can be configured via environment or lawbook.
 * 
 * @param actionType - Type of action
 * @returns Whether approval gate is required
 */
export function isApprovalGateRequired(actionType: ActionType): boolean {
  // Check environment variable (can be overridden)
  const envConfig = process.env.APPROVAL_GATE_ENABLED;
  if (envConfig === 'false') {
    return false;
  }

  // Default: approval gate is required for all dangerous operations
  return true;
}

/**
 * Create approval context summary for UI/audit
 * 
 * Helper to build human-readable summary for approval dialog
 * 
 * @param actionType - Type of action
 * @param details - Action-specific details
 * @returns Formatted summary object
 */
export function buildApprovalContextSummary(
  actionType: ActionType,
  details: Record<string, any>
): Record<string, any> {
  return {
    actionType,
    timestamp: new Date().toISOString(),
    ...details,
  };
}
