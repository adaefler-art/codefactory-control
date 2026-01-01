/**
 * API Route: /api/intent/sessions/[id]/cr/commit
 * 
 * Commit a CR draft as a new immutable version
 * Issue E74.4: CR Versioning + Diff
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { commitCrVersion } from '@/lib/db/intentCrVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * POST /api/intent/sessions/[id]/cr/commit
 * Commit current draft as new immutable version (if hash new)
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
    
    const result = await commitCrVersion(pool, sessionId, userId, body.crJson);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to commit CR version', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(
      {
        version: result.data,
        isNew: result.isNew,
      },
      { 
        requestId,
        status: result.isNew ? 201 : 200,
      }
    );
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/cr/commit] Error committing CR version:', error);
    return errorResponse('Failed to commit CR version', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
