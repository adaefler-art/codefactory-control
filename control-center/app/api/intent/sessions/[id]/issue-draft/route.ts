/**
 * API Route: /api/intent/sessions/[id]/issue-draft
 * 
 * Get and save issue drafts for INTENT sessions
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 * Issue E81.5: Evidence Pack for Issue Authoring (audit trail)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueDraft, saveIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { createEvidenceRecord, createEvidenceErrorInfo } from '@/lib/intent-issue-evidence';
import { insertEvent } from '@/lib/db/intentIssueAuthoringEvents';

/**
 * GET /api/intent/sessions/[id]/issue-draft
 * Load current draft for a session
 * 
 * Returns 404 if no draft exists yet
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware (401-first)
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
    
    const result = await getIssueDraft(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }

      if (result.error === 'MIGRATION_REQUIRED') {
        console.error('[API /api/intent/sessions/[id]/issue-draft] MIGRATION_REQUIRED', {
          requestId,
          sessionId,
          code: 'MIGRATION_REQUIRED',
        });
        return errorResponse('Database migration required', {
          status: 503,
          requestId,
          code: 'MIGRATION_REQUIRED',
          details: 'intent_issue_drafts table is missing (run migrations)',
        });
      }
      
      return errorResponse('Failed to get issue draft', {
        status: 500,
        requestId,
        details: 'DATABASE_ERROR',
      });
    }
    
    // Return 200 with success:true, draft:null for empty state (not an error)
    if (!result.data) {
      return jsonResponse(
        {
          success: true,
          draft: null,
          reason: 'NO_DRAFT',
        },
        { 
          requestId,
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }
    
    return jsonResponse(
      {
        success: true,
        draft: result.data,
      },
      { 
        requestId,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-draft] Error getting draft:', error);
    return errorResponse('Failed to get issue draft', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}

/**
 * PUT /api/intent/sessions/[id]/issue-draft
 * Save draft (upsert) - allows invalid drafts but stores them
 * 
 * Body: { issue_json: unknown }
 * 
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 * Returns 400 if body is invalid
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware (401-first)
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
    
    // Parse body
    let body: any;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body', {
        status: 400,
        requestId,
      });
    }
    
    if (!body || typeof body.issue_json === 'undefined') {
      return errorResponse('Missing issue_json in body', {
        status: 400,
        requestId,
      });
    }
    
    // Save draft (without validation - validation is separate endpoint)
    const result = await saveIssueDraft(pool, sessionId, userId, body.issue_json);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to save issue draft', {
        status: 500,
        requestId,
        details: 'DATABASE_ERROR',
      });
    }
    
    // E81.5: Create evidence record (required for audit - fail if insert fails)
    let evidenceRecorded = false;
    let evidenceError: any = null;
    
    try {
      const evidence = await createEvidenceRecord(
        {
          requestId,
          sessionId,
          sub: userId,
          action: 'draft_save',
          params: { issue_json: body.issue_json },
          result: {
            success: true,
            draft_id: result.data?.id,
            issue_hash: result.data?.issue_hash,
          },
        },
        pool
      );
      
      const insertResult = await insertEvent(pool, evidence);
      if (!insertResult.success) {
        evidenceError = new Error(`Evidence insert failed: ${insertResult.error}`);
        (evidenceError as any).code = 'EVIDENCE_INSERT_FAILED';
        throw evidenceError;
      }
      
      evidenceRecorded = true;
    } catch (error) {
      // Create secret-free error info
      const errorInfo = createEvidenceErrorInfo(
        error instanceof Error ? error : new Error(String(error)),
        { requestId, sessionId, action: 'draft_save' }
      );
      
      // Structured logging without secrets
      console.error('[API] Evidence recording failed:', {
        code: errorInfo.code,
        message: errorInfo.message,
        requestId: errorInfo.requestId,
        sessionId: errorInfo.sessionId,
        action: errorInfo.action,
        timestamp: errorInfo.timestamp,
      });
      
      // Return 500 with deterministic error code (no secrets)
      return errorResponse('Evidence recording failed', {
        status: 500,
        requestId,
        details: {
          code: errorInfo.code,
          message: errorInfo.message,
          action: errorInfo.action,
        },
      });
    }
    
    return jsonResponse({
      ...result.data,
      evidenceRecorded,
    }, { 
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-draft] Error saving draft:', error);
    return errorResponse('Failed to save issue draft', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
