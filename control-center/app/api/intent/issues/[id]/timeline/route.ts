/**
 * API Route: GET /api/intent/issues/[id]/timeline
 * 
 * Get timeline events for an AFU-9 Issue
 * 
 * Returns a chronological list of lifecycle events for the issue.
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueTimelineEvents } from '@/lib/db/issueTimeline';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    // Authentication check
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
      });
    }
    
    // Get issue ID from params
    const { id: issueId } = await context.params;
    
    if (!issueId) {
      return errorResponse('Issue ID required', {
        status: 400,
        requestId,
      });
    }
    
    const pool = getPool();
    
    // Get timeline events
    const result = await getIssueTimelineEvents(pool, issueId);
    
    if (!result.success) {
      return errorResponse('Failed to get timeline events', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({
      success: true,
      issue_id: issueId,
      events: result.data || [],
      count: result.data?.length || 0,
    }, {
      status: 200,
      requestId,
    });
  } catch (error) {
    console.error('[API /api/intent/issues/[id]/timeline] Error:', error);
    return errorResponse('Failed to get timeline events', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
