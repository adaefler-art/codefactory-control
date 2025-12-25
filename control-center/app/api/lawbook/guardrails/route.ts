import { NextRequest, NextResponse } from 'next/server';
import { computeStableHash, loadGuardrails } from '@/lawbook/load';
import type { ContextTrace } from '@/lawbook/types';
import { withApi } from '../../../../src/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function debugApiEnabled(): boolean {
  const raw = (process.env.AFU9_DEBUG_API || '').toLowerCase();
  return raw === '1' || raw === 'true';
}

function buildParamsHash(request: NextRequest): string {
  const url = new URL(request.url);
  const entries = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
  return computeStableHash({ pathname: url.pathname, query: entries });
}

export const GET = withApi(async (request: NextRequest) => {
  const loaded = await loadGuardrails();

  const responseBody: any = {
    hash: loaded.hash,
    version: loaded.data.version,
    guardrails: loaded.data.guardrails,
  };

  if (debugApiEnabled()) {
    const trace: ContextTrace = {
      paramsHash: buildParamsHash(request),
      guardrailIdsApplied: loaded.data.guardrails.map((g) => g.id),
      memoryIdsUsed: [],
    };
    responseBody.contextTrace = trace;
  }

  return NextResponse.json(responseBody, { status: 200 });
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to load lawbook guardrails',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
