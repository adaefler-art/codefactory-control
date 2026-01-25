/**
 * API Route: GET /api/afu9/s1s3/prs/[prNumber]/checks
 * 
 * Get PR checks status from GitHub.
 * Returns CI/CD check runs and their statuses.
 * 
 * Query parameters:
 * - repo: Repository in format "owner/repo" (required, must be allowlisted)
 * 
 * Response format:
 * {
 *   pr: { number, state, mergeable },
 *   checks: {
 *     total: number,
 *     completed: number,
 *     success: number,
 *     failure: number,
 *     pending: number,
 *     runs: [...],
 *     conclusion: "success" | "failure" | "pending" | "neutral"
 *   }
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{
    prNumber: string;
  }>;
}

/**
 * GET /api/afu9/s1s3/prs/[prNumber]/checks
 * Get PR checks status
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const { prNumber } = await context.params;
    const searchParams = request.nextUrl.searchParams;

    // Get repo (required)
    const repo = searchParams.get('repo');
    if (!repo) {
      return errorResponse('Missing required parameter: repo', {
        status: 400,
        requestId,
        details: 'Format: owner/repo',
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

    const [owner, repoName] = repoParts;
    const prNum = parseInt(prNumber, 10);

    if (isNaN(prNum)) {
      return errorResponse('Invalid PR number', {
        status: 400,
        requestId,
        details: 'PR number must be a valid integer',
      });
    }

    console.log('[Checks] Fetching PR checks:', {
      requestId,
      repo,
      prNumber: prNum,
    });

    // Create authenticated GitHub client
    let octokit;
    try {
      octokit = await createAuthenticatedClient({ owner, repo: repoName, requestId });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not in allowlist')) {
        return errorResponse('Repository access denied', {
          status: 403,
          requestId,
          details: `Repository ${repo} is not in the allowlist`,
        });
      }
      throw error;
    }

    // Get PR details
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNum,
    });

    console.log('[Checks] PR fetched:', {
      requestId,
      prNumber: pr.number,
      state: pr.state,
      mergeable: pr.mergeable,
      head_sha: pr.head.sha,
    });

    // Get check runs for the PR's head SHA
    const { data: checkRuns } = await octokit.rest.checks.listForRef({
      owner,
      repo: repoName,
      ref: pr.head.sha,
    });

    // Aggregate check status
    const total = checkRuns.total_count;
    const runs = checkRuns.check_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      started_at: run.started_at,
      completed_at: run.completed_at,
      html_url: run.html_url,
    }));

    const completed = runs.filter((r) => r.status === 'completed').length;
    const success = runs.filter((r) => r.conclusion === 'success').length;
    const failure = runs.filter((r) => r.conclusion === 'failure').length;
    const pending = runs.filter((r) => r.status !== 'completed').length;

    // Determine overall conclusion
    let overallConclusion: 'success' | 'failure' | 'pending' | 'neutral' = 'neutral';
    if (pending > 0) {
      overallConclusion = 'pending';
    } else if (failure > 0) {
      overallConclusion = 'failure';
    } else if (success === total && total > 0) {
      overallConclusion = 'success';
    }

    console.log('[Checks] Checks fetched:', {
      requestId,
      total,
      completed,
      success,
      failure,
      pending,
      conclusion: overallConclusion,
    });

    return jsonResponse(
      {
        pr: {
          number: pr.number,
          state: pr.state,
          mergeable: pr.mergeable,
          mergeable_state: pr.mergeable_state,
          head_sha: pr.head.sha,
        },
        checks: {
          total,
          completed,
          success,
          failure,
          pending,
          runs,
          conclusion: overallConclusion,
        },
      },
      {
        requestId,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/s1s3/prs/[prNumber]/checks] Error fetching checks:', error);
    return errorResponse('Failed to fetch PR checks', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
