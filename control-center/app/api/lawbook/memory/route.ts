import { NextRequest, NextResponse } from 'next/server';
import { computeStableHash, loadMemorySeed } from '@/lawbook/load';
import type { ContextTrace, MemorySeedEntry } from '@/lawbook/types';
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
  const seed = await loadMemorySeed();

  // Stage A: no persistence layer for session memory; keep shape stable.
  const sessionEntries: MemorySeedEntry[] = [];
  const sessionHash = computeStableHash({ version: seed.data.version, entries: sessionEntries });

  const responseBody: any = {
    seed: {
      hash: seed.hash,
      version: seed.data.version,
      entries: seed.data.entries,
    },
    session: {
      hash: sessionHash,
      version: seed.data.version,
      entries: sessionEntries,
    },
    hash: computeStableHash({ seedHash: seed.hash, sessionHash }),
  };

  if (debugApiEnabled()) {
    const trace: ContextTrace = {
      paramsHash: buildParamsHash(request),
      guardrailIdsApplied: [],
      memoryIdsUsed: seed.data.entries.map((e) => e.id),
    };
    responseBody.contextTrace = trace;
  }

  return NextResponse.json(responseBody, { status: 200 });
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to load lawbook memory',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
