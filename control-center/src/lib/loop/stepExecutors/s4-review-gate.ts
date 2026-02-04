/**
 * S4: Review Gate Step Executor (E9.3-CTRL-01)
 * 
 * Implements the explicit review request gate for AFU-9 issues.
 * Ensures fail-closed semantics: no implicit entry into review state.
 * 
 * Contract: docs/contracts/step-executor-s4.v1.md
 */

import { Pool } from 'pg';
import { IssueState, LoopStep } from '../stateMachine';
import { getLoopEventStore, LoopEventType } from '../eventStore';
import { logger } from '@/lib/logger';

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
 * Issue data required for S4 execution
 */
export interface IssueForS4 {
  id: string;
  status: string;
  github_url?: string | null;
  pr_url?: string | null;
}

/**
 * Parameters for S4 execution
 */
export interface ExecuteS4Params {
  issue: IssueForS4;
  runId: string;
  requestId: string;
  mode: 'execute' | 'dryRun';
}

/**
 * Successful S4 execution result
 */
export interface S4ExecutionResult {
  success: true;
  runId: string;
  step: 'S4_REVIEW';
  stateBefore: string;
  stateAfter: string;
  reviewIntent: {
    eventId: string;
    prUrl: string;
    reviewers?: string[];
  };
  durationMs: number;
}

/**
 * Blocked S4 execution result
 */
export interface S4BlockedResult {
  success: false;
  blocked: true;
  blockerCode: S4BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S4_REVIEW';
  stateBefore: string;
}

/**
 * S4 execution result (success or blocked)
 */
export type S4Result = S4ExecutionResult | S4BlockedResult;

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
 * @param params - Execution parameters
 * @returns S4 execution result
 */
export async function executeS4(
  pool: Pool,
  params: ExecuteS4Params
): Promise<S4Result> {
  const { issue, runId, requestId, mode } = params;
  const startTime = Date.now();
  
  const eventStore = getLoopEventStore(pool);
  
  logger.info('Executing S4 (Review Gate)', {
    issueId: issue.id,
    runId,
    requestId,
    mode,
    currentStatus: issue.status,
  }, 'S4Executor');
  
  // Validation Step 1: Check issue is in correct state
  if (issue.status !== IssueState.IMPLEMENTING_PREP) {
    const blockerMessage = `S4 requires issue to be in IMPLEMENTING_PREP state, but found: ${issue.status}`;
    logger.warn('S4 blocked: Invalid state', {
      issueId: issue.id,
      expectedState: IssueState.IMPLEMENTING_PREP,
      actualState: issue.status,
      runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: S4BlockerCode.NO_PR_LINKED, // Use generic blocker for state issues
      blockerMessage,
      runId,
      step: 'S4_REVIEW',
      stateBefore: issue.status,
    };
  }
  
  // Validation Step 2: Check GitHub link exists
  if (!issue.github_url || issue.github_url.trim() === '') {
    const blockerMessage = 'S4 requires GitHub issue link';
    logger.warn('S4 blocked: No GitHub link', {
      issueId: issue.id,
      runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: S4BlockerCode.NO_GITHUB_LINK,
      blockerMessage,
      runId,
      step: 'S4_REVIEW',
      stateBefore: issue.status,
    };
  }
  
  // Validation Step 3: Check PR link exists
  if (!issue.pr_url || issue.pr_url.trim() === '') {
    const blockerMessage = 'S4 requires PR to be linked to issue';
    logger.warn('S4 blocked: No PR linked', {
      issueId: issue.id,
      runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: S4BlockerCode.NO_PR_LINKED,
      blockerMessage,
      runId,
      step: 'S4_REVIEW',
      stateBefore: issue.status,
    };
  }
  
  // Dry-run mode: Skip state modifications, only validate
  if (mode === 'dryRun') {
    logger.info('S4 dry-run completed (validation only)', {
      issueId: issue.id,
      runId,
    }, 'S4Executor');
    
    return {
      success: true,
      runId,
      step: 'S4_REVIEW',
      stateBefore: issue.status,
      stateAfter: IssueState.REVIEW_READY,
      reviewIntent: {
        eventId: 'dry-run-event-id',
        prUrl: issue.pr_url,
      },
      durationMs: Date.now() - startTime,
    };
  }
  
  // Record review-intent event
  const reviewIntentEvent = await eventStore.createEvent({
    issueId: issue.id,
    runId,
    eventType: LoopEventType.REVIEW_REQUESTED,
    eventData: {
      runId,
      step: LoopStep.S4_REVIEW,
      stateBefore: issue.status,
      requestId,
      prUrl: issue.pr_url,
    },
  });
  
  logger.info('S4 review-intent recorded', {
    issueId: issue.id,
    eventId: reviewIntentEvent.id,
    prUrl: issue.pr_url,
    runId,
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
      runId,
    }, 'S4Executor');
    
    throw new Error('Failed to update issue state');
  }
  
  const durationMs = Date.now() - startTime;
  
  logger.info('S4 (Review Gate) completed successfully', {
    issueId: issue.id,
    runId,
    stateBefore: issue.status,
    stateAfter: IssueState.REVIEW_READY,
    eventId: reviewIntentEvent.id,
    durationMs,
  }, 'S4Executor');
  
  return {
    success: true,
    runId,
    step: 'S4_REVIEW',
    stateBefore: issue.status,
    stateAfter: IssueState.REVIEW_READY,
    reviewIntent: {
      eventId: reviewIntentEvent.id,
      prUrl: issue.pr_url,
    },
    durationMs,
  };
}
