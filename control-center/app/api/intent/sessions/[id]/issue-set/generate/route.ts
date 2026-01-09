/**
 * API Route: /api/intent/sessions/[id]/issue-set/generate
 * 
 * Generate issue set from briefing text
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 * Issue E81.5: Evidence Pack for Issue Authoring (audit trail)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { generateIssueSet } from '@/lib/db/intentIssueSets';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import type { IssueDraft } from '@/lib/schemas/issueDraft';
import { createEvidenceRecord, createEvidenceErrorInfo } from '@/lib/intent-issue-evidence';
import { insertEvent } from '@/lib/db/intentIssueAuthoringEvents';

/**
 * POST /api/intent/sessions/[id]/issue-set/generate
 * Generate issue set from briefing text and constraints
 * 
 * Body: {
 *   briefingText: string,
 *   issueDrafts: IssueDraft[],
 *   constraints?: Record<string, unknown>
 * }
 * 
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 * Returns 400 if body is invalid or exceeds bounds
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
    
    // Validate required fields
    if (!body || typeof body.briefingText !== 'string') {
      return errorResponse('Missing briefingText in body', {
        status: 400,
        requestId,
      });
    }

    if (!Array.isArray(body.issueDrafts)) {
      return errorResponse('Missing or invalid issueDrafts array in body', {
        status: 400,
        requestId,
      });
    }

    // Validate bounds
    if (body.issueDrafts.length > 20) {
      return errorResponse('Issue set exceeds maximum size of 20 items', {
        status: 400,
        requestId,
        details: { count: body.issueDrafts.length, max: 20 },
      });
    }

    if (body.issueDrafts.length === 0) {
      return errorResponse('Issue set must contain at least one item', {
        status: 400,
        requestId,
      });
    }

    // Validate briefing text length
    if (body.briefingText.length > 50000) {
      return errorResponse('Briefing text exceeds maximum size of 50000 characters', {
        status: 400,
        requestId,
        details: { length: body.briefingText.length, max: 50000 },
      });
    }
    
    // Generate the issue set
    const result = await generateIssueSet(
      pool,
      sessionId,
      userId,
      body.briefingText,
      body.issueDrafts as IssueDraft[],
      body.constraints
    );
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to generate issue set', {
        status: 500,
        requestId,
        details: result.error,
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
          action: 'issue_set_generate',
          params: {
            briefing_length: body.briefingText.length,
            issue_count: body.issueDrafts.length,
            has_constraints: !!body.constraints,
          },
          result: {
            success: true,
            issue_set_id: result.data?.id,
            source_hash: result.data?.source_hash,
            total_items: result.items.length,
            valid_count: result.items.filter(i => i.last_validation_status === 'valid').length,
            invalid_count: result.items.filter(i => i.last_validation_status === 'invalid').length,
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
        { requestId, sessionId, action: 'issue_set_generate' }
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
      issueSet: result.data,
      items: result.items,
      summary: {
        total: result.items.length,
        valid: result.items.filter(i => i.last_validation_status === 'valid').length,
        invalid: result.items.filter(i => i.last_validation_status === 'invalid').length,
      },
      evidenceRecorded,
    }, { 
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-set/generate] Error:', error);
    return errorResponse('Failed to generate issue set', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
