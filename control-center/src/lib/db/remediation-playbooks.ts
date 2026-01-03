/**
 * Remediation Playbook DAO - Database Access Object
 * 
 * Provides persistence layer for remediation playbook runs and steps.
 * Supports idempotent run creation via unique run_key and deterministic querying.
 * 
 * Reference: I771 (E77.1 - Remediation Playbook Framework)
 */

import { Pool } from 'pg';
import {
  RemediationRun,
  RemediationRunInput,
  RemediationStep,
  RemediationStepInput,
  RemediationRunStatus,
  RemediationStepStatus,
} from '../contracts/remediation-playbook';

export class RemediationPlaybookDAO {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create or get existing remediation run by run_key (idempotent)
   * 
   * If run_key exists: returns existing run (no-op)
   * If run_key does not exist: creates new run
   * 
   * @returns The created or existing remediation run
   */
  async upsertRunByKey(input: RemediationRunInput): Promise<RemediationRun> {
    const result = await this.pool.query<any>(
      `INSERT INTO remediation_runs (
        run_key, incident_id, playbook_id, playbook_version,
        status, planned_json, result_json, lawbook_version, inputs_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (run_key)
      DO UPDATE SET updated_at = NOW()
      RETURNING 
        id, run_key, incident_id, playbook_id, playbook_version,
        status, created_at, updated_at, planned_json, result_json,
        lawbook_version, inputs_hash`,
      [
        input.run_key,
        input.incident_id,
        input.playbook_id,
        input.playbook_version,
        input.status || 'PLANNED',
        input.planned_json || null,
        input.result_json || null,
        input.lawbook_version,
        input.inputs_hash,
      ]
    );

    const row = result.rows[0];
    return this.mapRowToRun(row);
  }

  /**
   * Get a remediation run by ID
   */
  async getRun(id: string): Promise<RemediationRun | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, run_key, incident_id, playbook_id, playbook_version,
        status, created_at, updated_at, planned_json, result_json,
        lawbook_version, inputs_hash
      FROM remediation_runs
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRun(result.rows[0]);
  }

  /**
   * Get a remediation run by run_key
   */
  async getRunByKey(run_key: string): Promise<RemediationRun | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, run_key, incident_id, playbook_id, playbook_version,
        status, created_at, updated_at, planned_json, result_json,
        lawbook_version, inputs_hash
      FROM remediation_runs
      WHERE run_key = $1`,
      [run_key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRun(result.rows[0]);
  }

  /**
   * List remediation runs for an incident
   */
  async listRunsForIncident(incident_id: string, limit: number = 100): Promise<RemediationRun[]> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, run_key, incident_id, playbook_id, playbook_version,
        status, created_at, updated_at, planned_json, result_json,
        lawbook_version, inputs_hash
      FROM remediation_runs
      WHERE incident_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
      [incident_id, limit]
    );

    return result.rows.map(row => this.mapRowToRun(row));
  }

  /**
   * Update remediation run status
   */
  async updateRunStatus(
    id: string,
    status: RemediationRunStatus,
    result_json?: Record<string, any>
  ): Promise<RemediationRun | null> {
    const result = await this.pool.query<any>(
      `UPDATE remediation_runs
      SET status = $1, result_json = COALESCE($2, result_json), updated_at = NOW()
      WHERE id = $3
      RETURNING 
        id, run_key, incident_id, playbook_id, playbook_version,
        status, created_at, updated_at, planned_json, result_json,
        lawbook_version, inputs_hash`,
      [status, result_json || null, id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRun(result.rows[0]);
  }

  /**
   * Create a remediation step (idempotent per run+step_id)
   */
  async createStep(input: RemediationStepInput): Promise<RemediationStep> {
    const result = await this.pool.query<any>(
      `INSERT INTO remediation_steps (
        remediation_run_id, step_id, action_type, status,
        idempotency_key, input_json, output_json, error_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (remediation_run_id, step_id)
      DO UPDATE SET 
        status = EXCLUDED.status,
        idempotency_key = EXCLUDED.idempotency_key,
        input_json = EXCLUDED.input_json,
        output_json = EXCLUDED.output_json,
        error_json = EXCLUDED.error_json
      RETURNING 
        id, remediation_run_id, step_id, action_type, status,
        started_at, finished_at, idempotency_key,
        input_json, output_json, error_json`,
      [
        input.remediation_run_id,
        input.step_id,
        input.action_type,
        input.status || 'PLANNED',
        input.idempotency_key || null,
        input.input_json || null,
        input.output_json || null,
        input.error_json || null,
      ]
    );

    const row = result.rows[0];
    return this.mapRowToStep(row);
  }

  /**
   * Update remediation step status
   */
  async updateStepStatus(
    id: string,
    status: RemediationStepStatus,
    updates: {
      started_at?: Date;
      finished_at?: Date;
      output_json?: Record<string, any>;
      error_json?: Record<string, any>;
    } = {}
  ): Promise<RemediationStep | null> {
    const result = await this.pool.query<any>(
      `UPDATE remediation_steps
      SET 
        status = $1,
        started_at = COALESCE($2, started_at),
        finished_at = COALESCE($3, finished_at),
        output_json = COALESCE($4, output_json),
        error_json = COALESCE($5, error_json)
      WHERE id = $6
      RETURNING 
        id, remediation_run_id, step_id, action_type, status,
        started_at, finished_at, idempotency_key,
        input_json, output_json, error_json`,
      [
        status,
        updates.started_at || null,
        updates.finished_at || null,
        updates.output_json || null,
        updates.error_json || null,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToStep(result.rows[0]);
  }

  /**
   * Get steps for a remediation run (ordered by step_id)
   */
  async getStepsForRun(remediation_run_id: string): Promise<RemediationStep[]> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, remediation_run_id, step_id, action_type, status,
        started_at, finished_at, idempotency_key,
        input_json, output_json, error_json
      FROM remediation_steps
      WHERE remediation_run_id = $1
      ORDER BY step_id`,
      [remediation_run_id]
    );

    return result.rows.map(row => this.mapRowToStep(row));
  }

  /**
   * Get a single step by ID
   */
  async getStep(id: string): Promise<RemediationStep | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, remediation_run_id, step_id, action_type, status,
        started_at, finished_at, idempotency_key,
        input_json, output_json, error_json
      FROM remediation_steps
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToStep(result.rows[0]);
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private mapRowToRun(row: any): RemediationRun {
    return {
      id: row.id,
      run_key: row.run_key,
      incident_id: row.incident_id,
      playbook_id: row.playbook_id,
      playbook_version: row.playbook_version,
      status: row.status,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      planned_json: row.planned_json,
      result_json: row.result_json,
      lawbook_version: row.lawbook_version,
      inputs_hash: row.inputs_hash,
    };
  }

  private mapRowToStep(row: any): RemediationStep {
    return {
      id: row.id,
      remediation_run_id: row.remediation_run_id,
      step_id: row.step_id,
      action_type: row.action_type,
      status: row.status,
      started_at: row.started_at ? row.started_at.toISOString() : null,
      finished_at: row.finished_at ? row.finished_at.toISOString() : null,
      idempotency_key: row.idempotency_key,
      input_json: row.input_json,
      output_json: row.output_json,
      error_json: row.error_json,
    };
  }
}

/**
 * Get RemediationPlaybookDAO instance with pool
 */
export function getRemediationPlaybookDAO(pool: Pool): RemediationPlaybookDAO {
  return new RemediationPlaybookDAO(pool);
}
