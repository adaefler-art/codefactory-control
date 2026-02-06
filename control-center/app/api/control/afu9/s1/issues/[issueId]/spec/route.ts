import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { updateS1S3IssueSpec } from '@/lib/db/s1s3Flow';
import { getRequestId, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../../../../issues/_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function buildResponse(
  status: number,
  requestId: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('x-request-id', requestId);
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

function errorResponse(
  status: number,
  requestId: string,
  errorCode: string,
  message: string,
  meta: Record<string, unknown>,
  headers: Record<string, string>
): NextResponse {
  return buildResponse(status, requestId, {
    errorCode,
    message,
    requestId,
    meta,
  }, headers);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAcceptanceCriteria(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? items : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ issueId: string }> }
) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = getControlResponseHeaders(requestId, routeHeaderValue);
  const { issueId } = await params;
  const resolved = await resolveIssueIdentifierOr404(issueId, requestId);
  if (!resolved.ok) {
    return buildResponse(resolved.status, requestId, {
      ...resolved.body,
      requestId,
    }, responseHeaders);
  }
  const resolvedIssueId = resolved.uuid;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, requestId, 'invalid_spec_payload', 'Invalid JSON body', {
      issueId,
      lookupTarget: 'control',
      route: `POST ${request.nextUrl.pathname}`,
    }, responseHeaders);
  }

  const scope = body.scope;
  const acceptanceCriteria = normalizeAcceptanceCriteria(body.acceptanceCriteria);

  if (!isNonEmptyString(scope) || !acceptanceCriteria) {
    return errorResponse(400, requestId, 'invalid_spec_payload', 'Invalid spec payload', {
      issueId,
      lookupTarget: 'control',
      route: `POST ${request.nextUrl.pathname}`,
    }, responseHeaders);
  }

  const pool = getPool();
  const updateResult = await updateS1S3IssueSpec(pool, resolvedIssueId, {
    scope: scope.trim(),
    acceptance_criteria: acceptanceCriteria,
  });

  if (!updateResult.success || !updateResult.data) {
    if (updateResult.error?.toLowerCase().includes('not found')) {
      return buildResponse(404, requestId, {
        errorCode: 'issue_not_found',
        issueId,
        requestId,
        lookupStore: 'control',
      }, responseHeaders);
    }

    return errorResponse(500, requestId, 'spec_update_failed', 'Failed to persist spec', {
      issueId,
      lookupTarget: 'control',
      route: `POST ${request.nextUrl.pathname}`,
    }, responseHeaders);
  }

  return buildResponse(200, requestId, {
    status: 'SPEC_READY',
    issueId: resolvedIssueId,
    requestId,
  }, responseHeaders);
}
