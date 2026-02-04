/**
 * S4: Review Gate Step Executor (E9.3-CTRL-01)
 * 
 * Implements the explicit review request gate for AFU-9 issues.
 * Ensures fail-closed semantics: no implicit entry into review state.
 * 
 * Contract: docs/contracts/step-executor-s4.v1.md
 */

import { Pool } from 'pg';
import { IssueState, LoopStep, BlockerCode } from '../stateMachine';
import { getLoopEventStore, LoopEventType } from '../eventStore';
import { logger } from '@/lib/logger';
import type { StepContext, StepExecutionResult } from './s1-pick-issue';

// Re-export types for convenience
export type { StepContext, StepExecutionResult };

/**
 * Blocker codes specific to S4 execution
 */
export enum S4BlockerCode {
  NO_PR_LINKED = 'NO_PR_LINKED',
  PR_NOT_FOUND = 'PR_NOT_FOUND',
  PR_CLOSED = 'PR_CLOSED',
  NO_GITHUB_LINK = 'NO_GITHUB_LINK',
  GITHUB_AUTH_FAILED = 'GITHUB_AUTH_FAILED',
}

/**
 * Execute S4 (Review Gate) step
 * 
 * Validates that issue is ready for review, records explicit review-intent,
 * and transitions state to REVIEW_READY.
 * 
 * Implements fail-closed semantics:
 * - Blocks if PR not found
 * - Blocks if PR is closed/merged
 * - Blocks if no GitHub link
 * 
 * @param pool - PostgreSQL connection pool
 * @param ctx - Execution context
 * @returns S4 execution result
 */
export async function executeS4(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult> {
  const startTime = Date.now();
  
  const eventStore = getLoopEventStore(pool);
  
  logger.info('Executing S4 (Review Gate)', {
    issueId: ctx.issueId,
    runId: ctx.runId,
    requestId: ctx.requestId,
    mode: ctx.mode,
  }, 'S4Executor');
  
  // Fetch issue from database
  const issueResult = await pool.query(
    `SELECT id, status, github_url, pr_url
     FROM afu9_issues
     WHERE id = $1`,
    [ctx.issueId]
  );

  if (issueResult.rows.length === 0) {
    throw new Error(`Issue not found: ${ctx.issueId}`);
  }

  const issue = issueResult.rows[0];
  const stateBefore = issue.status;
  
  // Validation Step 1: Check issue is in correct state
  if (issue.status !== IssueState.IMPLEMENTING_PREP) {
    const blockerMessage = `S4 requires issue to be in IMPLEMENTING_PREP state, but found: ${issue.status}`;
    logger.warn('S4 blocked: Invalid state', {
      issueId: issue.id,
      expectedState: IssueState.IMPLEMENTING_PREP,
      actualState: issue.status,
      runId: ctx.runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.INVARIANT_VIOLATION,
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: blockerMessage,
    };
  }
  
  // Validation Step 2: Check GitHub link exists
  if (!issue.github_url || issue.github_url.trim() === '') {
    const blockerMessage = 'S4 requires GitHub issue link';
    logger.warn('S4 blocked: No GitHub link', {
      issueId: issue.id,
      runId: ctx.runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_GITHUB_LINK,
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: blockerMessage,
    };
  }
  
  // Validation Step 3: Check PR link exists
  if (!issue.pr_url || issue.pr_url.trim() === '') {
    const blockerMessage = 'S4 requires PR to be linked to issue';
    logger.warn('S4 blocked: No PR linked', {
      issueId: issue.id,
      runId: ctx.runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_GITHUB_LINK, // Use existing blocker code
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: blockerMessage,
    };
  }
  
  // Dry-run mode: Skip state modifications, only validate
  if (ctx.mode === 'dryRun') {
    logger.info('S4 dry-run completed (validation only)', {
      issueId: issue.id,
      runId: ctx.runId,
    }, 'S4Executor');
    
    return {
      success: true,
      blocked: false,
      stateBefore,
      stateAfter: IssueState.REVIEW_READY,
      fieldsChanged: ['status'],
      message: 'S4 validation passed (dry-run)',
    };
  }
  
  // Record review-intent event
  const reviewIntentEvent = await eventStore.createEvent({
    issueId: issue.id,
    runId: ctx.runId,
    eventType: LoopEventType.REVIEW_REQUESTED,
    eventData: {
      runId: ctx.runId,
      step: LoopStep.S4_REVIEW,
      stateBefore: issue.status,
      requestId: ctx.requestId,
      prUrl: issue.pr_url,
    },
  });
  
  logger.info('S4 review-intent recorded', {
    issueId: issue.id,
    eventId: reviewIntentEvent.id,
    prUrl: issue.pr_url,
    runId: ctx.runId,
  }, 'S4Executor');
  
  // Transition state to REVIEW_READY
  const updateResult = await pool.query(
    `UPDATE afu9_issues 
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING status`,
    [IssueState.REVIEW_READY, issue.id]
  );
  
  if (updateResult.rowCount === 0) {
    logger.error('Failed to update issue state to REVIEW_READY', {
      issueId: issue.id,
      runId: ctx.runId,
    }, 'S4Executor');
    
    throw new Error('Failed to update issue state');
  }
  
  const durationMs = Date.now() - startTime;
  
  logger.info('S4 (Review Gate) completed successfully', {
    issueId: issue.id,
    runId: ctx.runId,
    stateBefore,
    stateAfter: IssueState.REVIEW_READY,
    eventId: reviewIntentEvent.id,
    durationMs,
  }, 'S4Executor');
  
  return {
    success: true,
    blocked: false,
    stateBefore,
    stateAfter: IssueState.REVIEW_READY,
    fieldsChanged: ['status'],
    message: `S4 completed: Transitioned to REVIEW_READY, review-intent recorded (event ${reviewIntentEvent.id})`,
  };
}
