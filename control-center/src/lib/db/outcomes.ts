/**
 * Outcome Records DAO - Database Access Object
 * 
 * Provides persistence layer for outcome records with auto-postmortem artifacts.
 * Supports idempotent creation via unique constraints on (outcome_key, postmortem_hash).
 * 
 * Reference: I782 (E78.2 - Outcome Records + Auto-Postmortem JSON)
 */

import { Pool } from 'pg';
import {
  OutcomeRecord,
  OutcomeRecordInput,
  OutcomeEntityType,
} from '../contracts/outcome';

export class OutcomeRecordsDAO {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Create outcome record (idempotent)
   * 
   * If (outcome_key, postmortem_hash) already exists: returns existing record
   * If not: creates new record
   * 
   * Concurrency-safe: Uses INSERT...ON CONFLICT for idempotency
   * 
   * @returns The created or existing outcome record
   */
  async createOutcomeRecord(input: OutcomeRecordInput): Promise<OutcomeRecord> {
    const result = await this.pool.query<any>(
      `INSERT INTO outcome_records (
        entity_type, entity_id, outcome_key, status,
        metrics_json, postmortem_json, postmortem_hash,
        lawbook_version, source_refs
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (outcome_key, postmortem_hash)
      DO UPDATE SET created_at = outcome_records.created_at
      RETURNING 
        id, entity_type, entity_id, created_at, outcome_key,
        status, metrics_json, postmortem_json, postmortem_hash,
        lawbook_version, source_refs`,
      [
        input.entity_type,
        input.entity_id,
        input.outcome_key,
        input.status || 'RECORDED',
        input.metrics_json || {},
        input.postmortem_json,
        input.postmortem_hash,
        input.lawbook_version || null,
        input.source_refs || {},
      ]
    );

    const row = result.rows[0];
    return this.mapRowToOutcomeRecord(row);
  }

  /**
   * Get outcome record by ID
   */
  async getOutcomeRecord(id: string): Promise<OutcomeRecord | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, entity_type, entity_id, created_at, outcome_key,
        status, metrics_json, postmortem_json, postmortem_hash,
        lawbook_version, source_refs
      FROM outcome_records
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToOutcomeRecord(result.rows[0]);
  }

  /**
   * Get outcome records by entity (incident or remediation_run)
   * 
   * Ordering: created_at DESC (most recent first)
   */
  async getOutcomeRecordsByEntity(
    entityType: OutcomeEntityType,
    entityId: string,
    limit: number = 100
  ): Promise<OutcomeRecord[]> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, entity_type, entity_id, created_at, outcome_key,
        status, metrics_json, postmortem_json, postmortem_hash,
        lawbook_version, source_refs
      FROM outcome_records
      WHERE entity_type = $1 AND entity_id = $2
      ORDER BY created_at DESC
      LIMIT $3`,
      [entityType, entityId, limit]
    );

    return result.rows.map(row => this.mapRowToOutcomeRecord(row));
  }

  /**
   * Get outcome records by incident ID
   * Convenience wrapper for getOutcomeRecordsByEntity
   */
  async getOutcomeRecordsByIncident(
    incidentId: string,
    limit: number = 100
  ): Promise<OutcomeRecord[]> {
    return this.getOutcomeRecordsByEntity('incident', incidentId, limit);
  }

  /**
   * Get outcome records by remediation run ID
   * Convenience wrapper for getOutcomeRecordsByEntity
   */
  async getOutcomeRecordsByRemediationRun(
    remediationRunId: string,
    limit: number = 100
  ): Promise<OutcomeRecord[]> {
    return this.getOutcomeRecordsByEntity('remediation_run', remediationRunId, limit);
  }

  /**
   * Check if outcome record exists by key + hash
   * Used to check idempotency before generation
   */
  async outcomeRecordExists(
    outcomeKey: string,
    postmortemHash: string
  ): Promise<boolean> {
    const result = await this.pool.query<any>(
      `SELECT id FROM outcome_records
      WHERE outcome_key = $1 AND postmortem_hash = $2
      LIMIT 1`,
      [outcomeKey, postmortemHash]
    );

    return result.rows.length > 0;
  }

  /**
   * List recent outcome records (paginated)
   * 
   * Ordering: created_at DESC (most recent first)
   */
  async listOutcomeRecords(
    limit: number = 50,
    offset: number = 0
  ): Promise<OutcomeRecord[]> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, entity_type, entity_id, created_at, outcome_key,
        status, metrics_json, postmortem_json, postmortem_hash,
        lawbook_version, source_refs
      FROM outcome_records
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows.map(row => this.mapRowToOutcomeRecord(row));
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private mapRowToOutcomeRecord(row: any): OutcomeRecord {
    return {
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      created_at: row.created_at.toISOString(),
      outcome_key: row.outcome_key,
      status: row.status,
      metrics_json: row.metrics_json || {},
      postmortem_json: row.postmortem_json,
      postmortem_hash: row.postmortem_hash,
      lawbook_version: row.lawbook_version,
      source_refs: row.source_refs || {},
    };
  }
}

/**
 * Get OutcomeRecordsDAO instance with pool
 */
export function getOutcomeRecordsDAO(pool: Pool): OutcomeRecordsDAO {
  return new OutcomeRecordsDAO(pool);
}
