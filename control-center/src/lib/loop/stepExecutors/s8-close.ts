/**
 * S8 Close Step Executor (E9.3-CTRL-07)
 * 
 * Implements the GREEN path for cleanly closing successfully verified issues.
 * Transitions VERIFIED issues to immutable CLOSED state.
 * 
 * Flow: VERIFIED → CLOSED (immutable, terminal)
 * 
 * Guarantees:
 * - Immutable closure: CLOSED state cannot be modified
 * - Explicit closure: Only S8 can close issues
 * - Fail-closed semantics: All errors result in explicit blocker codes
 * - Full audit trail: Complete traceability from verification to closure
 */

import { BlockerCode, LoopStep, IssueState } from '../stateMachine';
import type { PoolClient } from 'pg';

/**
 * Issue data required for S8 execution
 */
export interface IssueForS8 {
  id: string;
  status: string;
  github_url?: string | null;
  pr_url?: string | null;
  merge_sha?: string | null;
}

/**
 * S8 execution parameters
 */
export interface ExecuteS8Params {
  issue: IssueForS8;
  runId: string;
  requestId: string;
  mode: 'execute' | 'dryRun';
  dbClient: PoolClient;
}

/**
 * S8 success result
 */
export interface S8SuccessResult {
  success: true;
  runId: string;
  step: string;
  stateBefore: string;
  stateAfter: string;
  closureRecord: {
    closureId: string;
    closedAt: string;
    verificationVerdictId?: string;
    closureReason: string;
  };
  durationMs: number;
}

/**
 * S8 blocked result
 */
export interface S8BlockedResult {
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
 * S8 result type
 */
export type S8Result = S8SuccessResult | S8BlockedResult;

/**
 * Execute S8: Close step (GREEN path)
 * 
 * Transitions VERIFIED issues to immutable CLOSED state.
 * 
 * @param params - Execution parameters
 * @returns S8 execution result
 */
export async function executeS8Close(params: ExecuteS8Params): Promise<S8Result> {
  const { issue, runId, requestId, mode, dbClient } = params;
  const startTime = Date.now();

  // Validate issue is in VERIFIED state
  if (issue.status !== IssueState.VERIFIED) {
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NOT_VERIFIED,
      blockerMessage: `S8 (Close) requires issue to be in VERIFIED state. Current state: ${issue.status}`,
      runId,
      step: LoopStep.S8_CLOSE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }

  // Check for GREEN verdict from S7
  const verdictResult = await dbClient.query(
    `SELECT id, verdict, evaluated_at 
     FROM verification_verdicts 
     WHERE issue_id = $1 
     ORDER BY evaluated_at DESC 
     LIMIT 1`,
    [issue.id]
  );

  if (verdictResult.rows.length === 0) {
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_GREEN_VERDICT,
      blockerMessage: 'S8 (Close) requires a GREEN verification verdict from S7',
      runId,
      step: LoopStep.S8_CLOSE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }

  const verdict = verdictResult.rows[0];
  if (verdict.verdict !== 'GREEN') {
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_GREEN_VERDICT,
      blockerMessage: `S8 (Close) requires GREEN verdict. Found: ${verdict.verdict}`,
      runId,
      step: LoopStep.S8_CLOSE,
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
      step: LoopStep.S8_CLOSE,
      stateBefore: issue.status,
      stateAfter: IssueState.CLOSED,
      closureRecord: {
        closureId: 'dry-run-closure',
        closedAt: new Date().toISOString(),
        verificationVerdictId: verdict.id,
        closureReason: 'VERIFIED_SUCCESS',
      },
      durationMs,
    };
  }

  // Execute mode - create closure record and transition to CLOSED
  try {
    // Call database function to close issue
    const closureResult = await dbClient.query(
      `SELECT close_issue($1, $2, $3, $4) as closure_id`,
      [issue.id, runId, verdict.id, 'VERIFIED_SUCCESS']
    );

    const closureId = closureResult.rows[0]?.closure_id;

    if (!closureId) {
      // Already closed (idempotent)
      const existingClosure = await dbClient.query(
        `SELECT id, closed_at, verification_verdict_id, closure_reason 
         FROM issue_closures 
         WHERE issue_id = $1`,
        [issue.id]
      );

      if (existingClosure.rows.length > 0) {
        const existing = existingClosure.rows[0];
        const durationMs = Date.now() - startTime;
        
        return {
          success: true,
          runId,
          step: LoopStep.S8_CLOSE,
          stateBefore: IssueState.CLOSED,
          stateAfter: IssueState.CLOSED,
          closureRecord: {
            closureId: existing.id,
            closedAt: existing.closed_at,
            verificationVerdictId: existing.verification_verdict_id,
            closureReason: existing.closure_reason,
          },
          durationMs,
        };
      }

      throw new Error('Failed to close issue: no closure record created');
    }

    // Fetch created closure record
    const createdClosure = await dbClient.query(
      `SELECT id, closed_at, verification_verdict_id, closure_reason 
       FROM issue_closures 
       WHERE id = $1`,
      [closureId]
    );

    const closure = createdClosure.rows[0];
    const durationMs = Date.now() - startTime;

    // Emit timeline event
    await dbClient.query(
      `INSERT INTO loop_events (issue_id, run_id, event_type, event_data, occurred_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        issue.id,
        runId,
        'issue_closed',
        JSON.stringify({
          runId,
          step: LoopStep.S8_CLOSE,
          stateBefore: IssueState.VERIFIED,
          stateAfter: IssueState.CLOSED,
          requestId,
          closureId: closure.id,
          verificationVerdictId: closure.verification_verdict_id,
        }),
      ]
    );

    return {
      success: true,
      runId,
      step: LoopStep.S8_CLOSE,
      stateBefore: IssueState.VERIFIED,
      stateAfter: IssueState.CLOSED,
      closureRecord: {
        closureId: closure.id,
        closedAt: closure.closed_at,
        verificationVerdictId: closure.verification_verdict_id,
        closureReason: closure.closure_reason,
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
      blockerMessage: `S8 (Close) failed: ${errorMessage}`,
      runId,
      step: LoopStep.S8_CLOSE,
      stateBefore: issue.status,
      stateAfter: issue.status,
    };
  }
}
