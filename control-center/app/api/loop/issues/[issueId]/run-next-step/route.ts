/**
 * API Route: Loop Run Next Step
 * 
 * POST /api/loop/issues/[issueId]/run-next-step
 * 
 * E9.1-CTRL-1: Contract-first Loop API
 * 
 * Executes the next step in the loop for a given AFU-9 issue.
 * Supports both execute and dryRun modes.
 * 
 * Contract:
 * - Request: { mode?: "execute" | "dryRun" }
 * - Response: schemaVersion, requestId, execution details
 * - Errors: 401 (Unauthorized), 404 (Not Found), 409 (Conflict), 500 (Internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/api/response-helpers';
import {
  RunNextStepRequestSchema,
  createLoopError,
  getHttpStatusForErrorCode,
  RunNextStepResponse,
  LoopErrorResponse,
} from '@/lib/loop/schemas';
import { runNextStep } from '@/lib/loop/execution';
import { LockConflictError } from '@/lib/loop/lock';

export const dynamic = 'force-dynamic';

/**
 * Check if user is authorized (based on AFU9_ADMIN_SUBS env var)
 */
function isAuthorizedUser(userId: string | null): boolean {
  if (!userId) return false;
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

/**
 * POST handler for running the next step in a loop
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    // Authentication check
    const userId = request.headers.get('x-afu9-sub');
    
    if (!isAuthorizedUser(userId)) {
      const errorResponse: LoopErrorResponse = createLoopError(
        requestId,
        'UNAUTHORIZED',
        'Admin privileges required to execute loop operations'
      );
      return NextResponse.json(
        errorResponse,
        { 
          status: getHttpStatusForErrorCode('UNAUTHORIZED'),
          headers: { 'x-request-id': requestId }
        }
      );
    }
    
    // Extract issue ID from params
    const { issueId } = await params;
    
    if (!issueId || !issueId.trim()) {
      const errorResponse: LoopErrorResponse = createLoopError(
        requestId,
        'INVALID_REQUEST',
        'Issue ID is required'
      );
      return NextResponse.json(
        errorResponse,
        { 
          status: getHttpStatusForErrorCode('INVALID_REQUEST'),
          headers: { 'x-request-id': requestId }
        }
      );
    }
    
    // Parse and validate request body
    let requestBody = {};
    try {
      const text = await request.text();
      if (text.trim()) {
        requestBody = JSON.parse(text);
      }
    } catch (parseError) {
      const errorResponse: LoopErrorResponse = createLoopError(
        requestId,
        'INVALID_REQUEST',
        'Invalid JSON in request body',
        { error: parseError instanceof Error ? parseError.message : String(parseError) }
      );
      return NextResponse.json(
        errorResponse,
        { 
          status: getHttpStatusForErrorCode('INVALID_REQUEST'),
          headers: { 'x-request-id': requestId }
        }
      );
    }
    
    // Validate request with Zod schema
    const validationResult = RunNextStepRequestSchema.safeParse(requestBody);
    
    if (!validationResult.success) {
      const errorResponse: LoopErrorResponse = createLoopError(
        requestId,
        'INVALID_REQUEST',
        'Request validation failed',
        { 
          errors: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
            code: e.code,
          }))
        }
      );
      return NextResponse.json(
        errorResponse,
        { 
          status: getHttpStatusForErrorCode('INVALID_REQUEST'),
          headers: { 'x-request-id': requestId }
        }
      );
    }
    
    const { mode } = validationResult.data;
    const actor = userId || 'system';
    
    // Execute the next step via the single function call
    const result: RunNextStepResponse = await runNextStep({
      issueId,
      mode,
      actor,
      requestId,
    });
    
    // Return successful response with schema version and request ID
    return NextResponse.json(
      result,
      {
        status: 200,
        headers: { 'x-request-id': requestId }
      }
    );
    
  } catch (error) {
    console.error('[Loop API] Error executing next step:', error);
    
    // E9.1-CTRL-3: Handle lock conflict errors specifically
    if (error instanceof LockConflictError) {
      const errorResponse: LoopErrorResponse = createLoopError(
        requestId,
        'LOOP_CONFLICT',
        error.message,
        { 
          lockKey: error.lockKey,
          lockedBy: error.lockedBy,
          expiresAt: error.expiresAt?.toISOString(),
        }
      );
      
      return NextResponse.json(
        errorResponse,
        { 
          status: getHttpStatusForErrorCode('LOOP_CONFLICT'),
          headers: { 'x-request-id': requestId }
        }
      );
    }
    
    // Map specific errors to appropriate status codes
    let errorCode: 'ISSUE_NOT_FOUND' | 'LOOP_CONFLICT' | 'INTERNAL_ERROR' = 'INTERNAL_ERROR';
    let errorMessage = 'An unexpected error occurred';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Check for specific error patterns
      if (error.message.toLowerCase().includes('not found')) {
        errorCode = 'ISSUE_NOT_FOUND';
      } else if (error.message.toLowerCase().includes('conflict') || 
                 error.message.toLowerCase().includes('already running')) {
        errorCode = 'LOOP_CONFLICT';
      }
    }
    
    const errorResponse: LoopErrorResponse = createLoopError(
      requestId,
      errorCode,
      errorMessage,
      { error: error instanceof Error ? error.stack : String(error) }
    );
    
    return NextResponse.json(
      errorResponse,
      { 
        status: getHttpStatusForErrorCode(errorCode),
        headers: { 'x-request-id': requestId }
      }
    );
  }
}
