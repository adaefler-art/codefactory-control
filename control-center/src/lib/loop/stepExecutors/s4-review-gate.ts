/**
 * S4: Review Gate Step Executor (E9.3-CTRL-01 + E9.3-CTRL-03)
 * 
 * Implements the explicit review request gate for AFU-9 issues.
 * Ensures fail-closed semantics: no implicit entry into review state.
 * 
 * E9.3-CTRL-03: Integrates combined Review + Checks gate decision to ensure
 * both review approval and checks pass before allowing state transition.
 * 
 * Contract: docs/contracts/step-executor-s4.v1.md
 *           docs/contracts/s4-gate-decision.v1.md
 */

import { Pool } from 'pg';
import { IssueState, LoopStep, BlockerCode } from '../stateMachine';
import { getLoopEventStore, LoopEventType } from '../eventStore';
import { logger } from '@/lib/logger';
import type { StepContext, StepExecutionResult } from './s1-pick-issue';
import { captureSnapshotForPR } from '@/lib/github/checks-mirror-service';
import { makeS4GateDecision, S4BlockReason } from '../s4-gate-decision';

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
  // Gate decision blocker codes (E9.3-CTRL-03)
  GATE_DECISION_FAILED = 'GATE_DECISION_FAILED',
}

/**
 * Helper function to parse PR URL
 * Expected format: https://github.com/owner/repo/pull/123
 */
function parsePrUrl(prUrl: string): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
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

  // Validation Step 4: Parse PR URL
  const prInfo = parsePrUrl(issue.pr_url);
  if (!prInfo) {
    const blockerMessage = `S4 requires valid PR URL format, got: ${issue.pr_url}`;
    logger.warn('S4 blocked: Invalid PR URL', {
      issueId: issue.id,
      prUrl: issue.pr_url,
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
  
  // Dry-run mode: Skip state modifications and gate decision, only validate
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

  // Step 5: Capture checks snapshot (E9.3-CTRL-03)
  logger.info('Capturing checks snapshot for S4 gate decision', {
    issueId: issue.id,
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    runId: ctx.runId,
  }, 'S4Executor');

  const snapshotResult = await captureSnapshotForPR(
    pool,
    prInfo.owner,
    prInfo.repo,
    prInfo.prNumber,
    {
      run_id: ctx.runId,
      issue_id: issue.id,
      request_id: ctx.requestId,
    }
  );

  if (!snapshotResult.success || !snapshotResult.snapshot) {
    const blockerMessage = `Failed to capture checks snapshot: ${snapshotResult.error || 'Unknown error'}`;
    logger.error('S4 blocked: Snapshot capture failed', {
      issueId: issue.id,
      error: snapshotResult.error,
      runId: ctx.runId,
    }, 'S4Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: S4BlockerCode.GATE_DECISION_FAILED,
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: blockerMessage,
    };
  }

  logger.info('Checks snapshot captured', {
    issueId: issue.id,
    snapshotId: snapshotResult.snapshot.id,
    totalChecks: snapshotResult.snapshot.total_checks,
    failedChecks: snapshotResult.snapshot.failed_checks,
    pendingChecks: snapshotResult.snapshot.pending_checks,
    runId: ctx.runId,
  }, 'S4Executor');

  // Step 6: Make S4 gate decision (Review + Checks) (E9.3-CTRL-03)
  logger.info('Making S4 gate decision (Review + Checks)', {
    issueId: issue.id,
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    snapshotId: snapshotResult.snapshot.id,
    runId: ctx.runId,
  }, 'S4Executor');

  const gateDecision = await makeS4GateDecision(pool, {
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    snapshotId: snapshotResult.snapshot.id,
    requestId: ctx.requestId,
  });

  logger.info('S4 gate decision made', {
    issueId: issue.id,
    verdict: gateDecision.verdict,
    blockReason: gateDecision.blockReason,
    reviewStatus: gateDecision.reviewStatus,
    checksStatus: gateDecision.checksStatus,
    runId: ctx.runId,
  }, 'S4Executor');

  // Step 7: Check gate decision verdict
  if (gateDecision.verdict === 'FAIL') {
    const blockerMessage = gateDecision.blockMessage || 'S4 gate decision failed';
    
    logger.warn('S4 blocked: Gate decision FAIL', {
      issueId: issue.id,
      blockReason: gateDecision.blockReason,
      blockMessage: blockerMessage,
      reviewStatus: gateDecision.reviewStatus,
      checksStatus: gateDecision.checksStatus,
      runId: ctx.runId,
    }, 'S4Executor');

    // Record blocked event
    await eventStore.createEvent({
      issueId: issue.id,
      runId: ctx.runId,
      eventType: 'loop_run_blocked' as LoopEventType,
      eventData: {
        runId: ctx.runId,
        step: LoopStep.S4_REVIEW,
        stateBefore: issue.status,
        requestId: ctx.requestId,
        gateDecision: {
          blockReason: gateDecision.blockReason,
          blockMessage: blockerMessage,
          reviewStatus: gateDecision.reviewStatus,
          checksStatus: gateDecision.checksStatus,
          snapshotId: snapshotResult.snapshot.id,
        },
      } as any, // eventData allows extra properties for context
    });
    
    return {
      success: false,
      blocked: true,
      blockerCode: (BlockerCode as any)[gateDecision.blockReason || 'GATE_DECISION_FAILED'],
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: blockerMessage,
    };
  }
  
  // Step 8: Record review-intent event (gate decision passed)
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
      gateDecision: {
        verdict: gateDecision.verdict,
        reviewStatus: gateDecision.reviewStatus,
        checksStatus: gateDecision.checksStatus,
        snapshotId: snapshotResult.snapshot.id,
      },
    } as any, // eventData allows extra properties for context
  });
  
  logger.info('S4 review-intent recorded with gate decision', {
    issueId: issue.id,
    eventId: reviewIntentEvent.id,
    prUrl: issue.pr_url,
    gateDecisionVerdict: gateDecision.verdict,
    runId: ctx.runId,
  }, 'S4Executor');
  
  // Step 9: Transition state to REVIEW_READY (gate decision passed)
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
    gateDecisionVerdict: gateDecision.verdict,
    reviewStatus: gateDecision.reviewStatus,
    checksStatus: gateDecision.checksStatus,
    durationMs,
  }, 'S4Executor');
  
  return {
    success: true,
    blocked: false,
    stateBefore,
    stateAfter: IssueState.REVIEW_READY,
    fieldsChanged: ['status'],
    message: `S4 completed: Gate decision PASS (review: ${gateDecision.reviewStatus}, checks: ${gateDecision.checksStatus}), transitioned to REVIEW_READY (event ${reviewIntentEvent.id})`,
  };
}
