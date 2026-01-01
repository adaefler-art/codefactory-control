/**
 * API Route: /api/intent/sessions/[id]/context-packs
 * 
 * List context packs for a session (metadata only, newest first)
 * Issue E73.4: Context Pack Storage/Retrieval (versioning, immutable snapshots)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listContextPacksMetadata } from '@/lib/db/contextPacks';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions/[id]/context-packs
 * List all context packs for a session (newest first)
 * 
 * Returns metadata only (without full pack_json) to avoid large payloads
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
    
    const result = await listContextPacksMetadata(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to list context packs', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({ packs: result.data }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/context-packs] Error listing context packs:', error);
    return errorResponse('Failed to list context packs', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
