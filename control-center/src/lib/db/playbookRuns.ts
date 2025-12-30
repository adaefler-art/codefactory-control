/**
 * Playbook Runs Database Helper
 * 
 * Centralized database operations for playbook_runs and playbook_run_steps tables.
 * Provides type-safe CRUD operations with proper error handling.
 * 
 * Reference: E65.2 (Post-Deploy Verification Playbook)
 */

import { Pool } from 'pg';
import {
  PlaybookRunRow,
  PlaybookRunStepRow,
  PlaybookRunInput,
  PlaybookStepResultInput,
  RunStatus,
  StepStatus,
  RunSummary,
} from '../contracts/playbook';

/**
 * Insert a new playbook run
 */
export async function insertPlaybookRun(
  pool: Pool,
  input: PlaybookRunInput
): Promise<PlaybookRunRow> {
  const result = await pool.query<PlaybookRunRow>(
    `INSERT INTO playbook_runs (playbook_id, playbook_version, env, status)
     VALUES ($1, $2, $3, $4)
     RETURNING id, playbook_id, playbook_version, env, status, 
               started_at, completed_at, summary, created_at`,
    [input.playbookId, input.playbookVersion, input.env, 'pending']
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to insert playbook run');
  }

  return result.rows[0];
}

/**
 * Update playbook run status and timestamps
 */
export async function updatePlaybookRunStatus(
  pool: Pool,
  runId: string,
  status: RunStatus,
  options?: {
    startedAt?: Date;
    completedAt?: Date;
    summary?: RunSummary;
  }
): Promise<void> {
  const fields: string[] = ['status = $2'];
  const values: any[] = [runId, status];
  let paramIndex = 3;

  if (options?.startedAt) {
    fields.push(`started_at = $${paramIndex++}`);
    values.push(options.startedAt);
  }

  if (options?.completedAt) {
    fields.push(`completed_at = $${paramIndex++}`);
    values.push(options.completedAt);
  }

  if (options?.summary) {
    fields.push(`summary = $${paramIndex++}`);
    values.push(JSON.stringify(options.summary));
  }

  const query = `
    UPDATE playbook_runs
    SET ${fields.join(', ')}
    WHERE id = $1
  `;

  await pool.query(query, values);
}

/**
 * Insert a playbook run step
 */
export async function insertPlaybookRunStep(
  pool: Pool,
  input: PlaybookStepResultInput
): Promise<PlaybookRunStepRow> {
  const result = await pool.query<PlaybookRunStepRow>(
    `INSERT INTO playbook_run_steps 
      (run_id, step_id, step_index, status, started_at, completed_at, evidence, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, run_id, step_id, step_index, status, 
               started_at, completed_at, evidence, error, created_at`,
    [
      input.runId,
      input.stepId,
      input.stepIndex,
      input.status,
      input.startedAt || null,
      input.completedAt || null,
      input.evidence ? JSON.stringify(input.evidence) : null,
      input.error ? JSON.stringify(input.error) : null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to insert playbook run step');
  }

  return result.rows[0];
}

/**
 * Update playbook run step status
 */
export async function updatePlaybookRunStepStatus(
  pool: Pool,
  stepRowId: string,
  status: StepStatus,
  options?: {
    startedAt?: Date;
    completedAt?: Date;
    evidence?: any;
    error?: any;
  }
): Promise<void> {
  const fields: string[] = ['status = $2'];
  const values: any[] = [stepRowId, status];
  let paramIndex = 3;

  if (options?.startedAt) {
    fields.push(`started_at = $${paramIndex++}`);
    values.push(options.startedAt);
  }

  if (options?.completedAt) {
    fields.push(`completed_at = $${paramIndex++}`);
    values.push(options.completedAt);
  }

  if (options?.evidence) {
    fields.push(`evidence = $${paramIndex++}`);
    values.push(JSON.stringify(options.evidence));
  }

  if (options?.error) {
    fields.push(`error = $${paramIndex++}`);
    values.push(JSON.stringify(options.error));
  }

  const query = `
    UPDATE playbook_run_steps
    SET ${fields.join(', ')}
    WHERE id = $1
  `;

  await pool.query(query, values);
}

/**
 * Get a playbook run by ID with all its steps
 */
export async function getPlaybookRun(
  pool: Pool,
  runId: string
): Promise<{ run: PlaybookRunRow; steps: PlaybookRunStepRow[] } | null> {
  // Get run
  const runResult = await pool.query<PlaybookRunRow>(
    `SELECT id, playbook_id, playbook_version, env, status,
            started_at, completed_at, summary, created_at
     FROM playbook_runs
     WHERE id = $1`,
    [runId]
  );

  if (runResult.rows.length === 0) {
    return null;
  }

  // Get steps
  const stepsResult = await pool.query<PlaybookRunStepRow>(
    `SELECT id, run_id, step_id, step_index, status,
            started_at, completed_at, evidence, error, created_at
     FROM playbook_run_steps
     WHERE run_id = $1
     ORDER BY step_index ASC`,
    [runId]
  );

  return {
    run: runResult.rows[0],
    steps: stepsResult.rows,
  };
}

/**
 * List playbook runs with pagination
 */
export async function listPlaybookRuns(
  pool: Pool,
  options?: {
    playbookId?: string;
    env?: string;
    limit?: number;
    offset?: number;
  }
): Promise<PlaybookRunRow[]> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (options?.playbookId) {
    conditions.push(`playbook_id = $${paramIndex++}`);
    values.push(options.playbookId);
  }

  if (options?.env) {
    conditions.push(`env = $${paramIndex++}`);
    values.push(options.env);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  const query = `
    SELECT id, playbook_id, playbook_version, env, status,
           started_at, completed_at, summary, created_at
    FROM playbook_runs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++}
    OFFSET $${paramIndex++}
  `;

  values.push(limit, offset);

  const result = await pool.query<PlaybookRunRow>(query, values);
  return result.rows;
}
