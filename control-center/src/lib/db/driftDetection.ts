/**
 * Drift Detection Database Layer
 * E85.4: Drift Detection + Repair Suggestions
 * 
 * Handles database operations for drift detection and resolution tracking.
 * All decisions are audited for compliance.
 */

import { Pool } from 'pg';
import {
  DriftDetectionResult,
  DriftDetectionRow,
  DriftResolution,
  DriftResolutionInput,
  DriftType,
  DriftSeverity,
} from './contracts/drift';

/**
 * Operation result type
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Save drift detection result to database
 * 
 * @param pool - PostgreSQL connection pool
 * @param detection - Drift detection result
 * @returns Operation result with detection ID
 */
export async function saveDriftDetection(
  pool: Pool,
  detection: DriftDetectionResult
): Promise<OperationResult<string>> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO drift_detections (
        id,
        issue_id,
        drift_detected,
        drift_types,
        severity,
        evidence,
        suggestions,
        detected_at,
        github_owner,
        github_repo,
        github_issue_number,
        dry_run
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        detection.id,
        detection.issue_id,
        detection.drift_detected,
        detection.drift_types,
        detection.severity,
        JSON.stringify(detection.evidence),
        JSON.stringify(detection.suggestions),
        detection.detected_at,
        detection.github_owner,
        detection.github_repo,
        detection.github_issue_number,
        detection.dry_run,
      ]
    );

    return {
      success: true,
      data: result.rows[0].id,
    };
  } catch (error) {
    console.error('[saveDriftDetection] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get drift detection by ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param detectionId - Detection ID
 * @returns Drift detection row
 */
export async function getDriftDetectionById(
  pool: Pool,
  detectionId: string
): Promise<OperationResult<DriftDetectionRow>> {
  try {
    const result = await pool.query<DriftDetectionRow>(
      `SELECT * FROM drift_detections WHERE id = $1`,
      [detectionId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Drift detection not found',
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[getDriftDetectionById] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List drift detections for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue ID
 * @param options - Query options
 * @returns List of drift detections
 */
export async function listDriftDetectionsForIssue(
  pool: Pool,
  issueId: string,
  options: {
    limit?: number;
    offset?: number;
    drift_detected_only?: boolean;
  } = {}
): Promise<OperationResult<{ detections: DriftDetectionRow[]; total: number }>> {
  try {
    const { limit = 50, offset = 0, drift_detected_only = false } = options;

    const conditions = ['issue_id = $1'];
    const params: any[] = [issueId];

    if (drift_detected_only) {
      conditions.push('drift_detected = true');
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM drift_detections WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get paginated results
    params.push(limit, offset);

    const result = await pool.query<DriftDetectionRow>(
      `SELECT * FROM drift_detections
       WHERE ${whereClause}
       ORDER BY detected_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      success: true,
      data: {
        detections: result.rows,
        total,
      },
    };
  } catch (error) {
    console.error('[listDriftDetectionsForIssue] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List all drift detections with filters
 * 
 * @param pool - PostgreSQL connection pool
 * @param options - Query options
 * @returns List of drift detections
 */
export async function listDriftDetections(
  pool: Pool,
  options: {
    severity?: DriftSeverity;
    drift_types?: DriftType[];
    drift_detected_only?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<OperationResult<{ detections: DriftDetectionRow[]; total: number }>> {
  try {
    const {
      severity,
      drift_types,
      drift_detected_only = true,
      limit = 50,
      offset = 0,
    } = options;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (drift_detected_only) {
      conditions.push('drift_detected = true');
    }

    if (severity) {
      conditions.push(`severity = $${paramIndex++}`);
      params.push(severity);
    }

    if (drift_types && drift_types.length > 0) {
      conditions.push(`drift_types && $${paramIndex++}`);
      params.push(drift_types);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM drift_detections ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get paginated results
    params.push(limit, offset);

    const result = await pool.query<DriftDetectionRow>(
      `SELECT * FROM drift_detections
       ${whereClause}
       ORDER BY detected_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );

    return {
      success: true,
      data: {
        detections: result.rows,
        total,
      },
    };
  } catch (error) {
    console.error('[listDriftDetections] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Record drift resolution (when user applies a suggestion)
 * 
 * ✅ All decisions are audited
 * ✅ Explicit user confirmation required
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Resolution input
 * @param result - Application result
 * @returns Operation result with resolution ID
 */
export async function recordDriftResolution(
  pool: Pool,
  input: DriftResolutionInput,
  result: {
    success: boolean;
    message: string | null;
    actions_applied: any[];
    audit_trail: Record<string, unknown>;
  }
): Promise<OperationResult<string>> {
  try {
    // Validate confirmation
    if (!input.confirmation) {
      return {
        success: false,
        error: 'Explicit user confirmation required to apply drift repair',
      };
    }

    const resolutionResult = await pool.query<{ id: string }>(
      `INSERT INTO drift_resolutions (
        drift_detection_id,
        suggestion_id,
        applied_by,
        applied_at,
        actions_applied,
        result_success,
        result_message,
        audit_trail
      ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
      RETURNING id`,
      [
        input.drift_detection_id,
        input.suggestion_id,
        input.applied_by,
        JSON.stringify(result.actions_applied),
        result.success,
        result.message,
        JSON.stringify(result.audit_trail),
      ]
    );

    return {
      success: true,
      data: resolutionResult.rows[0].id,
    };
  } catch (error) {
    console.error('[recordDriftResolution] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get drift resolution by ID
 * 
 * @param pool - PostgreSQL connection pool
 * @param resolutionId - Resolution ID
 * @returns Drift resolution
 */
export async function getDriftResolutionById(
  pool: Pool,
  resolutionId: string
): Promise<OperationResult<DriftResolution>> {
  try {
    const result = await pool.query<DriftResolution>(
      `SELECT * FROM drift_resolutions WHERE id = $1`,
      [resolutionId]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Drift resolution not found',
      };
    }

    return {
      success: true,
      data: result.rows[0],
    };
  } catch (error) {
    console.error('[getDriftResolutionById] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List drift resolutions for a detection
 * 
 * @param pool - PostgreSQL connection pool
 * @param detectionId - Detection ID
 * @returns List of resolutions
 */
export async function listDriftResolutionsForDetection(
  pool: Pool,
  detectionId: string
): Promise<OperationResult<DriftResolution[]>> {
  try {
    const result = await pool.query<DriftResolution>(
      `SELECT * FROM drift_resolutions
       WHERE drift_detection_id = $1
       ORDER BY applied_at DESC`,
      [detectionId]
    );

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    console.error('[listDriftResolutionsForDetection] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get drift detection audit trail
 * Provides full history of drift detections and resolutions for an issue
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - Issue ID
 * @returns Audit trail
 */
export async function getDriftAuditTrail(
  pool: Pool,
  issueId: string
): Promise<OperationResult<{
  detections: DriftDetectionRow[];
  resolutions: DriftResolution[];
}>> {
  try {
    // Get all detections for issue
    const detectionsResult = await pool.query<DriftDetectionRow>(
      `SELECT * FROM drift_detections
       WHERE issue_id = $1
       ORDER BY detected_at DESC`,
      [issueId]
    );

    // Get all resolutions for these detections
    const resolutionsResult = await pool.query<DriftResolution>(
      `SELECT r.* FROM drift_resolutions r
       INNER JOIN drift_detections d ON r.drift_detection_id = d.id
       WHERE d.issue_id = $1
       ORDER BY r.applied_at DESC`,
      [issueId]
    );

    return {
      success: true,
      data: {
        detections: detectionsResult.rows,
        resolutions: resolutionsResult.rows,
      },
    };
  } catch (error) {
    console.error('[getDriftAuditTrail] Database error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
