/**
 * API Route: /api/afu9/issues
 * 
 * I201.1: Canonical Issues API as Single Source of Truth
 * 
 * This is the canonical API for listing AFU9 issues.
 * All other issue listing endpoints should delegate to this.
 * 
 * Query parameters:
 * - canonicalId (or canonical_id): Filter by canonical ID (e.g., I867, E81.1)
 * - publicId (or public_id): Filter by 8-hex publicId
 * - status: Filter by status (CREATED, ACTIVE, BLOCKED, DONE)
 * - limit: Results per page (default: 100, max: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Response format:
 * {
 *   issues: [...],
 *   total: number,      // Total count from DB query
 *   filtered: number,   // Count after filtering
 *   limit: number,
 *   offset: number
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { listAfu9Issues } from '../../../../src/lib/db/afu9Issues';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { normalizeIssueForApi } from '../../issues/_shared';
import {
  Afu9IssueStatus,
  isValidStatus,
} from '../../../../src/lib/contracts/afu9Issue';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads of sync metadata in production/CDN layers.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/afu9/issues
 * Canonical issue listing API with deterministic filtering
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    // Parse canonicalId filter (support both canonicalId and canonical_id)
    const canonicalId = searchParams.get('canonicalId') || searchParams.get('canonical_id') || undefined;

    // Parse publicId filter (support both publicId and public_id)
    const publicId = searchParams.get('publicId') || searchParams.get('public_id') || undefined;

    // Parse and validate status filter
    const statusParam = searchParams.get('status');
    let status: Afu9IssueStatus | undefined;
    if (statusParam) {
      if (!isValidStatus(statusParam)) {
        return errorResponse('Invalid status parameter', {
          status: 400,
          requestId,
          details: `Status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`,
        });
      }
      status = statusParam as Afu9IssueStatus;
    }

    // Parse pagination
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      100
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Get issues from database with filters applied at DB level
    const result = await listAfu9Issues(pool, {
      canonicalId,
      publicId,
      status,
      limit,
      offset,
    });

    if (!result.success) {
      return errorResponse('Failed to list issues', {
        status: 500,
        requestId,
        details: result.error,
      });
    }

    const issues = result.data || [];

    // Build response with deterministic counts
    const responseBody: any = {
      issues: issues.map((issue) => normalizeIssueForApi(issue)),
      total: issues.length,     // Total from DB (already filtered)
      filtered: issues.length,  // Same as total (no post-query filtering)
      limit,
      offset,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return jsonResponse(responseBody, {
      requestId,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    console.error('[API /api/afu9/issues] Error listing issues:', error);
    return errorResponse('Failed to list issues', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
