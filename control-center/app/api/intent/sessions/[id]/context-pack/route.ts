/**
 * API Route: /api/intent/sessions/[id]/context-pack
 * 
 * Generate or return latest context pack for a session
 * Issue E73.3: Context Pack Generator (audit JSON per session) + Export/Download
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { generateContextPack } from '@/lib/db/contextPacks';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * POST /api/intent/sessions/[id]/context-pack
 * Generate or return existing context pack for a session
 * 
 * Implements idempotency: if same pack_hash exists, returns existing record
 */
export async function POST(
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
    
    const result = await generateContextPack(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to generate context pack', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { requestId, status: 201 });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/context-pack] Error generating context pack:', error);
    return errorResponse('Failed to generate context pack', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
