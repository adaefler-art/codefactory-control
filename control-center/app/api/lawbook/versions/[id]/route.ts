/**
 * GET /api/lawbook/versions/[id]
 * 
 * Get a specific lawbook version by ID.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY: All authenticated users allowed (read-only, lawbook is system config).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLawbookVersionById } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  const { id } = await params;

  if (!id || typeof id !== 'string') {
    return NextResponse.json(
      { error: 'Invalid version ID' },
      { status: 400 }
    );
  }

  const version = await getLawbookVersionById(id);

  if (!version) {
    return NextResponse.json(
      { error: 'Lawbook version not found' },
      { status: 404 }
    );
  }

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
    error: 'Failed to get lawbook version',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
