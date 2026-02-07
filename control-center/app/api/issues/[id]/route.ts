/**
 * API Route: /api/issues/[id]
 * 
 * Manages individual AFU9 issue - get and update operations
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 * Issue #3: Identifier Consistency (UUID + publicId)
 * E61.1: Issue Lifecycle State Machine & Events Ledger
 * 
 * **Identifier Handling:**
 * - Accepts both UUID (canonical) and 8-hex publicId (display)
 * - Returns 200 (found), 404 (not found), or 400 (invalid format)
 * - Uses fetchIssueRowByIdentifier for consistent validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  updateAfu9Issue,
  softDeleteAfu9Issue,
  transitionIssue,
} from '../../../../src/lib/db/afu9Issues';
import {
  Afu9IssueStatus,
  Afu9IssuePriority,
  Afu9HandoffState,
  isValidStatus,
  isValidPriority,
} from '../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import {
  fetchIssueRowByIdentifier,
  normalizeIssueForApi,
  extractServiceTokenFromHeaders,
  normalizeServiceToken,
  tokensEqual,
  getServiceTokenDebugInfo,
  ensureIssueInControl,
  resolveIssueIdentifier,
} from '../_shared';
import { withApi, apiError } from '../../../../src/lib/http/withApi';
import { normalizeLabels } from '../../../../src/lib/label-utils';
import { getRequestId } from '@/lib/api/response-helpers';

const AUTH_PATH_HEADER = 'x-afu9-auth-path';
const REQUEST_ID_HEADER = 'x-afu9-request-id';
const HANDLER_HEADER = 'x-afu9-handler';
const ERROR_CODE_HEADER = 'x-afu9-error-code';
const ISSUE_READ_HANDLER = 'control-center.issue-read';

function withControlHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set(AUTH_PATH_HEADER, 'control');
  return response;
}

function jsonWithHeaders(
  body: Record<string, unknown>,
  status: number,
  requestId: string
): NextResponse {
  const response = NextResponse.json(body, { status });
  return withControlHeaders(response, requestId);
}

function jsonErrorResponse(params: {
  code: string;
  message: string;
  requestId: string;
  status?: number;
  upstreamStatus?: number;
}): NextResponse {
  const response = NextResponse.json(
    {
      ok: false,
      code: params.code,
      message: params.message,
      requestId: params.requestId,
      upstreamStatus: params.upstreamStatus,
    },
    { status: params.status ?? 500 }
  );
  withControlHeaders(response, params.requestId);
  response.headers.set(HANDLER_HEADER, ISSUE_READ_HANDLER);
  response.headers.set(ERROR_CODE_HEADER, params.code);
  return response;
}

function mapIssueReadFailure(params: {
  requestId: string;
  error: unknown;
  statusHint?: number;
}): NextResponse {
  const statusHint =
    typeof params.statusHint === 'number'
      ? params.statusHint
      : typeof (params.error as { status?: number })?.status === 'number'
        ? (params.error as { status?: number }).status
        : undefined;
  const message =
    params.error instanceof Error
      ? params.error.message
      : typeof params.error === 'string'
        ? params.error
        : 'Issue read failed';
  const statusValue = typeof statusHint === 'number' ? statusHint : 500;

  if (/json|parse/i.test(message)) {
    return jsonErrorResponse({
      code: 'SERIALIZATION_FAILED',
      message: 'Failed to serialize issue response',
      requestId: params.requestId,
      status: 500,
    });
  }

  if (/github/i.test(message)) {
    return jsonErrorResponse({
      code: 'GITHUB_API_ERROR',
      message: 'GitHub API error',
      requestId: params.requestId,
      status: statusValue >= 500 ? 502 : statusValue,
      upstreamStatus: statusHint,
    });
  }

  return jsonErrorResponse({
    code: 'INTERNAL_ERROR',
    message,
    requestId: params.requestId,
    status: statusValue,
  });
}

function errorWithHeaders(
  message: string,
  status: number,
  requestId: string,
  details?: string
): NextResponse {
  return jsonWithHeaders(
    details ? { error: message, details } : { error: message },
    status,
    requestId
  );
}


/**
 * GET /api/issues/[id]
 * Get a specific issue by ID
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Both formats are accepted and return the same issue data.
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const requestId = getRequestId(request);
  const verifiedUserSub = request.headers.get('x-afu9-sub')?.trim();
  const { token: providedServiceToken, reason: tokenReason } = extractServiceTokenFromHeaders(request.headers);
  const expectedServiceToken = normalizeServiceToken(process.env.SERVICE_READ_TOKEN || '');
  const isTestEnv = process.env.NODE_ENV === 'test';
  const shouldEnforceServiceToken = !isTestEnv || Boolean(expectedServiceToken);

  // Auth model: JWT (middleware sets x-afu9-sub) is primary, service token is fallback.
  if (!verifiedUserSub && shouldEnforceServiceToken) {
    if (!providedServiceToken) {
      if (process.env.DEBUG_SERVICE_AUTH === 'true' && expectedServiceToken) {
        console.warn('[Issues API] service token missing', {
          requestId,
          reason: tokenReason,
        });
      }
      return apiError(
        'Authentication required',
        401,
        tokenReason === 'malformed' ? 'Malformed Authorization header' : 'Missing service token',
        requestId
      );
    }
    if (!expectedServiceToken || !tokensEqual(providedServiceToken, expectedServiceToken)) {
      if (process.env.DEBUG_SERVICE_AUTH === 'true' && expectedServiceToken) {
        console.warn('[Issues API] service token rejected', {
          requestId,
          ...getServiceTokenDebugInfo(providedServiceToken, expectedServiceToken),
        });
      }
      return apiError(
        'service token rejected',
        403,
        expectedServiceToken ? 'Service token mismatch' : 'Service token not configured',
        requestId
      );
    }
  }

  const { id } = await params;

  // Temporary diagnostics for the "Failed to fetch issue" bug.
  // Only logs in DEV to avoid noisy production logs.
  if (process.env.NODE_ENV === 'development') {
    console.log('[API /api/issues/[id]] GET', {
      id,
      url: request.nextUrl.toString(),
    });
  }

  let ensured: Awaited<ReturnType<typeof ensureIssueInControl>>;
  try {
    ensured = await ensureIssueInControl(id, requestId);
  } catch (error) {
    return jsonErrorResponse({
      code: 'ISSUE_STORE_READ_FAILED',
      message: 'Failed to load issue from store',
      requestId,
    });
  }

  if (!ensured.ok) {
    if (ensured.status >= 500) {
      return jsonErrorResponse({
        code: 'ISSUE_STORE_READ_FAILED',
        message: 'Failed to load issue from store',
        requestId,
        status: ensured.status,
      });
    }

    const fallbackCode = typeof ensured.body?.errorCode === 'string'
      ? ensured.body.errorCode
      : 'ISSUE_READ_FAILED';
    return jsonErrorResponse({
      code: fallbackCode,
      message: typeof ensured.body?.error === 'string' ? ensured.body.error : 'Issue read failed',
      requestId,
      status: ensured.status,
    });
  }

  let responseBody: any;
  try {
    responseBody = normalizeIssueForApi(ensured.issue);
  } catch (error) {
    return jsonErrorResponse({
      code: 'INVALID_STORED_STATE',
      message: 'Issue record failed validation',
      requestId,
    });
  }

  if (isDebugApiEnabled()) {
    try {
      responseBody.contextTrace = await buildContextTrace(request);
    } catch (error) {
      return mapIssueReadFailure({ requestId, error });
    }
  }

  try {
    return jsonWithHeaders(responseBody, 200, requestId);
  } catch (error) {
    return jsonErrorResponse({
      code: 'SERIALIZATION_FAILED',
      message: 'Failed to serialize issue response',
      requestId,
    });
  }
});

/**
 * PATCH /api/issues/[id]
 * Update an existing issue
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Body (all fields optional):
 * - title: string
 * - body: string
 * - labels: string[]
 * - status: Afu9IssueStatus
 * - priority: Afu9IssuePriority | null
 * - assignee: string | null
 */
