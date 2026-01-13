/**
 * Job Rerun Service (E84.3 + E84.4)
 * 
 * Service for rerunning failed GitHub workflow jobs with bounded retry policy,
 * idempotent attempt tracking, and comprehensive audit trail.
 * 
 * E84.4 Integration: Calls stop decision service before triggering reruns
 * to prevent infinite loops via lawbook-gated HOLD rules.
 * 
 * Reference: E84.3 - Tool: rerun_failed_jobs (bounded retry + audit)
 *           E84.4 - Stop Conditions + HOLD Rules
 */

import { Pool } from 'pg';
import { getPool } from '../db';
import { createAuthenticatedClient } from './auth-wrapper';
import { withRetry, DEFAULT_RETRY_CONFIG } from './retry-policy';
import { makeStopDecision } from './stop-decision-service';
import { logger } from '../logger';
import {
  JobRerunInput,
  RerunResultV1,
  RerunDecision,
  JobRerunStatus,
  JobRerunAttemptRecord,
  JobRerunAttemptCount,
} from '../types/job-rerun';
import { StopDecisionContext } from '../types/stop-decision';

/**
 * Get lawbook hash from environment or use default
 */
function getLawbookHash(): string {
  return process.env.LAWBOOK_HASH || 'v1.0.0-dev';
}

/**
 * Get deployment environment
 */
function getDeploymentEnv(): 'staging' | 'prod' {
  const env = process.env.DEPLOY_ENV;
  if (env === 'prod' || env === 'production') {
    return 'prod';
  }
  return 'staging';
}

/**
 * Classify failure to determine if it's eligible for rerun
 * 
 * Returns failure class: 'flaky probable', 'infra transient', or null (not eligible)
 */
function classifyFailureForRerun(conclusion: string | null, jobName: string): string | null {
  if (!conclusion) {
    return null;
  }

  // Transient infrastructure failures
  const infraTransientPatterns = [
    /timeout/i,
    /timed_out/i,
    /network/i,
    /connection/i,
    /rate.?limit/i,
    /503/,
    /502/,
    /500/,
  ];

  // Flaky test patterns
  const flakyPatterns = [
    /flaky/i,
    /intermittent/i,
    /random/i,
    /race.?condition/i,
  ];

  const conclusionLower = conclusion.toLowerCase();
  const jobNameLower = jobName.toLowerCase();

  for (const pattern of infraTransientPatterns) {
    if (pattern.test(conclusionLower) || pattern.test(jobNameLower)) {
      return 'infra transient';
    }
  }

  for (const pattern of flakyPatterns) {
    if (pattern.test(conclusionLower) || pattern.test(jobNameLower)) {
      return 'flaky probable';
    }
  }

  // Special case: if conclusion is 'timed_out', classify as infra transient
  if (conclusion === 'timed_out') {
    return 'infra transient';
  }

  // Default: not eligible for automatic rerun
  return null;
}

/**
 * Get current attempt count for a job
 */
async function getAttemptCount(
  pool: Pool,
  owner: string,
  repo: string,
  prNumber: number,
  runId: number,
  jobName: string
): Promise<number> {
  const result = await pool.query<{ total_attempts: string }>(
    `SELECT COUNT(*) as total_attempts
     FROM job_rerun_attempts
     WHERE resource_owner = $1 
       AND resource_repo = $2 
       AND pr_number = $3 
       AND workflow_run_id = $4 
       AND job_name = $5`,
    [owner, repo, prNumber, runId, jobName]
  );

  return parseInt(result.rows[0]?.total_attempts || '0', 10);
}

/**
 * Get total attempt count for all jobs in a PR
 */
async function getTotalPrAttemptCount(
  pool: Pool,
  owner: string,
  repo: string,
  prNumber: number
): Promise<number> {
  const result = await pool.query<{ total_attempts: string }>(
    `SELECT COUNT(*) as total_attempts
     FROM job_rerun_attempts
     WHERE resource_owner = $1 
       AND resource_repo = $2 
       AND pr_number = $3`,
    [owner, repo, prNumber]
  );

  return parseInt(result.rows[0]?.total_attempts || '0', 10);
}

/**
 * Record a rerun attempt in the database
 */
