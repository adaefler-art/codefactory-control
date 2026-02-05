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
  upsertAfu9IssueFromEngine,
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
} from '../_shared';
import { withApi, apiError } from '../../../../src/lib/http/withApi';
import { normalizeLabels } from '../../../../src/lib/label-utils';
import { getRequestId } from '@/lib/api/response-helpers';

const AUTH_PATH_HEADER = 'x-afu9-auth-path';
const REQUEST_ID_HEADER = 'x-afu9-request-id';

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

function issueNotFoundResponse(issueId: string, requestId: string): NextResponse {
  return jsonWithHeaders(
    {
      errorCode: 'issue_not_found',
      issueId,
      lookupStore: 'control',
      requestId,
    },
    404,
    requestId
  );
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry) => typeof entry === 'string') as string[];
  return items.length > 0 ? items : undefined;
}

function normalizeEngineBaseUrl(raw?: string | null): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/$/, '');
}

async function fetchIssueFromEngine(
  issueId: string,
  requestId: string
): Promise<
  | { ok: true; issue: Record<string, unknown> | null }
  | { ok: false; status: number; message: string }
> {
  const engineBaseUrl = normalizeEngineBaseUrl(
    process.env.ENGINE_BASE_URL || process.env.ENGINE_URL
  );
  const engineToken = process.env.AFU9_SERVICE_TOKEN || process.env.ENGINE_SERVICE_TOKEN || '';

  if (!engineBaseUrl || !engineToken) {
    return { ok: true, issue: null };
  }

  const url = `${engineBaseUrl}/api/issues/${encodeURIComponent(issueId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-afu9-service-token': engineToken,
      'x-request-id': requestId,
    },
  });

  if (response.status === 404) {
    return { ok: true, issue: null };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: 'Engine issue lookup failed',
    };
  }

  try {
    const issue = (await response.json()) as Record<string, unknown>;
    return { ok: true, issue };
  } catch {
    return {
      ok: false,
      status: 502,
      message: 'Engine issue lookup invalid JSON',
    };
  }
}

function mapEngineIssueToInput(issue: Record<string, unknown>) {
  const title = getStringField(issue, 'title') || getStringField(issue, 'summary');
  if (!title) return null;

  const statusValue = getStringField(issue, 'status');
  const priorityValue = getStringField(issue, 'priority');

  return {
    title,
    body: getStringField(issue, 'body') ?? null,
    labels: toStringArray(issue.labels),
    priority: priorityValue && isValidPriority(priorityValue) ? priorityValue : null,
    assignee: getStringField(issue, 'assignee') ?? null,
    status: statusValue && isValidStatus(statusValue) ? statusValue : Afu9IssueStatus.CREATED,
    canonical_id: getStringField(issue, 'canonicalId') || getStringField(issue, 'canonical_id') || null,
    github_issue_number:
      typeof issue.githubIssueNumber === 'number'
        ? issue.githubIssueNumber
        : typeof issue.github_issue_number === 'number'
          ? issue.github_issue_number
          : null,
    github_url: getStringField(issue, 'githubUrl') || getStringField(issue, 'github_url') || null,
    source: 'engine',
  };
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

  const pool = getPool();
  const { id } = await params;

  // Temporary diagnostics for the "Failed to fetch issue" bug.
  // Only logs in DEV to avoid noisy production logs.
  if (process.env.NODE_ENV === 'development') {
    console.log('[API /api/issues/[id]] GET', {
      id,
      url: request.nextUrl.toString(),
    });
  }

  const resolved = await fetchIssueRowByIdentifier(pool, id);
  if (!resolved.ok) {
    if (resolved.status === 404) {
      const engineLookup = await fetchIssueFromEngine(id, requestId);
      if (engineLookup.ok && engineLookup.issue) {
        const mappedInput = mapEngineIssueToInput(engineLookup.issue);
        if (mappedInput) {
          const upsertResult = await upsertAfu9IssueFromEngine(pool, id, mappedInput);
          if (upsertResult.success && upsertResult.data) {
            const normalizedIssue = normalizeIssueForApi(upsertResult.data);
            const responseBody: Record<string, unknown> = normalizedIssue;
            if (isDebugApiEnabled()) {
              responseBody.contextTrace = await buildContextTrace(request);
            }
            return jsonWithHeaders(responseBody, 200, requestId);
          }
        }
      }

      if (!engineLookup.ok) {
        return jsonWithHeaders(
          {
            errorCode: 'engine_lookup_failed',
            issueId: id,
            lookupStore: 'engine',
            requestId,
          },
          502,
          requestId
        );
      }

      return issueNotFoundResponse(id, requestId);
    }

    return jsonWithHeaders(
      {
        ...resolved.body,
        requestId,
      },
      resolved.status,
      requestId
    );
  }

  const responseBody: any = normalizeIssueForApi(resolved.row);
  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }
  return jsonWithHeaders(responseBody, 200, requestId);
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

  const resolved = await fetchIssueRowByIdentifier(pool, id);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const internalId = (resolved.row as any).id as string;

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
      return apiError(
        'Invalid priority',
        400,
        `Priority must be one of: ${Object.values(Afu9IssuePriority).join(', ')} or null`
      );
    }
    updates.priority = body.priority;
  }

  if (body.assignee !== undefined) {
    if (body.assignee !== null && typeof body.assignee !== 'string') {
      return apiError('assignee must be a string or null', 400);
    }
    updates.assignee = body.assignee;
  }

  // Check if there are any updates
  if (Object.keys(updates).length === 0) {
    return apiError('No fields to update', 400);
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
        return NextResponse.json(
          { error: 'Failed to update issue fields', details: updateResult.error },
          { status: 500 }
        );
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
        return NextResponse.json(
          { error: transitionResult.error },
          { status: 400 }
        );
      }

      // Check for Single-Active constraint violation
      if (transitionResult.error && transitionResult.error.includes('Single-Active')) {
        return NextResponse.json(
          { error: transitionResult.error },
          { status: 409 } // Conflict
        );
      }

      return NextResponse.json(
        { error: 'Failed to transition issue', details: transitionResult.error },
        { status: 500 }
      );
    }

    const responseBody: any = normalizeIssueForApi(transitionResult.data);
    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }
    return NextResponse.json(responseBody);
  }

  // Invariant: SYNCED handoff_state cannot occur with CREATED status
  const finalStatus = updates.status ?? currentIssue.status;
  const finalHandoffState = updates.handoff_state ?? currentIssue.handoff_state;
  
  if (finalStatus === Afu9IssueStatus.CREATED && finalHandoffState === Afu9HandoffState.SYNCED) {
    return apiError(
      'Invalid state combination',
      400,
      'Issue with status CREATED cannot have handoff_state SYNCED. This violates lifecycle invariants.'
    );
  }

  // Update issue (non-status fields only at this point)
  const result = await updateAfu9Issue(pool, internalId, updates);

  if (!result.success) {
    if (result.error && result.error.includes('not found')) {
      return NextResponse.json(
        { error: 'Issue not found', id },
        { status: 404 }
      );
    }

    // Check for Single-Active constraint violation
    if (result.error && result.error.includes('Single-Active')) {
      return NextResponse.json(
        { error: result.error },
        { status: 409 } // Conflict
      );
    }

    return NextResponse.json(
      { error: 'Failed to update issue', details: result.error },
      { status: 500 }
    );
  }

  const responseBody: any = normalizeIssueForApi(result.data);
  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }
  return NextResponse.json(responseBody);
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

  const resolved = await fetchIssueRowByIdentifier(pool, id);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const internalId = (resolved.row as any).id as string;

  // Perform soft delete
  const result = await softDeleteAfu9Issue(pool, internalId);

  if (!result.success) {
    // Check if it's a guardrail violation
    if (result.error && result.error.includes('deletion only allowed')) {
      return NextResponse.json(
        { error: result.error },
        { status: 403 } // Forbidden
      );
    }

    if (result.error && result.error.includes('not found')) {
      return NextResponse.json(
        { error: 'Issue not found', id },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to delete issue', details: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, id: internalId }, { status: 200 });
});
