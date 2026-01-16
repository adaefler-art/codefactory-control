/**
 * Database Access Layer: INTENT Work Plans
 * 
 * V09-I04: WorkPlanV1: Freies Plan-Artefakt (ohne Draft)
 * 
 * Provides functions for managing free-form work plans per INTENT session.
 * Work plans are an intermediate planning artifact between casual conversation
 * and formal draft creation.
 */

import { Pool } from 'pg';
import type { WorkPlanContentV1 } from '../schemas/workPlan';
import { hashWorkPlanContent } from '../schemas/workPlan';

export interface IntentWorkPlan {
  session_id: string;
  schema_version: string;
  content_json: WorkPlanContentV1;
  content_hash: string;
  updated_at: string;
}

/**
 * Get work plan for a session
 * 
 * @param pool - Database connection pool
 * @param sessionId - Session ID
 * @param userId - User ID (for ownership verification)
 * @returns Work plan or null if not found
 */
export async function getWorkPlan(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentWorkPlan | null } | { success: false; error: string }> {
  try {
    // Verify session ownership first
    const sessionCheck = await pool.query(
      'SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    // Get work plan
    const result = await pool.query(
      `SELECT session_id, schema_version, content_json, content_hash, updated_at
       FROM intent_work_plans
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
        session_id: row.session_id,
        schema_version: row.schema_version,
        content_json: row.content_json,
        content_hash: row.content_hash,
        updated_at: row.updated_at.toISOString(),
      },
    };
  } catch (error) {
    console.error('[DB] Error getting work plan:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Save or update work plan for a session
 * 
 * Uses UPSERT pattern (INSERT ... ON CONFLICT UPDATE) for atomic operation.
 * Generates deterministic hash from content.
 * 
 * @param pool - Database connection pool
 * @param sessionId - Session ID
 * @param userId - User ID (for ownership verification)
 * @param content - Work plan content
 * @param schemaVersion - Schema version (default: 1.0.0)
 * @returns Updated work plan
 */
export async function saveWorkPlan(
  pool: Pool,
  sessionId: string,
  userId: string,
  content: WorkPlanContentV1,
  schemaVersion = '1.0.0'
): Promise<{ success: true; data: IntentWorkPlan } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verify session ownership
    const sessionCheck = await client.query(
      'SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    // Generate deterministic hash from normalized content
    const contentHash = hashWorkPlanContent(content);
    
    // UPSERT: Insert or update if already exists
    const result = await client.query(
      `INSERT INTO intent_work_plans (session_id, schema_version, content_json, content_hash, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (session_id)
       DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         content_json = EXCLUDED.content_json,
         content_hash = EXCLUDED.content_hash,
         updated_at = NOW()
       RETURNING session_id, schema_version, content_json, content_hash, updated_at`,
      [sessionId, schemaVersion, JSON.stringify(content), contentHash]
    );
    
    // Update session's updated_at timestamp
    await client.query(
      'UPDATE intent_sessions SET updated_at = NOW() WHERE id = $1',
      [sessionId]
    );
    
    await client.query('COMMIT');
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        session_id: row.session_id,
        schema_version: row.schema_version,
        content_json: row.content_json,
        content_hash: row.content_hash,
        updated_at: row.updated_at.toISOString(),
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error saving work plan:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    client.release();
  }
}

/**
 * Delete work plan for a session
 * 
 * @param pool - Database connection pool
 * @param sessionId - Session ID
 * @param userId - User ID (for ownership verification)
 * @returns Success status
 */
export async function deleteWorkPlan(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    // Verify session ownership
    const sessionCheck = await pool.query(
      'SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2',
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    // Delete work plan
    await pool.query(
      'DELETE FROM intent_work_plans WHERE session_id = $1',
      [sessionId]
    );
    
    return {
      success: true,
    };
  } catch (error) {
    console.error('[DB] Error deleting work plan:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
