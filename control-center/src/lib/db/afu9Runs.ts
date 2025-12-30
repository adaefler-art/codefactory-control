/**
 * AFU-9 Runs DAO - Database Access Object for Runs Ledger
 * 
 * Provides persistence layer for runs, run_steps, and run_artifacts tables.
 * Supports immutable runs, deterministic playbook IDs, and re-runs via parentRunId.
 * 
 * Reference: I632 (Runs Ledger), I633 (Issue UI Runs Tab)
 */

import { Pool } from 'pg';
import { RunSpec, RunResult, StepResult, RunResultSchema, RunSummary } from '../contracts/afu9Runner';
import { v4 as uuidv4 } from 'uuid';

export class RunsDAO {
  private pool: Pool;
  private static readonly TRUNCATION_PREFIX = '...';
  private static readonly MAX_OUTPUT_LENGTH = 4000;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create a new run in the database
   */
  async createRun(
    runId: string,
    spec: RunSpec,
    issueId?: string,
    playbookId?: string,
    parentRunId?: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert run
      await client.query(
        `INSERT INTO runs (id, issue_id, title, playbook_id, parent_run_id, status, spec_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          runId,
          issueId || null,
          spec.title,
          playbookId || null,
          parentRunId || null,
          'QUEUED',
          JSON.stringify(spec),
        ]
      );

      // Insert steps
      for (let i = 0; i < spec.steps.length; i++) {
        const step = spec.steps[i];
        await client.query(
          `INSERT INTO run_steps (run_id, idx, name, status)
           VALUES ($1, $2, $3, $4)`,
          [runId, i, step.name, 'QUEUED']
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get a run by ID
   */
  async getRun(runId: string): Promise<{ run: any; steps: any[] } | null> {
    const client = await this.pool.connect();
    try {
      // Get run
      const runResult = await client.query('SELECT * FROM runs WHERE id = $1', [runId]);

      if (runResult.rows.length === 0) {
        return null;
      }

      // Get steps
      const stepsResult = await client.query(
        'SELECT * FROM run_steps WHERE run_id = $1 ORDER BY idx ASC',
        [runId]
      );

      return {
        run: runResult.rows[0],
        steps: stepsResult.rows,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update run status
   */
  async updateRunStatus(
    runId: string,
    status: string,
    startedAt?: Date,
    finishedAt?: Date
  ): Promise<void> {
    const updates: string[] = ['status = $2'];
    const params: any[] = [runId, status];
    let paramIndex = 3;

    if (startedAt) {
      updates.push(`started_at = $${paramIndex++}`);
      params.push(startedAt);
    }

    if (finishedAt) {
      updates.push(`finished_at = $${paramIndex++}`);
      params.push(finishedAt);
    }

    await this.pool.query(`UPDATE runs SET ${updates.join(', ')} WHERE id = $1`, params);
  }

  /**
   * Update run with result summary
   */
  async updateRunResult(runId: string, resultJson: any): Promise<void> {
    await this.pool.query('UPDATE runs SET result_json = $2 WHERE id = $1', [
      runId,
      JSON.stringify(resultJson),
    ]);
  }

  /**
   * Update step status and results
   */
  async updateStep(
    runId: string,
    idx: number,
    status: string,
    exitCode?: number,
    durationMs?: number,
    stdoutTail?: string,
    stderrTail?: string
  ): Promise<void> {
    const updates: string[] = ['status = $3'];
    const params: any[] = [runId, idx, status];
    let paramIndex = 4;

    if (exitCode !== undefined) {
      updates.push(`exit_code = $${paramIndex++}`);
      params.push(exitCode);
    }

    if (durationMs !== undefined) {
      updates.push(`duration_ms = $${paramIndex++}`);
      params.push(durationMs);
    }

    if (stdoutTail !== undefined) {
      updates.push(`stdout_tail = $${paramIndex++}`);
      params.push(this.capOutput(stdoutTail));
    }

    if (stderrTail !== undefined) {
      updates.push(`stderr_tail = $${paramIndex++}`);
      params.push(this.capOutput(stderrTail));
    }

    await this.pool.query(
      `UPDATE run_steps SET ${updates.join(', ')} WHERE run_id = $1 AND idx = $2`,
      params
    );
  }

  /**
   * Get runs by issue ID
   */
  async listRunsByIssue(
    issueId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<RunSummary[]> {
    const result = await this.pool.query(
      `SELECT 
        id as "runId",
        title,
        status,
        created_at as "createdAt",
        started_at as "startedAt",
        finished_at as "finishedAt",
        playbook_id as "playbookId",
        parent_run_id as "parentRunId"
       FROM runs 
       WHERE issue_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [issueId, limit, offset]
    );

    return result.rows.map((row) => ({
      runId: row.runId,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt?.toISOString() || '',
      startedAt: row.startedAt?.toISOString() || null,
      finishedAt: row.finishedAt?.toISOString() || null,
      playbookId: row.playbookId,
      parentRunId: row.parentRunId,
    }));
  }

