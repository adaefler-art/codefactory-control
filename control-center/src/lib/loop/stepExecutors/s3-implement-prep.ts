/**
 * Step Executor S3: Implement Prep
 * 
 * E9.1-CTRL-7: Idempotent executor that transitions to IMPLEMENTING_PREP only when SPEC_READY.
 * 
 * Intent: S3 moves to IMPLEMENTING_PREP state strictly when spec is validated and ready.
 * 
 * Acceptance Criteria:
 * - Preconditions: State == SPEC_READY
 * - Success: set state → IMPLEMENTING_PREP, Timeline-Event loop_step_s3_implement_prep
 * - Error: blocked with UNKNOWN_STATE or INVARIANT_VIOLATION
 * - Idempotent, no PR-Handling
 */

import { Pool } from 'pg';
import { logTimelineEvent } from '../../db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '../../contracts/issueTimeline';
import { BlockerCode, LoopStep, IssueState } from '../stateMachine';
import type { StepContext, StepExecutionResult } from './s1-pick-issue';

// Re-export types for convenience
export type { StepContext, StepExecutionResult };

/**
 * Execute S3: Implement Prep
 * 
 * Validates that the issue is in SPEC_READY state and transitions to IMPLEMENTING_PREP.
 * 
 * Preconditions:
 * 1. Issue status must be SPEC_READY
 * 
 * If preconditions are met, transitions issue to IMPLEMENTING_PREP state.
 * If already in IMPLEMENTING_PREP, this is a no-op (idempotent).
 * Otherwise returns blocked with specific blocker code.
 * 
 * Creates a timeline event documenting the step execution.
 * 
 * @param pool - PostgreSQL connection pool
 * @param ctx - Execution context
 * @returns Step execution result
 */
export async function executeS3(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult> {
  console.log('[S3] Executing Implement Prep', {
    issueId: ctx.issueId,
    runId: ctx.runId,
    mode: ctx.mode,
  });

  // Fetch issue from database
  const issueResult = await pool.query(
    `SELECT id, status, github_url, source_session_id, current_draft_id, handoff_state
     FROM afu9_issues
     WHERE id = $1`,
    [ctx.issueId]
  );

  if (issueResult.rows.length === 0) {
    throw new Error(`Issue not found: ${ctx.issueId}`);
  }

  const issue = issueResult.rows[0];
  const stateBefore = issue.status;

  // Check if already in IMPLEMENTING_PREP (idempotent no-op)
  if (stateBefore === IssueState.IMPLEMENTING_PREP) {
    console.log('[S3] Already in IMPLEMENTING_PREP (no-op)', { issueId: ctx.issueId });

    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S3_IMPLEMENT_PREP,
        stateBefore,
        stateAfter: stateBefore,
        requestId: ctx.requestId,
        blocked: false,
        isNoOp: true,
        mode: ctx.mode,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: true,
      blocked: false,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: 'S3 complete: Already in IMPLEMENTING_PREP (no-op)',
    };
  }

  // Precondition check: State must be SPEC_READY
  if (stateBefore !== IssueState.SPEC_READY) {
    console.log('[S3] Blocked: Invalid state', {
      issueId: ctx.issueId,
      currentState: stateBefore,
      expectedState: IssueState.SPEC_READY,
    });

    // Determine appropriate blocker code
    // If the state is a known state but not SPEC_READY, it's an invariant violation
    // If the state is unknown/invalid, it's UNKNOWN_STATE
    const isKnownState = Object.values(IssueState).includes(stateBefore as IssueState);
    const blockerCode = isKnownState ? BlockerCode.INVARIANT_VIOLATION : BlockerCode.UNKNOWN_STATE;
    const blockerMessage = isKnownState
      ? `S3 (Implement Prep) requires state SPEC_READY, but issue is in state '${stateBefore}'`
      : `S3 (Implement Prep) encountered unknown state: '${stateBefore}'`;

    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S3_IMPLEMENT_PREP,
        stateBefore,
        stateAfter: stateBefore,
        requestId: ctx.requestId,
        blocked: true,
        blockerCode,
        mode: ctx.mode,
        expectedState: IssueState.SPEC_READY,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: false,
      blocked: true,
      blockerCode,
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: `Step blocked: ${blockerMessage}`,
    };
  }

  // All checks passed - transition to IMPLEMENTING_PREP
  const stateAfter = IssueState.IMPLEMENTING_PREP;
  const fieldsChanged: string[] = [];

  if (ctx.mode === 'execute') {
    // Update issue status to IMPLEMENTING_PREP
    await pool.query(
      `UPDATE afu9_issues
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [stateAfter, ctx.issueId]
    );
    fieldsChanged.push('status');

    console.log('[S3] Transitioned to IMPLEMENTING_PREP', {
      issueId: ctx.issueId,
      stateBefore,
      stateAfter,
    });
  }

  // Log timeline event for successful execution with custom event name
  await logTimelineEvent(pool, {
    issue_id: ctx.issueId,
    event_type: IssueTimelineEventType.RUN_STARTED,
    event_data: {
      runId: ctx.runId,
      step: LoopStep.S3_IMPLEMENT_PREP,
      stepName: 'loop_step_s3_implement_prep',
      stateBefore,
      stateAfter,
      requestId: ctx.requestId,
      blocked: false,
      fieldsChanged,
      mode: ctx.mode,
    },
    actor: ctx.actor,
    actor_type: ActorType.SYSTEM,
  });

  const message = ctx.mode === 'execute'
    ? `S3 complete: Implement prep ready, transitioned to ${stateAfter}`
    : `S3 dry-run complete: Implement prep ready, would transition to ${stateAfter}`;

  console.log('[S3] Execution complete', {
    issueId: ctx.issueId,
    stateBefore,
    stateAfter,
    fieldsChanged,
    mode: ctx.mode,
  });

  return {
    success: true,
    blocked: false,
    stateBefore,
    stateAfter,
    fieldsChanged,
    message,
  };
}
