/**
 * Database Access Layer: Issue Evidence
 * 
 * Provides functions for managing issue evidence records.
 * Records evidence for AFU-9 Issue lifecycle actions (publish receipts, audit trail).
 */

import { Pool } from 'pg';
import {
  IssueEvidenceRow,
  IssueEvidenceInput,
  IssueEvidenceType,
  validateEvidenceInput,
} from '../contracts/issueEvidence';

/**
 * Operation result type
 */
export interface OperationResult<T = IssueEvidenceRow> {
  success: boolean;
  data?: T;
  error?: string;
  rowCount?: number;
}

/**
 * Record evidence for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Evidence data
 * @returns Operation result with created evidence record or error
 */
export async function recordEvidence(
  pool: Pool,
  input: IssueEvidenceInput
): Promise<OperationResult> {
  // Validate input
  const validation = validateEvidenceInput(input);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error || 'Invalid input',
    };
  }

  try {
    const result = await pool.query<IssueEvidenceRow>(
      `INSERT INTO issue_evidence (
        issue_id,
        evidence_type,
        evidence_data,
        request_id
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [
        input.issue_id,
        input.evidence_type,
        JSON.stringify(input.evidence_data),
        input.request_id || null,
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
      },
    };
  } catch (error) {
    console.error('[IssueEvidence] Record evidence failed:', {
      error: error instanceof Error ? error.message : String(error),
      issue_id: input.issue_id,
      evidence_type: input.evidence_type,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get evidence records for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param limit - Maximum number of records to retrieve (default: 100)
 * @returns Operation result with evidence records or error
 */
export async function getIssueEvidence(
  pool: Pool,
  issueId: string,
  limit: number = 100
): Promise<OperationResult<IssueEvidenceRow[]>> {
  try {
    const result = await pool.query<IssueEvidenceRow>(
      `SELECT
        id,
        issue_id,
        evidence_type,
        evidence_data,
        request_id,
        created_at
       FROM issue_evidence
       WHERE issue_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [issueId, limit]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[IssueEvidence] Get evidence failed:', {
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
 * Get evidence records by type
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param evidenceType - Evidence type to filter by
 * @param limit - Maximum number of records to retrieve (default: 50)
 * @returns Operation result with evidence records or error
 */
export async function getIssueEvidenceByType(
  pool: Pool,
  issueId: string,
  evidenceType: IssueEvidenceType,
  limit: number = 50
): Promise<OperationResult<IssueEvidenceRow[]>> {
  try {
    const result = await pool.query<IssueEvidenceRow>(
      `SELECT
        id,
        issue_id,
        evidence_type,
        evidence_data,
        request_id,
        created_at
       FROM issue_evidence
       WHERE issue_id = $1 AND evidence_type = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [issueId, evidenceType, limit]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[IssueEvidence] Get evidence by type failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      evidenceType,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get evidence by request ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param requestId - Request ID to filter by
 * @returns Operation result with evidence records or error
 */
export async function getEvidenceByRequestId(
  pool: Pool,
  requestId: string
): Promise<OperationResult<IssueEvidenceRow[]>> {
  try {
    const result = await pool.query<IssueEvidenceRow>(
      `SELECT
        id,
        issue_id,
        evidence_type,
        evidence_data,
        request_id,
        created_at
       FROM issue_evidence
       WHERE request_id = $1
       ORDER BY created_at DESC`,
      [requestId]
    );

    return {
      success: true,
      data: result.rows.map(row => ({
        ...row,
        created_at: row.created_at.toString(),
      })),
    };
  } catch (error) {
    console.error('[IssueEvidence] Get evidence by request ID failed:', {
      error: error instanceof Error ? error.message : String(error),
      requestId,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get the most recent evidence of a specific type for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue UUID
 * @param evidenceType - Evidence type to retrieve
 * @returns Operation result with evidence record or null if none found
 */
export async function getLatestEvidence(
  pool: Pool,
  issueId: string,
  evidenceType: IssueEvidenceType
): Promise<OperationResult<IssueEvidenceRow | null>> {
  try {
    const result = await pool.query<IssueEvidenceRow>(
      `SELECT
        id,
        issue_id,
        evidence_type,
        evidence_data,
        request_id,
        created_at
       FROM issue_evidence
       WHERE issue_id = $1 AND evidence_type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [issueId, evidenceType]
    );

    return {
      success: true,
      data: result.rows.length > 0 
        ? { ...result.rows[0], created_at: result.rows[0].created_at.toString() }
        : null,
    };
  } catch (error) {
    console.error('[IssueEvidence] Get latest evidence failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      evidenceType,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
