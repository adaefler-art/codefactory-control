/**
 * API: POST /api/diagnostics/smoke-key/allowlist/seed
 *
 * Idempotently seeds smoke-key allowlist routes for AFU9 S1-S3.
 * Requires x-afu9-smoke-key header and is stage-only.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { extractSmokeKeyFromEnv, normalizeSmokeKeyCandidate, smokeKeysMatchConstantTime } from '@/lib/auth/smokeKey';
import { getStageFromHostname } from '@/lib/auth/stage-enforcement';
import { getEffectiveHostname } from '@/lib/http/effective-hostname';
import { seedSmokeKeyAllowlistEntries, type SmokeKeySeedEntry } from '@/lib/db/smokeKeyAllowlist';

export const dynamic = 'force-dynamic';

const SEED_ENTRIES: SmokeKeySeedEntry[] = [
  {
    route_pattern: '/api/afu9/s1s3/issues/pick',
    method: 'POST',
    is_regex: false,
    description: 'AFU9 S1S3 pick issue (E9.1 smoke)',
  },
  {
    route_pattern: '/api/afu9/github/issues',
    method: 'GET',
    is_regex: false,
    description: 'AFU9 GitHub issues list (E9.1 smoke)',
  },
  {
    route_pattern: '/api/afu9/s1s3/issues',
    method: 'GET',
    is_regex: false,
    description: 'AFU9 S1S3 issues list (E9.1 smoke)',
  },
  {
    route_pattern: '^/api/afu9/s1s3/issues/[^/]+$',
    method: 'GET',
    is_regex: true,
    description: 'AFU9 S1S3 issue detail (E9.1 smoke)',
  },
  {
    route_pattern: '^/api/afu9/s1s3/issues/[^/]+/spec$',
    method: 'POST',
    is_regex: true,
    description: 'AFU9 S1S3 issue spec (E9.1 smoke)',
  },
  {
    route_pattern: '^/api/afu9/s1s3/issues/[^/]+/implement$',
    method: 'POST',
    is_regex: true,
    description: 'AFU9 S1S3 issue implement (E9.1 smoke)',
  },
  {
    route_pattern: '^/api/afu9/s1s3/prs/[^/]+/checks$',
    method: 'GET',
    is_regex: true,
    description: 'AFU9 S1S3 PR checks (E9.1 smoke)',
  },
  {
    route_pattern: '^/api/loop/issues/[^/]+/run-next-step$',
    method: 'POST',
    is_regex: true,
    description: 'AFU9 loop run-next-step (E9.1 smoke)',
  },
  {
    route_pattern: '^/api/loop/issues/[^/]+/events$',
    method: 'GET',
    is_regex: true,
    description: 'AFU9 loop issue events (E9.1 smoke)',
  },
  {
    route_pattern: '/api/ops/db/migrations',
    method: 'GET',
    is_regex: false,
    description: 'Migration parity gate (CI deploy)',
  },
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

function smokeKeyMatches(request: NextRequest): boolean {
  const extraction = extractSmokeKeyFromEnv(process.env.AFU9_SMOKE_KEY);
  const provided = normalizeSmokeKeyCandidate(request.headers.get('x-afu9-smoke-key'));
  return smokeKeysMatchConstantTime(provided, extraction.expectedSmokeKey);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const stage = getStageLabel(request);

  if (!smokeKeyMatches(request)) {
    return jsonResponse(
      { error: 'Unauthorized', code: 'SMOKE_KEY_REQUIRED', requestId },
      { status: 401, requestId }
    );
  }

  if (stage !== 'staging') {
    return jsonResponse(
      { error: 'Forbidden', code: 'STAGE_ONLY', stage, requestId },
      { status: 403, requestId }
    );
  }

  const result = await seedSmokeKeyAllowlistEntries(SEED_ENTRIES, 'system:diagnostics:smoke-key');
  if (!result.success) {
    return jsonResponse(
      { error: 'DB_UNREACHABLE', requestId },
      { status: 500, requestId }
    );
  }

  return jsonResponse(
    {
      inserted: result.inserted,
      alreadyPresent: result.alreadyPresent,
    },
    { requestId }
  );
}
