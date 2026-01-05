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
import { getActiveLawbookVersion } from '@/lib/lawbook-version-helper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cache duration for status responses (in seconds)
 * Prevents excessive re-computation
 */
const CACHE_TTL_SECONDS = 30;

function normalizeSnapshotSignals(signals: unknown): any {
  if (!signals || typeof signals !== 'object') {
    return { checkedAt: new Date().toISOString() };
  }

  const s = signals as Record<string, any>;

  // Prefer already-camelCase
  if (typeof s.checkedAt === 'string') {
    return s;
  }

  const legacyCheckedAt = typeof s.checked_at === 'string' ? s.checked_at : new Date().toISOString();
  const legacyCorrelationId = typeof s.correlation_id === 'string' ? s.correlation_id : undefined;
  const legacyVerificationRun = s.verification_run as any;

  const normalizedVerificationRun = legacyVerificationRun
    ? {
        runId: legacyVerificationRun.run_id,
        playbookId: legacyVerificationRun.playbook_id,
        playbookVersion: legacyVerificationRun.playbook_version,
        env: legacyVerificationRun.env,
        status: legacyVerificationRun.status,
        createdAt: legacyVerificationRun.created_at,
        startedAt: legacyVerificationRun.started_at ?? null,
        completedAt: legacyVerificationRun.completed_at ?? null,
      }
    : null;

  return {
    checkedAt: legacyCheckedAt,
    ...(legacyCorrelationId ? { correlationId: legacyCorrelationId } : {}),
    verificationRun: normalizedVerificationRun,
  };
}

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
          (Date.now() - new Date(snapshot.observedAt).getTime()) / 1000
        );

        const normalizedSignals = normalizeSnapshotSignals(snapshot.signals);
        const cachedCorrelationId = normalizedSignals?.correlationId as string | undefined;
        const cachedRunId = normalizedSignals?.verificationRun?.runId as string | undefined;
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
            observedAt: snapshot.observedAt,
            reasons: snapshot.reasons,
            signals: normalizedSignals,
            stalenessSeconds: snapshot.stalenessSeconds || 0,
            snapshotId: snapshot.id,
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

    // E79.3 / I793: Get active lawbook version (passive ingestion - null if not configured)
    const lawbookVersion = await getActiveLawbookVersion(pool);

    const resolved = await resolveDeployStatusFromVerificationRuns(pool, {
      env,
      correlationId,
      lawbookVersion,
    });

    // Idempotency: avoid inserting duplicates for the same correlation/run.
    const latestSnapshot = await getLatestDeployStatusSnapshot(pool, env);
    if (latestSnapshot.success && latestSnapshot.snapshot) {
      const previous = latestSnapshot.snapshot;
      const prevSignals = normalizeSnapshotSignals(previous.signals);
      const prevCorrelationId = prevSignals?.correlationId as string | undefined;
      const prevRunId = prevSignals?.verificationRun?.runId as string | undefined;
      const nextCorrelationId = resolved.signals?.correlationId;
      const nextRunId = resolved.signals?.verificationRun?.runId;

      if (
        previous.status === resolved.status &&
        prevCorrelationId === nextCorrelationId &&
        prevRunId === nextRunId
      ) {
        const response: DeployStatusResponse = {
          env: previous.env,
          status: previous.status,
          observedAt: previous.observedAt,
          reasons: previous.reasons,
          signals: prevSignals,
          stalenessSeconds: previous.stalenessSeconds || 0,
          snapshotId: previous.id,
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
      observedAt: resolved.observedAt || new Date().toISOString(),
      reasons: resolved.reasons,
      signals: resolved.signals,
      stalenessSeconds: resolved.stalenessSeconds || 0,
      snapshotId: persistResult.snapshot?.id,
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
