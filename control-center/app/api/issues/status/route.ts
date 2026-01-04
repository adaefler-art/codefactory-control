/**
 * API Route: GET /api/issues/status
 * 
 * AFU-9 Issue Status Sync MVP
 * 
 * Returns snapshot-based issue status from database (not live GitHub).
 * Includes sync metadata (staleness, last sync time).
 * 
 * Query parameters:
 * - state?: 'open' | 'closed' - Filter by state
 * - limit?: number - Results per page (default: 100, max: 100)
 * - offset?: number - Pagination offset (default: 0)
 * 
 * Response:
 * - issues: Array of issue snapshots
 * - total: Total count
 * - staleness: Staleness info (last synced, hours since)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  listIssueSnapshots,
  getSyncStaleness,
  getRecentSyncRuns,
} from '../../../../src/lib/db/issueSync';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';

/**
 * GET /api/issues/status
 * 
 * List issue snapshots with sync metadata
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const state = searchParams.get('state') as 'open' | 'closed' | null;
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Fetch issue snapshots
    const snapshotsResult = await listIssueSnapshots(pool, {
      state: state || undefined,
      limit,
      offset,
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

    const issues = snapshotsResult.data || [];
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
      issues: normalizedIssues,
      total: staleness.total_snapshots,
      limit,
      offset,
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
