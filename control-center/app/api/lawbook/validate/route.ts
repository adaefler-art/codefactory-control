/**
 * POST /api/lawbook/validate
 * 
 * Validate lawbook JSON against schema without creating a version.
 * Returns deterministic error list if validation fails.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY: All authenticated users allowed (validation is read-only operation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { safeParseLawbook, computeLawbookHash } from '@/lawbook/schema';
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
        ok: false,
        errors: [{
          path: '$',
          message: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
          code: 'INVALID_JSON'
        }],
        hash: null
      },
      { status: 400 }
    );
  }

  // Validate lawbook schema using Zod
  const parseResult = safeParseLawbook(body);

  if (!parseResult.success) {
    // Map Zod errors to deterministic error format
    // Sort by path for stability
    const errors = parseResult.error.errors
      .map(err => ({
        path: err.path.join('.') || '$',
        message: err.message,
        code: err.code,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return NextResponse.json(
      {
        ok: false,
        errors,
        hash: null,
      },
      { status: 200 } // Validation endpoint returns 200 with ok: false
    );
  }

  // Validation succeeded - compute hash
  const lawbook = parseResult.data;
  const hash = computeLawbookHash(lawbook);

  return NextResponse.json(
    {
      ok: true,
      errors: [],
      hash,
      lawbookId: lawbook.lawbookId,
      lawbookVersion: lawbook.lawbookVersion,
    },
    { status: 200 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to validate lawbook',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
