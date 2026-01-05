/**
 * API Route: GET /api/whoami
 * 
 * Diagnostic endpoint for authentication and authorization status.
 * Returns current user's sub and admin status without making database calls.
 * 
 * SECURITY: Auth-first (401) + fail-closed admin check
 * - x-afu9-sub header is set by proxy.ts after server-side JWT verification
 * - Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing
 * - Admin check from AFU9_ADMIN_SUBS env var (fail-closed if missing/empty)
 * - NO database calls - purely diagnostic/read-only
 * 
 * Response:
 * - sub: string - The verified user sub from x-afu9-sub header
 * - isAdmin: boolean - Whether user is in admin allowlist
 * 
 * Error codes:
 * - 401 UNAUTHORIZED - Missing or empty x-afu9-sub
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check if user sub is in admin allowlist
 * Fail-closed: empty/missing AFU9_ADMIN_SUBS → returns false
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    // Fail-closed: no admin allowlist configured → not admin
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

/**
 * GET /api/whoami
 * 
 * Returns current user's authentication and authorization status
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  // Check admin status (fail-closed, no 403 on this read-only endpoint)
  const isAdmin = isAdminUser(userId);

  return jsonResponse(
    {
      sub: userId,
      isAdmin,
    },
    { 
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
