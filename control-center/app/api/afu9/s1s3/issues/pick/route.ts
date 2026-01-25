/**
 * API Route: POST /api/afu9/s1s3/issues/pick
 * 
 * S1 - Pick Issue: Links a GitHub issue to AFU9.
 * Creates an AFU9 issue record with ownership and initial status.
 * Logs S1 step event for audit trail.
 * 
 * Request body:
 * {
 *   repo: "owner/repo",
 *   issueNumber: number,
 *   owner?: string (default: "afu9"),
 *   canonicalId?: string (e.g., "E89.6", "I811")
 * }
 * 
 * Response format:
 * {
 *   issue: S1S3IssueRow,
 *   run: S1S3RunRow,
 *   step: S1S3RunStepRow
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import {
  upsertS1S3Issue,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
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

/**
 * POST /api/afu9/s1s3/issues/pick
 * Pick and link a GitHub issue to AFU9
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const pool = getPool();

  try {
    // Parse request body
    const body = await request.json();
    const { repo, issueNumber, owner = 'afu9', canonicalId } = body;

    // Validate required fields
    if (!repo || !issueNumber) {
      return errorResponse('Missing required fields', {
        status: 400,
        requestId,
        details: 'Required: repo (owner/repo), issueNumber',
      });
    }

    // Parse repo
    const repoParts = repo.split('/');
    if (repoParts.length !== 2) {
      return errorResponse('Invalid repo format', {
        status: 400,
        requestId,
        details: 'Format must be: owner/repo',
      });
    }

    const [repoOwner, repoName] = repoParts;
    const repoFullName = `${repoOwner}/${repoName}`;

    console.log('[S1] Pick issue request:', {
      requestId,
      repo: repoFullName,
      issueNumber,
      owner,
      canonicalId,
    });

    // Create authenticated GitHub client
    // Auth wrapper enforces allowlist policy
    let octokit;
    try {
      octokit = await createAuthenticatedClient({ owner: repoOwner, repo: repoName, requestId });
    } catch (error) {
      // Check if it's a policy denial
      if (error instanceof Error && error.message.includes('not in allowlist')) {
        return errorResponse('Repository access denied', {
          status: 403,
          requestId,
          details: `Repository ${repo} is not in the allowlist`,
        });
      }

      // Check if it's auth failure
      if (error instanceof Error && error.message.includes('authentication failed')) {
        return errorResponse('GitHub authentication failed', {
          status: 401,
          requestId,
          details: error.message,
        });
      }

      throw error;
    }

    // Fetch issue from GitHub to validate it exists
    let githubIssue;
    try {
      const { data } = await octokit.rest.issues.get({
        owner: repoOwner,
        repo: repoName,
        issue_number: issueNumber,
      });
      githubIssue = data;

      // Check if it's a pull request
      if (githubIssue.pull_request) {
        return errorResponse('Cannot pick pull request', {
          status: 400,
          requestId,
          details: `#${issueNumber} is a pull request, not an issue`,
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Not Found')) {
        return errorResponse('GitHub issue not found', {
          status: 404,
          requestId,
          details: `Issue #${issueNumber} not found in ${repo}`,
        });
      }
      throw error;
    }

    console.log('[S1] GitHub issue fetched:', {
      requestId,
      number: githubIssue.number,
      title: githubIssue.title,
      state: githubIssue.state,
    });

    // Upsert AFU9 issue record
    const issueResult = await upsertS1S3Issue(pool, {
      repo_full_name: repoFullName,
      github_issue_number: issueNumber,
      github_issue_url: githubIssue.html_url,
      owner,
      canonical_id: canonicalId,
      status: S1S3IssueStatus.CREATED,
    });

    if (!issueResult.success || !issueResult.data) {
      return errorResponse('Failed to create AFU9 issue record', {
        status: 500,
        requestId,
        details: issueResult.error,
      });
    }

    const afu9Issue = issueResult.data;
    console.log('[S1] AFU9 issue created/updated:', {
      requestId,
      id: afu9Issue.id,
      public_id: afu9Issue.public_id,
      status: afu9Issue.status,
    });

    // Create run record
    const runResult = await createS1S3Run(pool, {
      type: S1S3RunType.S1_PICK_ISSUE,
      issue_id: afu9Issue.id,
      request_id: requestId,
      actor: owner,
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
      step_id: 'S1',
      step_name: 'Pick GitHub Issue',
      status: S1S3StepStatus.STARTED,
      evidence_refs: {
        issue_url: githubIssue.html_url,
        issue_number: issueNumber,
        repo_full_name: repoFullName,
        request_id: requestId,
      },
    });

    // Create step event - SUCCEEDED
    const stepResult = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S1',
      step_name: 'Pick GitHub Issue',
      status: S1S3StepStatus.SUCCEEDED,
      evidence_refs: {
        issue_url: githubIssue.html_url,
        issue_number: issueNumber,
        repo_full_name: repoFullName,
        afu9_issue_id: afu9Issue.id,
        afu9_public_id: afu9Issue.public_id,
        request_id: requestId,
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

    console.log('[S1] Issue pick completed successfully:', {
      requestId,
      afu9_issue_id: afu9Issue.id,
      run_id: run.id,
    });

    return jsonResponse(
      {
        issue: afu9Issue,
        run: run,
        step: stepResult.data,
      },
      {
        status: 201,
        requestId,
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/pick] Error picking issue:', error);
    return errorResponse('Failed to pick issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
