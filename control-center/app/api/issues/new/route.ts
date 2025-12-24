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

type DraftIssue = {
  id: string;
  title: string;
  description: string;
  status: 'CREATED';
  labels: string[];
  createdAt: string;
  updatedAt: string;
};

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
  return {
    id: randomUUID(),
    title: '',
    description: '',
    status: 'CREATED',
    labels: [],
    createdAt: nowIso,
    updatedAt: nowIso,
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

    const response = NextResponse.json(draft, { status: 200 });
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

    const response = NextResponse.json(fallback, { status: 200 });
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
