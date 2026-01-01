/**
 * API Route: /api/intent/sessions/[id]/cr/versions
 * 
 * List CR versions for a session
 * Issue E74.4: CR Versioning + Diff
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listCrVersions } from '@/lib/db/intentCrVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions/[id]/cr/versions
 * List versions newest first (metadata only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const sessionId = params.id;
    
    // Get authenticated user ID from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Parse pagination params
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    const result = await listCrVersions(pool, sessionId, userId, { limit, offset });
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to list CR versions', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({ versions: result.data }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/cr/versions] Error listing CR versions:', error);
    return errorResponse('Failed to list CR versions', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
