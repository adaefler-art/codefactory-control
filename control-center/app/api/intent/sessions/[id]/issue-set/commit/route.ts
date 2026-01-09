/**
 * API Route: /api/intent/sessions/[id]/issue-set/commit
 * 
 * Commit issue set (make immutable)
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { commitIssueSet } from '@/lib/db/intentIssueSets';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * POST /api/intent/sessions/[id]/issue-set/commit
 * Commit the issue set (mark as immutable)
 * Only commits if all items are valid
 * 
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 * Returns 400 if not all items are valid
 * Returns 404 if no issue set exists
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware (401-first)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
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
    
    // Commit the issue set
    const result = await commitIssueSet(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }

      if (result.error === 'No issue set exists for this session') {
        return errorResponse('No issue set exists', {
          status: 404,
          requestId,
        });
      }

      if (result.error === 'Cannot commit: not all items are valid') {
        return errorResponse('Cannot commit: not all items are valid', {
          status: 400,
          requestId,
          details: 'All items must have valid validation status before committing',
        });
      }

      if (result.error === 'Issue set is already committed') {
        return errorResponse('Issue set is already committed', {
          status: 400,
          requestId,
        });
      }
      
      return errorResponse('Failed to commit issue set', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { 
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-set/commit] Error committing issue set:', error);
    return errorResponse('Failed to commit issue set', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
