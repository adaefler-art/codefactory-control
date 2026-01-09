/**
 * API Route: /api/intent/sessions/[id]/issue-draft/commit
 * 
 * Commit an issue draft as an immutable version
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 * Issue E81.5: Evidence Pack for Issue Authoring (audit trail)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueDraft } from '@/lib/db/intentIssueDrafts';
import { commitIssueDraftVersion } from '@/lib/db/intentIssueDraftVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { createEvidenceRecord, createEvidenceErrorInfo } from '@/lib/intent-issue-evidence';
import { insertEvent } from '@/lib/db/intentIssueAuthoringEvents';

/**
 * POST /api/intent/sessions/[id]/issue-draft/commit
 * Commit current draft as immutable version
 * 
 * Requires last validation to be 'valid' (fail-closed)
 * Returns existing version if hash matches (idempotency)
 * 
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 * Returns 400 if last validation not valid
 * Returns 404 if no draft exists
 */
export async function POST(
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
    
    // Get current draft to commit
    const draftResult = await getIssueDraft(pool, sessionId, userId);
    
    if (!draftResult.success) {
      if (draftResult.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get issue draft', {
        status: 500,
        requestId,
        details: 'DATABASE_ERROR',
      });
    }
    
    if (!draftResult.data) {
      return errorResponse('No draft exists for this session', {
        status: 404,
        requestId,
      });
    }
    
    // Commit the draft
    const commitResult = await commitIssueDraftVersion(
      pool,
      sessionId,
      userId,
      draftResult.data.issue_json
    );
    
    if (!commitResult.success) {
      if (commitResult.error === 'Cannot commit: last validation status is not valid') {
        return errorResponse('Cannot commit: draft validation is not valid', {
          status: 400,
          requestId,
          details: 'VALIDATION_REQUIRED',
        });
      }
      
      if (commitResult.error === 'No draft exists for this session') {
        return errorResponse('No draft exists for this session', {
          status: 404,
          requestId,
        });
      }
      
      if (commitResult.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to commit issue draft', {
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
          action: 'draft_commit',
          params: { 
            draft_id: draftResult.data.id,
            issue_hash: draftResult.data.issue_hash,
          },
          result: {
            success: true,
            version_id: commitResult.data?.id,
            is_new: commitResult.isNew,
            issue_hash: commitResult.data?.issue_hash,
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
        { requestId, sessionId, action: 'draft_commit' }
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
      version: commitResult.data,
      isNew: commitResult.isNew,
      evidenceRecorded,
    }, { 
      requestId,
      status: commitResult.isNew ? 201 : 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-draft/commit] Error:', error);
    return errorResponse('Failed to commit issue draft', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
