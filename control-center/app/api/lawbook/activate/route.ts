/**
 * POST /api/lawbook/activate
 * 
 * Activate a lawbook version (update active pointer).
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY: Admin-only (fail-closed).
 * - Allowed subs from ENV: AFU9_ADMIN_SUBS (comma-separated list of admin sub IDs)
 * - If AFU9_ADMIN_SUBS is empty/missing: deny all (403)
 * - Activation is privileged operation (changes active lawbook pointer system-wide)
 */

import { NextRequest, NextResponse } from 'next/server';
import { activateLawbookVersion } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check if user sub is in admin allowlist
 * Fail-closed: empty/missing AFU9_ADMIN_SUBS → deny all
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    // Fail-closed: no admin allowlist configured → deny all
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

export const POST = withApi(async (request: NextRequest) => {
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  // AUTHORIZATION CHECK: Admin-only (fail-closed)
  if (!isAdminUser(userId)) {
    return NextResponse.json(
      { 
        error: 'Forbidden', 
        message: 'Admin privileges required to activate lawbook versions' 
      },
      { status: 403 }
    );
  }

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
