/**
 * Deploy Status Snapshots Database Helper
 * 
 * Centralized database operations for deploy_status_snapshots table.
 * Provides type-safe CRUD operations with proper error handling.
 */

import { Pool } from 'pg';
import {
  DeployStatusSnapshot,
  CreateDeployStatusInput,
  DeployEnvironment,
} from '../contracts/deployStatus';

/**
 * Insert result type
 */
export interface InsertSnapshotResult {
  success: boolean;
  snapshot?: DeployStatusSnapshot;
  error?: string;
}

/**
 * Query result type
 */
export interface QuerySnapshotResult {
  success: boolean;
  snapshots?: DeployStatusSnapshot[];
  error?: string;
}

/**
 * Insert a deploy status snapshot into the database
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Validated deploy status input
 * @returns Insert result with snapshot or error
 */
export async function insertDeployStatusSnapshot(
  pool: Pool,
  input: CreateDeployStatusInput
): Promise<InsertSnapshotResult> {
  const runId = input.signals?.verificationRun?.runId;
  const correlationKey = input.signals?.correlationId || runId;

  try {
    // Idempotency hardening:
    // If we have a verification run ID, ensure we do not create duplicate snapshots
    // for the same (env, correlationId-or-runId, verificationRun.runId). We do this
    // with a transaction-scoped advisory lock and an update-or-insert flow.
    if (runId && correlationKey) {
      const lockKey = `deploy_status_snapshots|${input.env}|${correlationKey}|${runId}`;
      const observedAt = input.observedAt || new Date().toISOString();
      const reasonsJson = JSON.stringify(input.reasons);
      const signalsJson = JSON.stringify(input.signals);

      await pool.query('BEGIN');
      try {
        await pool.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);

        const existing = await pool.query<{ id: string }>(
          `SELECT id
           FROM deploy_status_snapshots
           WHERE env = $1
             AND COALESCE(
               signals->>'correlationId',
               signals->>'correlation_id',
               signals #>> '{verificationRun,runId}',
               signals #>> '{verification_run,run_id}'
             ) = $2
             AND COALESCE(
               signals #>> '{verificationRun,runId}',
               signals #>> '{verification_run,run_id}'
             ) = $3
           ORDER BY observed_at DESC
           LIMIT 1`,
          [input.env, correlationKey, runId]
        );

        if (existing.rows.length > 0) {
          const updateResult = await pool.query<DeployStatusSnapshot>(
            `UPDATE deploy_status_snapshots
             SET status = $2,
                 observed_at = $3,
                 reasons = $4,
                 signals = $5,
                 related_deploy_event_id = $6,
                 staleness_seconds = $7
             WHERE id = $1
             RETURNING
               id,
               created_at as "createdAt",
               updated_at as "updatedAt",
               env,
               status,
               observed_at as "observedAt",
               reasons,
               signals,
               related_deploy_event_id as "relatedDeployEventId",
               staleness_seconds as "stalenessSeconds"`,
            [
              existing.rows[0].id,
              input.status,
              observedAt,
              reasonsJson,
              signalsJson,
              input.relatedDeployEventId || null,
              input.stalenessSeconds || null,
            ]
          );

          await pool.query('COMMIT');

          if (updateResult.rows.length === 0) {
            return {
              success: false,
              error: 'No row returned from update',
            };
          }

          return {
            success: true,
            snapshot: updateResult.rows[0],
          };
        }

        const insertResult = await pool.query<DeployStatusSnapshot>(
          `INSERT INTO deploy_status_snapshots
            (env, status, observed_at, reasons, signals, related_deploy_event_id, staleness_seconds)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING
             id,
             created_at as "createdAt",
             updated_at as "updatedAt",
             env,
             status,
             observed_at as "observedAt",
             reasons,
             signals,
             related_deploy_event_id as "relatedDeployEventId",
             staleness_seconds as "stalenessSeconds"`,
          [
            input.env,
            input.status,
            observedAt,
            reasonsJson,
            signalsJson,
            input.relatedDeployEventId || null,
            input.stalenessSeconds || null,
          ]
        );

        await pool.query('COMMIT');

        if (insertResult.rows.length === 0) {
          return {
            success: false,
            error: 'No row returned from insert',
          };
        }

        return {
          success: true,
          snapshot: insertResult.rows[0],
        };
      } catch (txError) {
        try {
          await pool.query('ROLLBACK');
        } catch {
          // ignore rollback failure
        }
        throw txError;
      }
    }

    const result = await pool.query<DeployStatusSnapshot>(
      `INSERT INTO deploy_status_snapshots 
        (env, status, observed_at, reasons, signals, related_deploy_event_id, staleness_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING 
         id,
         created_at as "createdAt",
         updated_at as "updatedAt",
         env,
         status,
         observed_at as "observedAt",
         reasons,
         signals,
         related_deploy_event_id as "relatedDeployEventId",
         staleness_seconds as "stalenessSeconds"`,
      [
        input.env,
        input.status,
        input.observedAt || new Date().toISOString(),
        JSON.stringify(input.reasons),
        JSON.stringify(input.signals),
        input.relatedDeployEventId || null,
        input.stalenessSeconds || null,
      ]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No row returned from insert',
      };
    }

    return {
      success: true,
      snapshot: result.rows[0],
    };
  } catch (error) {
    // If a DB-level unique constraint prevents a duplicate insert, treat it as success and
    // return the existing snapshot.
    const maybePgError = error as any;
    if (runId && correlationKey && maybePgError && maybePgError.code === '23505') {
      try {
        const existing = await pool.query<DeployStatusSnapshot>(
          `SELECT
             id,
             created_at as "createdAt",
             updated_at as "updatedAt",
             env,
             status,
             observed_at as "observedAt",
             reasons,
             signals,
             related_deploy_event_id as "relatedDeployEventId",
             staleness_seconds as "stalenessSeconds"
           FROM deploy_status_snapshots
           WHERE env = $1
             AND COALESCE(
               signals->>'correlationId',
               signals->>'correlation_id',
               signals #>> '{verificationRun,runId}',
               signals #>> '{verification_run,run_id}'
             ) = $2
             AND COALESCE(
               signals #>> '{verificationRun,runId}',
               signals #>> '{verification_run,run_id}'
             ) = $3
           ORDER BY observed_at DESC
           LIMIT 1`,
          [input.env, correlationKey, runId]
        );

        if (existing.rows.length > 0) {
          return { success: true, snapshot: existing.rows[0] };
        }
      } catch {
        // Fall through to normal error handling.
      }
    }

    console.error('[deployStatusSnapshots] Insert failed:', {
      error: error instanceof Error ? error.message : String(error),
      env: input.env,
      status: input.status,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get the latest deploy status snapshot for an environment
 * 
 * @param pool - PostgreSQL connection pool
 * @param env - Environment identifier
 * @returns Query result with snapshot or error
 */
export async function getLatestDeployStatusSnapshot(
  pool: Pool,
  env: DeployEnvironment
): Promise<InsertSnapshotResult> {
  try {
    const result = await pool.query<DeployStatusSnapshot>(
      `SELECT 
         id,
         created_at as "createdAt",
         updated_at as "updatedAt",
         env,
         status,
         observed_at as "observedAt",
         reasons,
         signals,
         related_deploy_event_id as "relatedDeployEventId",
         staleness_seconds as "stalenessSeconds"
       FROM deploy_status_snapshots
       WHERE env = $1
       ORDER BY observed_at DESC
       LIMIT 1`,
      [env]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No snapshots found for environment',
      };
    }

    return {
      success: true,
      snapshot: result.rows[0],
    };
  } catch (error) {
    console.error('[deployStatusSnapshots] Query failed:', {
      error: error instanceof Error ? error.message : String(error),
      env,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get recent deploy status snapshots for an environment
 * 
 * @param pool - PostgreSQL connection pool
 * @param env - Environment identifier
 * @param limit - Maximum number of snapshots to return (default: 10)
 * @returns Query result with snapshots or error
 */
export async function getRecentDeployStatusSnapshots(
  pool: Pool,
  env: DeployEnvironment,
  limit: number = 10
): Promise<QuerySnapshotResult> {
  try {
    const result = await pool.query<DeployStatusSnapshot>(
      `SELECT 
         id,
         created_at as "createdAt",
         updated_at as "updatedAt",
         env,
         status,
         observed_at as "observedAt",
         reasons,
         signals,
         related_deploy_event_id as "relatedDeployEventId",
         staleness_seconds as "stalenessSeconds"
       FROM deploy_status_snapshots
       WHERE env = $1
       ORDER BY observed_at DESC
       LIMIT $2`,
      [env, limit]
    );

    return {
      success: true,
      snapshots: result.rows,
    };
  } catch (error) {
    console.error('[deployStatusSnapshots] Query failed:', {
      error: error instanceof Error ? error.message : String(error),
      env,
      limit,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get latest deploy events for an environment
 * Helper function to fetch recent deploy events for status determination
 * 
 * @param pool - PostgreSQL connection pool
 * @param env - Environment identifier
 * @param limit - Maximum number of events to return (default: 5)
 * @returns Query result with deploy events
 */
export async function getLatestDeployEvents(
  pool: Pool,
  env: string,
  limit: number = 5
): Promise<{
  success: boolean;
  events?: Array<{
    id: string;
    created_at: string;
    env: string;
    service: string;
    version: string;
    commit_hash: string;
    status: string;
    message: string | null;
  }>;
  error?: string;
}> {
  try {
    const result = await pool.query(
      `SELECT id, created_at, env, service, version, commit_hash, status, message
       FROM deploy_events
       WHERE env = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [env, limit]
    );

    return {
      success: true,
      events: result.rows,
    };
  } catch (error) {
    console.error('[deployStatusSnapshots] Get deploy events failed:', {
      error: error instanceof Error ? error.message : String(error),
      env,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Last Known Good (LKG) deployment record
 * Represents a deployment that was verified GREEN with PASS verification
 */
export interface LastKnownGoodDeploy {
  snapshotId: string;
  deployEventId: string | null;
  env: string;
  service: string | null;
  version: string | null;
  commitHash: string | null;
  imageDigest: string | null;
  cfnChangeSetId: string | null;
  observedAt: string;
  verificationRunId: string | null;
  verificationReportHash: string | null;
}

/**
 * Find Last Known Good (LKG) deployment for an environment
 * 
 * LKG Definition (I773):
 * - Deploy status snapshot with status = 'GREEN'
 * - Verification PASS with reportHash present (in signals.verificationRun)
 * - Known deploy inputs (commit_hash from deploy_events OR signals metadata)
 * - Most recent matching record for the environment/service
 * 
 * @param pool - PostgreSQL connection pool
 * @param env - Environment identifier (required)
 * @param service - Optional service filter
 * @returns LKG deploy record or null if not found
 */
export async function findLastKnownGood(
  pool: Pool,
  env: DeployEnvironment,
  service?: string
): Promise<{
  success: boolean;
  lkg?: LastKnownGoodDeploy | null;
  error?: string;
}> {
  try {
    // Query for most recent GREEN snapshot with verification PASS
    // Join with deploy_events to get commit/version details
    const query = `
      SELECT 
        dss.id as snapshot_id,
        dss.related_deploy_event_id as deploy_event_id,
        dss.env,
        de.service,
        de.version,
        de.commit_hash,
        dss.observed_at,
        dss.signals #>> '{verificationRun,runId}' as verification_run_id,
        dss.signals #>> '{verificationRun,reportHash}' as verification_report_hash,
        dss.signals #>> '{deploy,imageDigest}' as image_digest,
        dss.signals #>> '{deploy,cfnChangeSetId}' as cfn_changeset_id
      FROM deploy_status_snapshots dss
      LEFT JOIN deploy_events de ON dss.related_deploy_event_id = de.id
      WHERE dss.env = $1
        AND dss.status = 'GREEN'
        AND dss.signals #>> '{verificationRun,status}' = 'success'
        AND dss.signals #>> '{verificationRun,reportHash}' IS NOT NULL
        ${service ? 'AND de.service = $2' : ''}
      ORDER BY dss.observed_at DESC
      LIMIT 1
    `;

    const params = service ? [env, service] : [env];
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        success: true,
        lkg: null,
      };
    }

    const row = result.rows[0];
    const lkg: LastKnownGoodDeploy = {
      snapshotId: row.snapshot_id,
      deployEventId: row.deploy_event_id,
      env: row.env,
      service: row.service || null,
      version: row.version || null,
      commitHash: row.commit_hash || null,
      imageDigest: row.image_digest || null,
      cfnChangeSetId: row.cfn_changeset_id || null,
      observedAt: row.observed_at,
      verificationRunId: row.verification_run_id || null,
      verificationReportHash: row.verification_report_hash || null,
    };

    return {
      success: true,
      lkg,
    };
  } catch (error) {
    console.error('[deployStatusSnapshots] Find LKG failed:', {
      error: error instanceof Error ? error.message : String(error),
      env,
      service,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
