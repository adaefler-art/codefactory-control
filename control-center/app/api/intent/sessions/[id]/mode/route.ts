/**
 * API Route: /api/intent/sessions/[id]/mode
 * 
 * V09-I01: Session Conversation Mode (FREE vs DRAFTING) + Persistenz
 * 
 * GET: Retrieve current conversation mode for a session
 * PUT: Update conversation mode for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getIntentSession, updateSessionMode } from '@/lib/db/intentSessions';
import { logToolExecution } from '@/lib/db/toolExecutionAudit';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import {
  ConversationModeResponseV1Schema,
  ConversationModeUpdateRequestSchema,
  CONVERSATION_MODE_VERSION,
} from '@/lib/schemas/conversationMode';

/**
 * GET /api/intent/sessions/[id]/mode
 * Retrieve current conversation mode for a session
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
    
    if (!sessionId || !sessionId.trim()) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Get session to verify ownership and retrieve mode
    const result = await getIntentSession(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get session mode', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    // Build deterministic response with versioned schema
    const response: typeof ConversationModeResponseV1Schema._type = {
      version: CONVERSATION_MODE_VERSION,
      mode: result.data.conversation_mode,
      updatedAt: result.data.updated_at,
    };
    
    // Validate response schema (defensive)
    const validated = ConversationModeResponseV1Schema.safeParse(response);
    if (!validated.success) {
      console.error('[API /api/intent/sessions/[id]/mode] Schema validation failed:', validated.error);
      return errorResponse('Internal server error', {
        status: 500,
        requestId,
        details: 'Response schema validation failed',
      });
    }
    
    return jsonResponse(validated.data, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/mode] Error getting mode:', error);
    return errorResponse('Failed to get session mode', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * PUT /api/intent/sessions/[id]/mode
 * Update conversation mode for a session
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
    
    if (!sessionId || !sessionId.trim()) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return errorResponse('Invalid JSON', {
        status: 400,
        requestId,
      });
    }
    
    const validation = ConversationModeUpdateRequestSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse('Invalid input', {
        status: 400,
        requestId,
        details: validation.error?.errors?.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') || 'Validation failed',
      });
    }
    
    const { mode } = validation.data;
    
    // Get previous mode for audit
    const prevSession = await getIntentSession(pool, sessionId, userId);
    const previousMode = prevSession.success ? prevSession.data.conversation_mode : null;
    
    // Update session mode
    const result = await updateSessionMode(pool, sessionId, userId, mode);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to update session mode', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    // I903: Audit mode transition
    await logToolExecution(pool, {
      sessionId,
      userId,
      toolName: `mode_transition:${previousMode || 'unknown'}_to_${mode}`,
      triggerType: 'UI_ACTION',
      conversationMode: mode as 'DISCUSS' | 'DRAFTING' | 'ACT',
      success: true,
    });
    
    // Build deterministic response with versioned schema
    const response: typeof ConversationModeResponseV1Schema._type = {
      version: CONVERSATION_MODE_VERSION,
      mode: result.data.mode,
      updatedAt: result.data.updated_at,
    };
    
    // Validate response schema (defensive)
    const validated = ConversationModeResponseV1Schema.safeParse(response);
    if (!validated.success) {
      console.error('[API /api/intent/sessions/[id]/mode] Schema validation failed:', validated.error);
      return errorResponse('Internal server error', {
        status: 500,
        requestId,
        details: 'Response schema validation failed',
      });
    }
    
    return jsonResponse(validated.data, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/mode] Error updating mode:', error);
    return errorResponse('Failed to update session mode', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
