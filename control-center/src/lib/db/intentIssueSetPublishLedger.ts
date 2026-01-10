/**
 * Database Access Layer: INTENT Issue Set Publish Ledger
 * 
 * Provides functions for managing the audit trail of issue set publishing to GitHub.
 * Issue E82.3: Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
 */

import { Pool } from 'pg';
import crypto from 'crypto';

/**
 * Publish batch record
 */
export interface PublishBatch {
  id: string;
  issue_set_id: string;
  session_id: string;
  created_at: string;
  request_id: string;
  lawbook_version: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  total_items: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  error_message: string | null;
  error_details: unknown | null;
  batch_hash: string;
}

/**
 * Publish item record
 */
export interface PublishItem {
  id: string;
  batch_id: string;
  issue_set_item_id: string;
  created_at: string;
  canonical_id: string;
  issue_hash: string;
  owner: string;
  repo: string;
  github_issue_number: number | null;
  github_issue_url: string | null;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  status: 'pending' | 'success' | 'failed';
  error_message: string | null;
  error_details: unknown | null;
  lawbook_version: string;
  rendered_issue_hash: string | null;
  labels_applied: string[] | null;
  request_id: string;
}

/**
 * Input for creating a publish batch
 */
export interface CreatePublishBatchInput {
  issue_set_id: string;
  session_id: string;
  request_id: string;
  lawbook_version: string;
  total_items: number;
  source_hash: string;
  owner: string;
  repo: string;
}

/**
 * Input for creating a publish item
 */
export interface CreatePublishItemInput {
  batch_id: string;
  issue_set_item_id: string;
  canonical_id: string;
  issue_hash: string;
  owner: string;
  repo: string;
  github_issue_number?: number;
  github_issue_url?: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  status: 'pending' | 'success' | 'failed';
  error_message?: string;
  error_details?: unknown;
  lawbook_version: string;
  rendered_issue_hash?: string;
  labels_applied?: string[];
  request_id: string;
}

/**
 * Generate batch hash for idempotency (repo-specific)
 */
