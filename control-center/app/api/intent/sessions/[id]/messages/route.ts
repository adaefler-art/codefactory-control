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
import { getIssueDraft, validateAndSaveIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { UsedSourcesSchema, type UsedSources } from '@/lib/schemas/usedSources';
import { generateIntentResponse, isIntentEnabled, type IntentMessage } from '@/lib/intent-agent';
import { ISSUE_DRAFT_VERSION, type IssueDraft } from '@/lib/schemas/issueDraft';
import { classifyMessage } from '@/lib/intent/message-classifier';
import { ZodError } from 'zod';
import { createHash } from 'crypto';

function deterministicI8xx(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId, 'utf8').digest();
  const n = digest.readUInt16BE(0) % 100; // 0..99
  const code = 800 + n; // 800..899
  return `I${code}`;
}

function clampTitle(raw: string): string {
  const line = raw.split(/\r?\n/)[0]?.trim() ?? '';
  const title = line.length > 0 ? line : 'INTENT Issue Draft';
  return title.length <= 200 ? title : title.slice(0, 197) + '...';
}

function buildMinimalDraft(sessionId: string, userText: string): IssueDraft {
  const canonicalId = deterministicI8xx(sessionId);
  const title = clampTitle(userText);

  const body = `Canonical-ID: ${canonicalId}\n\n${userText}\n\n## Problem\nUser request captured by INTENT.\n\n## Acceptance Criteria\n- Draft is persisted and visible in the Issue Draft panel\n- Draft validates (schema v${ISSUE_DRAFT_VERSION})\n\n## Verify\n- Run unit tests and ensure UI renders the draft`;

  return {
    issueDraftVersion: ISSUE_DRAFT_VERSION,
    title,
    body,
    type: 'issue',
    canonicalId,
    labels: ['intent', 'v0.8'],
    dependsOn: [],
    priority: 'P2',
    acceptanceCriteria: [
      'Draft is persisted and visible in the Issue Draft panel',
      'Draft validates against Issue Draft Schema',
    ],
    verify: {
      commands: ['npm --prefix control-center test'],
      expected: ['Tests pass'],
    },
    guards: {
      // Schema only allows staging/development; drafts are prod-blocked anyway.
      env: 'development',
      prodBlocked: true,
    },
  };
}

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
  context: { params: Promise<{ id: string }> }
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
    const { id: rawId } = await context.params;
    const sessionId = typeof rawId === 'string' ? rawId.trim() : '';
    
    if (!sessionId) {
      console.warn('[API /api/intent/sessions/[id]/messages] Missing or invalid session id', {
        requestId,
        userId,
        rawParamsId: rawId,
        paramsIdType: typeof rawId,
        trimmedValue: typeof rawId === 'string' ? `"${rawId.trim()}"` : 'N/A',
        isEmpty: typeof rawId === 'string' && rawId.trim() === '',
      });

      return errorResponse('Session ID required', {
        status: 400,
        requestId,
        details: `Invalid session ID received. Type: ${typeof rawId}, Value: "${rawId && typeof rawId === 'string' && rawId.length > 20 ? rawId.substring(0, 20) + '...' : rawId || 'null/undefined'}"`,
      });
    }
    
    if (sessionId.trim() !== sessionId) {
      console.warn('[API] Session ID has leading/trailing whitespace', {
        requestId,
        sessionId: `"${sessionId}"`,
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
    
    // V09-I02: Classify message to determine trigger type
    const classification = classifyMessage(body.content);
    const conversationMode = sessionResult.data.conversation_mode;
    
    console.log('[API /api/intent/sessions/[id]/messages] Message classification', {
      requestId,
      sessionId: sessionId.substring(0, 20),
      conversationMode,
      isActionIntent: classification.isActionIntent,
      actionType: classification.actionType,
      confidence: classification.confidence,
    });
    
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
    
    // V09-I02: Determine trigger type for tool execution
    // - USER_EXPLICIT: Explicit action command detected by classifier
    // - AUTO_ALLOWED: Non-action intent (read-only operations allowed in any mode)
    const triggerType = classification.isActionIntent ? 'USER_EXPLICIT' : 'AUTO_ALLOWED';
    
    // Generate INTENT agent response with rate limiting and trigger type
    let agentResponse;
    try {
      agentResponse = await generateIntentResponse(
        body.content,
        conversationHistory,
        userId,
        sessionId,
        triggerType,  // V09-I02: Pass trigger type to agent
        conversationMode  // V09-I02: Pass conversation mode to agent
      );
    } catch (error) {
      console.error('[API /api/intent/sessions/[id]/messages] INTENT agent error:', error);
      
      // Check for rate limit error
      if (error instanceof Error && error.message.includes('Rate limit exceeded')) {
        return errorResponse('Rate limit exceeded', {
          status: 429,
          requestId,
          details: error.message,
        });
      }
      
      return errorResponse('INTENT agent error', {
        status: 500,
        requestId,
        details: error instanceof Error ? error.message : 'Failed to generate response',
      });
    }
    
    // Append assistant message with used_sources (E89.5)
    const assistantMessageResult = await appendIntentMessage(
      pool,
      sessionId,
      userId,
      'assistant',
      agentResponse.content,
      agentResponse.usedSources || null // E89.5: Pass sources from tool calls
    );
    
    if (!assistantMessageResult.success) {
      return errorResponse('Failed to append assistant message', {
        status: 500,
        requestId,
        details: assistantMessageResult.error,
      });
    }

    // Best-effort: ensure a persisted Issue Draft exists for this session.
    // This unblocks Draft E2E in the UI (no persistent NO_DRAFT after first user message).
    let issueDraftAutoCreate: any = undefined;
    try {
      const trimmed = typeof body.content === 'string' ? body.content.trim() : '';
      if (trimmed) {
        const existing = await getIssueDraft(pool, sessionId, userId);
        if (existing.success && !existing.data) {
          const derived = buildMinimalDraft(sessionId, trimmed);
          issueDraftAutoCreate = await validateAndSaveIssueDraft(pool, sessionId, userId, derived);
        } else {
          issueDraftAutoCreate = { attempted: true, created: false };
        }
      } else {
        issueDraftAutoCreate = { attempted: false };
      }
    } catch (err) {
      // Do not fail the message endpoint on draft write issues.
      console.warn('[API /api/intent/sessions/[id]/messages] Issue draft auto-create failed (non-fatal)', {
        requestId,
        sessionId,
        userId,
        error: err instanceof Error ? err.message : String(err),
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
      issueDraftAutoCreate,
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
