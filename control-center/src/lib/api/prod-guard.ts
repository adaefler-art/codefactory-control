/**
 * API Guards for Production Environment Control (Issue 3)
 * 
 * Provides middleware and helpers to block production write operations
 * when ENABLE_PROD=false.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isProdEnabled, getProdDisabledReason } from '@/lib/utils/prod-control';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { jsonResponse } from '@/lib/api/response-helpers';

/**
 * Check if the current request should be blocked due to prod being disabled
 * 
 * @returns NextResponse with 403 error if blocked, null if allowed
 */
export function checkProdWriteGuard(request: NextRequest): NextResponse | null {
  const deploymentEnv = getDeploymentEnv();
  
  // Only block if we're in production and ENABLE_PROD=false
  if (deploymentEnv === 'production' && !isProdEnabled()) {
    console.log(`[PROD-GUARD] Blocked write operation in production: ${request.method} ${request.url}`);
    
    return jsonResponse(
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
      { status: 403 }
    );
  }
  
  return null; // Allow the request
}

/**
 * Higher-order function to wrap API routes with prod write guard
 * 
 * Usage:
 * ```typescript
 * export const POST = withProdWriteGuard(async (request: NextRequest) => {
 *   // Your handler logic here
 * });
 * ```
 */
export function withProdWriteGuard(
  handler: (request: NextRequest) => Promise<NextResponse>
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const guardResponse = checkProdWriteGuard(request);
    if (guardResponse) {
      return guardResponse;
    }
    
    return handler(request);
  };
}
