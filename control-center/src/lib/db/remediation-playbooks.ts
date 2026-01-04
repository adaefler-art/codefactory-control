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
  sanitizeRedact,
  RemediationAuditEvent,
  RemediationAuditEventInput,
  computePayloadHash,
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
   * Concurrency-safe: Uses INSERT...ON CONFLICT to handle race conditions
   * Sanitization: All JSON fields are sanitized to remove secrets
   * 
   * @returns The created or existing remediation run
   */
  async upsertRunByKey(input: RemediationRunInput): Promise<RemediationRun> {
    // Sanitize all JSON fields before storing
    const sanitizedPlannedJson = input.planned_json ? sanitizeRedact(input.planned_json) : null;
    const sanitizedResultJson = input.result_json ? sanitizeRedact(input.result_json) : null;
    
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
        sanitizedPlannedJson,
        sanitizedResultJson,
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
   * 
   * Sanitization: result_json is sanitized before storage
   */
  async updateRunStatus(
    id: string,
    status: RemediationRunStatus,
    result_json?: Record<string, any>
  ): Promise<RemediationRun | null> {
    // Sanitize result_json before storing
    const sanitizedResultJson = result_json ? sanitizeRedact(result_json) : null;
    
    const result = await this.pool.query<any>(
      `UPDATE remediation_runs
      SET status = $1, result_json = COALESCE($2, result_json), updated_at = NOW()
      WHERE id = $3
      RETURNING 
        id, run_key, incident_id, playbook_id, playbook_version,
        status, created_at, updated_at, planned_json, result_json,
        lawbook_version, inputs_hash`,
      [status, sanitizedResultJson, id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToRun(result.rows[0]);
  }

  /**
   * Create a remediation step (idempotent per run+step_id)
   * 
   * Concurrency-safe: Uses INSERT...ON CONFLICT for idempotency
   * Sanitization: All JSON fields are sanitized to remove secrets
   */
  async createStep(input: RemediationStepInput): Promise<RemediationStep> {
    // Sanitize all JSON fields before storing
    const sanitizedInputJson = input.input_json ? sanitizeRedact(input.input_json) : null;
    const sanitizedOutputJson = input.output_json ? sanitizeRedact(input.output_json) : null;
    const sanitizedErrorJson = input.error_json ? sanitizeRedact(input.error_json) : null;
    
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
        sanitizedInputJson,
        sanitizedOutputJson,
        sanitizedErrorJson,
      ]
    );

    const row = result.rows[0];
    return this.mapRowToStep(row);
  }

  /**
   * Update remediation step status
   * 
   * Sanitization: output_json and error_json are sanitized before storage
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
    // Sanitize JSON fields before storing
    const sanitizedOutputJson = updates.output_json ? sanitizeRedact(updates.output_json) : null;
    const sanitizedErrorJson = updates.error_json ? sanitizeRedact(updates.error_json) : null;
    
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
        sanitizedOutputJson,
        sanitizedErrorJson,
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

  private mapRowToAuditEvent(row: any): RemediationAuditEvent {
    return {
      id: row.id,
      remediation_run_id: row.remediation_run_id,
      incident_id: row.incident_id,
      event_type: row.event_type,
      created_at: row.created_at.toISOString(),
      lawbook_version: row.lawbook_version,
      payload_json: row.payload_json,
      payload_hash: row.payload_hash,
    };
  }

  // ========================================
  // Audit Event Methods (E77.5 / I775)
  // ========================================

  /**
   * Create audit event (append-only)
   * 
   * Audit events are immutable once created. No updates allowed.
   * Payload is sanitized and hashed for integrity verification.
   * 
   * @returns The created audit event
   */
  async createAuditEvent(input: RemediationAuditEventInput): Promise<RemediationAuditEvent> {
    // Sanitize payload before storing (no secrets)
    const sanitizedPayload = sanitizeRedact(input.payload_json);
    
    // Compute hash from sanitized payload
    const payloadHash = computePayloadHash(sanitizedPayload);
    
    const result = await this.pool.query<any>(
      `INSERT INTO remediation_audit_events (
        remediation_run_id, incident_id, event_type,
        lawbook_version, payload_json, payload_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id, remediation_run_id, incident_id, event_type,
        created_at, lawbook_version, payload_json, payload_hash`,
      [
        input.remediation_run_id,
        input.incident_id,
        input.event_type,
        input.lawbook_version,
        sanitizedPayload,
        payloadHash,
      ]
    );

    return this.mapRowToAuditEvent(result.rows[0]);
  }

  /**
   * Get audit events for a remediation run
   * 
   * Events are ordered deterministically by:
   * 1. created_at (ascending)
   * 2. id (ascending - for same-timestamp ordering)
   * 
   * @returns Ordered list of audit events
   */
  async getAuditEventsForRun(remediation_run_id: string): Promise<RemediationAuditEvent[]> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, remediation_run_id, incident_id, event_type,
        created_at, lawbook_version, payload_json, payload_hash
      FROM remediation_audit_events
      WHERE remediation_run_id = $1
      ORDER BY created_at ASC, id ASC`,
      [remediation_run_id]
    );

    return result.rows.map(row => this.mapRowToAuditEvent(row));
  }

  /**
   * Get complete audit bundle for a run (run + steps + audit events)
   * Used for export functionality
   * 
   * @returns Bundle with run, steps, and audit events
   */
  async getAuditBundle(remediation_run_id: string): Promise<{
    run: RemediationRun | null;
    steps: RemediationStep[];
    auditEvents: RemediationAuditEvent[];
  }> {
    const run = await this.getRun(remediation_run_id);
    const steps = await this.getStepsForRun(remediation_run_id);
    const auditEvents = await this.getAuditEventsForRun(remediation_run_id);

    return {
      run,
      steps,
      auditEvents,
    };
  }
}

/**
 * Get RemediationPlaybookDAO instance with pool
 */
export function getRemediationPlaybookDAO(pool: Pool): RemediationPlaybookDAO {
  return new RemediationPlaybookDAO(pool);
}
