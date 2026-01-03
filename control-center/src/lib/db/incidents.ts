/**
 * Incident DAO - Database Access Object for Incidents
 * 
 * Provides persistence layer for incidents, evidence, links, and events.
 * Supports idempotent ingestion via unique constraints and deterministic querying.
 * 
 * Reference: I761 (E76.1 - Incident Schema)
 */

import { Pool } from 'pg';
import {
  Incident,
  IncidentInput,
  Evidence,
  EvidenceInput,
  Link,
  LinkInput,
  Event,
  EventInput,
  IncidentFilter,
} from '../contracts/incident';

export class IncidentDAO {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Upsert an incident by incident_key (idempotent)
   * 
   * If incident_key exists:
   * - Updates title, summary, classification, lawbook_version, source_primary, tags
   * - Updates last_seen_at to NOW()
   * - Keeps first_seen_at unchanged
   * 
   * If incident_key does not exist:
   * - Creates new incident
   * - Sets first_seen_at and last_seen_at to NOW() or provided values
   * 
   * @returns The created or updated incident
   */
  async upsertIncidentByKey(input: IncidentInput): Promise<Incident> {
    const now = new Date().toISOString();
    const first_seen_at = input.first_seen_at || now;
    const last_seen_at = input.last_seen_at || now;

    const result = await this.pool.query<any>(
      `INSERT INTO incidents (
        incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        first_seen_at, last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (incident_key)
      DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        classification = EXCLUDED.classification,
        lawbook_version = EXCLUDED.lawbook_version,
        source_primary = EXCLUDED.source_primary,
        tags = EXCLUDED.tags,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING 
        id, incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        created_at, updated_at, first_seen_at, last_seen_at`,
      [
        input.incident_key,
        input.severity,
        input.status || 'OPEN',
        input.title,
        input.summary || null,
        input.classification || null,
        input.lawbook_version || null,
        input.source_primary,
        input.tags || [],
        first_seen_at,
        last_seen_at,
      ]
    );

    const row = result.rows[0];
    return this.mapRowToIncident(row);
  }

