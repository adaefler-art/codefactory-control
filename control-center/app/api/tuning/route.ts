/**
 * API Route: Get Tuning Suggestions
 * 
 * GET /api/tuning?window=daily&from=...&to=...
 * 
 * Retrieves tuning suggestions for a time range.
 * 
 * Query parameters:
 * - window: Aggregation window (daily, weekly, release, custom) - optional
 * - from: Start timestamp (ISO 8601) - optional
 * - to: End timestamp (ISO 8601) - optional
 * - limit: Max results to return (default: 50, max: 200)
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getTuningSuggestions } from '@/lib/tuning-suggestions-service';
import { getRequestId, errorResponse, jsonResponse } from '@/lib/api/response-helpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    // Authentication: fail-closed, require x-afu9-sub
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') || undefined;
    const fromDateStr = searchParams.get('from') || undefined;
    const toDateStr = searchParams.get('to') || undefined;
    const limitStr = searchParams.get('limit');

    // Validate and parse pagination parameters
    const limitParsed = limitStr ? parseInt(limitStr, 10) : 50;

    if (isNaN(limitParsed)) {
      return errorResponse('Invalid pagination parameters', {
        status: 400,
        requestId,
        details: 'limit must be a valid integer',
      });
    }

    const limit = Math.min(Math.max(1, limitParsed), 200); // Clamp between 1 and 200

    // Parse dates
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (fromDateStr) {
      fromDate = new Date(fromDateStr);
      if (isNaN(fromDate.getTime())) {
        return errorResponse('Invalid from date', {
          status: 400,
          requestId,
          details: 'from must be a valid ISO 8601 timestamp',
        });
      }
    }

    if (toDateStr) {
      toDate = new Date(toDateStr);
      if (isNaN(toDate.getTime())) {
        return errorResponse('Invalid to date', {
          status: 400,
          requestId,
          details: 'to must be a valid ISO 8601 timestamp',
        });
      }
    }

    console.log('[API] Retrieving tuning suggestions:', {
      window,
      fromDate: fromDate?.toISOString(),
      toDate: toDate?.toISOString(),
      limit,
      userId,
    });

    const pool = getPool();

    const suggestions = await getTuningSuggestions(pool, {
      window,
      fromDate,
      toDate,
      limit,
    });

    return jsonResponse({
      success: true,
      suggestions,
      count: suggestions.length,
      hasMore: suggestions.length >= limit,
      filters: {
        window,
        from: fromDate?.toISOString(),
        to: toDate?.toISOString(),
        limit,
      },
    }, { requestId });
  } catch (error) {
    console.error('[API] Error retrieving tuning suggestions:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