async function recordRerunAttempt(
  pool: Pool,
  input: {
    owner: string;
    repo: string;
    prNumber: number;
    runId: number;
    jobName: string;
    attemptNumber: number;
    requestId: string;
    decision: RerunDecision;
    reasonCode: string | null;
    reasons: string[];
    priorConclusion: string | null;
    failureClass: string | null;
    lawbookHash: string;
    maxAttemptsLimit: number;
    githubResponse?: Record<string, unknown>;
    githubError?: string;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO job_rerun_attempts (
      resource_owner, resource_repo, pr_number, workflow_run_id, job_name,
      attempt_number, request_id, decision, reason_code, reasons,
      prior_conclusion, failure_class, lawbook_hash, max_attempts_limit,
      github_response, github_error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      input.owner,
      input.repo,
      input.prNumber,
      input.runId,
      input.jobName,
      input.attemptNumber,
      input.requestId,
      input.decision,
      input.reasonCode,
      JSON.stringify(input.reasons),
      input.priorConclusion,
      input.failureClass,
      input.lawbookHash,
      input.maxAttemptsLimit,
      input.githubResponse ? JSON.stringify(input.githubResponse) : null,
      input.githubError || null,
    ]
  );
}

/**
 * Record audit event in workflow_action_audit table
 */
async function recordAuditEvent(
  pool: Pool,
  input: {
    owner: string;
    repo: string;
    prNumber: number;
    runId?: number;
    decision: RerunDecision;
    reasons: string[];
    jobs: JobRerunStatus[];
    requestId: string;
    initiatedBy?: string;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO workflow_action_audit (
      action_type, action_status, resource_type, resource_owner, resource_repo,
      resource_number, initiated_by, action_params, action_result
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      'rerun_checks',
      input.decision === 'RERUN_TRIGGERED' ? 'completed' : 'failed',
      'pull_request',
      input.owner,
      input.repo,
      input.prNumber,
      input.initiatedBy || 'system',
      JSON.stringify({
        runId: input.runId,
        requestId: input.requestId,
      }),
      JSON.stringify({
        decision: input.decision,
        reasons: input.reasons,
        jobs: input.jobs,
      }),
    ]
  );
}

/**
 * Main service: Rerun failed jobs with bounded retry policy
 */
