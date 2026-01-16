/**
 * API Route: /api/intent/sessions/[id]/work-plan
 * 
 * V09-I04: WorkPlanV1: Freies Plan-Artefakt (ohne Draft)
 * 
 * GET: Retrieve work plan for a session (returns empty state if no plan exists)
 * PUT: Save/update work plan for a session
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getWorkPlan, saveWorkPlan } from '@/lib/db/intentWorkPlans';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import {
  WorkPlanResponseV1Schema,
  WorkPlanUpdateRequestSchema,
  WORK_PLAN_VERSION,
  createEmptyWorkPlanResponse,
  createWorkPlanResponse,
  validateNoSecrets,
} from '@/lib/schemas/workPlan';

/**
 * GET /api/intent/sessions/[id]/work-plan
 * Retrieve work plan for a session
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
    
    // Get work plan
    const result = await getWorkPlan(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get work plan', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    // Build response
    let response: typeof WorkPlanResponseV1Schema._type;
    
    if (result.data === null) {
      // No plan exists - return empty state
      response = createEmptyWorkPlanResponse();
    } else {
      // Plan exists - return with content
      response = createWorkPlanResponse(result.data);
    }
    
    // Validate response schema (defensive)
    const validated = WorkPlanResponseV1Schema.safeParse(response);
    if (!validated.success) {
      console.error('[API /api/intent/sessions/[id]/work-plan] Schema validation failed:', validated.error);
      return errorResponse('Internal server error', {
        status: 500,
        requestId,
        details: 'Response schema validation failed',
      });
    }
    
    return jsonResponse(validated.data, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/work-plan] Error getting work plan:', error);
    return errorResponse('Failed to get work plan', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * PUT /api/intent/sessions/[id]/work-plan
 * Save/update work plan for a session
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
      return errorResponse('Invalid JSON in request body', {
        status: 400,
        requestId,
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    
    const parseResult = WorkPlanUpdateRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return errorResponse('Invalid work plan data', {
        status: 400,
        requestId,
        details: parseResult.error.message,
      });
    }
    
    const { content } = parseResult.data;
    
    // Validate no secrets in content
    const secretsCheck = validateNoSecrets(content);
    if (secretsCheck !== true) {
      return errorResponse('Work plan content may contain secrets', {
        status: 400,
        requestId,
        details: secretsCheck,
      });
    }
    
    // Save work plan
    const result = await saveWorkPlan(pool, sessionId, userId, content, WORK_PLAN_VERSION);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to save work plan', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    // Build response
    const response = createWorkPlanResponse(result.data);
    
    // Validate response schema (defensive)
    const validated = WorkPlanResponseV1Schema.safeParse(response);
    if (!validated.success) {
      console.error('[API /api/intent/sessions/[id]/work-plan] Schema validation failed:', validated.error);
      return errorResponse('Internal server error', {
        status: 500,
        requestId,
        details: 'Response schema validation failed',
      });
    }
    
    return jsonResponse(validated.data, { requestId });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/work-plan] Error saving work plan:', error);
    return errorResponse('Failed to save work plan', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
