/**
 * Loop Run Store - Database Access Object for Loop Runs
 * 
 * E9.1-CTRL-2: Persistence layer for loop_runs and loop_run_steps tables.
 * Tracks every loop execution (success, blocked, fail) for audit and replay.
 * 
 * Provides type-safe CRUD operations with proper error handling following
 * patterns from afu9Runs.ts and playbookRuns.ts.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

/**
 * Status enum for loop runs
 */
export type LoopRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';

/**
 * Status enum for loop run steps
 */
export type LoopRunStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Input for creating a new loop run
 */
export interface CreateLoopRunInput {
  issueId: string;
  actor: string;
  requestId: string;
  mode: 'execute' | 'dryRun';
  metadata?: Record<string, any>;
}

/**
 * Input for updating loop run status
 */
export interface UpdateLoopRunStatusInput {
  status: LoopRunStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Input for creating a loop run step
 */
export interface CreateLoopRunStepInput {
  runId: string;
  stepNumber: number;
  stepType: string;
  metadata?: Record<string, any>;
}

/**
 * Input for updating loop run step status
 */
export interface UpdateLoopRunStepInput {
  status: LoopRunStepStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Loop run record from database
 */
export interface LoopRunRow {
  id: string;
  issue_id: string;
  actor: string;
  request_id: string;
  mode: string;
  status: string;
  created_at: Date;
  started_at?: Date | null;
  completed_at?: Date | null;
  duration_ms?: number | null;
  error_message?: string | null;
  metadata?: any;
}

/**
 * Loop run step record from database
 */
export interface LoopRunStepRow {
  id: string;
  run_id: string;
  step_number: number;
  step_type: string;
  status: string;
  started_at?: Date | null;
  completed_at?: Date | null;
  duration_ms?: number | null;
  error_message?: string | null;
  metadata?: any;
}

/**
 * Loop Run Store - DAO for loop run persistence
 */
export class LoopRunStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new loop run record
   * 
   * @param input - Run creation input
   * @returns Created run with generated ID
   */
  async createRun(input: CreateLoopRunInput): Promise<LoopRunRow> {
    const runId = uuidv4();
    
    const result = await this.pool.query<LoopRunRow>(
      `INSERT INTO loop_runs (id, issue_id, actor, request_id, mode, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, issue_id, actor, request_id, mode, status, 
                 created_at, started_at, completed_at, duration_ms, error_message, metadata`,
      [
        runId,
        input.issueId,
        input.actor,
        input.requestId,
        input.mode,
        'pending',
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to create loop run');
    }

    return result.rows[0];
  }

  /**
   * Get a loop run by ID
   * 
   * @param runId - Run ID
   * @returns Run record or null if not found
   */
  async getRun(runId: string): Promise<LoopRunRow | null> {
    const result = await this.pool.query<LoopRunRow>(
      `SELECT id, issue_id, actor, request_id, mode, status,
              created_at, started_at, completed_at, duration_ms, error_message, metadata
       FROM loop_runs
       WHERE id = $1`,
      [runId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update loop run status and timestamps
   * 
   * @param runId - Run ID
   * @param input - Update input
   */
  async updateRunStatus(runId: string, input: UpdateLoopRunStatusInput): Promise<void> {
    const fields: string[] = ['status = $2'];
    const values: any[] = [runId, input.status];
    let paramIndex = 3;

    if (input.startedAt) {
      fields.push(`started_at = $${paramIndex++}`);
      values.push(input.startedAt);
    }

    if (input.completedAt) {
      fields.push(`completed_at = $${paramIndex++}`);
      values.push(input.completedAt);
    }

    if (input.durationMs !== undefined) {
      fields.push(`duration_ms = $${paramIndex++}`);
      values.push(input.durationMs);
    }

    if (input.errorMessage !== undefined) {
      fields.push(`error_message = $${paramIndex++}`);
      values.push(input.errorMessage);
    }

    if (input.metadata) {
      fields.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    const query = `
      UPDATE loop_runs
      SET ${fields.join(', ')}
      WHERE id = $1
    `;

    await this.pool.query(query, values);
  }

  /**
   * List loop runs by issue ID
   * 
   * @param issueId - Issue ID
   * @param limit - Maximum number of results
   * @param offset - Pagination offset
   * @returns Array of run records
   */
  async listRunsByIssue(
    issueId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<LoopRunRow[]> {
    const result = await this.pool.query<LoopRunRow>(
      `SELECT id, issue_id, actor, request_id, mode, status,
              created_at, started_at, completed_at, duration_ms, error_message, metadata
       FROM loop_runs
       WHERE issue_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [issueId, limit, offset]
    );

    return result.rows;
  }

  /**
   * Create a new loop run step
   * 
   * @param input - Step creation input
   * @returns Created step with generated ID
   */
  async createStep(input: CreateLoopRunStepInput): Promise<LoopRunStepRow> {
    const result = await this.pool.query<LoopRunStepRow>(
      `INSERT INTO loop_run_steps (run_id, step_number, step_type, status, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, run_id, step_number, step_type, status,
                 started_at, completed_at, duration_ms, error_message, metadata`,
      [
        input.runId,
        input.stepNumber,
        input.stepType,
        'pending',
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to create loop run step');
    }

    return result.rows[0];
  }

  /**
   * Update loop run step status
   * 
   * @param stepId - Step ID
   * @param input - Update input
   */
  async updateStepStatus(stepId: string, input: UpdateLoopRunStepInput): Promise<void> {
    const fields: string[] = ['status = $2'];
    const values: any[] = [stepId, input.status];
    let paramIndex = 3;

    if (input.startedAt) {
      fields.push(`started_at = $${paramIndex++}`);
      values.push(input.startedAt);
    }

    if (input.completedAt) {
      fields.push(`completed_at = $${paramIndex++}`);
      values.push(input.completedAt);
    }

    if (input.durationMs !== undefined) {
      fields.push(`duration_ms = $${paramIndex++}`);
      values.push(input.durationMs);
    }

    if (input.errorMessage !== undefined) {
      fields.push(`error_message = $${paramIndex++}`);
      values.push(input.errorMessage);
    }

    if (input.metadata) {
      fields.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(input.metadata));
    }

    const query = `
      UPDATE loop_run_steps
      SET ${fields.join(', ')}
      WHERE id = $1
    `;

    await this.pool.query(query, values);
  }

  /**
   * Get steps for a run
   * 
   * @param runId - Run ID
   * @returns Array of step records ordered by step_number
   */
  async getStepsByRun(runId: string): Promise<LoopRunStepRow[]> {
    const result = await this.pool.query<LoopRunStepRow>(
      `SELECT id, run_id, step_number, step_type, status,
              started_at, completed_at, duration_ms, error_message, metadata
       FROM loop_run_steps
       WHERE run_id = $1
       ORDER BY step_number ASC`,
      [runId]
    );

    return result.rows;
  }

  /**
   * Get a run with its steps
   * 
   * @param runId - Run ID
   * @returns Run and steps or null if run not found
   */
  async getRunWithSteps(
    runId: string
  ): Promise<{ run: LoopRunRow; steps: LoopRunStepRow[] } | null> {
    const run = await this.getRun(runId);
    
    if (!run) {
      return null;
    }

    const steps = await this.getStepsByRun(runId);

    return { run, steps };
  }
}

/**
 * Get LoopRunStore instance with pool
 */
export function getLoopRunStore(pool: Pool): LoopRunStore {
  return new LoopRunStore(pool);
}
