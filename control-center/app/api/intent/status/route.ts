/**
 * API Route: /api/intent/status
 * 
 * Returns read-only status of INTENT feature flag (enabled/disabled).
 * Issue: INTENT Console - Layout fix + Enabled-Status Banner
 * 
 * SECURITY:
 * - 401-first: Requires x-afu9-sub header (set by middleware after JWT verification)
 * - NO secrets/keys/env-dumps in response
 * - Only returns boolean enabled status based on AFU9_INTENT_ENABLED
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/status
 * Returns INTENT feature flag status (enabled/disabled)
 * 
 * Response:
 * {
 *   enabled: boolean,
 *   mode: "enabled" | "disabled"
 * }
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  // This header is set by proxy.ts after server-side JWT verification
  // and cannot be spoofed by clients
  const userId = request.headers.get('x-afu9-sub');
  if (!userId) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Authentication required to access INTENT status',
    });
  }
  
  try {
    // Read AFU9_INTENT_ENABLED flag from environment
    // This is a boolean flag, not a secret
    const intentEnabled = process.env.AFU9_INTENT_ENABLED === 'true';
    
    return jsonResponse({
      enabled: intentEnabled,
      mode: intentEnabled ? 'enabled' : 'disabled',
    }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/status] Error retrieving status:', error);
    return errorResponse('Failed to retrieve INTENT status', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
