/**
 * POST /api/lawbook/publish
 * 
 * Publish a new lawbook version (wrapper for POST /api/lawbook/versions).
 * Idempotent by hash - same JSON returns existing version.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY: All authenticated users allowed (lawbook versioning is idempotent, no destructive ops).
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeParseLawbook } from '@/lawbook/schema';
import { createLawbookVersion } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  } catch (parseError) {
    return NextResponse.json(
      { 
        error: 'Invalid JSON body',
        details: parseError instanceof Error ? parseError.message : 'Parse error'
      },
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
    : 'admin';

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
        : 'Lawbook version published successfully',
    },
    { status: result.isExisting ? 200 : 201 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to publish lawbook version',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
