/**
 * Deploy Events Database Helper
 * 
 * Centralized database operations for deploy_events table.
 * Provides type-safe insert with proper error handling.
 */

import { Pool } from 'pg';
import {
  DeployEventInput,
  DeployEventRow,
  sanitizeDeployEventInput,
} from '../contracts/deployEvent';

/**
 * Insert result type
 */
export interface InsertResult {
  success: boolean;
  event?: DeployEventRow;
  error?: string;
}

/**
 * Insert a deploy event into the database
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Validated and sanitized deploy event input
 * @returns Insert result with event or error
 */
export async function insertDeployEvent(
  pool: Pool,
  input: DeployEventInput
): Promise<InsertResult> {
  // Sanitize input to ensure all constraints are met
  const sanitized = sanitizeDeployEventInput(input);

  try {
    const result = await pool.query<DeployEventRow>(
      `INSERT INTO deploy_events (env, service, version, commit_hash, status, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at, env, service, version, commit_hash, status, message`,
      [
        sanitized.env,
        sanitized.service,
        sanitized.version,
        sanitized.commit_hash,
        sanitized.status,
        sanitized.message,
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
      event: result.rows[0],
    };
  } catch (error) {
    // Log error for debugging (without exposing sensitive data)
    console.error('[deployEvents] Insert failed:', {
      error: error instanceof Error ? error.message : String(error),
      env: sanitized.env,
      service: sanitized.service,
      status: sanitized.status,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
