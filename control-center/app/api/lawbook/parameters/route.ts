import { NextRequest, NextResponse } from 'next/server';
import { computeStableHash, loadParameters } from '@/lawbook/load';
import type { ContextTrace } from '@/lawbook/types';

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

export async function GET(request: NextRequest) {
  try {
    const loaded = await loadParameters();

    const responseBody: any = {
      hash: loaded.hash,
      version: loaded.data.version,
      parameters: loaded.data.parameters,
    };

    if (debugApiEnabled()) {
      const trace: ContextTrace = {
        paramsHash: buildParamsHash(request),
        guardrailIdsApplied: [],
        memoryIdsUsed: [],
      };
      responseBody.contextTrace = trace;
    }

    return NextResponse.json(responseBody, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to load lawbook parameters',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