export async function rerunFailedJobs(
  input: JobRerunInput,
  pool?: Pool
): Promise<RerunResultV1> {
  const db = pool || getPool();
  const requestId = input.requestId || `rerun-${Date.now()}`;
  const lawbookHash = getLawbookHash();
  const deploymentEnv = getDeploymentEnv();

  logger.info('Starting job rerun', {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    runId: input.runId,
    mode: input.mode,
    maxAttempts: input.maxAttempts,
    requestId,
  }, 'JobRerunService');

  try {
    // Create authenticated GitHub client
    const octokit = await createAuthenticatedClient({
      owner: input.owner,
      repo: input.repo,
    });

    // Get PR details to find head SHA
    const pr = await octokit.rest.pulls.get({
      owner: input.owner,
      repo: input.repo,
      pull_number: input.prNumber,
    });

    const headSha = pr.data.head.sha;

    // Get check runs for the PR (with pagination support)
    const allCheckRuns: any[] = [];
    let page = 1;
    const perPage = 100;
    
    while (true) {
      const checkRuns = await octokit.rest.checks.listForRef({
        owner: input.owner,
        repo: input.repo,
        ref: headSha,
        per_page: perPage,
        page,
      });
      
      allCheckRuns.push(...checkRuns.data.check_runs);
      
      // Stop if we've fetched all checks or reached a reasonable limit (500)
      if (checkRuns.data.check_runs.length < perPage || allCheckRuns.length >= 500) {
        break;
      }
      page++;
    }

    // Filter to jobs that need rerun
    const jobStatuses: JobRerunStatus[] = [];
    const reasons: string[] = [];
    let rerunCount = 0;
    let blockedCount = 0;
    let skipCount = 0;
    
    // If no runId provided, we need to get it from the workflow runs for the PR
    let effectiveRunId = input.runId;
    if (!effectiveRunId && allCheckRuns.length > 0) {
      // Get workflow runs for the PR to find the run ID
      try {
        const workflowRuns = await octokit.rest.actions.listWorkflowRunsForRepo({
          owner: input.owner,
          repo: input.repo,
          event: 'pull_request',
          per_page: 10,
        });
        
        // Find the most recent run for this PR
        const prRun = workflowRuns.data.workflow_runs.find(
          (run) => run.pull_requests.some((p) => p.number === input.prNumber)
        );
        
        if (prRun) {
          effectiveRunId = prRun.id;
          logger.info('Found workflow run ID from PR', { 
            runId: effectiveRunId, 
            prNumber: input.prNumber 
          }, 'JobRerunService');
        }
      } catch (error) {
        logger.warn('Failed to find workflow run ID', error as Error, {}, 'JobRerunService');
      }
    }

    // E84.4: Check stop conditions before processing reruns
    // Get total PR attempt count for stop decision
    const totalPrAttempts = await getTotalPrAttemptCount(db, input.owner, input.repo, input.prNumber);
    
    // For stop decision, we need to check the highest job attempt count
    // to determine if we should proceed
    let maxJobAttempts = 0;
    if (effectiveRunId) {
      for (const check of allCheckRuns) {
        if (check.conclusion === 'failure' || check.conclusion === 'timed_out') {
          const attempts = await getAttemptCount(
            db,
            input.owner,
            input.repo,
            input.prNumber,
            effectiveRunId,
            check.name
          );
          maxJobAttempts = Math.max(maxJobAttempts, attempts);
        }
      }
    }

    // Evaluate stop decision
    const stopContext: StopDecisionContext = {
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      runId: effectiveRunId,
      attemptCounts: {
        currentJobAttempts: maxJobAttempts,
        totalPrAttempts,
      },
      requestId,
    };

    const stopDecision = await makeStopDecision(stopContext, db);

    // If stop decision is HOLD or KILL, block the rerun
    if (stopDecision.decision === 'HOLD' || stopDecision.decision === 'KILL') {
      logger.warn('Stop decision blocked rerun', {
        decision: stopDecision.decision,
        reasonCode: stopDecision.reasonCode,
        requestId,
      }, 'JobRerunService');

      // Record audit event for blocked rerun
      await recordAuditEvent(db, {
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        runId: effectiveRunId,
        decision: 'BLOCKED',
        reasons: [
          `Blocked by stop decision: ${stopDecision.decision}`,
          ...stopDecision.reasons,
        ],
        jobs: [],
        requestId,
      });

      return {
        schemaVersion: '1.0',
        requestId,
        lawbookHash,
        deploymentEnv,
        target: {
          prNumber: input.prNumber,
          runId: effectiveRunId,
        },
        decision: 'BLOCKED',
        reasons: [
          `Stop decision: ${stopDecision.decision} (${stopDecision.reasonCode})`,
          ...stopDecision.reasons,
        ],
        jobs: [],
        metadata: {
          totalJobs: 0,
          rerunJobs: 0,
          blockedJobs: 0,
          skippedJobs: 0,
        },
      };
    }

    logger.info('Stop decision: CONTINUE - proceeding with rerun evaluation', {
      requestId,
      totalPrAttempts,
      maxJobAttempts,
    }, 'JobRerunService');

    for (const check of allCheckRuns) {
      const conclusion = check.conclusion;
      const jobName = check.name;
      const jobId = check.id;
      
      // Use effective run ID (from input or discovered)
      // If still not found, skip this check
      if (!effectiveRunId) {
        logger.warn('No workflow run ID available, cannot process check', { 
          jobName, 
          checkId: check.id,
        }, 'JobRerunService');
        skipCount++;
        jobStatuses.push({
          jobName,
          jobId,
          priorConclusion: conclusion,
          action: 'SKIP',
          attemptNumber: 0,
          reasonCode: 'no_run_id',
        });
        continue;
      }
      const runId = effectiveRunId;

      // Skip if not failed (unless mode is ALL_JOBS)
      if (input.mode === 'FAILED_ONLY' && conclusion !== 'failure' && conclusion !== 'timed_out') {
        jobStatuses.push({
          jobName,
          jobId,
          priorConclusion: conclusion,
          action: 'SKIP',
          attemptNumber: 0,
          reasonCode: 'not_failed',
        });
        skipCount++;
        continue;
      }

      // Classify failure
      const failureClass = classifyFailureForRerun(conclusion, jobName);
      
      // Check if eligible for rerun based on failure class
      if (!failureClass) {
        jobStatuses.push({
          jobName,
          jobId,
          priorConclusion: conclusion,
          action: 'SKIP',
          attemptNumber: 0,
          reasonCode: 'not_eligible',
        });
        skipCount++;
        reasons.push(`Job '${jobName}' not eligible for rerun (failure class: deterministic)`);
        continue;
      }

      // Get current attempt count
      const currentAttempts = await getAttemptCount(db, input.owner, input.repo, input.prNumber, runId, jobName);
      const nextAttemptNumber = currentAttempts + 1;

      // Check if max attempts exceeded
      if (currentAttempts >= input.maxAttempts) {
        jobStatuses.push({
          jobName,
          jobId,
          priorConclusion: conclusion,
          action: 'BLOCKED',
          attemptNumber: nextAttemptNumber,
          reasonCode: 'max_attempts_exceeded',
        });
        blockedCount++;
        reasons.push(`Job '${jobName}' blocked: max attempts (${input.maxAttempts}) exceeded`);
        
        // Record blocked attempt
        await recordRerunAttempt(db, {
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          runId,
          jobName,
          attemptNumber: nextAttemptNumber,
          requestId,
          decision: 'BLOCKED',
          reasonCode: 'max_attempts_exceeded',
          reasons: ['Max attempts exceeded'],
          priorConclusion: conclusion,
          failureClass,
          lawbookHash,
          maxAttemptsLimit: input.maxAttempts,
        });
        continue;
      }

      // Eligible for rerun
      jobStatuses.push({
        jobName,
        jobId,
        priorConclusion: conclusion,
        action: 'RERUN',
        attemptNumber: nextAttemptNumber,
        reasonCode: failureClass.replace(' ', '_'),
      });
      rerunCount++;

      // Record rerun attempt
      await recordRerunAttempt(db, {
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        runId,
        jobName,
        attemptNumber: nextAttemptNumber,
        requestId,
        decision: 'RERUN_TRIGGERED',
        reasonCode: failureClass.replace(' ', '_'),
        reasons: [`Failure class: ${failureClass}`],
        priorConclusion: conclusion,
        failureClass,
        lawbookHash,
        maxAttemptsLimit: input.maxAttempts,
      });
    }

    // Determine overall decision
    let decision: RerunDecision;
    if (rerunCount > 0) {
      decision = 'RERUN_TRIGGERED';
      
      // Trigger actual rerun via GitHub API (only if we have a run ID)
      if (effectiveRunId) {
        try {
          // Rerun failed jobs for specific run
          await withRetry(
            async () => {
              await octokit.rest.actions.reRunWorkflowFailedJobs({
                owner: input.owner,
                repo: input.repo,
                run_id: effectiveRunId!,
              });
            },
            DEFAULT_RETRY_CONFIG,
            (decision, attempt) => {
              logger.info('GitHub rerun API retry', { decision: decision.decision, attempt }, 'JobRerunService');
            }
          );
          reasons.push(`Successfully triggered rerun for ${rerunCount} job(s)`);
        } catch (error) {
          logger.error('Failed to trigger GitHub rerun', error as Error, { requestId }, 'JobRerunService');
          reasons.push(`GitHub API error: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        reasons.push(`Cannot trigger rerun: no workflow run ID available`);
        decision = 'BLOCKED';
      }
    } else if (blockedCount > 0) {
      decision = 'BLOCKED';
      reasons.push(`All eligible jobs blocked (${blockedCount} job(s) exceeded max attempts)`);
    } else {
      decision = 'NOOP';
      reasons.push('No jobs eligible for rerun');
    }

    // Record audit event
    await recordAuditEvent(db, {
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      runId: effectiveRunId,
      decision,
      reasons,
      jobs: jobStatuses,
      requestId,
    });

    const result: RerunResultV1 = {
      schemaVersion: '1.0',
      requestId,
      lawbookHash,
      deploymentEnv,
      target: {
        prNumber: input.prNumber,
        runId: effectiveRunId,
      },
      decision,
      reasons,
      jobs: jobStatuses,
      metadata: {
        totalJobs: jobStatuses.length,
        rerunJobs: rerunCount,
        blockedJobs: blockedCount,
        skippedJobs: skipCount,
      },
    };

    logger.info('Job rerun completed', {
      requestId,
      decision,
      totalJobs: jobStatuses.length,
      rerunJobs: rerunCount,
      blockedJobs: blockedCount,
    }, 'JobRerunService');

    return result;
  } catch (error) {
    logger.error('Job rerun failed', error as Error, { requestId }, 'JobRerunService');
    throw error;
  }
}
