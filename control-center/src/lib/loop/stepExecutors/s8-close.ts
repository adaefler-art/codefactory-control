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
 * Execute S8: Close step (GREEN path)
 * 
 * Transitions VERIFIED issues to immutable CLOSED state.
 * 
 * @param pool - Database connection pool
 * @param ctx - Execution context
 * @returns S8 execution result
 */
export async function executeS8Close(pool: Pool, ctx: StepContext): Promise<StepExecutionResult> {
  const { issueId, runId, requestId, mode } = ctx;
  const startTime = Date.now();

  console.log('[S8] Executing Close', { issueId, runId, mode });

  // Fetch issue from database
  const issueResult = await pool.query(
    `SELECT id, status, github_url, pr_url, merge_sha
     FROM afu9_issues
     WHERE id = $1`,
    [issueId]
  );

  if (issueResult.rows.length === 0) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const issue = issueResult.rows[0];

  // Validate issue is in VERIFIED state
  if (issue.status !== IssueState.VERIFIED) {
    return {
      blocked: true,
      blockerCode: BlockerCode.NOT_VERIFIED,
      blockerMessage: `S8 (Close) requires issue to be in VERIFIED state. Current state: ${issue.status}`,
    };
  }

  // Check for GREEN verdict from S7
  const verdictResult = await pool.query(
    `SELECT id, verdict, evaluated_at 
     FROM verification_verdicts 
     WHERE issue_id = $1 
     ORDER BY evaluated_at DESC 
     LIMIT 1`,
    [issueId]
  );

  if (verdictResult.rows.length === 0) {
    return {
      blocked: true,
      blockerCode: BlockerCode.NO_GREEN_VERDICT,
      blockerMessage: 'S8 (Close) requires a GREEN verification verdict from S7',
    };
  }

  const verdict = verdictResult.rows[0];
  if (verdict.verdict !== 'GREEN') {
    return {
      blocked: true,
      blockerCode: BlockerCode.NO_GREEN_VERDICT,
      blockerMessage: `S8 (Close) requires GREEN verdict. Found: ${verdict.verdict}`,
    };
  }

  // Dry run mode - return without making changes
  if (mode === 'dryRun') {
    const durationMs = Date.now() - startTime;
    return {
      blocked: false,
      metadata: {
        step: LoopStep.S8_CLOSE,
        stateBefore: issue.status,
        stateAfter: IssueState.CLOSED,
        closureId: 'dry-run-closure',
        verificationVerdictId: verdict.id,
        durationMs,
      },
    };
  }

  // Execute mode - create closure record and transition to CLOSED
  try {
    // Call database function to close issue
    const closureResult = await pool.query(
      `SELECT close_issue($1, $2, $3, $4) as closure_id`,
      [issueId, runId, verdict.id, 'VERIFIED_SUCCESS']
    );

    const closureId = closureResult.rows[0]?.closure_id;

    if (!closureId) {
      // Already closed (idempotent)
      const existingClosure = await pool.query(
        `SELECT id, closed_at, verification_verdict_id, closure_reason 
         FROM issue_closures 
         WHERE issue_id = $1`,
        [issueId]
      );

      if (existingClosure.rows.length > 0) {
        const existing = existingClosure.rows[0];
        const durationMs = Date.now() - startTime;
        
        return {
          blocked: false,
          metadata: {
            step: LoopStep.S8_CLOSE,
            stateBefore: IssueState.CLOSED,
            stateAfter: IssueState.CLOSED,
            closureId: existing.id,
            closedAt: existing.closed_at,
            verificationVerdictId: existing.verification_verdict_id,
            idempotent: true,
            durationMs,
          },
        };
      }

      throw new Error('Failed to close issue: no closure record created');
    }

    // Fetch created closure record
    const createdClosure = await pool.query(
      `SELECT id, closed_at, verification_verdict_id, closure_reason 
       FROM issue_closures 
       WHERE id = $1`,
      [closureId]
    );

    const closure = createdClosure.rows[0];
    const durationMs = Date.now() - startTime;

    // Emit timeline event
    await pool.query(
      `INSERT INTO loop_events (issue_id, run_id, event_type, event_data, occurred_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        issueId,
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

    console.log('[S8] Issue closed successfully', { issueId, closureId: closure.id });

    return {
      blocked: false,
      metadata: {
        step: LoopStep.S8_CLOSE,
        stateBefore: IssueState.VERIFIED,
        stateAfter: IssueState.CLOSED,
        closureId: closure.id,
        closedAt: closure.closed_at,
        verificationVerdictId: closure.verification_verdict_id,
        closureReason: closure.closure_reason,
        durationMs,
      },
    };
  } catch (error) {
    // Handle errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('[S8] Failed to close issue', { issueId, error: errorMessage });
    
    return {
      blocked: true,
      blockerCode: BlockerCode.INVARIANT_VIOLATION,
      blockerMessage: `S8 (Close) failed: ${errorMessage}`,
    };
  }
}
