/**
 * API Route: /api/intent/sessions/[id]/messages
 * 
 * Append messages to an INTENT session
 * Issue E73.1: INTENT Console UI Shell
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { appendIntentMessage } from '@/lib/db/intentSessions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * Generate a stub assistant response
 * Simple deterministic response for E73.1 scope
 */
function generateStubResponse(userMessage: string): string {
  // Simple stub: echo with prefix
  return `[Stub] I received: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`;
}

/**
 * POST /api/intent/sessions/[id]/messages
 * Append a user message and generate a stub assistant reply
 * 
 * Body:
 * - content: string (required) - the user message content
 */
export async function POST(
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
    
    const body = await request.json();
    
    if (!body.content || typeof body.content !== 'string') {
      return errorResponse('Invalid input', {
        status: 400,
        requestId,
        details: 'Content is required and must be a string',
      });
    }
    
    // Append user message
    const userMessageResult = await appendIntentMessage(
      pool,
      sessionId,
      'user',
      body.content
    );
    
    if (!userMessageResult.success) {
      return errorResponse('Failed to append user message', {
        status: 500,
        requestId,
        details: userMessageResult.error,
      });
    }
    
    // Generate and append stub assistant response
    const stubResponse = generateStubResponse(body.content);
    const assistantMessageResult = await appendIntentMessage(
      pool,
      sessionId,
      'assistant',
      stubResponse
    );
    
    if (!assistantMessageResult.success) {
      return errorResponse('Failed to append assistant message', {
        status: 500,
        requestId,
        details: assistantMessageResult.error,
      });
    }
    
    return jsonResponse({
      userMessage: userMessageResult.data,
      assistantMessage: assistantMessageResult.data,
    }, { status: 201, requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/messages] Error appending message:', error);
    return errorResponse('Failed to append message', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
