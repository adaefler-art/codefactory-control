/**
 * API Route: /api/afu9/issues/[id]
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
import { normalizeIssueForApi } from '../../../issues/_shared';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../issues/_shared';
import { getRequestId, jsonResponse, errorResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { getAfu9IssueByCanonicalId } from '../../../../../src/lib/db/afu9Issues';
import { parseIssueId } from '@/lib/contracts/ids';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/afu9/issues/[id]
 * 
 * Resolve issue by UUID, publicId, or canonicalId
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = getControlResponseHeaders(requestId, routeHeaderValue);
  const { id } = await context.params;

  if (!id || typeof id !== 'string') {
    return errorResponse('Issue identifier required', {
      status: 400,
      requestId,
      headers: responseHeaders,
    });
  }

  try {
    const pool = getPool();
    const parsedId = parseIssueId(id);

    if (parsedId.isValid) {
      const resolved = await resolveIssueIdentifierOr404(id, requestId);
      if (!resolved.ok) {
        return jsonResponse(resolved.body, {
          status: resolved.status,
          requestId,
          headers: responseHeaders,
        });
      }

      const issueRow = resolved.issue as Record<string, unknown>;
      const normalizedIssue = normalizeIssueForApi(issueRow);

      const responseBody: Record<string, unknown> = normalizedIssue;

      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }

      return jsonResponse(responseBody, {
        requestId,
        headers: {
          ...responseHeaders,
          'Cache-Control': 'no-store, max-age=0',
          Pragma: 'no-cache',
        },
      });
    }

    const canonicalResult = await getAfu9IssueByCanonicalId(pool, id);

    if (!canonicalResult.success) {
      return errorResponse('Invalid issue identifier format', {
        status: 400,
        requestId,
        details: 'Identifier must be a valid UUID v4, 8-hex publicId, or canonicalId',
        headers: responseHeaders,
      });
    }

    const issueRow = canonicalResult.data;
    const normalizedIssue = normalizeIssueForApi(issueRow);

    const responseBody: Record<string, unknown> = normalizedIssue;

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return jsonResponse(responseBody, {
      requestId,
      headers: {
        ...responseHeaders,
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    console.error('[API /api/afu9/issues/[id]] Unexpected error:', error);
    return errorResponse('Failed to get issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
      headers: responseHeaders,
    });
  }
}
