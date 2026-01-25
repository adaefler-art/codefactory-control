/**
 * API Route: GET /api/afu9/s1s3/issues
 * 
 * List S1-S3 AFU9 issues with runs and timeline.
 * 
 * Query parameters:
 * - status: Filter by status (optional)
 * - repo: Filter by repo (optional)
 * - limit: Results per page (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Response format:
 * {
 *   issues: [...],
 *   total: number,
 *   limit: number,
 *   offset: number
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { listS1S3Issues } from '@/lib/db/s1s3Flow';
import { S1S3IssueStatus, isValidS1S3Status, normalizeAcceptanceCriteria } from '@/lib/contracts/s1s3Flow';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/afu9/s1s3/issues
 * List S1-S3 issues
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const pool = getPool();

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse status filter
    const statusParam = searchParams.get('status');
    let status: S1S3IssueStatus | undefined;
    if (statusParam) {
      if (!isValidS1S3Status(statusParam)) {
        return errorResponse('Invalid status parameter', {
          status: 400,
          requestId,
          details: `Status must be one of: ${Object.values(S1S3IssueStatus).join(', ')}`,
        });
      }
      status = statusParam as S1S3IssueStatus;
    }

    // Parse repo filter
    const repo = searchParams.get('repo') || undefined;

    // Parse pagination
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    console.log('[S1-S3] List issues:', {
      requestId,
      status,
      repo,
      limit,
      offset,
    });

    // Get issues from database
    const result = await listS1S3Issues(pool, {
      status,
      repo,
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

    // Normalize acceptance_criteria from JSONB
    const normalizedIssues = issues.map((issue) => ({
      ...issue,
      acceptance_criteria: normalizeAcceptanceCriteria(issue.acceptance_criteria),
    }));

    console.log('[S1-S3] Issues fetched:', {
      requestId,
      count: normalizedIssues.length,
    });

    return jsonResponse(
      {
        issues: normalizedIssues,
        total: normalizedIssues.length,
        limit,
        offset,
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
    console.error('[API /api/afu9/s1s3/issues] Error listing issues:', error);
    return errorResponse('Failed to list issues', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
