/**
 * API Route: Admin Cost Control Status
 *
 * GET /api/admin/cost-control/status?env=staging
 *
 * Returns a read-only snapshot of operational signals (no cost claims).
 * If signals are not available, returns "unknown" with diagnostics (never 500 for missing signals).
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { describeService } from '@/lib/ecs/adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

function parseEnvParam(value: string | null | undefined): 'staging' | null {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  return normalized === 'staging' ? 'staging' : null;
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }

  const env = parseEnvParam(request.nextUrl.searchParams.get('env'));
  if (!env) {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_ENV',
      details: 'env query param must be staging',
    });
  }

  const diagnostics: Record<string, any> = {
    inputs: {
      ecsCluster: process.env.ECS_CLUSTER_NAME || null,
      ecsService: process.env.ECS_SERVICE_NAME || null,
    },
    warnings: [] as string[],
  };

  const cluster = process.env.ECS_CLUSTER_NAME || 'afu9-cluster';
  const service = process.env.ECS_SERVICE_NAME || 'afu9-control-center-staging';

  let ecs: any = { state: 'unknown' as const };
  try {
    const res = await describeService(cluster, service);
    if (res.success && res.service) {
      ecs = {
        state: 'ok' as const,
        desiredCount: res.service.desiredCount,
        runningCount: res.service.runningCount,
        cluster,
        service,
      };
    } else {
      ecs = {
        state: 'unknown' as const,
        cluster,
        service,
      };
      diagnostics.warnings.push(`ecs_unavailable:${res.error?.code || 'unknown'}`);
      diagnostics.ecsError = res.error || null;
    }
  } catch (e) {
    ecs = {
      state: 'unknown' as const,
      cluster,
      service,
    };
    diagnostics.warnings.push('ecs_exception');
    diagnostics.ecsError = e instanceof Error ? e.message : String(e);
  }

  // Phase 1: No RDS integration wired here. Return unknown with diagnostics.
  const rds = {
    state: 'unknown' as const,
    message: 'RDS status integration not available (phase 1)',
  };

  return jsonResponse(
    {
      ok: true,
      env,
      ecs,
      rds,
      diagnostics,
      timestamp: new Date().toISOString(),
    },
    { requestId, headers: { 'Cache-Control': 'no-store' } }
  );
}
