/**
 * API Route: POST /api/afu9/s1s3/issues/[id]/implement
 * 
 * S3 - Implement: Creates branch and PR for the issue.
 * Updates issue status to PR_CREATED.
 * Links PR to GitHub issue.
 * Logs S3 step event for audit trail.
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
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

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
  return String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  return typeof (error as { status?: number })?.status === 'number'
    ? (error as { status?: number }).status
    : undefined;
}

function getErrorApiMessage(error: unknown): string {
  const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return responseMessage || getErrorMessage(error);
}

function isPullRequestAlreadyExistsError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = getErrorApiMessage(error).toLowerCase();
  return status === 422 && message.includes('pull request already exists');
}

function isBranchAlreadyExistsError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = getErrorApiMessage(error).toLowerCase();
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

async function findExistingPullRequest(params: {
  octokit: any;
  owner: string;
  repo: string;
  head: string;
  base: string;
}): Promise<PullRequestSummary | null> {
  const { octokit, owner, repo, head, base } = params;

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

/**
 * POST /api/afu9/s1s3/issues/[id]/implement
 * Create branch and PR for implementation
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);
  const pool = getPool();

  try {
    const { id } = await context.params;

    // Parse request body
    const body = await request.json();
    const { baseBranch = 'main', prTitle, prBody } = body;

    console.log('[S3] Implement request:', {
      requestId,
      issue_id: id,
      baseBranch,
    });

    // Get existing issue
    const issueResult = await getS1S3IssueById(pool, id);
    if (!issueResult.success || !issueResult.data) {
      return errorResponse('Issue not found', {
        status: 404,
        requestId,
        details: issueResult.error,
      });
    }

    const issue = issueResult.data;

    // Check if issue has spec ready
    if (
      issue.status !== S1S3IssueStatus.SPEC_READY &&
      issue.status !== S1S3IssueStatus.IMPLEMENTING &&
      issue.status !== S1S3IssueStatus.PR_CREATED
    ) {
      return errorResponse('Invalid issue state', {
        status: 400,
        requestId,
        details: `Issue must be in SPEC_READY state. Current: ${issue.status}`,
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
        return errorResponse('Repository access denied', {
          status: 403,
          requestId,
          details: `Repository ${issue.repo_full_name} is not in the allowlist`,
        });
      }
      throw error;
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
      return errorResponse('Failed to create run record', {
        status: 500,
        requestId,
        details: runResult.error,
      });
    }

    const run = runResult.data;

    // Create step event - STARTED
    await createS1S3RunStep(pool, {
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

    try {
      // Generate branch name
      const generatedBranchName = `afu9/issue-${issue.github_issue_number}-${issue.public_id}`;
      const branchName = issue.branch_name || generatedBranchName;
      const head = `${repoOwner}:${branchName}`;

      let pr: PullRequestSummary | null = null;
      let reusedExistingPr = false;

      if (issue.status === S1S3IssueStatus.PR_CREATED && issue.pr_number && issue.pr_url && issue.branch_name) {
        pr = {
          number: issue.pr_number,
          html_url: issue.pr_url,
          created_at: issue.pr_created_at ? new Date(issue.pr_created_at).toISOString() : undefined,
        };
        reusedExistingPr = true;
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

        // Create pull request (reconcile if already exists)
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

          console.log('[S3] PR created:', {
            requestId,
            pr_number: data.number,
            pr_url: data.html_url,
          });
        } catch (error) {
          if (isPullRequestAlreadyExistsError(error)) {
            console.log('[S3] PR already exists, reconciling:', {
              requestId,
              head,
              base: baseBranch,
            });

            pr = await findExistingPullRequest({
              octokit,
              owner: repoOwner,
              repo: repoName,
              head,
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
                  code: 'S3_PR_EXISTS_BUT_NOT_FOUND',
                },
              });

              await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.FAILED, 'S3_PR_EXISTS_BUT_NOT_FOUND');

              return jsonResponse(
                {
                  error: 'Pull request already exists but was not found',
                  code: 'S3_PR_EXISTS_BUT_NOT_FOUND',
                  evidence: {
                    head,
                    base: baseBranch,
                  },
                  requestId,
                  timestamp: new Date().toISOString(),
                },
                {
                  status: 409,
                  requestId,
                }
              );
            }

            reusedExistingPr = true;

            console.log('[S3] PR reconciled:', {
              requestId,
              pr_number: pr.number,
              pr_url: pr.html_url,
            });
          } else {
            throw error;
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
        return errorResponse('Failed to update issue', {
          status: 500,
          requestId,
          details: updateResult.error,
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
          ...(reusedExistingPr
            ? {
                mode: 'reused_existing_pr',
                head,
                base: baseBranch,
              }
            : {}),
        },
      });

      if (!stepResult.success || !stepResult.data) {
        return errorResponse('Failed to create step event', {
          status: 500,
          requestId,
          details: stepResult.error,
        });
      }

      // Update run status to DONE
      await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

      console.log('[S3] Implement completed successfully:', {
        requestId,
        issue_id: updatedIssue.id,
        run_id: run.id,
        pr_number: pr.number,
        reused_existing_pr: reusedExistingPr,
      });

      return jsonResponse(
        {
          issue: updatedIssue,
          run: run,
          step: stepResult.data,
          pr: {
            number: pr.number,
            url: pr.html_url,
            branch: branchName,
          },
          ...(reusedExistingPr ? { message: 'PR already exists (idempotent)' } : {}),
        },
        {
          status: reusedExistingPr ? 200 : 201,
          requestId,
        }
      );
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

      throw error;
    }
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]/implement] Error implementing:', error);
    return errorResponse('Failed to implement', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
