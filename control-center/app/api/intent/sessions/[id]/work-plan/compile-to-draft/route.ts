/**
 * API Route: /api/intent/sessions/[id]/work-plan/compile-to-draft
 * 
 * V09-I05: Compile Plan → Draft (Deterministischer Compiler)
 * 
 * POST: Compile work plan to issue draft deterministically
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getWorkPlan } from '@/lib/db/intentWorkPlans';
import { saveIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { compileWorkPlanToIssueDraftV1 } from '@/lib/compilers/workPlanToIssueDraft';
import { WorkPlanContentV1Schema } from '@/lib/schemas/workPlan';
import { validateIssueDraft } from '@/lib/schemas/issueDraft';
import { createEvidenceRecord } from '@/lib/intent-issue-evidence';
import { insertEvent } from '@/lib/db/intentIssueAuthoringEvents';

/**
 * POST /api/intent/sessions/[id]/work-plan/compile-to-draft
 * Compile work plan to issue draft
 * 
 * Returns 201 with compiled draft
 * Returns 401 if user not authenticated
 * Returns 404 if session or work plan not found
 * Returns 400 if compilation fails
 * Returns 500 if evidence insert fails (fail-closed)
 */
export async function POST(
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
    
    // Get work plan
    const planResult = await getWorkPlan(pool, sessionId, userId);
    
    if (!planResult.success) {
      if (planResult.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get work plan', {
        status: 500,
        requestId,
        details: planResult.error,
      });
    }
    
    if (planResult.data === null) {
      return errorResponse('No work plan exists for this session', {
        status: 404,
        requestId,
        code: 'NO_WORK_PLAN',
        details: 'Create a work plan first before compiling to draft',
      });
    }
    
    // Validate plan content schema
    const planValidation = WorkPlanContentV1Schema.safeParse(planResult.data.content_json);
    if (!planValidation.success) {
      return errorResponse('Invalid work plan content', {
        status: 400,
        requestId,
        code: 'INVALID_PLAN_SCHEMA',
        details: planValidation.error.message,
      });
    }
    
    // Compile work plan to draft
    const compileResult = compileWorkPlanToIssueDraftV1(planValidation.data);
    
    if (!compileResult.success) {
      return errorResponse('Compilation failed', {
        status: 400,
        requestId,
        code: compileResult.code || 'COMPILATION_FAILED',
        details: compileResult.error,
      });
    }
    
    // Validate compiled draft (defensive check)
    const draftValidation = validateIssueDraft(compileResult.draft);
    if (!draftValidation.success) {
      console.error('[API compile-to-draft] Compiled draft failed validation:', draftValidation.errors);
      return errorResponse('Compiled draft is invalid', {
        status: 500,
        requestId,
        code: 'INVALID_COMPILED_DRAFT',
        details: 'Internal compiler error - output validation failed',
      });
    }
    
    // Save compiled draft
    const saveResult = await saveIssueDraft(pool, sessionId, userId, compileResult.draft);
    
    if (!saveResult.success) {
      if (saveResult.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to save compiled draft', {
        status: 500,
        requestId,
        details: 'DATABASE_ERROR',
      });
    }
    
    // Create evidence record (fail-closed)
    let evidenceRecorded = false;
    
    try {
      const evidence = await createEvidenceRecord(
        {
          requestId,
          sessionId,
          sub: userId,
          action: 'compile_plan_to_draft',
          params: {
            planHash: planResult.data.content_hash,
          },
          result: {
            success: true,
            draft_id: saveResult.data?.id,
            issue_hash: saveResult.data?.issue_hash,
            bodyHash: compileResult.bodyHash,
            canonicalId: compileResult.draft.canonicalId,
          },
        },
        pool
      );
      
      const insertResult = await insertEvent(pool, evidence);
      if (!insertResult.success) {
        const evidenceError = new Error(`Evidence insert failed: ${insertResult.error}`);
        (evidenceError as any).code = 'EVIDENCE_INSERT_FAILED';
        throw evidenceError;
      }
      
      evidenceRecorded = true;
    } catch (error) {
      console.error('[API compile-to-draft] Evidence recording failed:', {
        code: error instanceof Error ? (error as any).code : 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        requestId,
        sessionId,
      });
      
      return errorResponse('Evidence recording failed', {
        status: 500,
        requestId,
        details: {
          code: 'EVIDENCE_INSERT_FAILED',
          message: 'Failed to record compilation evidence',
          action: 'compile_plan_to_draft',
        },
      });
    }
    
    // Success response
    return jsonResponse({
      success: true,
      draft: {
        id: saveResult.data.id,
        issue_hash: saveResult.data.issue_hash,
        canonicalId: compileResult.draft.canonicalId,
        title: compileResult.draft.title,
        bodyHash: compileResult.bodyHash,
      },
      compilation: {
        planHash: planResult.data.content_hash.substring(0, 12),
        draftHash: saveResult.data.issue_hash?.substring(0, 12),
        bodyHash: compileResult.bodyHash,
      },
      evidenceRecorded,
      requestId,
    }, { 
      status: 201,
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/work-plan/compile-to-draft] Error:', error);
    return errorResponse('Failed to compile work plan to draft', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
