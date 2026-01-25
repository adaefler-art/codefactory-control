/**
 * API Route: /api/afu9/issues/[ref]
 * 
 * Epic-1 v0.9: Issue Detail Endpoint
 * 
 * Returns a single AFU-9 issue by:
 * - UUID v4 (canonical identifier)
 * - publicId (8-hex prefix)
 * - canonicalId (e.g., I811, E81.1)
 * 
 * Response codes:
 * - 200: Issue found
 * - 400: Invalid identifier format
 * - 404: Issue not found
 * - 500: Internal server error
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { fetchIssueRowByIdentifier } from '../../../issues/_shared';
import { normalizeIssueForApi } from '../../../issues/_shared';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { getAfu9IssueByCanonicalId } from '../../../../../src/lib/db/afu9Issues';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{ ref: string }>;
}

/**
 * GET /api/afu9/issues/[ref]
 * 
 * Resolve issue by UUID, publicId, or canonicalId
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const requestId = getRequestId(request);
  const { ref } = await context.params;

  if (!ref || typeof ref !== 'string') {
    return errorResponse('Issue identifier required', {
      status: 400,
      requestId,
    });
  }

  try {
    const pool = getPool();

    // Try UUID/publicId lookup first (fast path)
    const result = await fetchIssueRowByIdentifier(pool, ref);

    // Invalid UUID/publicId format → Try canonicalId fallback
    // fetchIssueRowByIdentifier returns 400 when ref doesn't match UUID or 8-hex pattern
    // In this case, try canonicalId lookup as fallback (e.g., "I811", "E81.1")
    if (!result.ok && result.status === 400) {
      const canonicalResult = await getAfu9IssueByCanonicalId(pool, ref);

      if (!canonicalResult.success) {
        // All lookup methods failed - return 400
        return errorResponse('Invalid issue identifier format', {
          status: 400,
          requestId,
          details: 'Identifier must be a valid UUID v4, 8-hex publicId, or canonicalId',
        });
      }

      // Found by canonicalId
      const issueRow = canonicalResult.data;
      const normalizedIssue = normalizeIssueForApi(issueRow);

      const responseBody: Record<string, unknown> = normalizedIssue;

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
    }

    // Database error → 500
    if (!result.ok && result.status === 500) {
      return errorResponse('Database error', {
        status: 500,
        requestId,
        details: result.body.error,
      });
    }

    // Not found → 404
    if (!result.ok && result.status === 404) {
      return errorResponse('Issue not found', {
        status: 404,
        requestId,
      });
    }

    // Success → 200
    const issueRow = result.row;
    const normalizedIssue = normalizeIssueForApi(issueRow);

    const responseBody: Record<string, unknown> = normalizedIssue;

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
    console.error('[API /api/afu9/issues/[ref]] Unexpected error:', error);
    return errorResponse('Failed to get issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
