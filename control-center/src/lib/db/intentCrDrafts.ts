/**
 * Database Access Layer: INTENT CR Drafts
 * 
 * Provides functions for managing CR (Change Request) drafts per INTENT session.
 * Issue E74.3: CR Preview/Edit UI + Validation Gate
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';
import { validateChangeRequest, type ValidationResult } from '../validators/changeRequestValidator';
import { canonicalizeChangeRequestToJSON, type ChangeRequest } from '../schemas/changeRequest';

export interface IntentCrDraft {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  cr_json: unknown;
  cr_hash: string;
  status: 'draft' | 'valid' | 'invalid';
}

/**
 * Get the current CR draft for a session
 * Only returns draft if session belongs to the specified user
 */
export async function getCrDraft(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentCrDraft | null } | { success: false; error: string }> {
  try {
    // First verify session ownership
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
    
    // Get the draft
    const result = await pool.query(
      `SELECT id, session_id, created_at, updated_at, cr_json, cr_hash, status
       FROM intent_cr_drafts
       WHERE session_id = $1`,
      [sessionId]
    );
    
    if (result.rows.length === 0) {
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
        updated_at: row.updated_at.toISOString(),
        cr_json: row.cr_json,
        cr_hash: row.cr_hash,
        status: row.status,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting CR draft:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Save a CR draft for a session (upsert)
 * Computes hash from canonical JSON
 * Does NOT validate - use validateAndSaveCrDraft for validation
 */
export async function saveCrDraft(
  pool: Pool,
  sessionId: string,
  userId: string,
  crJson: unknown
): Promise<{ success: true; data: IntentCrDraft } | { success: false; error: string }> {
  try {
    // First verify session ownership
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
    
    // Try to parse and canonicalize for hash computation
    // If it's valid CR, compute canonical hash; otherwise use raw hash
    let hash: string;
    try {
      const parsed = crJson as ChangeRequest;
      const canonical = canonicalizeChangeRequestToJSON(parsed);
      hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    } catch {
      // If can't canonicalize, use hash of JSON.stringify (best effort)
      const raw = JSON.stringify(crJson);
      hash = createHash('sha256').update(raw, 'utf8').digest('hex');
    }
    
    // Upsert the draft (status remains as-is or defaults to 'draft')
    const result = await pool.query(
      `INSERT INTO intent_cr_drafts (session_id, cr_json, cr_hash, status)
       VALUES ($1, $2, $3, 'draft')
       ON CONFLICT (session_id)
       DO UPDATE SET
         cr_json = EXCLUDED.cr_json,
         cr_hash = EXCLUDED.cr_hash,
         updated_at = NOW()
       RETURNING id, session_id, created_at, updated_at, cr_json, cr_hash, status`,
      [sessionId, JSON.stringify(crJson), hash]
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        cr_json: row.cr_json,
        cr_hash: row.cr_hash,
        status: row.status,
      },
    };
  } catch (error) {
    console.error('[DB] Error saving CR draft:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Validate and save a CR draft
 * Runs validation, updates status based on result, and stores hash
 * Returns both the saved draft and validation result
 */
export async function validateAndSaveCrDraft(
  pool: Pool,
  sessionId: string,
  userId: string,
  crJson: unknown
): Promise<
  | { success: true; data: IntentCrDraft; validation: ValidationResult }
  | { success: false; error: string; validation?: ValidationResult }
> {
  try {
    // First verify session ownership
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
    
    // Run validation
    const validation = validateChangeRequest(crJson);
    
    // Determine status from validation
    const status = validation.ok ? 'valid' : 'invalid';
    
    // Use hash from validation metadata if available
    const hash = validation.meta.hash || createHash('sha256').update(JSON.stringify(crJson), 'utf8').digest('hex');
    
    // Upsert the draft with validation status
    const result = await pool.query(
      `INSERT INTO intent_cr_drafts (session_id, cr_json, cr_hash, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id)
       DO UPDATE SET
         cr_json = EXCLUDED.cr_json,
         cr_hash = EXCLUDED.cr_hash,
         status = EXCLUDED.status,
         updated_at = NOW()
       RETURNING id, session_id, created_at, updated_at, cr_json, cr_hash, status`,
      [sessionId, JSON.stringify(crJson), hash, status]
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        cr_json: row.cr_json,
        cr_hash: row.cr_hash,
        status: row.status,
      },
      validation,
    };
  } catch (error) {
    console.error('[DB] Error validating and saving CR draft:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
