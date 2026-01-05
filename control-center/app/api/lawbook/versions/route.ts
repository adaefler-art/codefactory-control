/**
 * GET /api/lawbook/versions - List lawbook versions
 * POST /api/lawbook/versions - Create new lawbook version
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  listLawbookVersions, 
  createLawbookVersion 
} from '@/lib/db/lawbook';
import { safeParseLawbook } from '@/lawbook/schema';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ========================================
// GET - List Versions
// ========================================

export const GET = withApi(async (request: NextRequest) => {
  const url = new URL(request.url);
  const lawbookId = url.searchParams.get('lawbookId') || 'AFU9-LAWBOOK';
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const versions = await listLawbookVersions(lawbookId, limit, offset);

  return NextResponse.json(
    {
      lawbookId,
      versions: versions.map(v => ({
        id: v.id,
        lawbookVersion: v.lawbook_version,
        createdAt: v.created_at,
        createdBy: v.created_by,
        lawbookHash: v.lawbook_hash,
        schemaVersion: v.schema_version,
      })),
      pagination: {
        limit,
        offset,
        count: versions.length,
      },
    },
    { status: 200 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to list lawbook versions',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});

// ========================================
// POST - Create Version
// ========================================

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

  // Validate lawbook schema
  const parseResult = safeParseLawbook(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid lawbook schema',
        details: parseResult.error.errors,
      },
      { status: 400 }
    );
  }

  const lawbook = parseResult.data;
  const createdBy = (body.createdBy === 'admin' || body.createdBy === 'system') 
    ? body.createdBy 
    : 'system';

  const result = await createLawbookVersion(lawbook, createdBy);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 500 }
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
      isExisting: result.isExisting || false,
      message: result.isExisting 
        ? 'Lawbook version already exists with this hash (idempotent)'
        : 'Lawbook version created successfully',
    },
    { status: result.isExisting ? 200 : 201 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to create lawbook version',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
