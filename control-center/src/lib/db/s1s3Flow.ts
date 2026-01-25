/**
 * S1-S3 Flow Database Access Layer
 * 
 * Provides persistence layer for S1-S3 GitHub issue flow:
 * - Issues: GitHub issue linkage and spec storage
 * - Runs: Execution tracking with request IDs
 * - Steps: Event logging with evidence refs
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { Pool } from 'pg';
import {
  S1S3IssueRow,
  S1S3IssueInput,
  S1S3IssueStatus,
  S1S3RunRow,
  S1S3RunInput,
  S1S3RunStatus,
  S1S3RunStepRow,
  S1S3RunStepInput,
  sanitizeS1S3IssueInput,
  normalizeAcceptanceCriteria,
  normalizeEvidenceRefs,
} from '../contracts/s1s3Flow';

/**
 * Operation result type
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  rowCount?: number;
}

// ========================================
// Issues
// ========================================

/**
 * Create or update S1-S3 issue (upsert by repo + issue number)
 */
export async function upsertS1S3Issue(
  pool: Pool,
  input: S1S3IssueInput
): Promise<OperationResult<S1S3IssueRow>> {
  const sanitized = sanitizeS1S3IssueInput(input);

  try {
    const result = await pool.query<S1S3IssueRow>(
      `INSERT INTO afu9_s1s3_issues (
        repo_full_name,
        github_issue_number,
        github_issue_url,
        owner,
        canonical_id,
        status,
        problem,
        scope,
        acceptance_criteria,
        notes,
        pr_number,
        pr_url,
        branch_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (repo_full_name, github_issue_number)
      DO UPDATE SET
        owner = EXCLUDED.owner,
        canonical_id = COALESCE(EXCLUDED.canonical_id, afu9_s1s3_issues.canonical_id),
        status = EXCLUDED.status,
        problem = COALESCE(EXCLUDED.problem, afu9_s1s3_issues.problem),
        scope = COALESCE(EXCLUDED.scope, afu9_s1s3_issues.scope),
        acceptance_criteria = COALESCE(EXCLUDED.acceptance_criteria, afu9_s1s3_issues.acceptance_criteria),
        notes = COALESCE(EXCLUDED.notes, afu9_s1s3_issues.notes),
        pr_number = COALESCE(EXCLUDED.pr_number, afu9_s1s3_issues.pr_number),
        pr_url = COALESCE(EXCLUDED.pr_url, afu9_s1s3_issues.pr_url),
        branch_name = COALESCE(EXCLUDED.branch_name, afu9_s1s3_issues.branch_name),
        updated_at = NOW()
      RETURNING *`,
      [
        sanitized.repo_full_name,
        sanitized.github_issue_number,
        sanitized.github_issue_url,
        sanitized.owner,
        sanitized.canonical_id || null,
        sanitized.status,
        sanitized.problem,
        sanitized.scope,
        JSON.stringify(sanitized.acceptance_criteria),
        sanitized.notes,
        sanitized.pr_number,
        sanitized.pr_url,
        sanitized.branch_name,
      ]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No row returned from upsert' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Upsert issue failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get S1-S3 issue by ID
 */
export async function getS1S3IssueById(
  pool: Pool,
  id: string
): Promise<OperationResult<S1S3IssueRow>> {
  try {
    const result = await pool.query<S1S3IssueRow>(
      'SELECT * FROM afu9_s1s3_issues WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Issue not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Get issue by ID failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get S1-S3 issue by GitHub issue
 */
export async function getS1S3IssueByGitHub(
  pool: Pool,
  repoFullName: string,
  issueNumber: number
): Promise<OperationResult<S1S3IssueRow>> {
  try {
    const result = await pool.query<S1S3IssueRow>(
      'SELECT * FROM afu9_s1s3_issues WHERE repo_full_name = $1 AND github_issue_number = $2',
      [repoFullName, issueNumber]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Issue not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Get issue by GitHub failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * List S1-S3 issues with filters
 */
export async function listS1S3Issues(
  pool: Pool,
  filters: {
    status?: S1S3IssueStatus;
    repo?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<OperationResult<S1S3IssueRow[]>> {
  try {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    if (filters.repo) {
      conditions.push(`repo_full_name = $${paramIndex++}`);
      params.push(filters.repo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const result = await pool.query<S1S3IssueRow>(
      `SELECT * FROM afu9_s1s3_issues ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return { success: true, data: result.rows };
  } catch (error) {
    console.error('[S1S3 DAO] List issues failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update S1-S3 issue status
 */
export async function updateS1S3IssueStatus(
  pool: Pool,
  id: string,
  status: S1S3IssueStatus,
  additionalFields?: {
    spec_ready_at?: Date;
    pr_created_at?: Date;
    pr_number?: number;
    pr_url?: string;
    branch_name?: string;
  }
): Promise<OperationResult<S1S3IssueRow>> {
  try {
    const updates: string[] = ['status = $2', 'updated_at = NOW()'];
    const params: any[] = [id, status];
    let paramIndex = 3;

    if (additionalFields?.spec_ready_at) {
      updates.push(`spec_ready_at = $${paramIndex++}`);
      params.push(additionalFields.spec_ready_at);
    }

    if (additionalFields?.pr_created_at) {
      updates.push(`pr_created_at = $${paramIndex++}`);
      params.push(additionalFields.pr_created_at);
    }

    if (additionalFields?.pr_number !== undefined) {
      updates.push(`pr_number = $${paramIndex++}`);
      params.push(additionalFields.pr_number);
    }

    if (additionalFields?.pr_url) {
      updates.push(`pr_url = $${paramIndex++}`);
      params.push(additionalFields.pr_url);
    }

    if (additionalFields?.branch_name) {
      updates.push(`branch_name = $${paramIndex++}`);
      params.push(additionalFields.branch_name);
    }

    const result = await pool.query<S1S3IssueRow>(
      `UPDATE afu9_s1s3_issues SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Issue not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Update issue status failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update S1-S3 issue spec fields
 */
export async function updateS1S3IssueSpec(
  pool: Pool,
  id: string,
  spec: {
    problem?: string | null;
    scope?: string | null;
    acceptance_criteria?: string[];
    notes?: string | null;
  }
): Promise<OperationResult<S1S3IssueRow>> {
  try {
    const result = await pool.query<S1S3IssueRow>(
      `UPDATE afu9_s1s3_issues
       SET problem = $1,
           scope = $2,
           acceptance_criteria = $3,
           notes = $4,
           status = $5,
           spec_ready_at = NOW(),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        spec.problem?.trim() || null,
        spec.scope?.trim() || null,
        JSON.stringify(spec.acceptance_criteria || []),
        spec.notes?.trim() || null,
        S1S3IssueStatus.SPEC_READY,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Issue not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Update issue spec failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update S1-S3 issue PR fields
 */
export async function updateS1S3IssuePR(
  pool: Pool,
  id: string,
  prData: {
    pr_number: number;
    pr_url: string;
    branch_name: string;
  }
): Promise<OperationResult<S1S3IssueRow>> {
  try {
    const result = await pool.query<S1S3IssueRow>(
      `UPDATE afu9_s1s3_issues
       SET pr_number = $1,
           pr_url = $2,
           branch_name = $3,
           status = $4,
           pr_created_at = NOW(),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [prData.pr_number, prData.pr_url, prData.branch_name, S1S3IssueStatus.PR_CREATED, id]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Issue not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Update issue PR failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

// ========================================
// Runs
// ========================================

/**
 * Create S1-S3 run
 */
export async function createS1S3Run(
  pool: Pool,
  input: S1S3RunInput
): Promise<OperationResult<S1S3RunRow>> {
  try {
    const result = await pool.query<S1S3RunRow>(
      `INSERT INTO s1s3_runs (type, issue_id, request_id, actor, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.type, input.issue_id, input.request_id, input.actor || 'system', input.status || S1S3RunStatus.CREATED]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No row returned from insert' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Create run failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Get S1-S3 run by ID
 */
export async function getS1S3RunById(
  pool: Pool,
  id: string
): Promise<OperationResult<S1S3RunRow>> {
  try {
    const result = await pool.query<S1S3RunRow>(
      'SELECT * FROM s1s3_runs WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Run not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Get run by ID failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * List S1-S3 runs for an issue
 */
export async function listS1S3RunsByIssue(
  pool: Pool,
  issueId: string
): Promise<OperationResult<S1S3RunRow[]>> {
  try {
    const result = await pool.query<S1S3RunRow>(
      'SELECT * FROM s1s3_runs WHERE issue_id = $1 ORDER BY created_at DESC',
      [issueId]
    );

    return { success: true, data: result.rows };
  } catch (error) {
    console.error('[S1S3 DAO] List runs by issue failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * Update S1-S3 run status
 */
export async function updateS1S3RunStatus(
  pool: Pool,
  id: string,
  status: S1S3RunStatus,
  errorMessage?: string
): Promise<OperationResult<S1S3RunRow>> {
  try {
    const updates: string[] = ['status = $2'];
    const params: any[] = [id, status];
    let paramIndex = 3;

    if (status === S1S3RunStatus.RUNNING && !errorMessage) {
      updates.push(`started_at = COALESCE(started_at, NOW())`);
    }

    if (status === S1S3RunStatus.DONE || status === S1S3RunStatus.FAILED) {
      updates.push(`completed_at = NOW()`);
    }

    if (errorMessage !== undefined) {
      updates.push(`error_message = $${paramIndex++}`);
      params.push(errorMessage);
    }

    const result = await pool.query<S1S3RunRow>(
      `UPDATE s1s3_runs SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Run not found' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Update run status failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

// ========================================
// Run Steps
// ========================================

/**
 * Create S1-S3 run step (append-only)
 */
export async function createS1S3RunStep(
  pool: Pool,
  input: S1S3RunStepInput
): Promise<OperationResult<S1S3RunStepRow>> {
  try {
    const result = await pool.query<S1S3RunStepRow>(
      `INSERT INTO s1s3_run_steps (run_id, step_id, step_name, status, evidence_refs, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.run_id,
        input.step_id,
        input.step_name,
        input.status,
        JSON.stringify(input.evidence_refs || {}),
        input.error_message || null,
      ]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'No row returned from insert' };
    }

    return { success: true, data: result.rows[0] };
  } catch (error) {
    console.error('[S1S3 DAO] Create run step failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}

/**
 * List S1-S3 run steps for a run
 */
export async function listS1S3RunSteps(
  pool: Pool,
  runId: string
): Promise<OperationResult<S1S3RunStepRow[]>> {
  try {
    const result = await pool.query<S1S3RunStepRow>(
      'SELECT * FROM s1s3_run_steps WHERE run_id = $1 ORDER BY created_at ASC',
      [runId]
    );

    return { success: true, data: result.rows };
  } catch (error) {
    console.error('[S1S3 DAO] List run steps failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database operation failed',
    };
  }
}
