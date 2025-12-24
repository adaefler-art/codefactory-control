/**
 * API Route: /api/issues/[id]/events
 * 
 * Retrieves activity log events for an AFU9 issue
 * Issue #5: AFU9 Single-Issue Mode Enforcement + Activity Log
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getIssueEvents } from '../../../../../src/lib/db/afu9Issues';
import { isValidUUID } from '../../../../../src/lib/utils/uuid-validator';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';

/**
 * GET /api/issues/[id]/events
 * 
 * Retrieves the activity log events for an issue
 * 
 * Query parameters:
 * - limit: Maximum number of events to return (default: 100, max: 500)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pool = getPool();
    const { id } = params;

    // Validate UUID format
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: 'Invalid issue ID format' },
        { status: 400 }
      );
    }

    // Parse limit parameter
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      500
    );

    // Get events from database
    const result = await getIssueEvents(pool, id, limit);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to get issue events', details: result.error },
        { status: 500 }
      );
    }

    const responseBody: any = {
      events: result.data || [],
      total: (result.data || []).length,
      limit,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[API /api/issues/[id]/events] Error getting events:', error);
    return NextResponse.json(
      {
        error: 'Failed to get issue events',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
