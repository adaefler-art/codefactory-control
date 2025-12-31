/**
 * API Route: /api/intent/sessions
 * 
 * Manages INTENT sessions - list and create operations
 * Issue E73.1: INTENT Console UI Shell
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listIntentSessions, createIntentSession } from '@/lib/db/intentSessions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/sessions
 * List recent INTENT sessions
 * 
 * Query parameters:
 * - limit: Results per page (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 * - status: Filter by status (active, archived)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;
    
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50', 10),
      100
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const status = searchParams.get('status') as 'active' | 'archived' | null;
    
    if (status && status !== 'active' && status !== 'archived') {
      return errorResponse('Invalid status parameter', {
        status: 400,
        requestId,
        details: 'Status must be "active" or "archived"',
      });
    }
    
    const result = await listIntentSessions(pool, {
      limit,
      offset,
      status: status || undefined,
    });
    
    if (!result.success) {
      return errorResponse('Failed to list sessions', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({
      sessions: result.data,
      total: result.data.length,
      limit,
      offset,
    }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions] Error listing sessions:', error);
    return errorResponse('Failed to list sessions', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /api/intent/sessions
 * Create a new INTENT session
 * 
 * Body:
 * - title: string (optional)
 * - status: 'active' | 'archived' (optional, default: 'active')
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const body = await request.json();
    
    // Validate input
    if (body.status && body.status !== 'active' && body.status !== 'archived') {
      return errorResponse('Invalid status', {
        status: 400,
        requestId,
        details: 'Status must be "active" or "archived"',
      });
    }
    
    if (body.title && typeof body.title !== 'string') {
      return errorResponse('Invalid title', {
        status: 400,
        requestId,
        details: 'Title must be a string',
      });
    }
    
    const result = await createIntentSession(pool, {
      title: body.title || undefined,
      status: body.status || 'active',
    });
    
    if (!result.success) {
      return errorResponse('Failed to create session', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(result.data, { status: 201, requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions] Error creating session:', error);
    return errorResponse('Failed to create session', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
