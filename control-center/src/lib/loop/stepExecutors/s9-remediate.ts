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
import type { Pool } from 'pg';

/**
 * Step execution context
 */
export interface StepContext {
  issueId: string;
  runId: string;
  requestId: string;
  actor: string;
  mode: 'execute' | 'dryRun';
}

/**
 * Step execution result
 */
export interface StepExecutionResult {
  blocked: boolean;
  blockerCode?: string;
  blockerMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Remediation options (passed via metadata)
 */
export interface RemediationOptions {
  reason: string;
  failedStep?: string;
  blockerCode?: string;
  redVerdict?: boolean;
  failedChecks?: string[];
}

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
 * @param pool - Database connection pool
 * @param ctx - Execution context
 * @param options - Remediation options (reason, failedStep, etc.)
 * @returns S9 execution result
 */
export async function executeS9Remediate(
  pool: Pool,
  ctx: StepContext,
  options?: RemediationOptions
): Promise<StepExecutionResult> {
  const { issueId, runId, requestId, mode } = ctx;
  const startTime = Date.now();

  console.log('[S9] Executing Remediate', { issueId, runId, mode, options });

  // Validate remediation reason is provided
  const remediationReason = options?.reason || '';
  if (!remediationReason || remediationReason.trim() === '') {
    return {
      blocked: true,
      blockerCode: BlockerCode.NO_REMEDIATION_REASON,
      blockerMessage: 'S9 (Remediate) requires explicit remediation reason',
    };
  }

  // Fetch issue from database
  const issueResult = await pool.query(
    `SELECT id, status, github_url, pr_url
     FROM afu9_issues
     WHERE id = $1`,
    [issueId]
  );

  if (issueResult.rows.length === 0) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const issue = issueResult.rows[0];

  // Check if issue is already CLOSED (immutable)
  if (issue.status === IssueState.CLOSED) {
    return {
      blocked: true,
      blockerCode: BlockerCode.INVALID_STATE_FOR_HOLD,
      blockerMessage: 'Cannot remediate CLOSED issue (immutable)',
    };
  }

  // Validate state allows transition to HOLD
  if (!canTransitionToHold(issue.status) && issue.status !== IssueState.HOLD) {
    return {
      blocked: true,
      blockerCode: BlockerCode.INVALID_STATE_FOR_HOLD,
      blockerMessage: `S9 (Remediate) cannot transition from ${issue.status} to HOLD`,
    };
  }

  // Dry run mode - return without making changes
  if (mode === 'dryRun') {
    const durationMs = Date.now() - startTime;
    return {
      blocked: false,
      metadata: {
        step: LoopStep.S9_REMEDIATE,
        stateBefore: issue.status,
        stateAfter: IssueState.HOLD,
        remediationId: 'dry-run-remediation',
        reason: remediationReason,
        failedStep: options?.failedStep,
        blockerCode: options?.blockerCode,
        durationMs,
      },
    };
  }

  // Execute mode - create remediation record and transition to HOLD
  try {
    const failedChecks = options?.failedChecks || [];
    
    // Call database function to record remediation
    const remediationResult = await pool.query(
      `SELECT record_remediation($1, $2, $3, $4, $5, $6, $7) as remediation_id`,
      [
        issueId,
        remediationReason,
        runId,
        options?.failedStep || null,
        options?.blockerCode || null,
        options?.redVerdict || false,
        failedChecks,
      ]
    );

    const remediationId = remediationResult.rows[0]?.remediation_id;

    if (!remediationId) {
      throw new Error('Failed to create remediation record');
    }

    // Fetch created remediation record
    const createdRemediation = await pool.query(
      `SELECT id, remediation_reason, failed_step, blocker_code, created_at 
       FROM remediation_records 
       WHERE id = $1`,
      [remediationId]
    );

    const remediation = createdRemediation.rows[0];
    const durationMs = Date.now() - startTime;

    // Emit timeline event
    await pool.query(
      `INSERT INTO loop_events (issue_id, run_id, event_type, event_data, occurred_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        issueId,
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

    console.log('[S9] Issue placed on HOLD', { issueId, remediationId: remediation.id });

    return {
      blocked: false,
      metadata: {
        step: LoopStep.S9_REMEDIATE,
        stateBefore: issue.status,
        stateAfter: IssueState.HOLD,
        remediationId: remediation.id,
        reason: remediation.remediation_reason,
        failedStep: remediation.failed_step,
        blockerCode: remediation.blocker_code,
        createdAt: remediation.created_at,
        durationMs,
      },
    };
  } catch (error) {
    // Handle errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('[S9] Failed to remediate issue', { issueId, error: errorMessage });
    
    return {
      blocked: true,
      blockerCode: BlockerCode.INVARIANT_VIOLATION,
      blockerMessage: `S9 (Remediate) failed: ${errorMessage}`,
    };
  }
}
