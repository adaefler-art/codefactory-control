/**
 * GET /api/lawbook/active
 * 
 * Returns the currently active lawbook version.
 * Implements deny-by-default: returns error if no active lawbook configured.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY: Read-only endpoint - all authenticated users allowed (lawbook is system config).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveLawbook } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(async (request: NextRequest) => {
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

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
