import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { updateS1S3IssueSpec } from '@/lib/db/s1s3Flow';
import { getRequestId } from '@/lib/api/response-helpers';
import { resolveIssueIdentifierOr404 } from '../../../../../../issues/_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function buildResponse(
  status: number,
  requestId: string,
  body: Record<string, unknown>
): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-afu9-request-id', requestId);
  response.headers.set('x-afu9-auth-path', 'control');
  return response;
}

function errorResponse(
  status: number,
  requestId: string,
  errorCode: string,
  message: string,
  meta: Record<string, unknown>
): NextResponse {
  return buildResponse(status, requestId, {
    errorCode,
    message,
    requestId,
    meta,
  });
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
  const { issueId } = await params;
  const resolved = await resolveIssueIdentifierOr404(issueId, requestId);
  if (!resolved.ok) {
    return buildResponse(resolved.status, requestId, {
      ...resolved.body,
      requestId,
    });
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
    });
  }

  const scope = body.scope;
  const acceptanceCriteria = normalizeAcceptanceCriteria(body.acceptanceCriteria);

  if (!isNonEmptyString(scope) || !acceptanceCriteria) {
    return errorResponse(400, requestId, 'invalid_spec_payload', 'Invalid spec payload', {
      issueId,
      lookupTarget: 'control',
      route: `POST ${request.nextUrl.pathname}`,
    });
  }

  const pool = getPool();
  const updateResult = await updateS1S3IssueSpec(pool, resolvedIssueId, {
    scope: scope.trim(),
    acceptance_criteria: acceptanceCriteria,
  });

  if (!updateResult.success || !updateResult.data) {
    if (updateResult.error?.toLowerCase().includes('not found')) {
      return errorResponse(404, requestId, 'issue_not_found', 'Issue not found', {
        issueId,
        lookupTarget: 'control',
        route: `POST ${request.nextUrl.pathname}`,
      });
    }

    return errorResponse(500, requestId, 'spec_update_failed', 'Failed to persist spec', {
      issueId,
      lookupTarget: 'control',
      route: `POST ${request.nextUrl.pathname}`,
    });
  }

  return buildResponse(200, requestId, {
    status: 'SPEC_READY',
    issueId: resolvedIssueId,
    requestId,
  });
}
