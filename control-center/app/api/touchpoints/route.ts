/**
 * GET /api/touchpoints - Query Manual Touchpoints (E88.1)
 * 
 * Retrieves manual touchpoint records with filtering and aggregation.
 * 
 * Query parameters:
 * - cycleId: Filter by release cycle
 * - issueId: Filter by AFU-9 issue UUID
 * - ghIssueNumber: Filter by GitHub issue number
 * - prNumber: Filter by PR number
 * - type: Filter by touchpoint type
 * - stats: Return aggregated statistics (true/false)
 * - limit: Max records to return (default: 100, max: 1000)
 * 
 * Response format:
 * {
 *   touchpoints: ManualTouchpointRecord[],
 *   stats: {
 *     total: number,
 *     byType: { ASSIGN: number, REVIEW: number, ... },
 *     bySource: { UI: number, INTENT: number, ... },
 *     uniqueActors: number
 *   }
 * }
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import {
  getTouchpointsByCycle,
  getTouchpointsByIssue,
  getTouchpointsByGhIssue,
  getTouchpointsByPr,
  getRecentTouchpoints,
  getTouchpointStatsByCycle,
  getTouchpointStatsByIssue,
  getGlobalTouchpointStats,
  TouchpointType,
} from '@/lib/db/manualTouchpoints';

// ========================================
// GET Handler
// ========================================

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    // Get query parameters
    const { searchParams } = new URL(request.url);
    const cycleId = searchParams.get('cycleId');
    const issueId = searchParams.get('issueId');
    const ghIssueNumber = searchParams.get('ghIssueNumber');
    const prNumber = searchParams.get('prNumber');
    const typeFilter = searchParams.get('type');
    const statsOnly = searchParams.get('stats') === 'true';
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      1000
    );

    const pool = getPool();

    // Validate type filter if provided
    const validTypes: TouchpointType[] = ['ASSIGN', 'REVIEW', 'MERGE_APPROVAL', 'DEBUG_INTERVENTION'];
    if (typeFilter && !validTypes.includes(typeFilter as TouchpointType)) {
      return errorResponse('Invalid type filter', {
        status: 400,
        requestId,
        code: 'INVALID_TYPE',
        details: `Type must be one of: ${validTypes.join(', ')}`,
      });
    }

    // Determine query strategy based on parameters
    let touchpoints;
    let stats;

    if (cycleId) {
      // Query by cycle
      if (statsOnly) {
        stats = await getTouchpointStatsByCycle(pool, cycleId);
        touchpoints = [];
      } else {
        touchpoints = await getTouchpointsByCycle(pool, cycleId, limit);
        stats = await getTouchpointStatsByCycle(pool, cycleId);
      }
    } else if (issueId) {
      // Query by issue
      if (statsOnly) {
        stats = await getTouchpointStatsByIssue(pool, issueId);
        touchpoints = [];
      } else {
        touchpoints = await getTouchpointsByIssue(pool, issueId, limit);
        stats = await getTouchpointStatsByIssue(pool, issueId);
      }
    } else if (ghIssueNumber) {
      // Query by GitHub issue number
      const ghIssueNum = parseInt(ghIssueNumber, 10);
      if (isNaN(ghIssueNum)) {
        return errorResponse('Invalid GitHub issue number', {
          status: 400,
          requestId,
          code: 'INVALID_GH_ISSUE_NUMBER',
        });
      }
      touchpoints = await getTouchpointsByGhIssue(pool, ghIssueNum, limit);
      stats = await getGlobalTouchpointStats(pool);
    } else if (prNumber) {
      // Query by PR number
      const prNum = parseInt(prNumber, 10);
      if (isNaN(prNum)) {
        return errorResponse('Invalid PR number', {
          status: 400,
          requestId,
          code: 'INVALID_PR_NUMBER',
        });
      }
      touchpoints = await getTouchpointsByPr(pool, prNum, limit);
      stats = await getGlobalTouchpointStats(pool);
    } else {
      // Global query (recent touchpoints)
      if (statsOnly) {
        stats = await getGlobalTouchpointStats(pool);
        touchpoints = [];
      } else {
        touchpoints = await getRecentTouchpoints(pool, limit);
        stats = await getGlobalTouchpointStats(pool);
      }
    }

    // Filter by type if specified
    if (typeFilter && touchpoints.length > 0) {
      touchpoints = touchpoints.filter((t) => t.type === typeFilter);
    }

    // Format response
    return jsonResponse(
      {
        touchpoints: touchpoints.map((t) => ({
          id: t.id,
          type: t.type,
          source: t.source,
          actor: t.actor,
          cycleId: t.cycle_id,
          issueId: t.issue_id,
          ghIssueNumber: t.gh_issue_number,
          prNumber: t.pr_number,
          sessionId: t.session_id,
          requestId: t.request_id,
          metadata: t.metadata,
          createdAt: t.created_at.toISOString(),
        })),
        stats: {
          total: stats.total,
          byType: stats.byType,
          bySource: stats.bySource,
          uniqueActors: stats.uniqueActors,
        },
        query: {
          cycleId: cycleId || null,
          issueId: issueId || null,
          ghIssueNumber: ghIssueNumber ? parseInt(ghIssueNumber, 10) : null,
          prNumber: prNumber ? parseInt(prNumber, 10) : null,
          type: typeFilter || null,
          limit,
        },
      },
      { status: 200, requestId }
    );
  } catch (error) {
    console.error('[Touchpoints API] Error querying touchpoints:', error);
    
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      code: 'INTERNAL_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
