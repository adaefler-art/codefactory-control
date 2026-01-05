/**
 * Production Write Guard (Issue 3 - Standardized)
 * 
 * Unified guard helper enforcing consistent ordering for all prod write endpoints:
 * 1. AUTH CHECK (401-first): Verify x-afu9-sub - NO DB calls
 * 2. PROD DISABLED (409): Check ENABLE_PROD - NO DB calls
 * 3. ADMIN CHECK (403): Verify AFU9_ADMIN_SUBS - NO DB calls
 * 
 * Only if all guards pass should the endpoint proceed to DB/network operations.
 * 
 * SECURITY PRINCIPLE: Fail-closed at every layer
 * - Missing auth → 401, stop immediately
 * - Prod disabled → 409, stop immediately  
 * - Not admin (when required) → 403, stop immediately
 * - Empty/missing AFU9_ADMIN_SUBS → deny all (fail-closed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { isProdEnabled, getProdDisabledReason } from '@/lib/utils/prod-control';
import { jsonResponse, errorResponse } from '@/lib/api/response-helpers';

export interface ProdWriteGuardOptions {
  /**
   * Whether to require admin privileges (AFU9_ADMIN_SUBS check)
   * Default: false (no admin check)
   */
  requireAdmin?: boolean;
  
  /**
   * Request ID for error responses (from getRequestId)
   */
  requestId?: string;
}

export interface ProdWriteGuardResult {
  /**
   * If guard blocks the request, this contains the error response
   * If null, all guards passed and request can proceed
   */
  errorResponse: NextResponse | null;
  
  /**
   * The authenticated user ID (from x-afu9-sub header)
   * Only set if auth check passed
   */
  userId?: string;
}

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

/**
 * Unified production write guard
 * 
 * Enforces strict ordering:
 * 1. AUTH CHECK (401) - Verify x-afu9-sub, NO DB calls
 * 2. PROD DISABLED (409) - Check ENABLE_PROD, NO DB calls
 * 3. ADMIN CHECK (403) - Verify admin allowlist (if required), NO DB calls
 * 
 * @param request - NextRequest object
 * @param options - Guard configuration options
 * @returns ProdWriteGuardResult with errorResponse (if blocked) or userId (if passed)
 * 
 * @example
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const requestId = getRequestId(request);
 *   const guard = checkProdWriteGuard(request, { requireAdmin: true, requestId });
 *   
 *   if (guard.errorResponse) {
 *     return guard.errorResponse;
 *   }
 *   
 *   const userId = guard.userId!;
 *   // Proceed with DB operations...
 * }
 * ```
 */
export function checkProdWriteGuard(
  request: NextRequest,
  options: ProdWriteGuardOptions = {}
): ProdWriteGuardResult {
  const { requireAdmin = false, requestId } = options;
  
  // 1. AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  // This must happen BEFORE env gating to maintain auth-first principle
  // SECURITY: x-afu9-sub is set by proxy.ts after server-side JWT verification
  // Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return {
      errorResponse: errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
      }),
    };
  }
  
  // 2. PROD DISABLED CHECK (409): Block if prod and ENABLE_PROD != 'true'
  // Return 409 Conflict (environment state conflict), not 403
  const deploymentEnv = getDeploymentEnv();
  if (deploymentEnv === 'production' && !isProdEnabled()) {
    console.log(`[PROD-WRITE-GUARD] Blocked write operation in production: ${request.method} ${request.url}`);
    
    return {
      errorResponse: jsonResponse(
        {
          error: 'Production environment is disabled',
          message: getProdDisabledReason(),
          code: 'PROD_DISABLED',
          details: {
            environment: 'production',
            enableProd: false,
            action: 'To re-enable production, set ENABLE_PROD=true and follow re-enable procedure',
          },
        },
        { status: 409, requestId }
      ),
      userId,
    };
  }
  
  // 3. ADMIN CHECK (403): Verify AFU9_ADMIN_SUBS allowlist (if required)
  // Fail-closed: empty/missing AFU9_ADMIN_SUBS → deny all
  if (requireAdmin) {
    if (!isAdminUser(userId)) {
      const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
      const reason = !adminSubs.trim()
        ? 'Admin allowlist not configured (AFU9_ADMIN_SUBS missing/empty)'
        : 'User not in admin allowlist';
      
      return {
        errorResponse: errorResponse('Forbidden', {
          status: 403,
          requestId,
          code: 'FORBIDDEN',
          details: reason,
        }),
        userId,
      };
    }
  }
  
  // All guards passed - allow request to proceed
  return {
    errorResponse: null,
    userId,
  };
}

/**
 * Higher-order function to wrap API routes with prod write guard
 * 
 * @param handler - The route handler function
 * @param options - Guard configuration options
 * @returns Wrapped handler with guard enforcement
 * 
 * @example
 * ```typescript
 * export const POST = withProdWriteGuard(
 *   async (request: NextRequest, userId: string) => {
 *     // Your handler logic here
 *     // userId is guaranteed to be set
 *   },
 *   { requireAdmin: true }
 * );
 * ```
 */
export function withProdWriteGuard(
  handler: (request: NextRequest, userId: string) => Promise<NextResponse>,
  options: ProdWriteGuardOptions = {}
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> {
    const guard = checkProdWriteGuard(request, options);
    
    if (guard.errorResponse) {
      return guard.errorResponse;
    }
    
    // All guards passed - proceed with handler
    return handler(request, guard.userId!);
  };
}
