/**
 * API Route: /api/issues/new
 *
 * Purpose: Provide a DraftIssue payload for the "New Issue" UX.
 *
 * Rationale:
 * - Without a concrete /new route, Next.js matches /api/issues/new to /api/issues/[id]
 *   which validates UUIDs and returns 400 for id="new".
 * - This endpoint must not require query/body validation for GET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getPool } from '../../../../src/lib/db';
import { createAfu9Issue } from '../../../../src/lib/db/afu9Issues';
import {
  Afu9HandoffState,
  Afu9IssuePriority,
  Afu9IssueStatus,
  isValidHandoffState,
  isValidPriority,
  isValidStatus,
} from '../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { normalizeIssueForApi, toPublicIdFromUuid } from '../_shared';
import { normalizeLabels } from '../../../../src/lib/label-utils';

type DraftIssue = {
  id: string;
  publicId: string;
  title: string;
  body: string | null;
  status: Afu9IssueStatus;
  labels: string[];
  priority: Afu9IssuePriority | null;
  assignee: string | null;
  source: string;
  handoff_state: Afu9HandoffState;
  github_issue_number: number | null;
  github_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (value && typeof value === 'object') {
    const asAny = value as any;
    if (typeof asAny.toISOString === 'function') return asAny.toISOString();
  }
  return new Date().toISOString();
}

function getRequestId(request: NextRequest): string {
  const headerId = request.headers.get('x-request-id');
  return headerId && headerId.trim() ? headerId : randomUUID();
}

function logRequest(params: {
  requestId: string;
  route: string;
  method: string;
  status: number;
  reason: string;
}) {
  const debugEnabled =
    process.env.AFU9_DEBUG_API === '1' ||
    process.env.AFU9_DEBUG_API === 'true' ||
    process.env.AFU9_DEBUG_API === 'TRUE';

  if (!debugEnabled) return;

  console.log(
    JSON.stringify({
      level: 'info',
      service: 'control-center',
      ...params,
      timestamp: new Date().toISOString(),
    })
  );
}

function createDraftIssue(nowIso: string): DraftIssue {
  const id = randomUUID();
  const publicId = toPublicIdFromUuid(id) ?? id.substring(0, 8).toLowerCase();
  return {
    id,
    publicId,
    title: '',
    body: '',
    status: Afu9IssueStatus.CREATED,
    labels: [],
    priority: null,
    assignee: null,
    source: 'afu9',
    handoff_state: Afu9HandoffState.NOT_SENT,
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

/**
 * GET /api/issues/new
 *
 * Always returns 200 for authenticated requests (auth is enforced by middleware).
 * Does not require query parameters or a request body.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const nowIso = new Date().toISOString();

    // Optional DB/repo dependency is intentionally avoided for GET.
    // If in the future we want to seed defaults from DB, it must remain best-effort
    // and never fail the endpoint with 400.
    const draft = createDraftIssue(nowIso);

    const responseBody: any = normalizeIssueForApi(draft);
    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    const response = NextResponse.json(responseBody, { status: 200 });
    response.headers.set('x-request-id', requestId);

    logRequest({
      requestId,
      route: '/api/issues/new',
      method: 'GET',
      status: 200,
      reason: 'ok',
    });

    return response;
  } catch (error) {
    // Fail open to draft issue to keep UX functional.
    const nowIso = new Date().toISOString();
    const fallback = createDraftIssue(nowIso);

    const responseBody: any = normalizeIssueForApi(fallback);
    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    const response = NextResponse.json(responseBody, { status: 200 });
    response.headers.set('x-request-id', requestId);

    logRequest({
      requestId,
      route: '/api/issues/new',
      method: 'GET',
      status: 200,
      reason: 'fallback',
    });

    if (
      process.env.AFU9_DEBUG_API === '1' ||
      process.env.AFU9_DEBUG_API === 'true' ||
      process.env.AFU9_DEBUG_API === 'TRUE'
    ) {
      console.error('[API /api/issues/new] Draft fallback used:', error);
    }

    return response;
  }
}

/**
 * PATCH /api/issues/new
 *
 * Creates a real AFU9 issue from the draft + payload.
 * Auth is enforced by middleware.
 */