  /**
   * Get run steps
   */
  async getRunSteps(runId: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM run_steps WHERE run_id = $1 ORDER BY idx ASC',
      [runId]
    );

    return result.rows;
  }

  /**
   * Get run artifacts
   */
  async getRunArtifacts(runId: string): Promise<any[]> {
    const result = await this.pool.query(
      'SELECT * FROM run_artifacts WHERE run_id = $1 ORDER BY created_at ASC',
      [runId]
    );

    return result.rows;
  }

  /**
   * Add run artifact
   */
  async addRunArtifact(
    runId: string,
    kind: string,
    name: string,
    ref: string,
    stepIdx?: number,
    bytes?: number,
    sha256?: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_artifacts (run_id, step_idx, kind, name, ref, bytes, sha256, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [runId, stepIdx || null, kind, name, ref, bytes || null, sha256 || null]
    );
  }

  /**
   * Cap output to maximum length (tail)
   */
  private capOutput(output: string): string {
    if (output.length <= RunsDAO.MAX_OUTPUT_LENGTH) {
      return output;
    }
    return (
      RunsDAO.TRUNCATION_PREFIX +
      output.slice(-RunsDAO.MAX_OUTPUT_LENGTH + RunsDAO.TRUNCATION_PREFIX.length)
    );
  }

  /**
   * Reconstruct RunResult from database
   */
  async reconstructRunResult(runId: string): Promise<RunResult | null> {
    const data = await this.getRun(runId);

    if (!data) {
      return null;
    }

    const { run, steps } = data;
    const spec = run.spec_json as RunSpec;

    // Get artifacts
    const artifacts = await this.getRunArtifacts(runId);

    // Map database step status to RunResult step status
    const stepResults: StepResult[] = steps.map((step) => {
      const result: StepResult = {
        name: step.name,
        status: this.mapStepStatus(step.status),
      };

      if (step.exit_code !== null && step.exit_code !== undefined) {
        result.exitCode = step.exit_code;
      }

      if (step.stdout_tail) {
        result.stdout = step.stdout_tail;
      }

      if (step.stderr_tail) {
        result.stderr = step.stderr_tail;
      }

      if (step.duration_ms !== null && step.duration_ms !== undefined) {
        result.durationMs = step.duration_ms;
      }

      return result;
    });

    // Map database run status to RunResult status
    const runResult: RunResult = {
      runId: run.id,
      issueId: run.issue_id || undefined,
      title: run.title,
      runtime: spec.runtime,
      status: this.mapRunStatus(run.status),
      steps: stepResults,
      createdAt: run.created_at.toISOString(),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        ref: artifact.ref,
        bytes: artifact.bytes || undefined,
        stepIdx: artifact.step_idx !== null ? artifact.step_idx : undefined,
      })),
    };

    if (run.started_at) {
      runResult.startedAt = run.started_at.toISOString();
    }

    if (run.finished_at) {
      runResult.completedAt = run.finished_at.toISOString();
    }

    if (run.started_at && run.finished_at) {
      runResult.durationMs = run.finished_at.getTime() - run.started_at.getTime();
    }

    return runResult;
  }

  /**
   * Map database run status to RunResult status
   */
  private mapRunStatus(
    dbStatus: string
  ): 'created' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' {
    switch (dbStatus) {
      case 'QUEUED':
        return 'created';
      case 'RUNNING':
        return 'running';
      case 'SUCCEEDED':
        return 'success';
      case 'FAILED':
        return 'failed';
      case 'CANCELLED':
        return 'cancelled';
      default:
        return 'failed';
    }
  }

  /**
   * Map database step status to StepResult status
   */
  private mapStepStatus(
    dbStatus: string
  ): 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'skipped' {
    switch (dbStatus) {
      case 'QUEUED':
        return 'pending';
      case 'RUNNING':
        return 'running';
      case 'SUCCEEDED':
        return 'success';
      case 'FAILED':
        return 'failed';
      case 'SKIPPED':
        return 'skipped';
      default:
        return 'failed';
    }
  }
}

/**
 * Get RunsDAO instance with pool
 */
export function getRunsDAO(pool: Pool): RunsDAO {
  return new RunsDAO(pool);
}
