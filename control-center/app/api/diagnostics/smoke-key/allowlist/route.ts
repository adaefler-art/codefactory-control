/**
 * API: GET /api/diagnostics/smoke-key/allowlist
 *
 * Diagnostics endpoint for smoke-key allowlist visibility.
 * Requires x-afu9-smoke-key header.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { extractSmokeKeyFromEnv, normalizeSmokeKeyCandidate, smokeKeysMatchConstantTime } from '@/lib/auth/smokeKey';
import { getStageFromHostname } from '@/lib/auth/stage-enforcement';
import { getEffectiveHostname } from '@/lib/http/effective-hostname';
import { getActiveAllowlist, isRouteAllowed, type SmokeKeyAllowlistEntry } from '@/lib/db/smokeKeyAllowlist';

export const dynamic = 'force-dynamic';

const ALLOWLIST_CHECKS: Array<{ method: string; path: string; matchPath: string }> = [
  { method: 'POST', path: '/api/afu9/s1s3/issues/pick', matchPath: '/api/afu9/s1s3/issues/pick' },
  { method: 'POST', path: '/api/afu9/s1s3/issues/{id}/spec', matchPath: '/api/afu9/s1s3/issues/diag-id/spec' },
  { method: 'POST', path: '/api/afu9/s1s3/issues/{id}/implement', matchPath: '/api/afu9/s1s3/issues/diag-id/implement' },
  { method: 'GET', path: '/api/afu9/s1s3/issues', matchPath: '/api/afu9/s1s3/issues' },
  { method: 'GET', path: '/api/afu9/s1s3/issues/{id}', matchPath: '/api/afu9/s1s3/issues/diag-id' },
  { method: 'GET', path: '/api/afu9/s1s3/prs/{prNumber}/checks', matchPath: '/api/afu9/s1s3/prs/123/checks' },
  { method: 'GET', path: '/api/afu9/github/issues', matchPath: '/api/afu9/github/issues' },
];

function getStageLabel(request: NextRequest): 'staging' | 'prod' | 'unknown' {
  const hostname = getEffectiveHostname({
    nextUrlHostname: request.nextUrl?.hostname,
    hostHeader: request.headers.get('host'),
    forwardedHostHeader: request.headers.get('x-forwarded-host'),
  });

  const detected = getStageFromHostname(hostname || '');
  if (detected === 'staging') return 'staging';
  if (detected === 'prod') return 'prod';
  return 'unknown';
}

function verifySmokeKey(request: NextRequest): { smokeKeyMatch: boolean } {
  const extraction = extractSmokeKeyFromEnv(process.env.AFU9_SMOKE_KEY);
  const provided = normalizeSmokeKeyCandidate(request.headers.get('x-afu9-smoke-key'));
  const smokeKeyMatch = smokeKeysMatchConstantTime(provided, extraction.expectedSmokeKey);
  return { smokeKeyMatch };
}

function buildAllowlistStatus(allowlist: SmokeKeyAllowlistEntry[]) {
  return ALLOWLIST_CHECKS.map(check => ({
    method: check.method,
    path: check.path,
    present: isRouteAllowed(check.matchPath, check.method, allowlist),
  }));
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const stage = getStageLabel(request);
  const { smokeKeyMatch } = verifySmokeKey(request);

  if (!smokeKeyMatch) {
    return jsonResponse(
      { error: 'Unauthorized', code: 'SMOKE_KEY_REQUIRED', requestId },
      { status: 401, requestId }
    );
  }

  const allowlistResult = await getActiveAllowlist();
  if (!allowlistResult.success || !allowlistResult.data) {
    return jsonResponse(
      { error: 'DB_UNREACHABLE', requestId },
      { status: 500, requestId, headers: { 'x-afu9-smoke-allowlist-error': 'db_unreachable' } }
    );
  }

  return jsonResponse(
    {
      stage,
      smokeKeyMatch,
      allowlisted: buildAllowlistStatus(allowlistResult.data),
    },
    { requestId }
  );
}
