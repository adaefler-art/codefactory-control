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
  try {
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
