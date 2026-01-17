/**
 * Database Access Layer: Control Pack Assignments
 * 
 * Provides functions for managing control pack assignments for AFU-9 Issues.
 */

import { Pool } from 'pg';
import {
  ControlPackAssignmentRow,
  ControlPackAssignmentInput,
  ControlPackAssignmentStatus,
  DEFAULT_CONTROL_PACKS,
  DEFAULT_CONTROL_PACK_NAMES,
  validateCpAssignmentInput,
} from '../contracts/controlPackAssignment';

/**
 * Operation result type
 */
export interface OperationResult<T = ControlPackAssignmentRow> {
  success: boolean;
  data?: T;
  error?: string;
  rowCount?: number;
}

/**
 * Assign a control pack to an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - CP assignment data
 * @returns Operation result with created assignment or error
 */
export async function assignControlPack(
  pool: Pool,
  input: ControlPackAssignmentInput
): Promise<OperationResult> {
  // Validate input
  const validation = validateCpAssignmentInput(input);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid input',
    };
  }

  try {
    // Check if an active assignment already exists for this CP
    const existingResult = await pool.query(
      `SELECT id FROM control_pack_assignments
       WHERE issue_id = $1 AND control_pack_id = $2 AND status = 'active'`,
      [input.issue_id, input.control_pack_id]
    );

    if (existingResult.rows.length > 0) {
      return {
        success: false,
        error: `Active assignment already exists for control pack ${input.control_pack_id} on this issue`,
      };
    }

    const result = await pool.query<ControlPackAssignmentRow>(
      `INSERT INTO control_pack_assignments (
        issue_id,
        control_pack_id,
        control_pack_name,
        assigned_by,
        assignment_reason,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        input.issue_id,
        input.control_pack_id,
        input.control_pack_name,
        input.assigned_by || 'system',
        input.assignment_reason || null,
        input.status || ControlPackAssignmentStatus.ACTIVE,
      ]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'No row returned from insert',
      };
    }

    const row = result.rows[0];
    return {
      success: true,
      data: {
        ...row,
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      },
    };
  } catch (error) {
    console.error('[ControlPackAssignments] Assign CP failed:', {
      error: error instanceof Error ? error.message : String(error),
      issue_id: input.issue_id,
      control_pack_id: input.control_pack_id,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Assign default control pack to an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param assignedBy - Who is assigning the CP (default: 'system')
 * @returns Operation result with created assignment or error
 */
export async function assignDefaultControlPack(
  pool: Pool,
  issueId: string,
  assignedBy: string = 'system'
): Promise<OperationResult> {
  return assignControlPack(pool, {
    issue_id: issueId,
    control_pack_id: DEFAULT_CONTROL_PACKS.INTENT_ISSUE_AUTHORING,
    control_pack_name: DEFAULT_CONTROL_PACK_NAMES[DEFAULT_CONTROL_PACKS.INTENT_ISSUE_AUTHORING],
    assigned_by: assignedBy,
    assignment_reason: 'Default CP assignment on issue creation',
    status: ControlPackAssignmentStatus.ACTIVE,
  });
}

/**
 * Get active control pack assignments for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @returns Operation result with active assignments or error
 */
export async function getActiveControlPacks(
  pool: Pool,
  issueId: string
): Promise<OperationResult<ControlPackAssignmentRow[]>> {
  try {
    const result = await pool.query<ControlPackAssignmentRow>(
      `SELECT
        id,
        issue_id,
        control_pack_id,
        control_pack_name,
        assigned_by,
        assignment_reason,
        status,
        created_at,
        updated_at
       FROM control_pack_assignments
       WHERE issue_id = $1 AND status = 'active'
       ORDER BY created_at DESC`,
      [issueId]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[ControlPackAssignments] Get active CPs failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get all control pack assignments for an issue (including inactive)
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @returns Operation result with all assignments or error
 */
export async function getAllControlPacks(
  pool: Pool,
  issueId: string
): Promise<OperationResult<ControlPackAssignmentRow[]>> {
  try {
    const result = await pool.query<ControlPackAssignmentRow>(
      `SELECT
        id,
        issue_id,
        control_pack_id,
        control_pack_name,
        assigned_by,
        assignment_reason,
        status,
        created_at,
        updated_at
       FROM control_pack_assignments
       WHERE issue_id = $1
       ORDER BY created_at DESC`,
      [issueId]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[ControlPackAssignments] Get all CPs failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Revoke a control pack assignment
 * 
 * @param pool - PostgreSQL connection pool
 * @param assignmentId - Assignment UUID
 * @returns Operation result with updated assignment or error
 */
export async function revokeControlPackAssignment(
  pool: Pool,
  assignmentId: string
): Promise<OperationResult> {
  try {
    const result = await pool.query<ControlPackAssignmentRow>(
      `UPDATE control_pack_assignments
       SET status = 'revoked', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [assignmentId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Assignment not found: ${assignmentId}`,
      };
    }

    const row = result.rows[0];
    return {
      success: true,
      data: {
        ...row,
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      },
    };
  } catch (error) {
    console.error('[ControlPackAssignments] Revoke CP failed:', {
      error: error instanceof Error ? error.message : String(error),
      assignmentId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update control pack assignment status
 * 
 * @param pool - PostgreSQL connection pool
 * @param assignmentId - Assignment UUID
 * @param status - New status
 * @returns Operation result with updated assignment or error
 */
export async function updateControlPackStatus(
  pool: Pool,
  assignmentId: string,
  status: ControlPackAssignmentStatus
): Promise<OperationResult> {
  try {
    const result = await pool.query<ControlPackAssignmentRow>(
      `UPDATE control_pack_assignments
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, assignmentId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: `Assignment not found: ${assignmentId}`,
      };
    }

    const row = result.rows[0];
    return {
      success: true,
      data: {
        ...row,
        created_at: row.created_at.toString(),
        updated_at: row.updated_at.toString(),
      },
    };
  } catch (error) {
    console.error('[ControlPackAssignments] Update CP status failed:', {
      error: error instanceof Error ? error.message : String(error),
      assignmentId,
      status,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
