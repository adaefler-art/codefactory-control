/**
 * API Route: /api/intent/sessions/[id]/publish-batches
 * 
 * Query publish batches for a session with pagination
 * Issue E89.7: Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { queryPublishBatchesBySession, queryPublishItemsByBatchId } from '@/lib/db/intentIssueSetPublishLedger';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions/[id]/publish-batches
 * 
 * Query publish batches for a session
 * 
 * Query Parameters:
 * - limit: Maximum number of batches to return (default: 50, max: 100)
 * - offset: Number of batches to skip (default: 0)
 * - include_items: If 'true', include items for each batch (default: false)
 * 
 * Returns:
 * - 200: Success with batches array
 * - 400: Invalid request (invalid limit/offset)
 * - 401: Unauthorized
 * - 403: Forbidden (session not owned by user)
 * - 404: Session not found
 * - 500: Internal error
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);

  try {
    // Authentication
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
      });
    }

    // Await params (Next.js 13.4+)
    const { id: sessionId } = await context.params;

    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const includeItems = searchParams.get('include_items') === 'true';

    let limit = 50; // default
    let offset = 0; // default

    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return errorResponse('Invalid limit parameter', {
          status: 400,
          requestId,
          details: 'Limit must be between 1 and 100',
        });
      }
      limit = parsedLimit;
    }

    if (offsetParam) {
      const parsedOffset = parseInt(offsetParam, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return errorResponse('Invalid offset parameter', {
          status: 400,
          requestId,
          details: 'Offset must be a non-negative integer',
        });
      }
      offset = parsedOffset;
    }

    const pool = getPool();

    // Verify session exists and is owned by user
    const sessionResult = await pool.query(
      `SELECT id, user_id FROM intent_sessions WHERE id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return errorResponse('Session not found', {
        status: 404,
        requestId,
        details: 'Session does not exist',
      });
    }

    const session = sessionResult.rows[0];
    if (session.user_id !== userId) {
      return errorResponse('Forbidden', {
        status: 403,
        requestId,
        code: 'FORBIDDEN',
        details: 'You do not have access to this session',
      });
    }

    // Query publish batches for this session
    const batchesResult = await queryPublishBatchesBySession(pool, sessionId, {
      limit,
      offset,
    });

    if (!batchesResult.success) {
      return errorResponse('Failed to query publish batches', {
        status: 500,
        requestId,
        details: batchesResult.error,
      });
    }

    const batches = batchesResult.data;

    // If include_items is true, fetch items for each batch
    if (includeItems && batches.length > 0) {
      for (const batch of batches) {
        const itemsResult = await queryPublishItemsByBatchId(pool, batch.batch_id, {
          limit: 100, // reasonable default for items per batch
        });

        if (itemsResult.success) {
          batch.items = itemsResult.data;
        } else {
          // Log error but don't fail the whole request
          console.error(`[API] Failed to fetch items for batch ${batch.batch_id}:`, itemsResult.error);
          batch.items = [];
        }
      }
    }

    return jsonResponse(
      {
        success: true,
        batches,
        pagination: {
          limit,
          offset,
          count: batches.length,
        },
      },
      {
        status: 200,
        requestId,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/publish-batches] Error querying publish batches:', error);
    return errorResponse('Failed to query publish batches', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
