/**
 * API Route: GET /api/afu9/github/issues
 * 
 * Lists GitHub issues from allowlisted repositories.
 * This is S1 (Pick Issue) - retrieve available issues for selection.
 * 
 * Query parameters:
 * - repo: Repository in format "owner/repo" (required, must be allowlisted)
 * - state: "open" | "closed" | "all" (default: "open")
 * - label: Filter by label (optional)
 * - limit: Results per page (default: 30, max: 100)
 * - page: Page number (default: 1)
 * 
 * Response format:
 * {
 *   issues: [...],
 *   total: number,
 *   page: number,
 *   limit: number
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

/**
 * GitHub Issue from API
 */
interface GitHubIssueListItem {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string; color: string }>;
  assignees: Array<{ login: string }>;
  body: string | null;
}

/**
 * GET /api/afu9/github/issues
 * List GitHub issues from allowlisted repo
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const searchParams = request.nextUrl.searchParams;

    // Get repo (required)
    const repo = searchParams.get('repo');
    if (!repo) {
      return errorResponse('Missing required parameter: repo', {
        status: 400,
        requestId,
        details: 'Format: owner/repo (e.g., adaefler-art/codefactory-control)',
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

    // Get filters
    const state = (searchParams.get('state') || 'open') as 'open' | 'closed' | 'all';
    const label = searchParams.get('label') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100);
    const page = parseInt(searchParams.get('page') || '1', 10);

    // Create authenticated GitHub client
    // Auth wrapper enforces allowlist policy
    let octokit;
    try {
      octokit = await createAuthenticatedClient({ owner, repo: repoName, requestId });
    } catch (error) {
      // Check if it's a policy denial
      if (error instanceof Error && error.message.includes('not in allowlist')) {
        return errorResponse('Repository access denied', {
          status: 403,
          requestId,
          details: `Repository ${repo} is not in the allowlist. Contact admin to add it.`,
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

    // Fetch issues from GitHub
    console.log(`[S1] Fetching issues from ${repo}...`, {
      requestId,
      state,
      label,
      limit,
      page,
    });

    const listParams: any = {
      owner,
      repo: repoName,
      state,
      per_page: limit,
      page,
      sort: 'created',
      direction: 'desc',
    };

    if (label) {
      listParams.labels = label;
    }

    const { data: issues } = await octokit.rest.issues.listForRepo(listParams);

    // Filter out pull requests (GitHub API returns PRs as issues)
    const filteredIssues = issues.filter((issue: any) => !issue.pull_request);

    // Map to response format
    const mappedIssues = filteredIssues.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      html_url: issue.html_url,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      labels: issue.labels?.map((l: any) => ({ name: l.name, color: l.color })) || [],
      assignees: issue.assignees?.map((a: any) => ({ login: a.login })) || [],
      body: issue.body,
    }));

    console.log(`[S1] Fetched ${mappedIssues.length} issues from ${repo}`, { requestId });

    return jsonResponse(
      {
        issues: mappedIssues,
        total: mappedIssues.length,
        page,
        limit,
        repo,
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
    console.error('[API /api/afu9/github/issues] Error listing issues:', error);
    return errorResponse('Failed to list GitHub issues', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
