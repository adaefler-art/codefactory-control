/**
 * API Route: POST /api/ops/issues/sync
 * 
 * AFU-9 Issue Status Sync MVP
 * 
 * Polls GitHub issues and syncs them to issue_snapshots table.
 * Auth-first, deterministic pagination, GitHub App only.
 * 
 * Request Body (optional):
 * - query?: string - Custom GitHub search query (default from env or deterministic)
 * 
 * Response:
 * - ok: boolean
 * - total: number - Total issues found
 * - upserted: number - Snapshots created/updated
 * - syncedAt: string - ISO timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { searchIssues } from '../../../../../src/lib/github';
import {
  createIssueSyncRun,
  updateIssueSyncRun,
  upsertIssueSnapshot,
} from '../../../../../src/lib/db/issueSync';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';

// Constants
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'adaefler-art';
const GITHUB_REPO = process.env.GITHUB_REPO || 'codefactory-control';
const MAX_SYNC_PAGES = parseInt(process.env.AFU9_ISSUE_SYNC_MAX_PAGES || '10', 10);
const PER_PAGE = 100; // GitHub search API max

/**
 * Extract canonical ID from issue title or labels
 * Examples: "E64.1: ...", "I751: ...", "[E64.1] ...", etc.
 */
function extractCanonicalId(title: string, labels: Array<{ name: string }>): string | null {
  // Pattern: E/I followed by digits and optional decimal (e.g., E64.1, I751)
  const titleMatch = title.match(/\b([EI]\d+(?:\.\d+)?)\b/);
  if (titleMatch) {
    return titleMatch[1];
  }

  // Check labels for canonical ID
  for (const label of labels) {
    const labelMatch = label.name.match(/\b([EI]\d+(?:\.\d+)?)\b/);
    if (labelMatch) {
      return labelMatch[1];
    }
  }

  return null;
}

/**
 * POST /api/ops/issues/sync
 * 
 * Synchronizes GitHub issues to local database snapshots
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();

    // Parse request body (optional query parameter)
    let body: { query?: string } = {};
    try {
      const text = await request.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch (err) {
      // Empty or invalid body is acceptable (use defaults)
      console.log('[API /api/ops/issues/sync] No body or invalid JSON, using defaults');
    }

    // Determine query (env var, body, or default)
    const query =
      body.query ||
      process.env.AFU9_ISSUE_SYNC_QUERY ||
      'repo:adaefler-art/codefactory-control is:issue';

    console.log('[API /api/ops/issues/sync] Starting sync with query:', query);

    // Create sync run record
    const runResult = await createIssueSyncRun(pool, query);
    if (!runResult.success || !runResult.data) {
      return errorResponse('Failed to create sync run', {
        status: 500,
        requestId,
        details: runResult.error,
      });
    }

    const runId = runResult.data;
    let totalCount = 0;
    let upsertedCount = 0;
    let error: string | null = null;

    try {
      // Fetch issues from GitHub with deterministic pagination
      // GitHub search API max per_page is 100
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        console.log(`[API /api/ops/issues/sync] Fetching page ${page}...`);

        const result = await searchIssues({
          query,
          per_page: PER_PAGE,
          page,
          sort: 'updated',
          direction: 'desc',
        });

        totalCount = result.total_count;

        // Upsert each issue snapshot
        for (const issue of result.issues) {
          const canonicalId = extractCanonicalId(issue.title, issue.labels);

          const upsertResult = await upsertIssueSnapshot(pool, {
            repo_owner: GITHUB_OWNER,
            repo_name: GITHUB_REPO,
            issue_number: issue.number,
            canonical_id: canonicalId,
            state: issue.state,
            title: issue.title,
            labels: issue.labels,
            assignees: issue.assignees,
            updated_at: issue.updated_at,
            gh_node_id: issue.node_id,
            payload_json: issue,
          });

          if (upsertResult.success) {
            upsertedCount++;
          } else {
            console.error(
              `[API /api/ops/issues/sync] Failed to upsert issue #${issue.number}:`,
              upsertResult.error
            );
          }
        }

        // Check if there are more pages
        hasMore = result.issues.length === PER_PAGE && page * PER_PAGE < totalCount;
        page++;

        // Safety limit: configurable max pages
        if (page > MAX_SYNC_PAGES) {
          console.warn(
            `[API /api/ops/issues/sync] Reached page limit (${MAX_SYNC_PAGES}), stopping`
          );
          hasMore = false;
        }
      }

      // Mark sync run as successful
      await updateIssueSyncRun(pool, runId, {
        status: 'SUCCESS',
        total_count: totalCount,
        upserted_count: upsertedCount,
      });

      console.log(
        `[API /api/ops/issues/sync] Sync completed: ${upsertedCount}/${totalCount} snapshots`
      );

      const responseBody: any = {
        ok: true,
        total: totalCount,
        upserted: upsertedCount,
        syncedAt: new Date().toISOString(),
      };

      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }

      return jsonResponse(responseBody, { requestId });
    } catch (syncError) {
      // Mark sync run as failed
      error = syncError instanceof Error ? syncError.message : 'Unknown sync error';
      await updateIssueSyncRun(pool, runId, {
        status: 'FAILED',
        total_count: totalCount,
        upserted_count: upsertedCount,
        error,
      });

      throw syncError;
    }
  } catch (err) {
    console.error('[API /api/ops/issues/sync] Error during sync:', err);
    return errorResponse('Failed to sync issues', {
      status: 500,
      requestId,
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
