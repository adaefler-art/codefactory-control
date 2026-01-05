/**
 * POST /api/lawbook/activate
 * 
 * Activate a lawbook version (update active pointer).
 */

import { NextRequest, NextResponse } from 'next/server';
import { activateLawbookVersion } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApi(async (request: NextRequest) => {
  let body: any;
  
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { lawbookVersionId, activatedBy } = body;

  if (!lawbookVersionId || typeof lawbookVersionId !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid lawbookVersionId' },
      { status: 400 }
    );
  }

  const validActivatedBy = (activatedBy === 'admin' || activatedBy === 'system') 
    ? activatedBy 
    : 'admin';

  const result = await activateLawbookVersion(lawbookVersionId, validActivatedBy);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 404 }
    );
  }

  const active = result.data!;

  return NextResponse.json(
    {
      lawbookId: active.lawbook_id,
      activeLawbookVersionId: active.active_lawbook_version_id,
      updatedAt: active.updated_at,
      message: 'Lawbook version activated successfully',
    },
    { status: 200 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to activate lawbook version',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
