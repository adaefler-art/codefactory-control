/**
 * API Route: /api/issues/[id]/execution
 * 
 * Manages execution state for AFU9 issues
 * Issue #adaefler-art/codefactory-control#319 (Epic) - I5-4.1: Execution State Visibility
 * Issue #3: Identifier Consistency (UUID + publicId)
 * 
 * **Identifier Handling:**
 * - Accepts both UUID (canonical) and 8-hex publicId (display)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { updateAfu9Issue } from '../../../../../src/lib/db/afu9Issues';
import { Afu9ExecutionState } from '../../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { getControlResponseHeaders, resolveIssueIdentifier, normalizeIssueForApi } from '../../_shared';
import { withApi } from '../../../../../src/lib/http/withApi';
import { normalizeOutput } from '@/lib/api/normalize-output';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/issues/[id]/execution
 * Get execution status of an issue
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;
  const requestId = getRequestId(request);
  const responseHeaders = getControlResponseHeaders(requestId);
  const resolved = await resolveIssueIdentifier(id, requestId);
  if (!resolved.ok) {
    return jsonResponse(resolved.body, {
      status: resolved.status,
      requestId,
      headers: responseHeaders,
    });
  }

  const issue = resolved.issue as any;
  
  // Normalize to ensure timestamps are ISO strings
  const normalized = normalizeOutput(issue);
  
  const responseBody: any = {
    id: normalized.id,
    publicId: normalized.id.substring(0, 8),
    execution_state: normalized.execution_state || 'IDLE',
    execution_started_at: normalized.execution_started_at,
    execution_completed_at: normalized.execution_completed_at,
    execution_output: normalized.execution_output,
  };

  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }

  return jsonResponse(responseBody, { requestId, headers: responseHeaders });
});

/**
 * POST /api/issues/[id]/execution
 * Control execution state
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Body:
 * - action: 'start' | 'complete' | 'fail' | 'reset'
 * - output?: object (optional, for complete/fail actions)
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;
  const requestId = getRequestId(request);
  const responseHeaders = getControlResponseHeaders(requestId);
  const resolved = await resolveIssueIdentifier(id, requestId);
  if (!resolved.ok) {
    return jsonResponse(resolved.body, {
      status: resolved.status,
      requestId,
      headers: responseHeaders,
    });
  }

  const internalId = resolved.uuid;
  const currentIssue = resolved.issue as any;
  const body = await request.json();

  if (!body.action || typeof body.action !== 'string') {
    return jsonResponse(
      { error: 'action is required and must be a string' },
      { status: 400, requestId, headers: responseHeaders }
    );
  }

  const action = body.action;
  const output = body.output || null;
  const currentExecutionState = currentIssue.execution_state || 'IDLE';

  let updates: any = {};

  switch (action) {
    case 'start':
      // Only allow starting from IDLE or FAILED state
      if (currentExecutionState === 'RUNNING') {
        return jsonResponse(
          {
            error: 'Cannot start execution: already running',
            details: 'Current state is RUNNING. Complete or fail the current execution first.',
          },
          { status: 409, requestId, headers: responseHeaders }
        );
      }
      if (currentExecutionState === 'DONE') {
        return jsonResponse(
          {
            error: 'Cannot start execution: already completed',
            details: 'Current state is DONE. Reset to IDLE first if you want to re-execute.',
          },
          { status: 409, requestId, headers: responseHeaders }
        );
      }
      updates = {
        execution_state: Afu9ExecutionState.RUNNING,
        execution_started_at: new Date().toISOString(),
        execution_completed_at: null,
        execution_output: null,
      };
      break;

    case 'complete':
      // Only allow completing from RUNNING state
      if (currentExecutionState !== 'RUNNING') {
        return jsonResponse(
          {
            error: 'Cannot complete execution: not running',
            details: `Current state is ${currentExecutionState}. Only RUNNING executions can be completed.`,
          },
          { status: 409, requestId, headers: responseHeaders }
        );
      }
      updates = {
        execution_state: Afu9ExecutionState.DONE,
        execution_completed_at: new Date().toISOString(),
        execution_output: output,
      };
      break;

    case 'fail':
      // Only allow failing from RUNNING state
      if (currentExecutionState !== 'RUNNING') {
        return jsonResponse(
          {
            error: 'Cannot fail execution: not running',
            details: `Current state is ${currentExecutionState}. Only RUNNING executions can be failed.`,
          },
          { status: 409, requestId, headers: responseHeaders }
        );
      }
      updates = {
        execution_state: Afu9ExecutionState.FAILED,
        execution_completed_at: new Date().toISOString(),
        execution_output: output,
      };
      break;

    case 'reset':
      // Can reset from any state except RUNNING
      if (currentExecutionState === 'RUNNING') {
        return jsonResponse(
          {
            error: 'Cannot reset execution: currently running',
            details: 'Complete or fail the running execution before resetting.',
          },
          { status: 409, requestId, headers: responseHeaders }
        );
      }
      updates = {
        execution_state: Afu9ExecutionState.IDLE,
        execution_started_at: null,
        execution_completed_at: null,
        execution_output: null,
      };
      break;

    default:
      return jsonResponse(
        {
          error: 'Invalid action',
          details: 'Action must be one of: start, complete, fail, reset',
        },
        { status: 400, requestId, headers: responseHeaders }
      );
  }

  const result = await updateAfu9Issue(pool, internalId, updates);

  if (!result.success) {
    if (result.error && result.error.includes('not found')) {
      return jsonResponse(
        { error: 'Issue not found', id },
        { status: 404, requestId, headers: responseHeaders }
      );
    }

    return jsonResponse(
      { error: 'Failed to update execution state', details: result.error },
      { status: 500, requestId, headers: responseHeaders }
    );
  }

  const responseBody: any = normalizeIssueForApi(result.data);
  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }
  return jsonResponse(responseBody, { requestId, headers: responseHeaders });
});
