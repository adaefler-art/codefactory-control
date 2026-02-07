/**
 * S5: Merge Step Executor (E9.3-CTRL-04)
 * 
 * Implements controlled merge for AFU-9 issues with gate verdict validation.
 * Ensures fail-closed semantics: merge only when gate verdict is PASS.
 * 
 * Contract: docs/contracts/step-executor-s5.v1.md
 */

import { Pool } from 'pg';
import { IssueState, LoopStep, BlockerCode } from '../stateMachine';
import { getLoopEventStore, LoopEventType } from '../eventStore';
import { logger } from '@/lib/logger';
import type { StepContext, StepExecutionResult } from './s1-pick-issue';
import { captureSnapshotForPR } from '@/lib/github/checks-mirror-service';
import { makeS4GateDecision } from '../s4-gate-decision';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { applyMergeToWorkflow } from '../applyMergeToWorkflow';

// Re-export types for convenience
export type { StepContext, StepExecutionResult };

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
 * Execute S5 (Merge) step
 * 
 * Validates gate verdict, executes merge idempotently, and transitions state to DONE.
 * 
 * Implements fail-closed semantics:
 * - Blocks if gate verdict is FAIL
 * - Blocks if PR not found or already closed
 * - Idempotent: Returns success if PR already merged
 * 
 * @param pool - PostgreSQL connection pool
 * @param ctx - Execution context
 * @returns S5 execution result
 */
