/**
 * API Route: /api/afu9/issues/[ref]
 *
 * Compatibility wrapper for identifier-based issue lookup.
 * Delegates to /api/afu9/issues/[id] to handle UUID, publicId, and canonicalId.
 */

import { NextRequest } from 'next/server';
import { GET as getIssueById } from '../[id]/route';

interface RouteContext {
  params: Promise<{ ref: string }>;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest, context: RouteContext) {
  const { ref } = await context.params;
  return getIssueById(request, { params: Promise.resolve({ id: ref }) });
}
