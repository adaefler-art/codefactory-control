/**
 * API Route: POST /api/afu9/s1s3/issues/[id]/implement
 * 
 * S3 - Implement: Creates branch and PR for the issue.
 * Updates issue status to PR_CREATED.
 * Links PR to GitHub issue.
 * Logs S3 step event for audit trail.
 * 
 * Idempotent behavior:
 * - If issue is in PR_CREATED or IMPLEMENTING state with PR info, returns existing PR
 * - If branch already exists, skips branch creation
 * - If no commits between branches, returns error without creating PR
 * 
 * Request body:
 * {
 *   baseBranch?: string (default: "main"),
 *   prTitle?: string (default: uses issue title),
 *   prBody?: string (default: auto-generated)
 * }
 * 
 * Response format:
 * {
 *   issue: S1S3IssueRow,
 *   run: S1S3RunRow,
 *   step: S1S3RunStepRow,
 *   pr: { number, url, branch }
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import {
  getS1S3IssueById,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssuePR,
} from '@/lib/db/s1s3Flow';
import {
  S1S3IssueStatus,
  S1S3RunType,
  S1S3RunStatus,
  S1S3StepStatus,
} from '@/lib/contracts/s1s3Flow';
import { getRequestId, jsonResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../../../issues/_shared';
import { buildAfu9ScopeHeaders } from '../../../../s1s9/_shared';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

type S3ErrorCode =
  | 'ENGINE_MISCONFIGURED'
  | 'GITHUB_WRITE_DENIED'
  | 'VALIDATION_FAILED'
  | 'DISPATCH_DISABLED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

type S3ErrorResponse = {
  ok: false;
  stage: 'S3';
  code: S3ErrorCode;
  message: string;
  requestId: string;
  errorCode?: string;
  requiredConfig?: string[];
};

type S3SuccessResponse = {
  ok: true;
  stage: 'S3';
  runId: string;
  mutationId: string;
  issueId: string;
  startedAt: string;
};

type PullRequestSummary = {
  number: number;
  html_url: string;
  created_at?: string;
  updated_at?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof (error as { status?: number })?.status === 'number'
    ? (error as { status?: number }).status
    : undefined;
}

function getErrorApiMessage(error: unknown): string {
  const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return responseMessage || '';
}

function isPullRequestAlreadyExistsError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = `${getErrorMessage(error)} ${getErrorApiMessage(error)}`.toLowerCase();
  return status === 422 && message.includes('pull request already exists');
}

function isBranchAlreadyExistsError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = `${getErrorMessage(error)} ${getErrorApiMessage(error)}`.toLowerCase();
  return status === 422 && message.includes('reference already exists');
}

function selectLatestPullRequest(prs: PullRequestSummary[]): PullRequestSummary | null {
  if (prs.length === 0) {
    return null;
  }
  return prs
    .slice()
    .sort((a, b) => {
      const aTime = new Date(a.created_at || a.updated_at || 0).getTime();
      const bTime = new Date(b.created_at || b.updated_at || 0).getTime();
      return bTime - aTime;
    })[0];
}

async function findExistingPr(params: {
  octokit: any;
  owner: string;
  repo: string;
  branch: string;
  base: string;
}): Promise<PullRequestSummary | null> {
  const { octokit, owner, repo, branch, base } = params;
  const head = `${owner}:${branch}`;

  const openResult = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head,
    base,
  });

  const openMatch = selectLatestPullRequest(openResult.data as PullRequestSummary[]);
  if (openMatch) {
    return openMatch;
  }

  const allResult = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'all',
    head,
    base,
  });

  return selectLatestPullRequest(allResult.data as PullRequestSummary[]);
}

const S3_STAGE = 'S3';
const S3_HANDLER = 'control.s1s3.implement';

function hasValue(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function resolveDispatchRequirements(): string[] {
  const required: string[] = [];
  const runnerEndpoint = process.env.MCP_RUNNER_URL || process.env.MCP_RUNNER_ENDPOINT;
  if (!hasValue(runnerEndpoint)) {
    required.push('MCP_RUNNER_URL');
  }

  const queueUrl = process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;
  if (!hasValue(queueUrl)) {
    required.push('AFU9_GITHUB_EVENTS_QUEUE_URL');
  }

  const appId = process.env.GITHUB_APP_ID || process.env.GH_APP_ID;
  const appKey =
    process.env.GITHUB_APP_PRIVATE_KEY_PEM || process.env.GH_APP_PRIVATE_KEY_PEM;
  const appSecretId =
    process.env.GITHUB_APP_SECRET_ID || process.env.GH_APP_SECRET_ID;
  const dispatcherConfigured = (hasValue(appId) && hasValue(appKey)) || hasValue(appSecretId);
  if (!dispatcherConfigured) {
    required.push('GITHUB_APP_ID');
    required.push('GITHUB_APP_PRIVATE_KEY_PEM');
  }

  return required;
}

/**
 * POST /api/afu9/s1s3/issues/[id]/implement
 * Create branch and PR for implementation
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = {
    ...getControlResponseHeaders(requestId, routeHeaderValue),
    ...buildAfu9ScopeHeaders({
      requestedScope: 's1s3',
      resolvedScope: 's1s3',
    }),
    'x-afu9-stage': S3_STAGE,
    'x-afu9-handler': S3_HANDLER,
  };
  responseHeaders['x-afu9-handler'] = S3_HANDLER;
  const pool = getPool();

  const respondS3Error = (params: {
    status: number;
    code: S3ErrorCode;
    message: string;
    requiredConfig?: string[];
  }) => {
    const body: S3ErrorResponse = {
      ok: false,
      stage: S3_STAGE,
      code: params.code,
      message: params.message,
      requestId,
      errorCode: params.code,
      requiredConfig: params.requiredConfig,
    };

    return jsonResponse(body, {
      status: params.status,
      requestId,
      headers: {
        ...responseHeaders,
        'x-afu9-error-code': params.code,
      },
    });
  };

  const respondS3Success = (body: S3SuccessResponse & Record<string, unknown>) =>
    jsonResponse(body, {
      status: 202,
      requestId,
      headers: responseHeaders,
    });

  try {
    const stageValue =
      process.env.AFU9_STAGE || process.env.DEPLOY_ENV || process.env.ENVIRONMENT;
    if (!hasValue(stageValue)) {
      return respondS3Error({
        status: 500,
        code: 'ENGINE_MISCONFIGURED',
        message: 'Missing AFU9_STAGE',
      });
    }

    const missingDispatchConfig = resolveDispatchRequirements();
    if (missingDispatchConfig.length > 0) {
      return respondS3Error({
        status: 503,
        code: 'DISPATCH_DISABLED',
        message: 'Execution disabled in this env',
        requiredConfig: missingDispatchConfig,
      });
    }

    const { id } = await context.params;
    const resolved = await resolveIssueIdentifierOr404(id, requestId);
    if (!resolved.ok) {
      return respondS3Error({
        status: resolved.status,
        code: 'VALIDATION_FAILED',
        message: resolved.body.errorCode || 'Invalid issue identifier',
      });
    }
    const issueId = resolved.uuid;

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const { baseBranch = 'main', prTitle, prBody } = body;

    console.log('[S3] Implement request:', {
      requestId,
      issue_id: issueId,
      baseBranch,
    });

    // Get existing issue
    const issueResult = await getS1S3IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return respondS3Error({
        status: 404,
        code: 'VALIDATION_FAILED',
        message: 'Issue not found',
      });
    }

    const issue = issueResult.data;

    // Check if issue has spec ready
    if (
      issue.status !== S1S3IssueStatus.SPEC_READY &&
      issue.status !== S1S3IssueStatus.IMPLEMENTING &&
      issue.status !== S1S3IssueStatus.PR_CREATED
    ) {
      return respondS3Error({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: `Issue must be in SPEC_READY, IMPLEMENTING, or PR_CREATED state. Current: ${issue.status}`,
      });
    }


    // Parse repo
    const [repoOwner, repoName] = issue.repo_full_name.split('/');

    // Create authenticated GitHub client
    let octokit;
    try {
      octokit = await createAuthenticatedClient({ owner: repoOwner, repo: repoName, requestId });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not in allowlist')) {
        return respondS3Error({
          status: 403,
          code: 'GITHUB_WRITE_DENIED',
          message: `Repository ${issue.repo_full_name} is not in the allowlist`,
        });
      }
      return respondS3Error({
        status: 500,
        code: 'ENGINE_MISCONFIGURED',
        message: error instanceof Error ? error.message : 'GitHub client not configured',
      });
    }

    // Create run record
    const runResult = await createS1S3Run(pool, {
      type: S1S3RunType.S3_IMPLEMENT,
      issue_id: issue.id,
      request_id: requestId,
      actor: issue.owner,
      status: S1S3RunStatus.RUNNING,
    });

    if (!runResult.success || !runResult.data) {
      return respondS3Error({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Failed to create run record',
      });
    }

    const run = runResult.data;
    const startedAt = new Date(run.created_at || Date.now()).toISOString();

    // Create step event - STARTED
    const startStep = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S3',
      step_name: 'Create Branch and PR',
      status: S1S3StepStatus.STARTED,
      evidence_refs: {
        issue_id: issue.id,
        issue_url: issue.github_issue_url,
        base_branch: baseBranch,
        request_id: requestId,
      },
    });

    if (!startStep.success || !startStep.data) {
      return respondS3Error({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Failed to create step event',
      });
    }

    const issueHasExistingPr =
      (issue.status === S1S3IssueStatus.PR_CREATED ||
        issue.status === S1S3IssueStatus.IMPLEMENTING) &&
      issue.pr_number &&
      issue.pr_url &&
      issue.branch_name;

    if (issueHasExistingPr) {
      console.log('[S3] PR already exists, returning existing info:', {
        requestId,
        issue_id: issue.id,
        pr_number: issue.pr_number,
        pr_url: issue.pr_url,
        branch_name: issue.branch_name,
      });

      const stepResult = await createS1S3RunStep(pool, {
        run_id: run.id,
        step_id: 'S3',
        step_name: 'Create Branch and PR',
        status: S1S3StepStatus.SUCCEEDED,
        evidence_refs: {
          issue_id: issue.id,
          issue_url: issue.github_issue_url,
          pr_number: issue.pr_number,
          pr_url: issue.pr_url,
          branch_name: issue.branch_name,
          base_branch: baseBranch,
          request_id: requestId,
          mode: 'reused_existing_pr',
        },
      });

      if (!stepResult.success || !stepResult.data) {
        return respondS3Error({
          status: 500,
          code: 'INTERNAL_ERROR',
          message: 'Failed to create step event',
        });
      }

      await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

      return respondS3Success({
        ok: true,
        stage: S3_STAGE,
        runId: run.id,
        mutationId: stepResult.data.id,
        issueId: issue.id,
        startedAt,
        issue,
        pr: {
          number: issue.pr_number,
          url: issue.pr_url,
          branch: issue.branch_name,
        },
        message: 'PR already exists (idempotent)',
      });
    }

    try {
      // Generate branch name
      const generatedBranchName = `afu9/issue-${issue.github_issue_number}-${issue.public_id}`;
      const branchName = issue.branch_name || generatedBranchName;
      const head = `${repoOwner}:${branchName}`;

      let pr: PullRequestSummary | null = null;
      let evidenceMode: 'created_pr' | 'reused_existing_pr' = 'created_pr';

      if (issue.status === S1S3IssueStatus.PR_CREATED && issue.pr_number && issue.pr_url && issue.branch_name) {
        pr = {
          number: issue.pr_number,
          html_url: issue.pr_url,
          created_at: issue.pr_created_at ? new Date(issue.pr_created_at).toISOString() : undefined,
        };
        evidenceMode = 'reused_existing_pr';
      }

      if (!pr) {
        // Get base branch SHA
        const { data: baseRef } = await octokit.rest.git.getRef({
          owner: repoOwner,
          repo: repoName,
          ref: `heads/${baseBranch}`,
        });

        const baseSha = baseRef.object.sha;

        // Create new branch (idempotent if already exists)
        try {
          await octokit.rest.git.createRef({
            owner: repoOwner,
            repo: repoName,
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
          });

          console.log('[S3] Branch created:', {
            requestId,
            branch: branchName,
            base: baseBranch,
            sha: baseSha,
          });
        } catch (error) {
          if (isBranchAlreadyExistsError(error)) {
            console.log('[S3] Branch already exists, continuing:', {
              requestId,
              branch: branchName,
              base: baseBranch,
            });
          } else {
            throw error;
          }
        }

        // Pre-check for existing PR (idempotent)
        pr = await findExistingPr({
          octokit,
          owner: repoOwner,
          repo: repoName,
          branch: branchName,
          base: baseBranch,
        });

        if (pr) {
          evidenceMode = 'reused_existing_pr';
        } else {
          // Generate PR title and body
          const finalPrTitle = prTitle || `Issue #${issue.github_issue_number}: Implementation`;
      
          // Import normalization utility for acceptance criteria
          const { normalizeAcceptanceCriteria } = await import('@/lib/contracts/s1s3Flow');
          const acceptanceCriteria = normalizeAcceptanceCriteria(issue.acceptance_criteria);
      
          const finalPrBody =
            prBody ||
            `
## Implementation for Issue #${issue.github_issue_number}

**AFU9 Issue ID:** ${issue.public_id}

${issue.problem ? `### Problem\n${issue.problem}\n` : ''}
${issue.scope ? `### Scope\n${issue.scope}\n` : ''}

### Acceptance Criteria
${
  acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : 'See issue description'
}

---
*This PR was created automatically by AFU9 S1-S3 flow.*

Closes #${issue.github_issue_number}
`.trim();

          // Create pull request (race-safe)
          try {
            const { data } = await octokit.rest.pulls.create({
              owner: repoOwner,
              repo: repoName,
              title: finalPrTitle,
              head: branchName,
              base: baseBranch,
              body: finalPrBody,
            });

            pr = {
              number: data.number,
              html_url: data.html_url,
              created_at: data.created_at,
              updated_at: data.updated_at,
            };

            evidenceMode = 'created_pr';

            console.log('[S3] PR created:', {
              requestId,
              pr_number: data.number,
              pr_url: data.html_url,
            });
          } catch (error) {
            if (isPullRequestAlreadyExistsError(error)) {
              console.log('[S3] PR already exists (race), reconciling:', {
                requestId,
                head,
                base: baseBranch,
              });

              pr = await findExistingPr({
                octokit,
                owner: repoOwner,
                repo: repoName,
                branch: branchName,
                base: baseBranch,
              });

              if (!pr) {
                await createS1S3RunStep(pool, {
                  run_id: run.id,
                  step_id: 'S3',
                  step_name: 'Create Branch and PR',
                  status: S1S3StepStatus.FAILED,
                  error_message: 'PR exists but was not found via GitHub list',
                  evidence_refs: {
                    issue_id: issue.id,
                    request_id: requestId,
                    head,
                    base_branch: baseBranch,
                    mode: 'blocked',
                    code: 'S3_PR_EXISTS_BUT_NOT_FOUND',
                  },
                });

                await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.FAILED, 'S3_PR_EXISTS_BUT_NOT_FOUND');

                return respondS3Error({
                  status: 409,
                  code: 'VALIDATION_FAILED',
                  message: 'Pull request already exists but was not found',
                });
              }

              evidenceMode = 'reused_existing_pr';
            } else {
              throw error;
            }
          }
        }
      }

      // Update issue with PR info
      const updateResult = await updateS1S3IssuePR(pool, issue.id, {
        pr_number: pr.number,
        pr_url: pr.html_url,
        branch_name: branchName,
      });

      if (!updateResult.success || !updateResult.data) {
        return respondS3Error({
          status: 500,
          code: 'INTERNAL_ERROR',
          message: 'Failed to update issue',
        });
      }

      const updatedIssue = updateResult.data;

      // Create step event - SUCCEEDED
      const stepResult = await createS1S3RunStep(pool, {
        run_id: run.id,
        step_id: 'S3',
        step_name: 'Create Branch and PR',
        status: S1S3StepStatus.SUCCEEDED,
        evidence_refs: {
          issue_id: updatedIssue.id,
          issue_url: updatedIssue.github_issue_url,
          pr_number: pr.number,
          pr_url: pr.html_url,
          branch_name: branchName,
          base_branch: baseBranch,
          request_id: requestId,
          mode: evidenceMode,
          head,
          base: baseBranch,
        },
      });

      if (!stepResult.success || !stepResult.data) {
        return respondS3Error({
          status: 500,
          code: 'INTERNAL_ERROR',
          message: 'Failed to create step event',
        });
      }

      // Update run status to DONE
      await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

      console.log('[S3] Implement completed successfully:', {
        requestId,
        issue_id: updatedIssue.id,
        run_id: run.id,
        pr_number: pr.number,
        mode: evidenceMode,
      });

      return respondS3Success({
        ok: true,
        stage: S3_STAGE,
        runId: run.id,
        mutationId: stepResult.data.id,
        issueId: updatedIssue.id,
        startedAt,
        issue: updatedIssue,
        run: run,
        step: stepResult.data,
        pr: {
          number: pr.number,
          url: pr.html_url,
          branch: branchName,
        },
        ...(evidenceMode === 'reused_existing_pr' ? { message: 'PR already exists (idempotent)' } : {}),
      });
    } catch (error) {
      // Log error step event
      await createS1S3RunStep(pool, {
        run_id: run.id,
        step_id: 'S3',
        step_name: 'Create Branch and PR',
        status: S1S3StepStatus.FAILED,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        evidence_refs: {
          issue_id: issue.id,
          request_id: requestId,
        },
      });

      // Update run status to FAILED
      await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.FAILED, error instanceof Error ? error.message : 'Unknown error');

      return respondS3Error({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]/implement] Error implementing:', error);
    return respondS3Error({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
