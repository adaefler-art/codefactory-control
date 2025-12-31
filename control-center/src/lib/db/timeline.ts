/**
 * Timeline DAO - Database Access Object for Timeline/Linkage Model
 * 
 * Provides persistence layer for timeline_nodes, timeline_edges, timeline_events, and timeline_sources.
 * Supports idempotent ingestion via unique constraints and deterministic querying.
 * 
 * Reference: I721 (E72.1 - Timeline/Linkage Model)
 */

import { Pool } from 'pg';
import {
  TimelineNode,
  TimelineNodeInput,
  TimelineEdge,
  TimelineEdgeInput,
  TimelineEvent,
  TimelineEventInput,
  TimelineSource,
  TimelineSourceInput,
  generateNaturalKey,
} from '../contracts/timeline';

export class TimelineDAO {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Upsert a timeline node (idempotent)
   * Uses the unique constraint on (source_system, source_type, source_id)
   * 
   * @returns The created or updated node
   */
  async upsertNode(input: TimelineNodeInput): Promise<TimelineNode> {
    const result = await this.pool.query<any>(
      `INSERT INTO timeline_nodes (
        source_system, source_type, source_id, node_type,
        title, url, payload_json, lawbook_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (source_system, source_type, source_id)
      DO UPDATE SET
        node_type = EXCLUDED.node_type,
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        payload_json = EXCLUDED.payload_json,
        lawbook_version = EXCLUDED.lawbook_version,
        updated_at = NOW()
      RETURNING 
        id, source_system, source_type, source_id, node_type,
        title, url, payload_json, lawbook_version,
        created_at, updated_at`,
      [
        input.source_system,
        input.source_type,
        input.source_id,
        input.node_type,
        input.title || null,
        input.url || null,
        input.payload_json || {},
        input.lawbook_version || null,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      source_system: row.source_system,
      source_type: row.source_type,
      source_id: row.source_id,
      node_type: row.node_type,
      title: row.title,
      url: row.url,
      payload_json: row.payload_json,
      lawbook_version: row.lawbook_version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /**
   * Get a node by natural key components
   */
  async getNodeByNaturalKey(
    source_system: string,
    source_type: string,
    source_id: string
  ): Promise<TimelineNode | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, source_system, source_type, source_id, node_type,
        title, url, payload_json, lawbook_version,
        created_at, updated_at
      FROM timeline_nodes
      WHERE source_system = $1 AND source_type = $2 AND source_id = $3`,
      [source_system, source_type, source_id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      source_system: row.source_system,
      source_type: row.source_type,
      source_id: row.source_id,
      node_type: row.node_type,
      title: row.title,
      url: row.url,
      payload_json: row.payload_json,
      lawbook_version: row.lawbook_version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /**
   * Get a node by ID
   */
  async getNodeById(id: string): Promise<TimelineNode | null> {
    const result = await this.pool.query<any>(
      `SELECT 
        id, source_system, source_type, source_id, node_type,
        title, url, payload_json, lawbook_version,
        created_at, updated_at
      FROM timeline_nodes
      WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      source_system: row.source_system,
      source_type: row.source_type,
      source_id: row.source_id,
      node_type: row.node_type,
      title: row.title,
      url: row.url,
      payload_json: row.payload_json,
      lawbook_version: row.lawbook_version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /**
   * Create an edge (idempotent via unique constraint)
   * Returns existing edge if duplicate
   */
  async createEdge(input: TimelineEdgeInput): Promise<TimelineEdge> {
    const result = await this.pool.query<any>(
      `INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING
      RETURNING id, from_node_id, to_node_id, edge_type, payload_json, created_at`,
      [
        input.from_node_id,
        input.to_node_id,
        input.edge_type,
        input.payload_json || {},
      ]
    );

    // If conflict occurred, fetch the existing edge
    if (result.rows.length === 0) {
      const existing = await this.pool.query<any>(
        `SELECT id, from_node_id, to_node_id, edge_type, payload_json, created_at
        FROM timeline_edges
        WHERE from_node_id = $1 AND to_node_id = $2 AND edge_type = $3`,
        [input.from_node_id, input.to_node_id, input.edge_type]
      );
      const row = existing.rows[0];
      return {
        id: row.id,
        from_node_id: row.from_node_id,
        to_node_id: row.to_node_id,
        edge_type: row.edge_type,
        payload_json: row.payload_json,
        created_at: row.created_at.toISOString(),
      };
    }

    const row = result.rows[0];
    return {
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      edge_type: row.edge_type,
      payload_json: row.payload_json,
      created_at: row.created_at.toISOString(),
    };
  }

  /**
   * Upsert an edge (update payload if exists)
   */
  async upsertEdge(input: TimelineEdgeInput): Promise<TimelineEdge> {
    const result = await this.pool.query<any>(
      `INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (from_node_id, to_node_id, edge_type)
      DO UPDATE SET payload_json = EXCLUDED.payload_json
      RETURNING id, from_node_id, to_node_id, edge_type, payload_json, created_at`,
      [
        input.from_node_id,
        input.to_node_id,
        input.edge_type,
        input.payload_json || {},
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      edge_type: row.edge_type,
      payload_json: row.payload_json,
      created_at: row.created_at.toISOString(),
    };
  }

  /**
   * Create a timeline event
   */
  async createEvent(input: TimelineEventInput): Promise<TimelineEvent> {
    const occurred_at = input.occurred_at instanceof Date 
      ? input.occurred_at 
      : new Date(input.occurred_at);

    const result = await this.pool.query<any>(
      `INSERT INTO timeline_events (node_id, event_type, occurred_at, payload_json, source_ref)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, node_id, event_type, occurred_at, payload_json, source_ref, created_at`,
      [
        input.node_id,
        input.event_type,
        occurred_at,
        input.payload_json || {},
        input.source_ref || null,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      node_id: row.node_id,
      event_type: row.event_type,
      occurred_at: row.occurred_at.toISOString(),
      payload_json: row.payload_json,
      source_ref: row.source_ref,
      created_at: row.created_at.toISOString(),
    };
  }

  /**
   * Get events for a node (deterministically ordered)
   */
  async getEventsForNode(nodeId: string, limit: number = 100): Promise<TimelineEvent[]> {
    const result = await this.pool.query<any>(
      `SELECT id, node_id, event_type, occurred_at, payload_json, source_ref, created_at
      FROM timeline_events
      WHERE node_id = $1
      ORDER BY occurred_at DESC, id DESC
      LIMIT $2`,
      [nodeId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      node_id: row.node_id,
      event_type: row.event_type,
      occurred_at: row.occurred_at.toISOString(),
      payload_json: row.payload_json,
      source_ref: row.source_ref,
      created_at: row.created_at.toISOString(),
    }));
  }

  /**
   * Create a timeline source
   */
  async createSource(input: TimelineSourceInput): Promise<TimelineSource> {
    const result = await this.pool.query<any>(
      `INSERT INTO timeline_sources (node_id, source_kind, ref_json, sha256, content_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, node_id, source_kind, ref_json, sha256, content_hash, created_at`,
      [
        input.node_id,
        input.source_kind,
        input.ref_json,
        input.sha256 || null,
        input.content_hash || null,
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      node_id: row.node_id,
      source_kind: row.source_kind,
      ref_json: row.ref_json,
      sha256: row.sha256,
      content_hash: row.content_hash,
      created_at: row.created_at.toISOString(),
    };
  }

  /**
   * Get sources for a node
   */
  async getSourcesForNode(nodeId: string): Promise<TimelineSource[]> {
    const result = await this.pool.query<any>(
      `SELECT id, node_id, source_kind, ref_json, sha256, content_hash, created_at
      FROM timeline_sources
      WHERE node_id = $1
      ORDER BY created_at DESC`,
      [nodeId]
    );

    return result.rows.map(row => ({
      id: row.id,
      node_id: row.node_id,
      source_kind: row.source_kind,
      ref_json: row.ref_json,
      sha256: row.sha256,
      content_hash: row.content_hash,
      created_at: row.created_at.toISOString(),
    }));
  }

  /**
   * List complete chain for an issue
   * Returns all nodes and edges connected to an issue node
   */
  async listChainForIssue(
    issueSourceSystem: string,
    issueSourceId: string
  ): Promise<{
    nodes: TimelineNode[];
    edges: TimelineEdge[];
  }> {
    // Get the issue node
    const issueNode = await this.getNodeByNaturalKey(issueSourceSystem, 'issue', issueSourceId);
    if (!issueNode) {
      return { nodes: [], edges: [] };
    }

    // Get all connected nodes via edges (recursive query)
    const result = await this.pool.query<any>(
      `WITH RECURSIVE connected_nodes AS (
        -- Start with the issue node
        SELECT id FROM timeline_nodes WHERE id = $1
        UNION
        -- Recursively find all connected nodes
        SELECT DISTINCT tn.id
        FROM timeline_nodes tn
        JOIN timeline_edges te ON (tn.id = te.from_node_id OR tn.id = te.to_node_id)
        JOIN connected_nodes cn ON (te.from_node_id = cn.id OR te.to_node_id = cn.id)
      )
      SELECT 
        n.id, n.source_system, n.source_type, n.source_id, n.node_type,
        n.title, n.url, n.payload_json, n.lawbook_version,
        n.created_at, n.updated_at
      FROM timeline_nodes n
      JOIN connected_nodes cn ON n.id = cn.id`,
      [issueNode.id]
    );

    const nodes: TimelineNode[] = result.rows.map(row => ({
      id: row.id,
      source_system: row.source_system,
      source_type: row.source_type,
      source_id: row.source_id,
      node_type: row.node_type,
      title: row.title,
      url: row.url,
      payload_json: row.payload_json,
      lawbook_version: row.lawbook_version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    }));

    // Get all edges between the connected nodes
    const nodeIds = nodes.map(n => n.id);
    if (nodeIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const edgesResult = await this.pool.query<any>(
      `SELECT id, from_node_id, to_node_id, edge_type, payload_json, created_at
      FROM timeline_edges
      WHERE from_node_id = ANY($1) AND to_node_id = ANY($1)`,
      [nodeIds]
    );

    const edges: TimelineEdge[] = edgesResult.rows.map(row => ({
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      edge_type: row.edge_type,
      payload_json: row.payload_json,
      created_at: row.created_at.toISOString(),
    }));

    return { nodes, edges };
  }

  /**
   * Get edges from a node
   */
  async getEdgesFromNode(nodeId: string): Promise<TimelineEdge[]> {
    const result = await this.pool.query<any>(
      `SELECT id, from_node_id, to_node_id, edge_type, payload_json, created_at
      FROM timeline_edges
      WHERE from_node_id = $1`,
      [nodeId]
    );

    return result.rows.map(row => ({
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      edge_type: row.edge_type,
      payload_json: row.payload_json,
      created_at: row.created_at.toISOString(),
    }));
  }

  /**
   * Get edges to a node
   */
  async getEdgesToNode(nodeId: string): Promise<TimelineEdge[]> {
    const result = await this.pool.query<any>(
      `SELECT id, from_node_id, to_node_id, edge_type, payload_json, created_at
      FROM timeline_edges
      WHERE to_node_id = $1`,
      [nodeId]
    );

    return result.rows.map(row => ({
      id: row.id,
      from_node_id: row.from_node_id,
      to_node_id: row.to_node_id,
      edge_type: row.edge_type,
      payload_json: row.payload_json,
      created_at: row.created_at.toISOString(),
    }));
  }
}

/**
 * Get TimelineDAO instance with pool
 */
export function getTimelineDAO(pool: Pool): TimelineDAO {
  return new TimelineDAO(pool);
}
