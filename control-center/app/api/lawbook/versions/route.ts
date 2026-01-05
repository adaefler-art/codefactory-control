/**
 * GET /api/lawbook/versions - List lawbook versions
 * POST /api/lawbook/versions - Create new lawbook version
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY:
 * - GET: All authenticated users allowed (read-only, lawbook is system config)
 * - POST: All authenticated users allowed (lawbook versioning is idempotent, no destructive ops)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { 
  listLawbookVersions, 
  createLawbookVersion 
} from '@/lib/db/lawbook';
import { safeParseLawbook } from '@/lawbook/schema';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ========================================
// Query Parameter Validation
// ========================================

const ListVersionsQuerySchema = z.object({
  lawbookId: z.string().nullable().optional(),
  limit: z.string().nullable().optional(),
  offset: z.string().nullable().optional(),
}).refine((data) => {
  // Validate limit if provided
  if (data.limit !== null && data.limit !== undefined) {
    const num = parseInt(data.limit, 10);
    if (isNaN(num) || num < 1 || num > 200) {
      return false;
    }
  }
  // Validate offset if provided
  if (data.offset !== null && data.offset !== undefined) {
    const num = parseInt(data.offset, 10);
    if (isNaN(num) || num < 0) {
      return false;
    }
  }
  return true;
}, {
  message: 'Invalid query parameters: limit must be 1-200, offset must be >= 0',
});

// ========================================
// GET - List Versions
// ========================================

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
  
  // Validate and bound query parameters
  const queryParams = {
    lawbookId: url.searchParams.get('lawbookId'),
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
  };

  const parseResult = ListVersionsQuerySchema.safeParse(queryParams);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid query parameters',
        details: parseResult.error.errors,
      },
      { status: 400 }
    );
  }

  const rawData = parseResult.data;
  const lawbookId = rawData.lawbookId || 'AFU9-LAWBOOK';
  const limit = rawData.limit ? parseInt(rawData.limit, 10) : 50;
  const offset = rawData.offset ? parseInt(rawData.offset, 10) : 0;

  const versions = await listLawbookVersions(lawbookId, limit, offset);

  // Determine if there are more results (fetch limit + 1 internally would be better,
  // but for minimal diff, check if we got exactly the limit)
  const hasMore = versions.length === limit;

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
        hasMore,
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

const MAX_BODY_SIZE_BYTES = 200 * 1024; // 200KB

export const POST = withApi(async (request: NextRequest) => {
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  // CONTENT-TYPE CHECK: Enforce application/json
  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { 
        error: 'Unsupported Media Type', 
        message: 'Content-Type must be application/json' 
      },
      { status: 415 }
    );
  }

  // BODY SIZE CHECK: Enforce max body size before parsing
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_BODY_SIZE_BYTES) {
      return NextResponse.json(
        { 
          error: 'Payload Too Large', 
          message: `Request body must not exceed ${MAX_BODY_SIZE_BYTES} bytes` 
        },
        { status: 413 }
      );
    }
  }

  let body: any;
  let bodyText: string;
  
  try {
    bodyText = await request.text();
    
    // Additional size check after reading body (defense in depth)
    if (bodyText.length > MAX_BODY_SIZE_BYTES) {
      return NextResponse.json(
        { 
          error: 'Payload Too Large', 
          message: `Request body must not exceed ${MAX_BODY_SIZE_BYTES} bytes` 
        },
        { status: 413 }
      );
    }
    
    body = JSON.parse(bodyText);
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
