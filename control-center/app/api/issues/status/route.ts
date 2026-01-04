/**
 * API Route: GET /api/issues/status
 * 
 * AFU-9 Issue Status Sync MVP
 * 
 * Returns snapshot-based issue status from database (not live GitHub).
 * Includes sync metadata (staleness, last sync time).
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * Query parameters:
 * - state?: 'open' | 'closed' - Filter by state
 * - limit?: number - Results per page (default: 50, max: 200)
 * - before?: string - Cursor for pagination (format: "timestamp:id")
 * 
 * Response:
 * - items: Array of issue snapshots (bounded, deterministically ordered)
 * - hasMore: boolean - More results available
 * - nextCursor?: string - Cursor for next page
 * - staleness: Staleness info (last synced, hours since)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  listIssueSnapshotsWithCursor,
  getSyncStaleness,
  getRecentSyncRuns,
} from '../../../../src/lib/db/issueSync';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';

/**
 * GET /api/issues/status
 * 
 * List issue snapshots with sync metadata
 * 401-first authentication, cursor-based pagination
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Authentication required - no verified user context',
    });
  }

  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters with bounds
    const state = searchParams.get('state') as 'open' | 'closed' | null;
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10), 1), 200);
    const before = searchParams.get('before') || undefined;

    // Validate state parameter
    if (state && state !== 'open' && state !== 'closed') {
      return errorResponse('Invalid state parameter', {
        status: 400,
        requestId,
        details: 'State must be "open" or "closed"',
      });
    }

    // Fetch issue snapshots with cursor pagination (fetch limit+1 to check hasMore)
    const snapshotsResult = await listIssueSnapshotsWithCursor(pool, {
      state: state || undefined,
      limit: limit + 1,
      before,
    });

    if (!snapshotsResult.success) {
      return errorResponse('Failed to fetch issue snapshots', {
        status: 500,
        requestId,
        details: snapshotsResult.error,
      });
    }

    // Fetch sync staleness
    const stalenessResult = await getSyncStaleness(pool);
    if (!stalenessResult.success) {
      return errorResponse('Failed to fetch sync staleness', {
        status: 500,
        requestId,
        details: stalenessResult.error,
      });
    }

    // Fetch recent sync runs
    const runsResult = await getRecentSyncRuns(pool, 5);
    if (!runsResult.success) {
      console.warn('[API /api/issues/status] Failed to fetch recent sync runs:', runsResult.error);
    }

    const allSnapshots = snapshotsResult.data?.snapshots || [];
    const hasMore = allSnapshots.length > limit;
    const issues = hasMore ? allSnapshots.slice(0, limit) : allSnapshots;

    // Generate next cursor if there are more results
    const nextCursor = hasMore && issues.length > 0
      ? `${issues[issues.length - 1].updated_at?.toISOString()}:${issues[issues.length - 1].issue_number}`
      : undefined;

    const staleness = stalenessResult.data || {
      last_synced_at: null,
      staleness_hours: null,
      total_snapshots: 0,
    };

    // Normalize issue snapshots for API response
    const normalizedIssues = issues.map((issue) => ({
      repoOwner: issue.repo_owner,
      repoName: issue.repo_name,
      issueNumber: issue.issue_number,
      canonicalId: issue.canonical_id,
      state: issue.state,
      title: issue.title,
      labels: issue.labels,
      assignees: issue.assignees,
      updatedAt: issue.updated_at?.toISOString() || null,
      ghNodeId: issue.gh_node_id,
      syncedAt: issue.synced_at?.toISOString() || null,
      createdAt: issue.created_at?.toISOString() || null,
    }));

    const responseBody: any = {
      items: normalizedIssues,
      hasMore,
      nextCursor,
      staleness: {
        lastSyncedAt: staleness.last_synced_at?.toISOString() || null,
        stalenessHours: staleness.staleness_hours,
        totalSnapshots: staleness.total_snapshots,
      },
    };

    // Include recent sync runs if available
    if (runsResult.success && runsResult.data) {
      responseBody.recentSyncRuns = runsResult.data.map((run) => ({
        id: run.id,
        startedAt: run.started_at?.toISOString() || null,
        finishedAt: run.finished_at?.toISOString() || null,
        status: run.status,
        totalCount: run.total_count,
        upsertedCount: run.upserted_count,
        error: run.error,
      }));
    }

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return jsonResponse(responseBody, { requestId });
  } catch (error) {
    console.error('[API /api/issues/status] Error fetching issue status:', error);
    return errorResponse('Failed to fetch issue status', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
