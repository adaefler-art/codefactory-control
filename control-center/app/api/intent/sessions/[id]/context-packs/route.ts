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
 * Default limit for context pack list responses
 */
const DEFAULT_PACK_LIMIT = 50;

/**
 * Maximum limit for context pack list responses
 */
const MAX_PACK_LIMIT = 100;

/**
 * GET /api/intent/sessions/[id]/context-packs
 * List all context packs for a session (newest first)
 * 
 * Returns metadata only (without full pack_json) to avoid large payloads
 * 
 * Query parameters:
 * - limit: Maximum number of packs to return (default: 50, max: 100)
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
    
    // Parse limit parameter
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    let limit = DEFAULT_PACK_LIMIT;
    
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return errorResponse('Invalid limit parameter', {
          status: 400,
          requestId,
          details: 'Limit must be a positive integer',
        });
      }
      limit = Math.min(parsedLimit, MAX_PACK_LIMIT);
    }
    
    const result = await listContextPacksMetadata(pool, sessionId, userId, limit);
    
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