  /**
   * Get an incident by ID
   */
  async getIncident(id: string): Promise<Incident | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        created_at, updated_at, first_seen_at, last_seen_at
      FROM incidents
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToIncident(result.rows[0]);
  }

  /**
   * Get an incident by incident_key
   */
  async getIncidentByKey(incident_key: string): Promise<Incident | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        created_at, updated_at, first_seen_at, last_seen_at
      FROM incidents
      WHERE incident_key = $1`,
      [incident_key]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToIncident(result.rows[0]);
  }

  /**
   * List incidents with filters (deterministic ordering)
   * 
   * Ordering: last_seen_at DESC, id ASC (deterministic)
   */
  async listIncidents(filter: IncidentFilter = { limit: 100, offset: 0 }): Promise<Incident[]> {
    let query = `
      SELECT 
        id, incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        created_at, updated_at, first_seen_at, last_seen_at
      FROM incidents
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Add filters
    if (filter.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filter.status);
      paramIndex++;
    }

    if (filter.severity) {
      query += ` AND severity = $${paramIndex}`;
      params.push(filter.severity);
      paramIndex++;
    }

    // Deterministic ordering
    query += ` ORDER BY last_seen_at DESC, id ASC`;

    // Pagination
    query += ` LIMIT $${paramIndex}`;
    params.push(filter.limit || 100);
    paramIndex++;

    if (filter.offset && filter.offset > 0) {
      query += ` OFFSET $${paramIndex}`;
      params.push(filter.offset);
    }

    const result = await this.pool.query<any>(query, params);

    return result.rows.map(row => this.mapRowToIncident(row));
  }

  /**
   * Add evidence to an incident (idempotent)
   * 
   * If sha256 is provided, duplicate evidence (same incident_id, kind, sha256) will be skipped.
   * If sha256 is null, multiple evidence entries can exist.
   * 
   * @returns Array of added evidence (or existing if duplicate)
   */
  async addEvidence(evidenceList: EvidenceInput[]): Promise<Evidence[]> {
    if (evidenceList.length === 0) {
      return [];
    }

    const results: Evidence[] = [];

    // Process each evidence item
    for (const evidence of evidenceList) {
      try {
        const result = await this.pool.query<any>(
          `INSERT INTO incident_evidence (incident_id, kind, ref, sha256)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (incident_id, kind, sha256) 
          WHERE sha256 IS NOT NULL
          DO NOTHING
          RETURNING id, incident_id, kind, ref, sha256, created_at`,
          [
            evidence.incident_id,
            evidence.kind,
            evidence.ref,
            evidence.sha256 || null,
          ]
        );

        // If conflict occurred, fetch the existing evidence
        if (result.rows.length === 0 && evidence.sha256) {
          const existing = await this.pool.query<any>(
            `SELECT id, incident_id, kind, ref, sha256, created_at
            FROM incident_evidence
            WHERE incident_id = $1 AND kind = $2 AND sha256 = $3`,
            [evidence.incident_id, evidence.kind, evidence.sha256]
          );

          if (existing.rows.length > 0) {
            results.push(this.mapRowToEvidence(existing.rows[0]));
          }
        } else if (result.rows.length > 0) {
          results.push(this.mapRowToEvidence(result.rows[0]));
        }
      } catch (error) {
        // If no sha256, conflict won't happen, propagate error for caller handling
        throw error;
      }
    }

    return results;
  }

  /**
   * Get evidence for an incident
   */
  async getEvidence(incident_id: string): Promise<Evidence[]> {
    const result = await this.pool.query<any>(
      `SELECT id, incident_id, kind, ref, sha256, created_at
      FROM incident_evidence
      WHERE incident_id = $1
      ORDER BY created_at DESC`,
      [incident_id]
    );

    return result.rows.map(row => this.mapRowToEvidence(row));
  }

  /**
   * Create a link between incident and timeline node (idempotent)
   */
  async createLink(link: LinkInput): Promise<Link> {
    const result = await this.pool.query<any>(
      `INSERT INTO incident_links (incident_id, timeline_node_id, link_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (incident_id, timeline_node_id, link_type) DO NOTHING
      RETURNING id, incident_id, timeline_node_id, link_type, created_at`,
      [link.incident_id, link.timeline_node_id, link.link_type]
    );

    // If conflict occurred, fetch the existing link
    if (result.rows.length === 0) {
      const existing = await this.pool.query<any>(
        `SELECT id, incident_id, timeline_node_id, link_type, created_at
        FROM incident_links
        WHERE incident_id = $1 AND timeline_node_id = $2 AND link_type = $3`,
        [link.incident_id, link.timeline_node_id, link.link_type]
      );
      return this.mapRowToLink(existing.rows[0]);
    }

    return this.mapRowToLink(result.rows[0]);
  }

  /**
   * Get links for an incident
   */
  async getLinks(incident_id: string): Promise<Link[]> {
    const result = await this.pool.query<any>(
      `SELECT id, incident_id, timeline_node_id, link_type, created_at
      FROM incident_links
      WHERE incident_id = $1
      ORDER BY created_at DESC`,
      [incident_id]
    );

    return result.rows.map(row => this.mapRowToLink(row));
  }

  /**
   * Create an incident event
   */
  async createEvent(event: EventInput): Promise<Event> {
    const result = await this.pool.query<any>(
      `INSERT INTO incident_events (incident_id, event_type, payload)
      VALUES ($1, $2, $3)
      RETURNING id, incident_id, event_type, payload, created_at`,
      [event.incident_id, event.event_type, event.payload || {}]
    );

    return this.mapRowToEvent(result.rows[0]);
  }

  /**
   * Get events for an incident (deterministic ordering)
   */
  async getEvents(incident_id: string, limit: number = 100): Promise<Event[]> {
    const result = await this.pool.query<any>(
      `SELECT id, incident_id, event_type, payload, created_at
      FROM incident_events
      WHERE incident_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
      [incident_id, limit]
    );

    return result.rows.map(row => this.mapRowToEvent(row));
  }

  /**
   * Update incident status
   */
  async updateStatus(id: string, status: string): Promise<Incident | null> {
    const result = await this.pool.query<any>(
      `UPDATE incidents
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING 
        id, incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        created_at, updated_at, first_seen_at, last_seen_at`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToIncident(result.rows[0]);
  }

  /**
   * Update incident classification (idempotent)
   * 
   * Only updates if the classification has actually changed.
   * Returns the incident and a boolean indicating if update occurred.
   * 
   * @param id - Incident ID
   * @param classification - Classification object to store
   * @param classificationHash - SHA256 hash of the classification
   * @returns { incident: Incident | null, updated: boolean }
   */
  async updateClassification(
    id: string,
    classification: any,
    classificationHash: string
  ): Promise<{ incident: Incident | null; updated: boolean }> {
    // First check if classification has changed
    const current = await this.pool.query<any>(
      `SELECT classification FROM incidents WHERE id = $1`,
      [id]
    );

    if (current.rows.length === 0) {
      return { incident: null, updated: false };
    }

    // Compute hash of current classification if it exists
    const currentClassification = current.rows[0].classification;
    if (currentClassification) {
      // Import computeClassificationHash here to avoid circular dependency
      const { computeClassificationHash } = require('../classifier');
      const currentHash = computeClassificationHash(currentClassification);
      
      // If hash matches, no update needed
      if (currentHash === classificationHash) {
        const incident = await this.getIncident(id);
        return { incident, updated: false };
      }
    }

    // Update classification
    const result = await this.pool.query<any>(
      `UPDATE incidents
      SET classification = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING 
        id, incident_key, severity, status, title, summary,
        classification, lawbook_version, source_primary, tags,
        created_at, updated_at, first_seen_at, last_seen_at`,
      [classification, id]
    );

    if (result.rows.length === 0) {
      return { incident: null, updated: false };
    }

    return { incident: this.mapRowToIncident(result.rows[0]), updated: true };
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private mapRowToIncident(row: any): Incident {
    return {
      id: row.id,
      incident_key: row.incident_key,
      severity: row.severity,
      status: row.status,
      title: row.title,
      summary: row.summary,
      classification: row.classification,
      lawbook_version: row.lawbook_version,
      source_primary: row.source_primary,
      tags: row.tags || [],
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      first_seen_at: row.first_seen_at.toISOString(),
      last_seen_at: row.last_seen_at.toISOString(),
    };
  }

  private mapRowToEvidence(row: any): Evidence {
    return {
      id: row.id,
      incident_id: row.incident_id,
      kind: row.kind,
      ref: row.ref,
      sha256: row.sha256,
      created_at: row.created_at.toISOString(),
    };
  }

  private mapRowToLink(row: any): Link {
    return {
      id: row.id,
      incident_id: row.incident_id,
      timeline_node_id: row.timeline_node_id,
      link_type: row.link_type,
      created_at: row.created_at.toISOString(),
    };
  }

  private mapRowToEvent(row: any): Event {
    return {
      id: row.id,
      incident_id: row.incident_id,
      event_type: row.event_type,
      payload: row.payload || {},
      created_at: row.created_at.toISOString(),
    };
  }
}

/**
 * Get IncidentDAO instance with pool
 */
export function getIncidentDAO(pool: Pool): IncidentDAO {
  return new IncidentDAO(pool);
}
