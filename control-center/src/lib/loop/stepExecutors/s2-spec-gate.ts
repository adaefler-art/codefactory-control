/**
 * Step Executor S2: Spec Gate
 * 
 * E9.1-CTRL-6: Idempotent executor that validates spec readiness via draft lifecycle.
 * 
 * Intent: S2 checks "Spec ready" through existing Draft-Lifecycle logic.
 * 
 * Acceptance Criteria:
 * - No draft → NO_DRAFT
 * - Not committed → NO_COMMITTED_DRAFT
 * - Validation failed → DRAFT_INVALID
 * - Success → SPEC_READY state, Timeline event loop_step_s2_spec_ready
 */

import { Pool } from 'pg';
import { logTimelineEvent } from '../../db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '../../contracts/issueTimeline';
import { BlockerCode, LoopStep } from '../stateMachine';
import type { StepContext, StepExecutionResult } from './s1-pick-issue';

// Re-export types for convenience
export type { StepContext, StepExecutionResult };

/**
 * Execute S2: Spec Gate
 * 
 * Validates that the issue has a spec ready via:
 * 1. A draft exists for the issue's source session
 * 2. At least one committed version exists
 * 3. Last validation status is 'valid'
 * 
 * If all criteria pass, transitions issue to SPEC_READY state.
 * Otherwise returns blocked with specific blocker code.
 * 
 * Creates a timeline event documenting the step execution.
 * 
 * @param pool - PostgreSQL connection pool
 * @param ctx - Execution context
 * @returns Step execution result
 */
export async function executeS2(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult> {
  console.log('[S2] Executing Spec Gate', {
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

  // Check if issue has a source_session_id (created from INTENT session)
  if (!issue.source_session_id) {
    console.log('[S2] Blocked: No source session', { issueId: ctx.issueId });

    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S2_SPEC_READY,
        stateBefore,
        stateAfter: stateBefore,
        requestId: ctx.requestId,
        blocked: true,
        blockerCode: BlockerCode.NO_DRAFT,
        mode: ctx.mode,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_DRAFT,
      blockerMessage: 'S2 (Spec Gate) requires issue to have a source INTENT session with draft',
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: 'Step blocked: No source session or draft',
    };
  }

  // Get draft for the session
  // Note: We use a system query here since we don't have user_id in the step context
  // We fetch directly from DB instead of using the session-based function
  const draftResult = await pool.query(
    `SELECT id, session_id, issue_json, issue_hash, last_validation_status, last_validation_at
     FROM intent_issue_drafts
     WHERE session_id = $1`,
    [issue.source_session_id]
  );

  if (draftResult.rows.length === 0) {
    console.log('[S2] Blocked: No draft exists', {
      issueId: ctx.issueId,
      sessionId: issue.source_session_id,
    });

    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S2_SPEC_READY,
        stateBefore,
        stateAfter: stateBefore,
        requestId: ctx.requestId,
        blocked: true,
        blockerCode: BlockerCode.NO_DRAFT,
        mode: ctx.mode,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_DRAFT,
      blockerMessage: 'S2 (Spec Gate) requires a draft to be created',
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: 'Step blocked: Draft does not exist for session',
    };
  }

  const draft = draftResult.rows[0];

  // Check if draft has been committed (has at least one version)
  const versionResult = await pool.query(
    `SELECT id, version_number, issue_hash
     FROM intent_issue_draft_versions
     WHERE session_id = $1
     ORDER BY version_number DESC
     LIMIT 1`,
    [issue.source_session_id]
  );

  if (versionResult.rows.length === 0) {
    console.log('[S2] Blocked: No committed version', {
      issueId: ctx.issueId,
      sessionId: issue.source_session_id,
      draftId: draft.id,
    });

    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S2_SPEC_READY,
        stateBefore,
        stateAfter: stateBefore,
        requestId: ctx.requestId,
        blocked: true,
        blockerCode: BlockerCode.NO_COMMITTED_DRAFT,
        mode: ctx.mode,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_COMMITTED_DRAFT,
      blockerMessage: 'S2 (Spec Gate) requires draft to be committed',
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: 'Step blocked: Draft has not been committed',
    };
  }

  const latestVersion = versionResult.rows[0];

  // Check if last validation is 'valid'
  if (draft.last_validation_status !== 'valid') {
    console.log('[S2] Blocked: Draft validation not valid', {
      issueId: ctx.issueId,
      sessionId: issue.source_session_id,
      draftId: draft.id,
      validationStatus: draft.last_validation_status,
    });

    await logTimelineEvent(pool, {
      issue_id: ctx.issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId: ctx.runId,
        step: LoopStep.S2_SPEC_READY,
        stateBefore,
        stateAfter: stateBefore,
        requestId: ctx.requestId,
        blocked: true,
        blockerCode: BlockerCode.DRAFT_INVALID,
        mode: ctx.mode,
        validationStatus: draft.last_validation_status,
      },
      actor: ctx.actor,
      actor_type: ActorType.SYSTEM,
    });

    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.DRAFT_INVALID,
      blockerMessage: `S2 (Spec Gate) requires draft validation to be 'valid', but it is '${draft.last_validation_status}'`,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: `Step blocked: Draft validation status is '${draft.last_validation_status}'`,
    };
  }

  // All checks passed - transition to SPEC_READY
  const stateAfter = 'SPEC_READY';
  const fieldsChanged: string[] = [];

  if (ctx.mode === 'execute') {
    // Update issue status to SPEC_READY
    await pool.query(
      `UPDATE afu9_issues
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [stateAfter, ctx.issueId]
    );
    fieldsChanged.push('status');

    console.log('[S2] Transitioned to SPEC_READY', {
      issueId: ctx.issueId,
      stateBefore,
      stateAfter,
    });
  }

  // Log timeline event for successful execution with custom event type
  await logTimelineEvent(pool, {
    issue_id: ctx.issueId,
    event_type: IssueTimelineEventType.RUN_STARTED,
    event_data: {
      runId: ctx.runId,
      step: LoopStep.S2_SPEC_READY,
      stepName: 'loop_step_s2_spec_ready',
      stateBefore,
      stateAfter,
      requestId: ctx.requestId,
      blocked: false,
      fieldsChanged,
      mode: ctx.mode,
      draftId: draft.id,
      versionId: latestVersion.id,
      versionNumber: latestVersion.version_number,
    },
    actor: ctx.actor,
    actor_type: ActorType.SYSTEM,
  });

  const message = ctx.mode === 'execute'
    ? `S2 complete: Spec ready, transitioned to ${stateAfter}`
    : `S2 dry-run complete: Spec ready, would transition to ${stateAfter}`;

  console.log('[S2] Execution complete', {
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