export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();

    let body: any;
    try {
      body = await request.json();
    } catch {
      const response = NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      logRequest({
        requestId,
        route: '/api/issues/new',
        method: 'PATCH',
        status: 400,
        reason: 'invalid_json',
      });
      return response;
    }

    // Minimal validation.
    // For the New-Issue flow we require a non-empty title to avoid creating
    // accidental placeholder issues (e.g. "Untitled Issue") that then get
    // duplicated when the user later submits the real title.
    const rawTitle = body?.title;
    if (rawTitle === undefined) {
      const response = NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    if (typeof rawTitle !== 'string') {
      const response = NextResponse.json(
        { error: 'Invalid title' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    const rawDescription = body?.description ?? body?.body;
    if (rawDescription !== undefined && rawDescription !== null && typeof rawDescription !== 'string') {
      const response = NextResponse.json(
        { error: 'Invalid description' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    const rawStatus = body?.status;
    if (rawStatus !== undefined && typeof rawStatus === 'string' && !isValidStatus(rawStatus)) {
      const response = NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }
    if (rawStatus !== undefined && typeof rawStatus !== 'string') {
      const response = NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    const rawPriority = body?.priority;
    if (rawPriority !== undefined && rawPriority !== null) {
      if (typeof rawPriority !== 'string' || !isValidPriority(rawPriority)) {
        const response = NextResponse.json(
          { error: 'Invalid priority' },
          { status: 400 }
        );
        response.headers.set('x-request-id', requestId);
        return response;
      }
    }

    const rawHandoffState = body?.handoffState;
    if (rawHandoffState !== undefined) {
      if (typeof rawHandoffState !== 'string' || !isValidHandoffState(rawHandoffState)) {
        const response = NextResponse.json(
          { error: 'Invalid handoffState' },
          { status: 400 }
        );
        response.headers.set('x-request-id', requestId);
        return response;
      }
    }

    const rawLabels = body?.labels;
    if (rawLabels !== undefined && !isStringArray(rawLabels)) {
      const response = NextResponse.json(
        { error: 'Invalid labels' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    const title = rawTitle.trim();
    if (!title) {
      const response = NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    const description =
      typeof rawDescription === 'string' ? rawDescription : '';

    const status =
      (rawStatus as Afu9IssueStatus | undefined) ?? Afu9IssueStatus.CREATED;

    // Normalize labels (handles comma-separated input, removes duplicates, etc.)
    const normalizedLabels = normalizeLabels(rawLabels || []);

    const result = await createAfu9Issue(pool, {
      title,
      body: description || null,
      labels: normalizedLabels,
      priority: (rawPriority as Afu9IssuePriority | null | undefined) ?? null,
      assignee: null,
      status,
      handoff_state:
        (rawHandoffState as Afu9HandoffState | undefined) ??
        Afu9HandoffState.NOT_SENT,
    });

    if (!result.success) {
      if (result.error && result.error.includes('Single-Active')) {
        const response = NextResponse.json(
          { error: result.error },
          { status: 409 }
        );
        response.headers.set('x-request-id', requestId);
        return response;
      }

      const response = NextResponse.json(
        { error: 'Failed to create issue', details: result.error },
        { status: 500 }
      );
      response.headers.set('x-request-id', requestId);
      return response;
    }

    // Return the same shape as the rest of the Issues API.
    const responseBody: any = normalizeIssueForApi(result.data);

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    const response = NextResponse.json(responseBody, { status: 201 });
    response.headers.set('x-request-id', requestId);

    logRequest({
      requestId,
      route: '/api/issues/new',
      method: 'PATCH',
      status: 201,
      reason: 'issue_created_from_new',
    });

    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        error: 'Failed to create issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
    response.headers.set('x-request-id', requestId);

    logRequest({
      requestId,
      route: '/api/issues/new',
      method: 'PATCH',
      status: 500,
      reason: 'unhandled_error',
    });

    if (
      process.env.AFU9_DEBUG_API === '1' ||
      process.env.AFU9_DEBUG_API === 'true' ||
      process.env.AFU9_DEBUG_API === 'TRUE'
    ) {
      console.error('[API /api/issues/new] Error creating issue:', error);
    }

    return response;
  }
}
