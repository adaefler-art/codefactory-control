/**
 * Database Access Layer: INTENT Issue Drafts
 * 
 * Provides functions for managing issue drafts per INTENT session.
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 */

import { Pool } from 'pg';
import { validateIssueDraft, type ValidationResult } from '../validators/issueDraftValidator';
import { canonicalizeIssueDraftToJSON } from '../validators/issueDraftValidator';
import type { IssueDraft } from '../schemas/issueDraft';

export interface IntentIssueDraft {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  issue_json: unknown;
  issue_hash: string;
  last_validation_status: 'unknown' | 'valid' | 'invalid';
  last_validation_at: string | null;
  last_validation_result: ValidationResult | null;
}

/**
 * Get the current issue draft for a session
 * Only returns draft if session belongs to the specified user
 */
export async function getIssueDraft(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentIssueDraft | null } | { success: false; error: string }> {
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
      `SELECT id, session_id, created_at, updated_at, issue_json, issue_hash,
              last_validation_status, last_validation_at, last_validation_result
       FROM intent_issue_drafts
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
        issue_json: row.issue_json,
        issue_hash: row.issue_hash,
        last_validation_status: row.last_validation_status,
        last_validation_at: row.last_validation_at?.toISOString() || null,
        last_validation_result: row.last_validation_result || null,
      },
    };
  } catch (error) {
    console.error('[DB] Error getting issue draft:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}

/**
 * Save an issue draft for a session (upsert)
 * Accepts draft even if invalid, but stores validation status
 * Does NOT run validation - validation status remains unchanged unless provided
 */
export async function saveIssueDraft(
  pool: Pool,
  sessionId: string,
  userId: string,
  issueJson: unknown,
  validationResult?: ValidationResult
): Promise<{ success: true; data: IntentIssueDraft } | { success: false; error: string }> {
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
    
    // Compute hash (best effort)
    let hash: string;
    try {
      const parsed = issueJson as IssueDraft;
      const canonical = canonicalizeIssueDraftToJSON(parsed);
      const crypto = await import('crypto');
      hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    } catch {
      // If can't canonicalize, use hash of JSON.stringify (best effort)
      const raw = JSON.stringify(issueJson);
      const crypto = await import('crypto');
      hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
    }
    
    // Determine validation fields
    let validationStatus: 'unknown' | 'valid' | 'invalid' = 'unknown';
    let validationAt: Date | null = null;
    let validationResultJson: string | null = null;
    
    if (validationResult) {
      validationStatus = validationResult.isValid ? 'valid' : 'invalid';
      validationAt = new Date();
      validationResultJson = JSON.stringify(validationResult);
    }
    
    // Upsert the draft
    const result = await pool.query(
      `INSERT INTO intent_issue_drafts (
        session_id, issue_json, issue_hash,
        last_validation_status, last_validation_at, last_validation_result
      )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id)
       DO UPDATE SET
         issue_json = EXCLUDED.issue_json,
         issue_hash = EXCLUDED.issue_hash,
         last_validation_status = COALESCE(EXCLUDED.last_validation_status, intent_issue_drafts.last_validation_status),
         last_validation_at = COALESCE(EXCLUDED.last_validation_at, intent_issue_drafts.last_validation_at),
         last_validation_result = COALESCE(EXCLUDED.last_validation_result, intent_issue_drafts.last_validation_result),
         updated_at = NOW()
       RETURNING id, session_id, created_at, updated_at, issue_json, issue_hash,
                 last_validation_status, last_validation_at, last_validation_result`,
      [sessionId, JSON.stringify(issueJson), hash, validationStatus, validationAt, validationResultJson]
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        issue_json: row.issue_json,
        issue_hash: row.issue_hash,
        last_validation_status: row.last_validation_status,
        last_validation_at: row.last_validation_at?.toISOString() || null,
        last_validation_result: row.last_validation_result || null,
      },
    };
  } catch (error) {
    console.error('[DB] Error saving issue draft:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}

/**
 * Validate and save an issue draft
 * Runs validation, updates status based on result, and stores hash
 * Returns both the saved draft and validation result
 */
export async function validateAndSaveIssueDraft(
  pool: Pool,
  sessionId: string,
  userId: string,
  issueJson: unknown
): Promise<
  | { success: true; data: IntentIssueDraft; validation: ValidationResult }
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
    const validation = validateIssueDraft(issueJson);
    
    // Save with validation result
    const saveResult = await saveIssueDraft(pool, sessionId, userId, issueJson, validation);
    
    if (!saveResult.success) {
      return {
        success: false,
        error: saveResult.error,
        validation,
      };
    }
    
    return {
      success: true,
      data: saveResult.data,
      validation,
    };
  } catch (error) {
    console.error('[DB] Error validating and saving issue draft:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}
