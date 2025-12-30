import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import {
  DeployStatusResponse,
  DeployEnvironment,
  isValidEnvironment,
} from '@/lib/contracts/deployStatus';
import {
  insertDeployStatusSnapshot,
  getLatestDeployStatusSnapshot,
} from '@/lib/db/deployStatusSnapshots';
import { resolveDeployStatusFromVerificationRuns } from '@/lib/deploy-status/verification-resolver';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cache duration for status responses (in seconds)
 * Prevents excessive re-computation
 */
const CACHE_TTL_SECONDS = 30;

/**
 * Check if database is enabled
 */
function isDatabaseEnabled(): boolean {
  return process.env.DATABASE_ENABLED === 'true';
}

/**
 * GET /api/deploy/status?env={env}
 * 
 * Returns the current deploy status for a given environment.
 * 
 * Query Parameters:
 * - env: Environment identifier (prod, stage, etc.) - required
 * - force: Force fresh status check (bypass cache) - optional
 * 
 * Response:
 * - 200: Success with status data
 * - 400: Invalid environment parameter
 * - 503: Database disabled or service unavailable
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const searchParams = request.nextUrl.searchParams;
  const env = searchParams.get('env') as DeployEnvironment;
  const force = searchParams.get('force') === 'true';
  const correlationId = searchParams.get('correlationId') || undefined;

  // Validate environment parameter
  if (!env || !isValidEnvironment(env)) {
    return jsonResponse(
      {
        error: 'Invalid environment',
        message: 'env query parameter must be a valid environment identifier (e.g., prod, stage)',
      },
      { status: 400, requestId }
    );
  }

  // Check if database is enabled
  if (!isDatabaseEnabled()) {
    return jsonResponse(
      {
        error: 'Service unavailable',
        message:
          'Deploy status requires DATABASE_ENABLED=true to read post-deploy verification runs and persist status snapshots',
      },
      { status: 503, requestId }
    );
  }

  // Database is enabled - use full functionality with caching
  const pool = getPool();

  try {
    // If not forcing refresh, try to get cached status from database.
    // If correlationId is provided, only return cached snapshot if it matches.
    if (!force) {
      const cachedResult = await getLatestDeployStatusSnapshot(pool, env);
      if (cachedResult.success && cachedResult.snapshot) {
        const snapshot = cachedResult.snapshot;
        const age = Math.floor(
          (Date.now() - new Date(snapshot.observed_at).getTime()) / 1000
        );

        const cachedCorrelationId = (snapshot.signals as any)?.correlation_id as
          | string
          | undefined;
        const cachedRunId = (snapshot.signals as any)?.verification_run?.run_id as
          | string
          | undefined;
        const correlationMatch =
          !correlationId || correlationId === cachedCorrelationId || correlationId === cachedRunId;

        // Use cached data if it's fresh enough
        if (age < CACHE_TTL_SECONDS && correlationMatch) {
          console.log(
            JSON.stringify({
              level: 'info',
              route: '/api/deploy/status',
              action: 'cache_hit',
              env,
              correlationId: correlationId || null,
              age_seconds: age,
              timestamp: new Date().toISOString(),
            })
          );

          const response: DeployStatusResponse = {
            env: snapshot.env,
            status: snapshot.status,
            observed_at: snapshot.observed_at,
            reasons: snapshot.reasons,
            signals: snapshot.signals,
            staleness_seconds: snapshot.staleness_seconds || 0,
            snapshot_id: snapshot.id,
          };

          return jsonResponse(response, { status: 200, requestId });
        }
      }
    }

    // Cache miss or forced refresh - resolve deterministically from verification runs
    console.log(
      JSON.stringify({
        level: 'info',
        route: '/api/deploy/status',
        action: 'resolve_from_verification_runs',
        env,
        force,
        correlationId: correlationId || null,
        timestamp: new Date().toISOString(),
      })
    );

    const resolved = await resolveDeployStatusFromVerificationRuns(pool, {
      env,
      correlationId,
    });

    // Idempotency: avoid inserting duplicates for the same correlation/run.
    const latestSnapshot = await getLatestDeployStatusSnapshot(pool, env);
    if (latestSnapshot.success && latestSnapshot.snapshot) {
      const previous = latestSnapshot.snapshot;
      const prevCorrelationId = (previous.signals as any)?.correlation_id as
        | string
        | undefined;
      const prevRunId = (previous.signals as any)?.verification_run?.run_id as
        | string
        | undefined;
      const nextCorrelationId = (resolved.signals as any)?.correlation_id as
        | string
        | undefined;
      const nextRunId = (resolved.signals as any)?.verification_run?.run_id as
        | string
        | undefined;

      if (previous.status === resolved.status && prevCorrelationId === nextCorrelationId && prevRunId === nextRunId) {
        const response: DeployStatusResponse = {
          env: previous.env,
          status: previous.status,
          observed_at: previous.observed_at,
          reasons: previous.reasons,
          signals: previous.signals,
          staleness_seconds: previous.staleness_seconds || 0,
          snapshot_id: previous.id,
        };

        return jsonResponse(response, { status: 200, requestId });
      }
    }

    // Persist snapshot to database for future caching
    const persistResult = await insertDeployStatusSnapshot(pool, resolved);

    if (!persistResult.success) {
      console.error('[DeployStatus] Failed to persist snapshot:', persistResult.error);
      // Continue anyway - we can still return the status
    }

    const response: DeployStatusResponse = {
      env,
      status: resolved.status,
      observed_at: resolved.observed_at || new Date().toISOString(),
      reasons: resolved.reasons,
      signals: resolved.signals,
      staleness_seconds: resolved.staleness_seconds || 0,
      snapshot_id: persistResult.snapshot?.id,
    };

    console.log(
      JSON.stringify({
        level: 'info',
        route: '/api/deploy/status',
        action: 'status_determined',
        env,
        status: resolved.status,
        reason_codes: resolved.reasons.map(r => r.code),
        timestamp: new Date().toISOString(),
      })
    );

    return jsonResponse(response, { status: 200, requestId });
  } catch (error) {
    console.error('[DeployStatus] Unexpected error:', {
      error: error instanceof Error ? error.message : String(error),
      env,
      timestamp: new Date().toISOString(),
    });

    return jsonResponse(
      {
        error: 'Service unavailable',
        message: 'Failed to determine deployment status',
      },
      { status: 503, requestId }
    );
  }
}
