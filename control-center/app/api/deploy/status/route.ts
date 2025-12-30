import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import {
  DeployStatusResponse,
  DeployEnvironment,
  isValidEnvironment,
} from '@/lib/contracts/deployStatus';
import { collectStatusSignals } from '@/lib/deploy-status/signal-collector';
import { determineDeployStatus } from '@/lib/deploy-status/rules-engine';
import {
  insertDeployStatusSnapshot,
  getLatestDeployStatusSnapshot,
} from '@/lib/db/deployStatusSnapshots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cache duration for status responses (in seconds)
 * Prevents excessive re-computation
 */
const CACHE_TTL_SECONDS = 30;

/**
 * How stale data can be before we consider it problematic (seconds)
 */
const STALENESS_THRESHOLD_SECONDS = 300; // 5 minutes

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
    // Without database, we can still provide basic status from HTTP checks
    // but we won't be able to persist or retrieve historical data
    console.log(
      JSON.stringify({
        level: 'info',
        route: '/api/deploy/status',
        action: 'get_status_without_db',
        env,
        timestamp: new Date().toISOString(),
      })
    );

    try {
      // Collect fresh signals (no database needed for HTTP checks)
      const signals = await collectStatusSignals(null, {
        env,
        includeDeployEvents: false,
      });

      // Determine status based on signals
      const result = determineDeployStatus({
        env,
        signals,
        stalenessThresholdSeconds: STALENESS_THRESHOLD_SECONDS,
      });

      const response: DeployStatusResponse = {
        env,
        status: result.status,
        observed_at: signals.checked_at,
        reasons: result.reasons,
        signals,
        staleness_seconds: result.staleness_seconds,
      };

      return jsonResponse(response, { status: 200, requestId });
    } catch (error) {
      console.error('[DeployStatus] Error collecting signals without DB:', error);
      return jsonResponse(
        {
          error: 'Service unavailable',
          message: 'Failed to collect deployment status signals',
        },
        { status: 503, requestId }
      );
    }
  }

  // Database is enabled - use full functionality with caching
  const pool = getPool();

  try {
    // If not forcing refresh, try to get cached status from database
    if (!force) {
      const cachedResult = await getLatestDeployStatusSnapshot(pool, env);
      if (cachedResult.success && cachedResult.snapshot) {
        const snapshot = cachedResult.snapshot;
        const age = Math.floor(
          (Date.now() - new Date(snapshot.observed_at).getTime()) / 1000
        );

        // Use cached data if it's fresh enough
        if (age < CACHE_TTL_SECONDS) {
          console.log(
            JSON.stringify({
              level: 'info',
              route: '/api/deploy/status',
              action: 'cache_hit',
              env,
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

    // Cache miss or forced refresh - collect fresh signals
    console.log(
      JSON.stringify({
        level: 'info',
        route: '/api/deploy/status',
        action: 'collect_fresh_signals',
        env,
        force,
        timestamp: new Date().toISOString(),
      })
    );

    const signals = await collectStatusSignals(pool, {
      env,
      includeDeployEvents: true,
    });

    // Determine status based on signals
    const result = determineDeployStatus({
      env,
      signals,
      stalenessThresholdSeconds: STALENESS_THRESHOLD_SECONDS,
    });

    // Persist snapshot to database for future caching
    const persistResult = await insertDeployStatusSnapshot(pool, {
      env,
      status: result.status,
      observed_at: signals.checked_at,
      reasons: result.reasons,
      signals,
      staleness_seconds: result.staleness_seconds,
    });

    if (!persistResult.success) {
      console.error('[DeployStatus] Failed to persist snapshot:', persistResult.error);
      // Continue anyway - we can still return the status
    }

    const response: DeployStatusResponse = {
      env,
      status: result.status,
      observed_at: signals.checked_at,
      reasons: result.reasons,
      signals,
      staleness_seconds: result.staleness_seconds,
      snapshot_id: persistResult.snapshot?.id,
    };

    console.log(
      JSON.stringify({
        level: 'info',
        route: '/api/deploy/status',
        action: 'status_determined',
        env,
        status: result.status,
        reason_codes: result.reasons.map(r => r.code),
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
