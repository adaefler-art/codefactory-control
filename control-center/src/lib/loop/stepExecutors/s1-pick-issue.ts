/**
 * Step Executor S1: Pick/Link Issue
 * 
 * E9.1-CTRL-5: Idempotent executor that brings an issue into a "processable" state.
 * 
 * Intent: S1 validates minimal criteria (GitHub link, ownership) and is idempotent.
 * 
 * Acceptance Criteria:
 * - If fields are present → S1 is no-op
 * - If fields are missing → blocked with NO_GITHUB_LINK
 * - Timeline event with runId, step, stateBefore, stateAfter, requestId
 */

import { Pool } from 'pg';
import { logTimelineEvent } from '../../db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '../../contracts/issueTimeline';
import { BlockerCode, LoopStep } from '../stateMachine';

/**
 * Context for step execution
 */
export interface StepContext {
  issueId: string;
  runId: string;
  requestId: string;
  actor: string;
  mode: 'execute' | 'dryRun';
}

/**
 * Result from step execution
 */
export interface StepExecutionResult {
  success: boolean;
  blocked: boolean;
  blockerCode?: BlockerCode;
  blockerMessage?: string;
  stateBefore: string;
  stateAfter: string;
  fieldsChanged: string[];
  message: string;
}

/**
 * Execute S1: Pick/Link Issue
 * 
 * Validates that the issue has:
 * 1. A valid GitHub URL (github_url field)
 * 2. Ownership information (assignee field)
 * 
 * If fields are already present, this is a no-op (idempotent).
 * If GitHub URL is missing, returns blocked with NO_GITHUB_LINK.
 * 
 * Creates a timeline event documenting the step execution.
 * 
 * @param pool - PostgreSQL connection pool
 * @param ctx - Execution context
 * @returns Step execution result
 */
export async function executeS1(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult> {
  console.log('[S1] Executing Pick/Link Issue', {
    issueId: ctx.issueId,
    runId: ctx.runId,
    mode: ctx.mode,
  });

  // Fetch issue from database
  const issueResult = await pool.query(
    `SELECT id, status, github_url, assignee, handoff_state
     FROM afu9_issues
     WHERE id = $1`,
    [ctx.issueId]
  );

  if (issueResult.rows.length === 0) {
    throw new Error(`Issue not found: ${ctx.issueId}`);
  }

  const issue = issueResult.rows[0];
  const stateBefore = issue.status;

  // Check minimal criteria: GitHub URL must be present
  if (!issue.github_url || issue.github_url.trim() === '') {
    console.log('[S1] Blocked: Missing GitHub URL', { issueId: ctx.issueId });

    // Log timeline event for blocked execution
    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S1_PICK_ISSUE,
        stateBefore,
        stateAfter: stateBefore, // No state change
        requestId: ctx.requestId,
        blocked: true,
        blockerCode: BlockerCode.NO_GITHUB_LINK,
        mode: ctx.mode,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_GITHUB_LINK,
      blockerMessage: 'S1 (Pick Issue) requires GitHub issue link',
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: 'Step blocked: GitHub URL is required',
    };
  }

  // Check if ownership is set (assignee)
  const needsOwnership = !issue.assignee || issue.assignee.trim() === '';
  const fieldsChanged: string[] = [];

  // In execute mode, set ownership if missing
  if (ctx.mode === 'execute' && needsOwnership) {
    // Set default assignee to the actor
    await pool.query(
      `UPDATE afu9_issues
       SET assignee = $1, updated_at = NOW()
       WHERE id = $2`,
      [ctx.actor, ctx.issueId]
    );
    fieldsChanged.push('assignee');
    console.log('[S1] Set ownership', {
      issueId: ctx.issueId,
      assignee: ctx.actor,
    });
  }

  // Determine if this was a no-op
  const isNoOp = !needsOwnership;
  const stateAfter = stateBefore; // S1 doesn't change status

  // Log timeline event for successful execution
  await logTimelineEvent(pool, {
    issue_id: ctx.issueId,
    event_type: IssueTimelineEventType.RUN_STARTED,
    event_data: {
      runId: ctx.runId,
      step: LoopStep.S1_PICK_ISSUE,
      stateBefore,
      stateAfter,
      requestId: ctx.requestId,
      blocked: false,
      fieldsChanged,
      isNoOp,
      mode: ctx.mode,
    },
    actor: ctx.actor,
    actor_type: ActorType.SYSTEM,
  });

  const message = isNoOp
    ? 'S1 complete: Issue already has required fields (no-op)'
    : `S1 complete: Set ownership (${fieldsChanged.join(', ')})`;

  console.log('[S1] Execution complete', {
    issueId: ctx.issueId,
    isNoOp,
    fieldsChanged,
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
