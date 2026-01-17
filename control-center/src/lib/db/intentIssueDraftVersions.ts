/**
 * Database Access Layer: INTENT Issue Draft Versions
 * 
 * Provides functions for managing immutable issue draft versions per INTENT session.
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 */

import { Pool } from 'pg';
import { canonicalizeIssueDraftToJSON } from '../validators/issueDraftValidator';
import type { IssueDraft } from '../schemas/issueDraft';

export interface IntentIssueDraftVersion {
  id: string;
  session_id: string;
  created_at: string;
  created_by_sub: string;
  issue_json: unknown;
  issue_hash: string;
  version_number: number;
}

/**
 * Commit an issue draft as a new immutable version
 * 
 * - Computes hash from canonical JSON
 * - If hash already exists for this session, returns existing version (idempotency)
 * - Otherwise, creates new version with incremented version_number
 * - Requires last validation to be 'valid' (fail-closed)
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param userId User ID (for ownership check and created_by_sub)
 * @param issueJson Issue JSON to commit
 * @returns Success with version data, or error
 */
export async function commitIssueDraftVersion(
  pool: Pool,
  sessionId: string,
  userId: string,
  issueJson: unknown
): Promise<{ success: true; data: IntentIssueDraftVersion; isNew: boolean } | { success: false; error: string }> {
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
    
    // Check that last validation is 'valid' (fail-closed)
    const draftCheck = await client.query(
      `SELECT last_validation_status FROM intent_issue_drafts WHERE session_id = $1`,
      [sessionId]
    );
    
    if (draftCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'No draft exists for this session',
      };
    }
    
    if (draftCheck.rows[0].last_validation_status !== 'valid') {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Cannot commit: last validation status is not valid',
      };
    }
    
    // Compute canonical hash
    let hash: string;
    try {
      const parsed = issueJson as IssueDraft;
      const canonical = canonicalizeIssueDraftToJSON(parsed);
      const crypto = await import('crypto');
      hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    } catch {
      // If can't canonicalize, use hash of JSON.stringify
      const raw = JSON.stringify(issueJson);
      const crypto = await import('crypto');
      hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    }
    
    // Check if this hash already exists for this session (idempotency)
    const existingVersion = await client.query(
      `SELECT id, session_id, created_at, created_by_sub, issue_json, issue_hash, version_number
       FROM intent_issue_draft_versions
       WHERE session_id = $1 AND issue_hash = $2`,
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
          created_by_sub: row.created_by_sub,
          issue_json: row.issue_json,
          issue_hash: row.issue_hash,
          version_number: row.version_number,
        },
      };
    }
    
    // Get next version number (max + 1)
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
       FROM intent_issue_draft_versions
       WHERE session_id = $1`,
      [sessionId]
    );
    
    const nextVersion = versionResult.rows[0].next_version;
    
    // Insert new version
    const insertResult = await client.query(
      `INSERT INTO intent_issue_draft_versions (session_id, created_by_sub, issue_json, issue_hash, version_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, session_id, created_at, created_by_sub, issue_json, issue_hash, version_number`,
      [sessionId, userId, JSON.stringify(issueJson), hash, nextVersion]
    );
    
    const newVersion = insertResult.rows[0];
    
    await client.query('COMMIT');
    
    return {
      success: true,
      isNew: true,
      data: {
        id: newVersion.id,
        session_id: newVersion.session_id,
        created_at: newVersion.created_at.toISOString(),
        created_by_sub: newVersion.created_by_sub,
        issue_json: newVersion.issue_json,
        issue_hash: newVersion.issue_hash,
        version_number: newVersion.version_number,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error committing issue draft version:', error);
    return {
      success: false,
      error: 'Database error',
    };
  } finally {
    client.release();
  }
}

/**
 * List issue draft versions for a session (newest first)
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param userId User ID (for ownership check)
 * @param options Pagination options
 * @returns List of version metadata (without full issue JSON)
 */
export async function listIssueDraftVersions(
  pool: Pool,
  sessionId: string,
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: Omit<IntentIssueDraftVersion, 'issue_json'>[] } | { success: false; error: string }> {
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
      `SELECT id, session_id, created_at, created_by_sub, issue_hash, version_number
       FROM intent_issue_draft_versions
       WHERE session_id = $1
       ORDER BY created_at DESC, version_number DESC
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        created_by_sub: row.created_by_sub,
        issue_hash: row.issue_hash,
        version_number: row.version_number,
      })),
    };
  } catch (error) {
    console.error('[DB] Error listing issue draft versions:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}

/**
 * Get a specific issue draft version by ID with ownership verification
 * 
 * @param pool Database pool
 * @param versionId Version ID
 * @param userId User ID (for ownership check)
 * @returns Full version data including issue JSON
 */
export async function getIssueDraftVersion(
  pool: Pool,
  versionId: string,
  userId?: string
): Promise<{ success: true; data: IntentIssueDraftVersion } | { success: false; error: string }> {
  try {
    let query: string;
    let params: any[];
    
    if (userId) {
      // Join with session to verify ownership
      query = `
        SELECT v.id, v.session_id, v.created_at, v.created_by_sub, v.issue_json, v.issue_hash, v.version_number
        FROM intent_issue_draft_versions v
        JOIN intent_sessions s ON s.id = v.session_id
        WHERE v.id = $1 AND s.user_id = $2
      `;
      params = [versionId, userId];
    } else {
      // No ownership check (for internal use)
      query = `
        SELECT id, session_id, created_at, created_by_sub, issue_json, issue_hash, version_number
        FROM intent_issue_draft_versions
        WHERE id = $1
      `;
      params = [versionId];
    }
    
    const result = await pool.query(query, params);
    
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
        created_by_sub: row.created_by_sub,
        issue_json: row.issue_json,
        issue_hash: row.issue_hash,
        version_number: row.version_number,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting issue draft version:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}

/**
 * Get the latest committed version for a session (P1.2, P1.3)
 * 
 * Returns the most recent committed version (highest version_number).
 * Used by publish flow to ensure commit-before-publish semantics.
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param userId User ID (for ownership check)
 * @returns Latest version data or null if no versions exist
 */
export async function getLatestCommittedVersion(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentIssueDraftVersion | null } | { success: false; error: string }> {
  try {
    // Verify session ownership first
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
    
    // Get latest committed version (highest version_number)
    const result = await pool.query(
      `SELECT id, session_id, created_at, created_by_sub, issue_json, issue_hash, version_number
       FROM intent_issue_draft_versions
       WHERE session_id = $1
       ORDER BY version_number DESC
       LIMIT 1`,
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      // No committed versions - this is a valid state, not an error
      return {
        success: true,
        data: null,
      };
    }
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        created_by_sub: row.created_by_sub,
        issue_json: row.issue_json,
        issue_hash: row.issue_hash,
        version_number: row.version_number,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting latest committed version:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}
