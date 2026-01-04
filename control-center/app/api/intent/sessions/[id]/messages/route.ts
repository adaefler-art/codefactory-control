/**
 * API Route: /api/intent/sessions/[id]/messages
 * 
 * Append messages to an INTENT session
 * Issue E73.1: INTENT Console UI Shell
 * Issue E73.2: Sources Panel + used_sources Contract
 * Issue: INTENT Agent MVP + INTENT Console UI auf Control-Center-Standard bringen
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { appendIntentMessage, getIntentSession } from '@/lib/db/intentSessions';
import { generateContextPack } from '@/lib/db/contextPacks';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { UsedSourcesSchema, type UsedSources } from '@/lib/schemas/usedSources';
import { generateIntentResponse, isIntentEnabled, type IntentMessage } from '@/lib/intent-agent';
import { ZodError } from 'zod';

/**
 * POST /api/intent/sessions/[id]/messages
 * Append a user message and generate an INTENT agent reply
 * Only allows appending to sessions owned by the authenticated user
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
    // Feature flag check: fail-closed if INTENT is disabled
    if (!isIntentEnabled()) {
      return errorResponse('INTENT agent is not enabled', {
        status: 404,
        requestId,
        details: 'Set AFU9_INTENT_ENABLED=true to enable INTENT agent',
      });
    }

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
    
    const body = await request.json();
    
    if (!body.content || typeof body.content !== 'string') {
      return errorResponse('Invalid input', {
        status: 400,
        requestId,
        details: 'Content is required and must be a string',
      });
    }
    
    // Fetch conversation history for context
    const sessionResult = await getIntentSession(pool, sessionId, userId);
    
    if (!sessionResult.success) {
      // Auth-first: don't leak whether session exists if access denied
      return errorResponse('Session not found', {
        status: 404,
        requestId,
        details: sessionResult.error,
      });
    }
    
    // Append user message
    const userMessageResult = await appendIntentMessage(
      pool,
      sessionId,
      userId,
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
    
    // Build conversation history for LLM (limit to last 10 messages for context window)
    const conversationHistory: IntentMessage[] = sessionResult.data.messages
      .slice(-10)
      .map(msg => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      }));
    
    // Generate INTENT agent response
    let agentResponse;
    try {
      agentResponse = await generateIntentResponse(body.content, conversationHistory);
    } catch (error) {
      console.error('[API /api/intent/sessions/[id]/messages] INTENT agent error:', error);
      return errorResponse('INTENT agent error', {
        status: 500,
        requestId,
        details: error instanceof Error ? error.message : 'Failed to generate response',
      });
    }
    
    // Append assistant message (no used_sources in MVP)
    const assistantMessageResult = await appendIntentMessage(
      pool,
      sessionId,
      userId,
      'assistant',
      agentResponse.content,
      null // No sources in MVP
    );
    
    if (!assistantMessageResult.success) {
      return errorResponse('Failed to append assistant message', {
        status: 500,
        requestId,
        details: assistantMessageResult.error,
      });
    }
    
    // Generate context pack after successful response (async, don't block response)
    // This ensures audit trail is created for every agent interaction
    generateContextPack(pool, sessionId, userId)
      .then(result => {
        if (result.success) {
          console.log('[API /api/intent/sessions/[id]/messages] Context pack generated:', {
            packId: result.data.id,
            packHash: result.data.pack_hash,
            sessionId,
          });
        } else {
          console.error('[API /api/intent/sessions/[id]/messages] Failed to generate context pack:', result.error);
        }
      })
      .catch(err => {
        console.error('[API /api/intent/sessions/[id]/messages] Context pack generation error:', err);
      });
    
    return jsonResponse({
      userMessage: userMessageResult.data,
      assistantMessage: assistantMessageResult.data,
      agentMetadata: {
        requestId: agentResponse.requestId,
        timestamp: agentResponse.timestamp,
        model: agentResponse.model,
      },
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
