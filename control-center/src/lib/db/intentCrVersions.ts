/**
 * Database Access Layer: INTENT CR Versions
 * 
 * Provides functions for managing immutable CR (Change Request) versions per INTENT session.
 * Issue E74.4: CR Versioning + Diff (immutable versions + latest pointer)
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import { canonicalizeChangeRequestToJSON, type ChangeRequest } from '../schemas/changeRequest';

export interface IntentCrVersion {
  id: string;
  session_id: string;
  created_at: string;
  cr_json: unknown;
  cr_hash: string;
  cr_version: number;
}

export interface IntentCrLatest {
  session_id: string;
  latest_cr_version_id: string;
  updated_at: string;
}

/**
 * Commit a CR as a new immutable version
 * 
 * - Computes hash from canonical JSON
 * - If hash already exists for this session, returns existing version (idempotency)
 * - Otherwise, creates new version with incremented cr_version
 * - Updates latest pointer atomically
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param userId User ID (for ownership check)
 * @param crJson CR JSON to commit
 * @returns Success with version data, or error
 */
export async function commitCrVersion(
  pool: Pool,
  sessionId: string,
  userId: string,
  crJson: unknown
): Promise<{ success: true; data: IntentCrVersion; isNew: boolean } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verify session ownership
    const sessionCheck = await client.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    // Compute canonical hash
    let hash: string;
    try {
      const parsed = crJson as ChangeRequest;
      const canonical = canonicalizeChangeRequestToJSON(parsed);
      hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    } catch {
      // If can't canonicalize, use hash of JSON.stringify
      const raw = JSON.stringify(crJson);
      hash = createHash('sha256').update(raw, 'utf8').digest('hex');
    }
    
    // Check if this hash already exists for this session (idempotency)
    const existingVersion = await client.query(
      `SELECT id, session_id, created_at, cr_json, cr_hash, cr_version
       FROM intent_cr_versions
       WHERE session_id = $1 AND cr_hash = $2`,
      [sessionId, hash]
    );
    
    if (existingVersion.rows.length > 0) {
      // Hash exists - return existing version (idempotent)
      await client.query('COMMIT');
      const row = existingVersion.rows[0];
      return {
        success: true,
        isNew: false,
        data: {
          id: row.id,
          session_id: row.session_id,
          created_at: row.created_at.toISOString(),
          cr_json: row.cr_json,
          cr_hash: row.cr_hash,
          cr_version: row.cr_version,
        },
      };
    }
    
    // Get next version number (max + 1)
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(cr_version), 0) + 1 AS next_version
       FROM intent_cr_versions
       WHERE session_id = $1`,
      [sessionId]
    );
    
    const nextVersion = versionResult.rows[0].next_version;
    
    // Insert new version
    const insertResult = await client.query(
      `INSERT INTO intent_cr_versions (session_id, cr_json, cr_hash, cr_version)
       VALUES ($1, $2, $3, $4)
       RETURNING id, session_id, created_at, cr_json, cr_hash, cr_version`,
      [sessionId, JSON.stringify(crJson), hash, nextVersion]
    );
    
    const newVersion = insertResult.rows[0];
    
    // Update latest pointer
    await client.query(
      `INSERT INTO intent_cr_latest (session_id, latest_cr_version_id)
       VALUES ($1, $2)
       ON CONFLICT (session_id)
       DO UPDATE SET
         latest_cr_version_id = EXCLUDED.latest_cr_version_id,
         updated_at = NOW()`,
      [sessionId, newVersion.id]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      isNew: true,
      data: {
        id: newVersion.id,
        session_id: newVersion.session_id,
        created_at: newVersion.created_at.toISOString(),
        cr_json: newVersion.cr_json,
        cr_hash: newVersion.cr_hash,
        cr_version: newVersion.cr_version,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error committing CR version:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    client.release();
  }
}

/**
 * List CR versions for a session (newest first)
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param userId User ID (for ownership check)
 * @param options Pagination options
 * @returns List of version metadata (without full CR JSON)
 */
export async function listCrVersions(
  pool: Pool,
  sessionId: string,
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: Omit<IntentCrVersion, 'cr_json'>[] } | { success: false; error: string }> {
  try {
    // Verify session ownership
    const sessionCheck = await pool.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    const result = await pool.query(
      `SELECT id, session_id, created_at, cr_hash, cr_version
       FROM intent_cr_versions
       WHERE session_id = $1
       ORDER BY created_at DESC, cr_version DESC
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        cr_hash: row.cr_hash,
        cr_version: row.cr_version,
      })),
    };
  } catch (error) {
    console.error('[DB] Error listing CR versions:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get a specific CR version by ID
 * 
 * @param pool Database pool
 * @param versionId Version ID
 * @returns Full version data including CR JSON
 */
export async function getCrVersion(
  pool: Pool,
  versionId: string
): Promise<{ success: true; data: IntentCrVersion } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `SELECT id, session_id, created_at, cr_json, cr_hash, cr_version
       FROM intent_cr_versions
       WHERE id = $1`,
      [versionId]
    );
    
    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Version not found',
      };
    }
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        cr_json: row.cr_json,
        cr_hash: row.cr_hash,
        cr_version: row.cr_version,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting CR version:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get the latest CR version for a session
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param userId User ID (for ownership check)
 * @returns Latest version data, or null if no versions exist
 */
export async function getLatestCrVersion(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentCrVersion | null } | { success: false; error: string }> {
  try {
    // Verify session ownership
    const sessionCheck = await pool.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    // Get latest pointer
    const latestResult = await pool.query(
      `SELECT v.id, v.session_id, v.created_at, v.cr_json, v.cr_hash, v.cr_version
       FROM intent_cr_latest l
       JOIN intent_cr_versions v ON v.id = l.latest_cr_version_id
       WHERE l.session_id = $1`,
      [sessionId]
    );
    
    if (latestResult.rows.length === 0) {
      return {
        success: true,
        data: null,
      };
    }
    
    const row = latestResult.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        cr_json: row.cr_json,
        cr_hash: row.cr_hash,
        cr_version: row.cr_version,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting latest CR version:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
