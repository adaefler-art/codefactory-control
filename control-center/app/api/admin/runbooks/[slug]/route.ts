/**
 * API: GET /api/admin/runbooks/[slug]
 * Returns specific runbook by slug including full content
 * I905 - Runbooks UX
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadRunbookBySlug } from '@/lib/runbooks/loader';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

export const dynamic = 'force-dynamic';

/**
 * Check if user is admin (based on AFU9_ADMIN_SUBS env var)
 */
function isAdminUser(userId: string | null): boolean {
  if (!userId) return false;
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

/**
 * Validate smoke key for unauthenticated access (staging smoke tests)
 */
function isValidSmokeKey(key: string | null): boolean {
  const validKey = process.env.AFU9_SMOKE_KEY;
  return !!(validKey && validKey.trim() && key === validKey);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const requestId = getRequestId(request);
  
  // Authentication check (admin or smoke key)
  const userId = request.headers.get('x-afu9-sub');
  const smokeKey = request.headers.get('x-afu9-smoke-key');
  
  const isAdmin = isAdminUser(userId);
  const hasValidSmokeKey = isValidSmokeKey(smokeKey);
  
  if (!isAdmin && !hasValidSmokeKey) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Admin privileges or valid smoke key required',
    });
  }
  
  try {
    const { slug } = await params;
    
    const runbook = loadRunbookBySlug(slug);
    
    if (!runbook) {
      return errorResponse('Runbook not found', {
        status: 404,
        requestId
      });
    }
    
    return jsonResponse({
      ok: true,
      runbook
    }, { requestId });
  } catch (error) {
    console.error('Error loading runbook:', error);
    return errorResponse('Failed to load runbook', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
