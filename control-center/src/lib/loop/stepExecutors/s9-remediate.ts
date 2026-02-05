/**
 * S9 Remediate Step Executor (E9.3-CTRL-07)
 * 
 * Implements the RED path for handling issues requiring remediation.
 * Places issues on HOLD with explicit remediation tracking.
 * 
 * Flow: Any state → HOLD (terminal, requires manual intervention to exit)
 * 
 * Guarantees:
 * - Explicit remediation: Reason always required
 * - Full tracking: Complete audit trail of remediation attempts
 * - Fail-closed semantics: No silent HOLD transitions
 * - Manual intervention: Exiting HOLD requires explicit action
 */

import { BlockerCode, LoopStep, IssueState } from '../stateMachine';
import type { PoolClient } from 'pg';

/**
 * Issue data required for S9 execution
 */
export interface IssueForS9 {
  id: string;
  status: string;
  github_url?: string | null;
  pr_url?: string | null;
}

/**
 * Remediation details
 */
export interface RemediationDetails {
  failedStep?: string;
  blockerCode?: string;
  redVerdict?: boolean;
  failedChecks?: string[];
}

/**
 * S9 execution parameters
 */
export interface ExecuteS9Params {
  issue: IssueForS9;
  runId: string;
  requestId: string;
  mode: 'execute' | 'dryRun';
  remediationReason: string;
  remediationDetails?: RemediationDetails;
  dbClient: PoolClient;
}

/**
 * S9 success result
 */
export interface S9SuccessResult {
  success: true;
  runId: string;
  step: string;
  stateBefore: string;
  stateAfter: string;
  remediationRecord: {
    remediationId: string;
    reason: string;
    failedStep?: string;
    blockerCode?: string;
    createdAt: string;
  };
  durationMs: number;
}

/**
 * S9 blocked result
 */
export interface S9BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: string;
  stateBefore: string;
  stateAfter: string;
}

/**
 * S9 result type
 */
export type S9Result = S9SuccessResult | S9BlockedResult;

/**
 * Check if a state allows transition to HOLD
 */
function canTransitionToHold(status: string): boolean {
  const allowedStates = [
    IssueState.CREATED,
    IssueState.SPEC_READY,
    IssueState.IMPLEMENTING_PREP,
    IssueState.REVIEW_READY,
    IssueState.DONE,
    'DRAFT_READY',
    'VERSION_COMMITTED',
    'CR_BOUND',
  ];
  
  return allowedStates.includes(status as IssueState);
}

/**
 * Execute S9: Remediate step (RED path)
 * 
 * Places issue on HOLD with explicit remediation tracking.
 * 
 * @param params - Execution parameters
 * @returns S9 execution result
 */
export async function executeS9Remediate(params: ExecuteS9Params): Promise<S9Result> {
  const { issue, runId, requestId, mode, remediationReason, remediationDetails, dbClient } = params;
  const startTime = Date.now();

  // Validate remediation reason is provided
  if (!remediationReason || remediationReason.trim() === '') {
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_REMEDIATION_REASON,
      blockerMessage: 'S9 (Remediate) requires explicit remediation reason',
      runId,
      step: LoopStep.S9_REMEDIATE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }

  // Check if issue is already CLOSED (immutable)
  if (issue.status === IssueState.CLOSED) {
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.INVALID_STATE_FOR_HOLD,
      blockerMessage: 'Cannot remediate CLOSED issue (immutable)',
      runId,
      step: LoopStep.S9_REMEDIATE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }

  // Check if issue is already on HOLD
  if (issue.status === IssueState.HOLD) {
    // Allow creating a new remediation record for already-held issues
    // This supports tracking multiple remediation attempts
  }

  // Validate state allows transition to HOLD
  if (!canTransitionToHold(issue.status)) {
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.INVALID_STATE_FOR_HOLD,
      blockerMessage: `S9 (Remediate) cannot transition from ${issue.status} to HOLD`,
      runId,
      step: LoopStep.S9_REMEDIATE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }

  // Dry run mode - return without making changes
  if (mode === 'dryRun') {
    const durationMs = Date.now() - startTime;
    return {
      success: true,
      runId,
      step: LoopStep.S9_REMEDIATE,
      stateBefore: issue.status,
      stateAfter: IssueState.HOLD,
      remediationRecord: {
        remediationId: 'dry-run-remediation',
        reason: remediationReason,
        failedStep: remediationDetails?.failedStep,
        blockerCode: remediationDetails?.blockerCode,
        createdAt: new Date().toISOString(),
      },
      durationMs,
    };
  }

  // Execute mode - create remediation record and transition to HOLD
  try {
    const failedChecks = remediationDetails?.failedChecks || [];
    
    // Call database function to record remediation
    const remediationResult = await dbClient.query(
      `SELECT record_remediation($1, $2, $3, $4, $5, $6, $7) as remediation_id`,
      [
        issue.id,
        remediationReason,
        runId,
        remediationDetails?.failedStep || null,
        remediationDetails?.blockerCode || null,
        remediationDetails?.redVerdict || false,
        failedChecks,
      ]
    );

    const remediationId = remediationResult.rows[0]?.remediation_id;

    if (!remediationId) {
      throw new Error('Failed to create remediation record');
    }

    // Fetch created remediation record
    const createdRemediation = await dbClient.query(
      `SELECT id, remediation_reason, failed_step, blocker_code, created_at 
       FROM remediation_records 
       WHERE id = $1`,
      [remediationId]
    );

    const remediation = createdRemediation.rows[0];
    const durationMs = Date.now() - startTime;

    // Emit timeline event
    await dbClient.query(
      `INSERT INTO loop_events (issue_id, run_id, event_type, event_data, occurred_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        issue.id,
        runId,
        'issue_held_for_remediation',
        JSON.stringify({
          runId,
          step: LoopStep.S9_REMEDIATE,
          stateBefore: issue.status,
          stateAfter: IssueState.HOLD,
          requestId,
          remediationId: remediation.id,
          remediationReason: remediation.remediation_reason,
          failedStep: remediation.failed_step,
          blockerCode: remediation.blocker_code,
        }),
      ]
    );

    return {
      success: true,
      runId,
      step: LoopStep.S9_REMEDIATE,
      stateBefore: issue.status,
      stateAfter: IssueState.HOLD,
      remediationRecord: {
        remediationId: remediation.id,
        reason: remediation.remediation_reason,
        failedStep: remediation.failed_step,
        blockerCode: remediation.blocker_code,
        createdAt: remediation.created_at,
      },
      durationMs,
    };
  } catch (error) {
    // Handle errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.INVARIANT_VIOLATION,
      blockerMessage: `S9 (Remediate) failed: ${errorMessage}`,
      runId,
      step: LoopStep.S9_REMEDIATE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }
}
