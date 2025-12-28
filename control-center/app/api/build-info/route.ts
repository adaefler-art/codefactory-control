/**
 * API Route: /api/build-info
 *
 * Read-only endpoint to verify what build/commit is deployed.
 * No secrets, no external calls.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  const gitSha = (process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || '').trim() || null;
  const buildTime = (process.env.BUILD_TIME || '').trim() || null;

  return jsonResponse(
    {
      ok: true,
      gitSha,
      buildTime,
    },
    { requestId, status: 200 }
  );
}
