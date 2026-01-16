/**
 * API Route: POST /api/ops/capabilities/probe
 * 
 * E89.8 - Capability Probe Trigger (Staging-Only)
 * 
 * Triggers a health probe of all MCP servers and tools.
 * Results stored in append-only audit log (afu9_capability_probes).
 * 
 * Features:
 * - Probes all MCP endpoints
 * - Records probe results in database
 * - Returns probe summary
 * 
 * SECURITY:
 * - Requires x-afu9-sub header (auth-protected)
 * - STAGING-ONLY (blocked in production)
 * - Read-only probes (no mutations to external systems)
 * - Audit trail for all probes
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { probeAllCapabilities } from '@/lib/capability-probe-service';
import { getDbPool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check deployment environment
 */
function getDeploymentEnv(): 'production' | 'staging' | 'development' {
  const env = process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || 'development';
  
  if (env === 'production' || env === 'prod') {
    return 'production';
  } else if (env === 'staging' || env === 'stage') {
    return 'staging';
  }
  
  return 'development';
}

/**
 * POST /api/ops/capabilities/probe
 * 
 * Trigger capability health probe (staging-only)
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  // STAGING-ONLY GUARD
  const deploymentEnv = getDeploymentEnv();
  if (deploymentEnv === 'production') {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'PROD_BLOCKED',
      details: 'Capability probes are disabled in production. Use staging environment.',
    });
  }

  // AUTH CHECK: Require x-afu9-sub header (set by middleware after JWT verification)
  const userId = request.headers.get('x-afu9-sub');
  if (!userId) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Authentication required to trigger capability probes',
    });
  }

  try {
    // Probe all capabilities
    const pool = getDbPool();
    const summary = await probeAllCapabilities(pool, {
      userId,
      sessionId: `probe-${requestId}`,
    });

    // Return probe summary
    return jsonResponse({
      ok: true,
      summary,
      environment: deploymentEnv,
      triggeredBy: userId,
      timestamp: new Date().toISOString(),
    }, {
      requestId,
      headers: {
        'Cache-Control': 'no-store', // Don't cache probe results
      },
    });
  } catch (error) {
    console.error('[API /api/ops/capabilities/probe] Error probing capabilities:', error);
    return errorResponse('Failed to probe capabilities', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
