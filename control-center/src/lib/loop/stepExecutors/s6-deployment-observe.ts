/**
 * S6: Deployment Observation Step Executor (E9.3-CTRL-05)
 * 
 * Implements read-only observation of GitHub deployments for AFU-9 issues.
 * Executes after successful merge (S5) to capture deployment information.
 * 
 * Contract: docs/contracts/step-executor-s6.v1.md
 */

import { Pool } from 'pg';
import { IssueState, LoopStep, BlockerCode } from '../stateMachine';
import { getLoopEventStore, LoopEventType } from '../eventStore';
import { logger } from '@/lib/logger';
import type { StepContext, StepExecutionResult } from './s1-pick-issue';
import { observeDeployments } from '@/lib/github/deployment-observer';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';

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
 * Execute S6 (Deployment Observation) step
 * 
 * Observes GitHub deployments for the merged PR commit.
 * Read-only operation that captures deployment metadata.
 * 
 * Implements read-only semantics:
 * - No deployment triggers
 * - No deployment modifications
 * - Pure observation only
 * 
 * @param pool - PostgreSQL connection pool
 * @param ctx - Execution context
 * @returns S6 execution result
 */
export async function executeS6(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult> {
  const startTime = Date.now();
  
  const eventStore = getLoopEventStore(pool);
  
  logger.info('Executing S6 (Deployment Observation)', {
    issueId: ctx.issueId,
    runId: ctx.runId,
    requestId: ctx.requestId,
    mode: ctx.mode,
  }, 'S6Executor');
  
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
  if (issue.status !== IssueState.DONE) {
    const message = `Cannot execute S6: Issue is in state ${issue.status}, expected DONE`;
    logger.warn('S6 blocked: Invalid state', {
      issueId: issue.id,
      currentState: issue.status,
      expectedState: IssueState.DONE,
      runId: ctx.runId,
    }, 'S6Executor');
    
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
  
  // Validation Step 2: Check PR URL exists
  if (!issue.pr_url) {
    const message = 'Cannot execute S6: Issue has no PR URL';
    logger.warn('S6 blocked: No PR URL', {
      issueId: issue.id,
      runId: ctx.runId,
    }, 'S6Executor');
    
    // Log blocked event
    await eventStore.createEvent({
      issueId: issue.id,
      runId: ctx.runId,
      eventType: LoopEventType.RUN_BLOCKED,
      eventData: {
        runId: ctx.runId,
        step: LoopStep.S6_DEPLOYMENT_OBSERVE,
        stateBefore,
        stateAfter: stateBefore,
        blockerCode: BlockerCode.NO_PR_LINKED,
        requestId: ctx.requestId,
      },
    });
    
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
  const prParsed = parsePrUrl(issue.pr_url);
  if (!prParsed) {
    const message = `Invalid PR URL format: ${issue.pr_url}`;
    logger.error('S6 blocked: Invalid PR URL', {
      issueId: issue.id,
      prUrl: issue.pr_url,
      runId: ctx.runId,
    }, 'S6Executor');
    
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
  
  const { owner, repo, prNumber } = prParsed;
  
  // Get GitHub client
  const octokit = await createAuthenticatedClient();
  
  // Validation Step 3: Get PR details to verify merge
  let mergeSha: string;
  try {
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    
    if (!pr.merged) {
      const message = 'PR is not merged yet';
      logger.warn('S6 blocked: PR not merged', {
        issueId: issue.id,
        prUrl: issue.pr_url,
        runId: ctx.runId,
      }, 'S6Executor');
      
      // Log blocked event
      await eventStore.createEvent({
        issueId: issue.id,
        runId: ctx.runId,
        eventType: LoopEventType.RUN_BLOCKED,
        eventData: {
          runId: ctx.runId,
          step: LoopStep.S6_DEPLOYMENT_OBSERVE,
          stateBefore,
          stateAfter: stateBefore,
          blockerCode: BlockerCode.PR_NOT_MERGED,
          requestId: ctx.requestId,
        },
      });
      
      return {
        success: false,
        blocked: true,
        blockerCode: BlockerCode.PR_NOT_MERGED,
        blockerMessage: message,
        stateBefore,
        stateAfter: stateBefore,
        fieldsChanged: [],
        message,
      };
    }
    
    if (!pr.merge_commit_sha) {
      const message = 'PR has no merge commit SHA';
      logger.error('S6 blocked: No merge SHA', {
        issueId: issue.id,
        prUrl: issue.pr_url,
        runId: ctx.runId,
      }, 'S6Executor');
      
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
    
    mergeSha = pr.merge_commit_sha;
  } catch (error) {
    const message = `Failed to fetch PR: ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.error('S6 blocked: GitHub API error', {
      issueId: issue.id,
      prUrl: issue.pr_url,
      error: error instanceof Error ? error.message : String(error),
      runId: ctx.runId,
    }, 'S6Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.GITHUB_API_ERROR,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  // Dry run mode: Skip actual observation
  if (ctx.mode === 'dryRun') {
    logger.info('S6 dry run: Skipping deployment observation', {
      issueId: issue.id,
      mergeSha,
      runId: ctx.runId,
    }, 'S6Executor');
    
    return {
      success: true,
      blocked: false,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message: 'S6 dry run: Would observe deployments',
    };
  }
  
  // Execute deployment observation
  logger.info('S6: Observing deployments', {
    issueId: issue.id,
    owner,
    repo,
    mergeSha,
    runId: ctx.runId,
  }, 'S6Executor');
  
  const observationResult = await observeDeployments({
    pool,
    octokit,
    issueId: issue.id,
    owner,
    repo,
    sha: mergeSha,
  });
  
  if (!observationResult.success) {
    const message = `Failed to observe deployments: ${observationResult.error || 'Unknown error'}`;
    logger.error('S6 failed: Deployment observation error', {
      issueId: issue.id,
      error: observationResult.error,
      runId: ctx.runId,
    }, 'S6Executor');
    
    return {
      success: false,
      blocked: true,
      blockerCode: BlockerCode.GITHUB_API_ERROR,
      blockerMessage: message,
      stateBefore,
      stateAfter: stateBefore,
      fieldsChanged: [],
      message,
    };
  }
  
  // Log deployment observation event
  const event = await eventStore.createEvent({
    issueId: issue.id,
    runId: ctx.runId,
    eventType: LoopEventType.DEPLOYMENT_OBSERVED,
    eventData: {
      runId: ctx.runId,
      step: LoopStep.S6_DEPLOYMENT_OBSERVE,
      stateBefore,
      stateAfter: stateBefore,
      requestId: ctx.requestId,
    },
  });
  
  const durationMs = Date.now() - startTime;
  
  logger.info('S6 completed successfully', {
    issueId: issue.id,
    deploymentsFound: observationResult.deploymentsFound,
    durationMs,
    runId: ctx.runId,
  }, 'S6Executor');
  
  const message = observationResult.deploymentsFound === 0
    ? 'S6 complete: No deployments found'
    : `S6 complete: Observed ${observationResult.deploymentsFound} deployment(s)`;
  
  return {
    success: true,
    blocked: false,
    stateBefore,
    stateAfter: stateBefore,  // S6 does not change state
    fieldsChanged: [],
    message,
    eventId: event?.id,
  };
}