export function generateBatchHash(issueSetId: string, sourceHash: string, owner: string, repo: string): string {
  const content = `${issueSetId}:${sourceHash}:${owner}:${repo}`;
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Create a new publish batch
 */
export async function createPublishBatch(
  pool: Pool,
  input: CreatePublishBatchInput
): Promise<{ success: true; data: PublishBatch } | { success: false; error: string }> {
  try {
    const batchHash = generateBatchHash(input.issue_set_id, input.source_hash, input.owner, input.repo);
    
    const result = await pool.query(
      `INSERT INTO intent_issue_set_publish_batches (
        issue_set_id,
        session_id,
        request_id,
        lawbook_version,
        status,
        total_items,
        batch_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING 
        id, issue_set_id, session_id, created_at, request_id, lawbook_version,
        status, started_at, completed_at, total_items, created_count, updated_count,
        skipped_count, failed_count, error_message, error_details, batch_hash`,
      [
        input.issue_set_id,
        input.session_id,
        input.request_id,
        input.lawbook_version,
        'pending',
        input.total_items,
        batchHash,
      ]
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        issue_set_id: row.issue_set_id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        request_id: row.request_id,
        lawbook_version: row.lawbook_version,
        status: row.status,
        started_at: row.started_at?.toISOString() || null,
        completed_at: row.completed_at?.toISOString() || null,
        total_items: row.total_items,
        created_count: row.created_count,
        updated_count: row.updated_count,
        skipped_count: row.skipped_count,
        failed_count: row.failed_count,
        error_message: row.error_message,
        error_details: row.error_details,
        batch_hash: row.batch_hash,
      },
    };
  } catch (error) {
    console.error('[DB] Error creating publish batch:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}

/**
 * Create a publish item
 */
export async function createPublishItem(
  pool: Pool,
  input: CreatePublishItemInput
): Promise<{ success: true; data: PublishItem } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `INSERT INTO intent_issue_set_publish_items (
        batch_id,
        issue_set_item_id,
        canonical_id,
        issue_hash,
        owner,
        repo,
        github_issue_number,
        github_issue_url,
        action,
        status,
        error_message,
        error_details,
        lawbook_version,
        rendered_issue_hash,
        labels_applied,
        request_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING 
        id, batch_id, issue_set_item_id, created_at, canonical_id, issue_hash,
        owner, repo, github_issue_number, github_issue_url, action, status,
        error_message, error_details, lawbook_version, rendered_issue_hash,
        labels_applied, request_id`,
      [
        input.batch_id,
        input.issue_set_item_id,
        input.canonical_id,
        input.issue_hash,
        input.owner,
        input.repo,
        input.github_issue_number || null,
        input.github_issue_url || null,
        input.action,
        input.status,
        input.error_message || null,
        input.error_details ? JSON.stringify(input.error_details) : null,
        input.lawbook_version,
        input.rendered_issue_hash || null,
        input.labels_applied || null,
        input.request_id,
      ]
    );
    
    const row = result.rows[0];
    return {
      success: true,
      data: {
        id: row.id,
        batch_id: row.batch_id,
        issue_set_item_id: row.issue_set_item_id,
        created_at: row.created_at.toISOString(),
        canonical_id: row.canonical_id,
        issue_hash: row.issue_hash,
        owner: row.owner,
        repo: row.repo,
        github_issue_number: row.github_issue_number,
        github_issue_url: row.github_issue_url,
        action: row.action,
        status: row.status,
        error_message: row.error_message,
        error_details: row.error_details,
        lawbook_version: row.lawbook_version,
        rendered_issue_hash: row.rendered_issue_hash,
        labels_applied: row.labels_applied,
        request_id: row.request_id,
      },
    };
  } catch (error) {
    console.error('[DB] Error creating publish item:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}

/**
 * Query publish batches by issue set ID
 */
export async function queryPublishBatches(
  pool: Pool,
  issueSetId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: PublishBatch[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    const result = await pool.query(
      `SELECT 
        id, issue_set_id, session_id, created_at, request_id, lawbook_version,
        status, started_at, completed_at, total_items, created_count, updated_count,
        skipped_count, failed_count, error_message, error_details, batch_hash
      FROM intent_issue_set_publish_batches
      WHERE issue_set_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
      [issueSetId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        issue_set_id: row.issue_set_id,
        session_id: row.session_id,
        created_at: row.created_at.toISOString(),
        request_id: row.request_id,
        lawbook_version: row.lawbook_version,
        status: row.status,
        started_at: row.started_at?.toISOString() || null,
        completed_at: row.completed_at?.toISOString() || null,
        total_items: row.total_items,
        created_count: row.created_count,
        updated_count: row.updated_count,
        skipped_count: row.skipped_count,
        failed_count: row.failed_count,
        error_message: row.error_message,
        error_details: row.error_details,
        batch_hash: row.batch_hash,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying publish batches:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}

/**
 * Query publish items by batch ID
 */
export async function queryPublishItems(
  pool: Pool,
  batchId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: PublishItem[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    
    const result = await pool.query(
      `SELECT 
        id, batch_id, issue_set_item_id, created_at, canonical_id, issue_hash,
        owner, repo, github_issue_number, github_issue_url, action, status,
        error_message, error_details, lawbook_version, rendered_issue_hash,
        labels_applied, request_id
      FROM intent_issue_set_publish_items
      WHERE batch_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3`,
      [batchId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        batch_id: row.batch_id,
        issue_set_item_id: row.issue_set_item_id,
        created_at: row.created_at.toISOString(),
        canonical_id: row.canonical_id,
        issue_hash: row.issue_hash,
        owner: row.owner,
        repo: row.repo,
        github_issue_number: row.github_issue_number,
        github_issue_url: row.github_issue_url,
        action: row.action,
        status: row.status,
        error_message: row.error_message,
        error_details: row.error_details,
        lawbook_version: row.lawbook_version,
        rendered_issue_hash: row.rendered_issue_hash,
        labels_applied: row.labels_applied,
        request_id: row.request_id,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying publish items:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}

/**
 * Query publish items by canonical ID
 */
export async function queryPublishItemsByCanonicalId(
  pool: Pool,
  canonicalId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: PublishItem[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    const result = await pool.query(
      `SELECT 
        id, batch_id, issue_set_item_id, created_at, canonical_id, issue_hash,
        owner, repo, github_issue_number, github_issue_url, action, status,
        error_message, error_details, lawbook_version, rendered_issue_hash,
        labels_applied, request_id
      FROM intent_issue_set_publish_items
      WHERE canonical_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
      [canonicalId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        batch_id: row.batch_id,
        issue_set_item_id: row.issue_set_item_id,
        created_at: row.created_at.toISOString(),
        canonical_id: row.canonical_id,
        issue_hash: row.issue_hash,
        owner: row.owner,
        repo: row.repo,
        github_issue_number: row.github_issue_number,
        github_issue_url: row.github_issue_url,
        action: row.action,
        status: row.status,
        error_message: row.error_message,
        error_details: row.error_details,
        lawbook_version: row.lawbook_version,
        rendered_issue_hash: row.rendered_issue_hash,
        labels_applied: row.labels_applied,
        request_id: row.request_id,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying publish items by canonical ID:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    };
  }
}