export async function executeS5(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult> {
  const startTime = Date.now();
  
  const eventStore = getLoopEventStore(pool);
  
  logger.info('Executing S5 (Merge)', {
    issueId: ctx.issueId,
    runId: ctx.runId,
    requestId: ctx.requestId,
    mode: ctx.mode,
  }, 'S5Executor');
  
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
  if (issue.status !== IssueState.REVIEW_READY) {
    const message = `Cannot execute S5: Issue is in state ${issue.status}, expected REVIEW_READY`;
    logger.warn('S5 blocked: Invalid state', {
      issueId: issue.id,
      currentState: issue.status,
      expectedState: IssueState.REVIEW_READY,
      runId: ctx.runId,
    }, 'S5Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.INVARIANT_VIOLATION,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  // Validation Step 2: Check PR is linked
  if (!issue.pr_url || issue.pr_url.trim() === '') {
    const message = 'Cannot execute S5: No PR linked to issue';
    logger.warn('S5 blocked: No PR linked', {
      issueId: issue.id,
      runId: ctx.runId,
    }, 'S5Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_PR_LINKED,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  // Parse PR URL
  const prInfo = parsePrUrl(issue.pr_url);
  if (!prInfo) {
    const message = `Cannot execute S5: Invalid PR URL format: ${issue.pr_url}`;
    logger.warn('S5 blocked: Invalid PR URL', {
      issueId: issue.id,
      prUrl: issue.pr_url,
      runId: ctx.runId,
    }, 'S5Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.NO_PR_LINKED,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  logger.info('Parsed PR info', {
    issueId: issue.id,
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    runId: ctx.runId,
  }, 'S5Executor');
  
  // Step 3: Create authenticated GitHub client
  const octokit = await createAuthenticatedClient({
    owner: prInfo.owner,
    repo: prInfo.repo,
  });
  
  // Step 4: Get PR details and check state
  logger.info('Fetching PR details', {
    issueId: issue.id,
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    runId: ctx.runId,
  }, 'S5Executor');
  
  let prDetails;
  try {
    const prResponse = await octokit.rest.pulls.get({
      owner: prInfo.owner,
      repo: prInfo.repo,
      pull_number: prInfo.prNumber,
    });
    prDetails = prResponse.data;
  } catch (error) {
    const message = `Failed to fetch PR: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('S5 blocked: PR fetch failed', {
      issueId: issue.id,
      owner: prInfo.owner,
      repo: prInfo.repo,
      prNumber: prInfo.prNumber,
      error: error instanceof Error ? error.message : String(error),
      runId: ctx.runId,
    }, 'S5Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.PR_NOT_FOUND,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  // Idempotency check: If PR already merged, return success
  if (prDetails.merged) {
    const message = 'PR already merged (idempotent success)';
    logger.info('S5 idempotent: PR already merged', {
      issueId: issue.id,
      prNumber: prInfo.prNumber,
      mergeSha: prDetails.merge_commit_sha,
      runId: ctx.runId,
    }, 'S5Executor');
    
    // Record idempotent merge event
    await eventStore.createEvent({
      issueId: issue.id,
      runId: ctx.runId,
      eventType: LoopEventType.MERGED,
      eventData: {
        runId: ctx.runId,
        step: LoopStep.S5_MERGE,
        stateBefore: issue.status,
        stateAfter: IssueState.DONE,
        requestId: ctx.requestId,
        prUrl: issue.pr_url,
        mergeSha: prDetails.merge_commit_sha,
        mergeMethod: 'unknown',
        idempotent: true,
      } as Record<string, unknown>,
    });

    const meshResult = await applyMergeToWorkflow({
      pool,
      issueId: issue.id,
      repository: { owner: prInfo.owner, repo: prInfo.repo },
      prNumber: prInfo.prNumber,
      prUrl: issue.pr_url,
      mergeSha: prDetails.merge_commit_sha,
      mergedAt: prDetails.merged_at || new Date().toISOString(),
      requestId: ctx.requestId,
      source: 'executor',
    });

    if (!meshResult.ok) {
      return {
        success: false,
        blocked: true,
        blockerCode: BlockerCode.MESH_UPDATE_FAILED,
        blockerMessage: meshResult.message,
        stateBefore,
        stateAfter: stateBefore,
        fieldsChanged: [],
        message: meshResult.message,
      };
    }
    
    const durationMs = Date.now() - startTime;
    return {
      success: true,
      blocked: false,
      stateBefore,
      stateAfter: IssueState.DONE,
      fieldsChanged: ['status'],
      message,
      durationMs,
    };
  }
  
  // Check if PR is closed without merge
  if (prDetails.state === 'closed' && !prDetails.merged) {
    const message = 'Cannot execute S5: PR is closed without merge';
    logger.warn('S5 blocked: PR closed', {
      issueId: issue.id,
      prNumber: prInfo.prNumber,
      runId: ctx.runId,
    }, 'S5Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.PR_CLOSED,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  // Step 5: Capture checks snapshot for gate decision
  logger.info('Capturing checks snapshot for S5 gate decision', {
    issueId: issue.id,
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    runId: ctx.runId,
  }, 'S5Executor');

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
    logger.error('S5 blocked: Snapshot capture failed', {
      issueId: issue.id,
      error: snapshotResult.error,
      runId: ctx.runId,
    }, 'S5Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.SNAPSHOT_FETCH_FAILED,
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
  }, 'S5Executor');

  // Step 6: Make gate decision (Review + Checks)
  logger.info('Making S5 gate decision (Review + Checks)', {
    issueId: issue.id,
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    snapshotId: snapshotResult.snapshot.id,
    runId: ctx.runId,
  }, 'S5Executor');

  const gateDecision = await makeS4GateDecision(pool, {
    owner: prInfo.owner,
    repo: prInfo.repo,
    prNumber: prInfo.prNumber,
    snapshotId: snapshotResult.snapshot.id,
    requestId: ctx.requestId,
  });

  logger.info('S5 gate decision made', {
    issueId: issue.id,
    verdict: gateDecision.verdict,
    blockReason: gateDecision.blockReason,
    reviewStatus: gateDecision.reviewStatus,
    checksStatus: gateDecision.checksStatus,
    runId: ctx.runId,
  }, 'S5Executor');

  // Step 7: Check gate decision verdict
  if (gateDecision.verdict === 'FAIL') {
    const blockerMessage = gateDecision.blockMessage || 'S5 gate decision failed - merge blocked';
    
    logger.warn('S5 blocked: Gate decision FAIL', {
      issueId: issue.id,
      blockReason: gateDecision.blockReason,
      blockMessage: blockerMessage,
      reviewStatus: gateDecision.reviewStatus,
      checksStatus: gateDecision.checksStatus,
      runId: ctx.runId,
    }, 'S5Executor');

    // Record blocked event
    await eventStore.createEvent({
      issueId: issue.id,
      runId: ctx.runId,
      eventType: 'loop_run_blocked' as LoopEventType,
      eventData: {
        runId: ctx.runId,
        step: LoopStep.S5_MERGE,
        stateBefore: issue.status,
        requestId: ctx.requestId,
        gateDecision: {
          verdict: 'FAIL',
          blockReason: gateDecision.blockReason,
          blockMessage: blockerMessage,
          reviewStatus: gateDecision.reviewStatus,
          checksStatus: gateDecision.checksStatus,
          snapshotId: snapshotResult.snapshot.id,
        },
      } as Record<string, unknown>,
    });

    // Map gate decision block reason to BlockerCode enum
    const blockerCode = gateDecision.blockReason && BlockerCode[gateDecision.blockReason as keyof typeof BlockerCode]
      ? BlockerCode[gateDecision.blockReason as keyof typeof BlockerCode]
      : BlockerCode.GATE_DECISION_FAILED;
    
    return {
      success: false,
      blocked: true,
      blockerCode,
      blockerMessage,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: blockerMessage,
    };
  }
  
  // Step 8: Execute merge (dry-run or execute mode)
  let mergeSha: string | undefined;
  let mergeMethod = 'squash'; // Default merge method
  
  if (ctx.mode === 'execute') {
    logger.info('Executing merge (PASS verdict)', {
      issueId: issue.id,
      owner: prInfo.owner,
      repo: prInfo.repo,
      prNumber: prInfo.prNumber,
      runId: ctx.runId,
    }, 'S5Executor');
    
    try {
      const mergeResult = await octokit.rest.pulls.merge({
        owner: prInfo.owner,
        repo: prInfo.repo,
        pull_number: prInfo.prNumber,
        merge_method: mergeMethod as 'merge' | 'squash' | 'rebase',
      });
      
      mergeSha = mergeResult.data.sha;
      
      logger.info('Successfully merged PR', {
        issueId: issue.id,
        prNumber: prInfo.prNumber,
        mergeSha,
        mergeMethod,
        runId: ctx.runId,
      }, 'S5Executor');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const message = `Merge failed: ${errorMessage}`;
      
      logger.error('S5 blocked: Merge failed', {
        issueId: issue.id,
        prNumber: prInfo.prNumber,
        error: errorMessage,
        runId: ctx.runId,
      }, 'S5Executor');
      
      // Determine blocker code from error
      const blockerCode = errorMessage.toLowerCase().includes('conflict')
        ? BlockerCode.MERGE_CONFLICT
        : BlockerCode.MERGE_FAILED;
      
      return {
        success: false,
        blocked: true,
        blockerCode,
        blockerMessage: message,
        stateBefore,
        stateAfter: stateBefore,
        fieldsChanged: [],
        message,
      };
    }
  } else {
    // Dry-run mode - simulate merge
    mergeSha = 'dry-run-sha';
    logger.info('S5 dry-run: Would merge PR', {
      issueId: issue.id,
      prNumber: prInfo.prNumber,
      runId: ctx.runId,
    }, 'S5Executor');
  }
  
  // Step 9: Record merge event
  const mergeEvent = await eventStore.createEvent({
    issueId: issue.id,
    runId: ctx.runId,
    eventType: LoopEventType.MERGED,
    eventData: {
      runId: ctx.runId,
      step: LoopStep.S5_MERGE,
      stateBefore: issue.status,
      stateAfter: IssueState.DONE,
      requestId: ctx.requestId,
      prUrl: issue.pr_url,
      mergeSha,
      mergeMethod,
      gateDecision: {
        verdict: gateDecision.verdict,
        reviewStatus: gateDecision.reviewStatus,
        checksStatus: gateDecision.checksStatus,
        snapshotId: snapshotResult.snapshot.id,
      },
      mode: ctx.mode,
    } as Record<string, unknown>,
  });
  
  logger.info('S5 merge recorded', {
    issueId: issue.id,
    eventId: mergeEvent.id,
    mergeSha,
    runId: ctx.runId,
  }, 'S5Executor');
  
  // Step 10: Update issue state to DONE
  const stateAfter = IssueState.DONE;

  if (ctx.mode === 'execute') {
    const meshResult = await applyMergeToWorkflow({
      pool,
      issueId: issue.id,
      repository: { owner: prInfo.owner, repo: prInfo.repo },
      prNumber: prInfo.prNumber,
      prUrl: issue.pr_url,
      mergeSha,
      mergedAt: new Date().toISOString(),
      requestId: ctx.requestId,
      source: 'executor',
    });

    if (!meshResult.ok) {
      return {
        success: false,
        blocked: true,
        blockerCode: BlockerCode.MESH_UPDATE_FAILED,
        blockerMessage: meshResult.message,
        stateBefore,
        stateAfter: stateBefore,
        fieldsChanged: [],
        message: meshResult.message,
      };
    }

    logger.info('S5 state transitioned', {
      issueId: issue.id,
      stateBefore,
      stateAfter,
      runId: ctx.runId,
    }, 'S5Executor');
  }
  
  const durationMs = Date.now() - startTime;
  const message = `S5 completed: PR merged successfully (SHA: ${mergeSha})`;
  
  logger.info('S5 execution completed', {
    issueId: issue.id,
    stateBefore,
    stateAfter,
    mergeSha,
    durationMs,
    runId: ctx.runId,
  }, 'S5Executor');
  
  return {
    success: true,
    blocked: false,
    stateBefore,
    stateAfter,
    fieldsChanged: ['status'],
    message,
    durationMs,
  };
}
