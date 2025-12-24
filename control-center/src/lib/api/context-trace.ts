import type { NextRequest } from 'next/server';

import type { ContextTrace } from '@/lawbook/types';
import { computeStableHash, loadGuardrails, loadMemorySeed } from '@/lawbook/load';

export function isDebugApiEnabled(): boolean {
  const value = process.env.AFU9_DEBUG_API;
  if (!value) return false;
  return value === '1' || value.toLowerCase() === 'true';
}

export function computeRequestParamsHash(request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const query = Array.from(request.nextUrl.searchParams.entries()).sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
  );

  return computeStableHash({ pathname, query });
}

export async function buildContextTrace(
  request: NextRequest,
  overrides?: Partial<Omit<ContextTrace, 'paramsHash'>>
): Promise<ContextTrace> {
  const paramsHash = computeRequestParamsHash(request);

  const [guardrails, memory] = await Promise.all([
    loadGuardrails(),
    loadMemorySeed(),
  ]);

  const defaultTrace: ContextTrace = {
    paramsHash,
    guardrailIdsApplied: guardrails.data.guardrails.map((g) => g.id),
    memoryIdsUsed: memory.data.entries.map((e) => e.id),
  };

  return {
    ...defaultTrace,
    ...overrides,
    paramsHash,
  };
}
