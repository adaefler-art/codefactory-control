/**
 * API Route: /api/intent/sessions/[id]/issue-draft/versions
 * 
 * List immutable issue draft versions for a session
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listIssueDraftVersions } from '@/lib/db/intentIssueDraftVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions/[id]/issue-draft/versions
 * List all committed versions for a session (newest first)
 * 
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 * 
 * Returns list of version metadata without full issue JSON (bounded output)
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 */
export async function GET(
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
    
    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50', 10),
      100
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    if (limit < 1 || offset < 0) {
      return errorResponse('Invalid pagination parameters', {
        status: 400,
        requestId,
      });
    }
    
    // List versions
    const result = await listIssueDraftVersions(pool, sessionId, userId, {
      limit,
      offset,
    });
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to list issue draft versions', {
        status: 500,
        requestId,
        details: 'DATABASE_ERROR',
      });
    }
    
    return jsonResponse({
      versions: result.data,
      total: result.data.length,
      limit,
      offset,
    }, { 
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-draft/versions] Error:', error);
    return errorResponse('Failed to list issue draft versions', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
