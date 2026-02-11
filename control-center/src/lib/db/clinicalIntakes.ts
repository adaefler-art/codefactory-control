/**
 * Clinical Intakes Database Layer
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 * 
 * CRUD operations for clinical intake records.
 * 
 * NON-NEGOTIABLES:
 * - Pool injection for testability
 * - Sanitized inputs (prevent injection/DoS)
 * - Prepared statements with parameter arrays
 * - Return {success, data|error} format
 */

import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import {
  ClinicalIntake,
  ClinicalIntakeRow,
  ClinicalIntakeInput,
  StructuredIntake,
} from '../schemas/clinicalIntake';

/**
 * Sanitize string inputs to prevent DoS via oversized inputs
 */
function sanitizeString(value: string | null | undefined, maxLength: number = 10000): string | null {
  if (!value) return null;
  return value.substring(0, maxLength);
}

/**
 * Convert database row to ClinicalIntake object
 */
function rowToIntake(row: ClinicalIntakeRow): ClinicalIntake {
  return {
    id: row.id,
    session_id: row.session_id,
    patient_identifier: row.patient_identifier || undefined,
    structured_intake: row.structured_intake as StructuredIntake,
    clinical_summary: row.clinical_summary,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    created_by: row.created_by || undefined,
    version: row.version,
    previous_version_id: row.previous_version_id || undefined,
  };
}

/**
 * Create a new clinical intake record
 */
export async function createClinicalIntake(
  pool: Pool,
  input: ClinicalIntakeInput,
  userId?: string
): Promise<{ success: true; data: ClinicalIntake } | { success: false; error: string }> {
  try {
    const id = randomUUID();
    const now = new Date();
    
    const sanitizedSummary = sanitizeString(input.clinical_summary, 5000);
    if (!sanitizedSummary) {
      return { success: false, error: 'Clinical summary is required' };
    }
    
    const query = `
      INSERT INTO clinical_intakes (
        id,
        session_id,
        patient_identifier,
        structured_intake,
        clinical_summary,
        created_at,
        updated_at,
        created_by,
        version,
        previous_version_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const values = [
      id,
      input.session_id,
      sanitizeString(input.patient_identifier, 100),
      JSON.stringify(input.structured_intake),
      sanitizedSummary,
      now,
      now,
      sanitizeString(userId, 100),
      input.version || 1,
      input.previous_version_id || null,
    ];
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Failed to create clinical intake' };
    }
    
    return { success: true, data: rowToIntake(result.rows[0]) };
  } catch (error) {
    console.error('Error creating clinical intake:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get clinical intake by ID
 */
export async function getClinicalIntakeById(
  pool: Pool,
  id: string
): Promise<{ success: true; data: ClinicalIntake } | { success: false; error: string }> {
  try {
    const query = 'SELECT * FROM clinical_intakes WHERE id = $1';
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Clinical intake not found' };
    }
    
    return { success: true, data: rowToIntake(result.rows[0]) };
  } catch (error) {
    console.error('Error fetching clinical intake:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get all clinical intakes for a session
 */
export async function getClinicalIntakesBySession(
  pool: Pool,
  sessionId: string
): Promise<{ success: true; data: ClinicalIntake[] } | { success: false; error: string }> {
  try {
    const query = `
      SELECT * FROM clinical_intakes 
      WHERE session_id = $1 
      ORDER BY version DESC, created_at DESC
    `;
    const result = await pool.query(query, [sessionId]);
    
    const intakes = result.rows.map(rowToIntake);
    return { success: true, data: intakes };
  } catch (error) {
    console.error('Error fetching clinical intakes by session:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Update clinical intake (creates new version)
 */
export async function updateClinicalIntake(
  pool: Pool,
  id: string,
  updates: Partial<ClinicalIntakeInput>,
  userId?: string
): Promise<{ success: true; data: ClinicalIntake } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get current version
    const currentResult = await client.query(
      'SELECT * FROM clinical_intakes WHERE id = $1',
      [id]
    );
    
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Clinical intake not found' };
    }
    
    const current = rowToIntake(currentResult.rows[0]);
    
    // Mark current version as superseded
    await client.query(
      'UPDATE clinical_intakes SET structured_intake = jsonb_set(structured_intake, \'{status}\', \'"superseded"\') WHERE id = $1',
      [id]
    );
    
    // Create new version
    const newId = randomUUID();
    const now = new Date();
    const newVersion = current.version + 1;
    
    const query = `
      INSERT INTO clinical_intakes (
        id,
        session_id,
        patient_identifier,
        structured_intake,
        clinical_summary,
        created_at,
        updated_at,
        created_by,
        version,
        previous_version_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const mergedStructuredIntake = {
      ...current.structured_intake,
      ...updates.structured_intake,
      status: updates.structured_intake?.status || current.structured_intake.status,
    };
    
    const values = [
      newId,
      updates.session_id || current.session_id,
      sanitizeString(updates.patient_identifier, 100) || current.patient_identifier,
      JSON.stringify(mergedStructuredIntake),
      sanitizeString(updates.clinical_summary, 5000) || current.clinical_summary,
      now,
      now,
      sanitizeString(userId, 100) || current.created_by,
      newVersion,
      id, // Previous version
    ];
    
    const result = await client.query(query, values);
    
    await client.query('COMMIT');
    
    return { success: true, data: rowToIntake(result.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating clinical intake:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  } finally {
    client.release();
  }
}

/**
 * Delete clinical intake (soft delete by archiving)
 */
export async function archiveClinicalIntake(
  pool: Pool,
  id: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const query = `
      UPDATE clinical_intakes 
      SET structured_intake = jsonb_set(structured_intake, '{status}', '"archived"'),
          updated_at = $2
      WHERE id = $1
      RETURNING id
    `;
    
    const result = await pool.query(query, [id, new Date()]);
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Clinical intake not found' };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error archiving clinical intake:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get intake version history
 */
export async function getClinicalIntakeVersionHistory(
  pool: Pool,
  sessionId: string
): Promise<{ success: true; data: ClinicalIntake[] } | { success: false; error: string }> {
  try {
    const query = `
      SELECT * FROM clinical_intakes 
      WHERE session_id = $1
      ORDER BY version ASC, created_at ASC
    `;
    
    const result = await pool.query(query, [sessionId]);
    const intakes = result.rows.map(rowToIntake);
    
    return { success: true, data: intakes };
  } catch (error) {
    console.error('Error fetching version history:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get latest active intake for a session
 */
export async function getLatestActiveIntake(
  pool: Pool,
  sessionId: string
): Promise<{ success: true; data: ClinicalIntake | null } | { success: false; error: string }> {
  try {
    const query = `
      SELECT * FROM clinical_intakes 
      WHERE session_id = $1 
        AND structured_intake->>'status' IN ('draft', 'active')
      ORDER BY version DESC, created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [sessionId]);
    
    if (result.rows.length === 0) {
      return { success: true, data: null };
    }
    
    return { success: true, data: rowToIntake(result.rows[0]) };
  } catch (error) {
    console.error('Error fetching latest active intake:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
