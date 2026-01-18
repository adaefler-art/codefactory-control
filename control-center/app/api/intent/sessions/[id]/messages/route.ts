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
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { listIntentToolSpecs, getToolGateStatus } from '@/lib/intent-tool-registry';
import { checkDevModeActionAllowed, getDevModeActionForTool } from '@/lib/guards/intent-dev-mode';
import { executeIntentTool } from '@/lib/intent-agent-tool-executor';

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

function safeParseToolResult(result: string): { success?: boolean; code?: string } | null {
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object') {
      return parsed as { success?: boolean; code?: string };
    }
  } catch (err) {
    return null;
  }
  return null;
}

function buildMinimalDraft(sessionId: string, userText: string, explicitCanonicalId?: string): IssueDraft {
  const canonicalId = explicitCanonicalId || deterministicI8xx(sessionId);
  const title = explicitCanonicalId || clampTitle(userText);

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
    
    // I903: Classify message to determine trigger type
    const classification = classifyMessage(body.content);
    const rawMode = sessionResult.data.conversation_mode;
    
    // Normalize mode: handle legacy 'FREE' by mapping to 'DISCUSS'
    const conversationMode = rawMode === ('FREE' as any) ? 'DISCUSS' : rawMode;
    
    console.log('[API /api/intent/sessions/[id]/messages] Message classification', {
      requestId,
      sessionId: sessionId.substring(0, 20),
      rawMode,
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
    
    // I903: Determine trigger type for tool execution
    // - USER_EXPLICIT: Explicit action command detected by classifier
    // - AUTO_ALLOWED: Non-action intent (read-only operations allowed in any mode)
    const triggerType = classification.isActionIntent ? 'USER_EXPLICIT' : 'AUTO_ALLOWED';
    
    // Generate INTENT agent response with rate limiting, trigger type, and three-stage mode
    let agentResponse;
    try {
      agentResponse = await generateIntentResponse(
        body.content,
        conversationHistory,
        userId,
        sessionId,
        triggerType,  // I903: Pass trigger type to agent
        conversationMode as 'DISCUSS' | 'DRAFTING' | 'ACT'  // I903: Pass three-stage mode to agent
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

    const debugExecutionErrors: string[] = agentResponse.debug?.executionErrors ?? [];
    const debugPlannedToolCallIds: string[] = agentResponse.debug?.plannedToolCallIds ?? [];
    const debugExecutedToolCallIds: string[] = agentResponse.debug?.executedToolCallIds ?? [];

    const draftCreateActionTypes = new Set([
      'slash_draft',
      'draft_create',
    ]);

    const shouldAutoDraft =
      conversationMode === 'DRAFTING' &&
      classification.isActionIntent &&
      classification.actionType &&
      draftCreateActionTypes.has(classification.actionType);

    if (shouldAutoDraft && !debugExecutedToolCallIds.includes('save_issue_draft')) {
      const canonicalMatch = body.content.match(/canonicalId\s*=\s*([A-Za-z0-9:_-]+)/i);
      const explicitCanonicalId = canonicalMatch?.[1];
      const draftPayload = buildMinimalDraft(sessionId, body.content, explicitCanonicalId);

      const toolContext = { userId, sessionId, triggerType, conversationMode: 'DRAFTING' as const };

      const saveResult = await executeIntentTool('save_issue_draft', { issueJson: draftPayload }, toolContext);
      debugExecutedToolCallIds.push('save_issue_draft');
      const saveParsed = safeParseToolResult(saveResult) as { success?: boolean; code?: string } | null;
      if (saveParsed?.success === false) {
        debugExecutionErrors.push(saveParsed.code || 'TOOL_EXECUTION_ERROR');
      }

      const validateResult = await executeIntentTool('validate_issue_draft', { issueJson: draftPayload }, toolContext);
      debugExecutedToolCallIds.push('validate_issue_draft');
      const validateParsed = safeParseToolResult(validateResult) as { success?: boolean; code?: string } | null;
      if (validateParsed?.success === false) {
        debugExecutionErrors.push(validateParsed.code || 'TOOL_EXECUTION_ERROR');
      }
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
    
    const isStaging = getDeploymentEnv() === 'staging';
    const intentToolSpecs = listIntentToolSpecs();
    const allowedToolIds = intentToolSpecs
      .filter(spec => {
        const gate = getToolGateStatus(spec.name, { userId, sessionId });
        if (!gate.enabled) return false;

        if (conversationMode === 'DISCUSS' && spec.isDraftMutating && triggerType !== 'USER_EXPLICIT') {
          const devModeAction = getDevModeActionForTool(spec.name);
          const devModeCheck = devModeAction
            ? checkDevModeActionAllowed(userId, devModeAction, { sessionId, toolName: spec.name, requestId })
            : { allowed: false };
          return devModeCheck.allowed;
        }

        return true;
      })
      .map(spec => spec.name);

    const debugPayload = isStaging
      ? {
          conversationMode,
          allowedToolIds,
          plannedToolCallIds: debugPlannedToolCallIds,
          executedToolCallIds: debugExecutedToolCallIds,
          executionErrors: debugExecutionErrors,
          requestId,
        }
      : undefined;

    return jsonResponse({
      userMessage: userMessageResult.data,
      assistantMessage: assistantMessageResult.data,
      agentMetadata: {
        requestId: agentResponse.requestId,
        timestamp: agentResponse.timestamp,
        model: agentResponse.model,
      },
      issueDraftAutoCreate,
      debug: debugPayload,
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