export const PATCH = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;
  const requestId = getRequestId(request);
  const resolution = await resolveIssueIdentifier(id, requestId);
  if (!resolution.ok) {
    return jsonWithHeaders(resolution.body, resolution.status, requestId);
  }

  const internalId = resolution.uuid;
  const resolved = resolution.issue
    ? { ok: true as const, row: resolution.issue }
    : await fetchIssueRowByIdentifier(pool, internalId);
  if (!resolved.ok) {
    return jsonWithHeaders(resolved.body, resolved.status, requestId);
  }

  const body = await request.json();

  // Validate provided fields
  const updates: any = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return apiError('title must be a non-empty string', 400);
    }
    updates.title = body.title;
  }

  if (body.body !== undefined) {
    if (body.body !== null && typeof body.body !== 'string') {
      return apiError('body must be a string or null', 400);
    }
    updates.body = body.body;
  }

  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels)) {
      return apiError('labels must be an array', 400);
    }
    if (!body.labels.every((label: any) => typeof label === 'string')) {
      return apiError('all labels must be strings', 400);
    }
    // Normalize labels (handles comma-separated input, removes duplicates, etc.)
    updates.labels = normalizeLabels(body.labels);
  }

  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) {
      return apiError(
        'Invalid status',
        400,
        `Status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`
      );
    }
    // Note: Status transitions are handled separately via transitionIssue
    // to ensure proper validation and event logging (E61.1)
    updates.status = body.status;
  }

  if (body.priority !== undefined) {
    if (body.priority !== null && !isValidPriority(body.priority)) {
      return errorWithHeaders(
        'Invalid priority',
        400,
        requestId,
        `Priority must be one of: ${Object.values(Afu9IssuePriority).join(', ')} or null`
      );
    }
    updates.priority = body.priority;
  }

  if (body.assignee !== undefined) {
    if (body.assignee !== null && typeof body.assignee !== 'string') {
      return errorWithHeaders('assignee must be a string or null', 400, requestId);
    }
    updates.assignee = body.assignee;
  }

  // Check if there are any updates
  if (Object.keys(updates).length === 0) {
    return errorWithHeaders('No fields to update', 400, requestId);
  }

  // Get current issue state for invariant checking
  const currentIssue = resolved.row as any;

  // E61.1: Handle status transitions separately via transitionIssue
  // This ensures proper validation and atomic event logging
  if (updates.status && updates.status !== currentIssue.status) {
    const statusToTransition = updates.status;
    delete updates.status; // Remove from updates - will be handled by transitionIssue

    // Apply non-status updates first if any exist
    if (Object.keys(updates).length > 0) {
      const updateResult = await updateAfu9Issue(pool, internalId, updates);
      if (!updateResult.success) {
        return errorWithHeaders('Failed to update issue fields', 500, requestId, updateResult.error);
      }
    }

    // Now perform the state transition
    const transitionResult = await transitionIssue(
      pool,
      internalId,
      statusToTransition,
      'api-user', // Future: Extract actual user from auth context
      { via: 'PATCH /api/issues/[id]' }
    );

    if (!transitionResult.success) {
      // Check for invalid transition
      if (transitionResult.error && transitionResult.error.includes('Invalid transition')) {
        return errorWithHeaders(transitionResult.error, 400, requestId);
      }

      // Check for Single-Active constraint violation
      if (transitionResult.error && transitionResult.error.includes('Single-Active')) {
        return errorWithHeaders(transitionResult.error, 409, requestId);
      }

      return errorWithHeaders('Failed to transition issue', 500, requestId, transitionResult.error);
    }

    const responseBody: any = normalizeIssueForApi(transitionResult.data);
    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }
    return jsonWithHeaders(responseBody, 200, requestId);
  }

  // Invariant: SYNCED handoff_state cannot occur with CREATED status
  const finalStatus = updates.status ?? currentIssue.status;
  const finalHandoffState = updates.handoff_state ?? currentIssue.handoff_state;
  
  if (finalStatus === Afu9IssueStatus.CREATED && finalHandoffState === Afu9HandoffState.SYNCED) {
    return errorWithHeaders(
      'Invalid state combination',
      400,
      requestId,
      'Issue with status CREATED cannot have handoff_state SYNCED. This violates lifecycle invariants.'
    );
  }

  // Update issue (non-status fields only at this point)
  const result = await updateAfu9Issue(pool, internalId, updates);

  if (!result.success) {
    if (result.error && result.error.includes('not found')) {
      return errorWithHeaders('Issue not found', 404, requestId);
    }

    // Check for Single-Active constraint violation
    if (result.error && result.error.includes('Single-Active')) {
      return errorWithHeaders(result.error, 409, requestId);
    }

    return errorWithHeaders('Failed to update issue', 500, requestId, result.error);
  }

  const responseBody: any = normalizeIssueForApi(result.data);
  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }
  return jsonWithHeaders(responseBody, 200, requestId);
});

/**
 * DELETE /api/issues/[id]
 * Soft delete an issue (only allowed for status=CREATED and handoff_state=NOT_SENT)
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Guardrails:
 * - Only issues with status=CREATED and handoff_state=NOT_SENT can be deleted
 * - Performs soft delete (sets deleted_at timestamp)
 */
export const DELETE = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;
  const requestId = getRequestId(request);
  const resolution = await resolveIssueIdentifier(id, requestId);
  if (!resolution.ok) {
    return jsonWithHeaders(resolution.body, resolution.status, requestId);
  }

  const internalId = resolution.uuid;

  // Perform soft delete
  const result = await softDeleteAfu9Issue(pool, internalId);

  if (!result.success) {
    // Check if it's a guardrail violation
    if (result.error && result.error.includes('deletion only allowed')) {
      return errorWithHeaders(result.error, 403, requestId);
    }

    if (result.error && result.error.includes('not found')) {
      return errorWithHeaders('Issue not found', 404, requestId);
    }

    return errorWithHeaders('Failed to delete issue', 500, requestId, result.error);
  }

  return jsonWithHeaders({ success: true, id: internalId }, 200, requestId);
});
