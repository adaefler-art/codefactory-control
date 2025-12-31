/**
 * API Route: /api/intent/sessions/[id]
 * 
 * Get a specific INTENT session with messages
 * Issue E73.1: INTENT Console UI Shell
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getIntentSession } from '@/lib/db/intentSessions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions/[id]
 * Get session with all messages ordered by seq
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const sessionId = params.id;
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await getIntentSession(pool, sessionId);
    
    if (!result.success) {
      if (result.error === 'Session not found') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get session', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]] Error getting session:', error);
    return errorResponse('Failed to get session', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
