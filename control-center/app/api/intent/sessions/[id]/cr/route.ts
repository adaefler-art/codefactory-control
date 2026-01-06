/**
 * API Route: /api/intent/sessions/[id]/cr
 * 
 * Manage Change Request (CR) drafts for INTENT sessions
 * Issue E74.3: CR Preview/Edit UI + Validation Gate
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCrDraft, saveCrDraft } from '@/lib/db/intentCrDrafts';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions/[id]/cr
 * Get the current CR draft for a session
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware
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
    
    const result = await getCrDraft(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get CR draft', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({ draft: result.data }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/cr] Error getting CR draft:', error);
    return errorResponse('Failed to get CR draft', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * PUT /api/intent/sessions/[id]/cr
 * Save a CR draft for a session
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware
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
    
    // Parse request body
    let body: { crJson: unknown };
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON in request body', {
        status: 400,
        requestId,
      });
    }
    
    if (!body.crJson) {
      return errorResponse('crJson field is required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await saveCrDraft(pool, sessionId, userId, body.crJson);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to save CR draft', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/cr] Error saving CR draft:', error);
    return errorResponse('Failed to save CR draft', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
