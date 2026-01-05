/**
 * GET /api/lawbook/active
 * 
 * Returns the currently active lawbook version.
 * Implements deny-by-default: returns error if no active lawbook configured.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveLawbook } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(async (request: NextRequest) => {
  const url = new URL(request.url);
  const lawbookId = url.searchParams.get('lawbookId') || 'AFU9-LAWBOOK';

  const result = await getActiveLawbook(lawbookId);

  if (!result.success) {
    // Deny-by-default: explicit error if lawbook missing/invalid
    return NextResponse.json(
      {
        error: result.error,
        notConfigured: result.notConfigured,
        lawbookId,
      },
      { status: result.notConfigured ? 404 : 500 }
    );
  }

  const version = result.data!;

  return NextResponse.json(
    {
      id: version.id,
      lawbookId: version.lawbook_id,
      lawbookVersion: version.lawbook_version,
      createdAt: version.created_at,
      createdBy: version.created_by,
      lawbookHash: version.lawbook_hash,
      schemaVersion: version.schema_version,
      lawbook: version.lawbook_json,
    },
    { status: 200 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to get active lawbook',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
