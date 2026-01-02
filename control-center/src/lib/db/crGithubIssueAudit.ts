/**
 * Database Access Layer: CR GitHub Issue Audit Trail
 * 
 * Provides functions for writing and querying the append-only audit trail
 * of CR → GitHub Issue generation operations.
 * Issue E75.4: Audit Trail (CR↔Issue mapping, hashes, timestamps, lawbookVersion)
 */

import { Pool } from 'pg';

/**
 * Audit record structure
 */
export interface CrGithubIssueAuditRecord {
  id: string;
  canonical_id: string;
  session_id: string | null;
  cr_version_id: string | null;
  cr_hash: string;
  lawbook_version: string | null;
  owner: string;
  repo: string;
  issue_number: number;
  action: 'create' | 'update';
  rendered_issue_hash: string;
  used_sources_hash: string | null;
  created_at: string;
  result_json: unknown;
}

/**
 * Input for inserting an audit record
 */
export interface InsertAuditRecordInput {
  canonical_id: string;
  session_id?: string | null;
  cr_version_id?: string | null;
  cr_hash: string;
  lawbook_version?: string | null;
  owner: string;
  repo: string;
  issue_number: number;
  action: 'create' | 'update';
  rendered_issue_hash: string;
  used_sources_hash?: string | null;
  result_json: {
    url: string;
    labelsApplied: string[];
    warnings?: string[];
  };
}

/**
 * Insert an audit record
 * 
 * This function is designed to be fail-safe: errors are logged but not thrown,
 * so audit failures don't block the main operation.
 * 
 * @param pool Database pool
 * @param input Audit record data
 * @returns Success with record ID, or error
 */
export async function insertAuditRecord(
  pool: Pool,
  input: InsertAuditRecordInput
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  try {
    const result = await pool.query(
      `INSERT INTO cr_github_issue_audit (
        canonical_id,
        session_id,
        cr_version_id,
        cr_hash,
        lawbook_version,
        owner,
        repo,
        issue_number,
        action,
        rendered_issue_hash,
        used_sources_hash,
        result_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        input.canonical_id,
        input.session_id || null,
        input.cr_version_id || null,
        input.cr_hash,
        input.lawbook_version || null,
        input.owner,
        input.repo,
        input.issue_number,
        input.action,
        input.rendered_issue_hash,
        input.used_sources_hash || null,
        JSON.stringify(input.result_json),
      ]
    );
    
    return {
      success: true,
      id: result.rows[0].id,
    };
  } catch (error) {
    console.error('[DB] Error inserting audit record:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query audit records by canonical ID
 * 
 * Returns all audit records for a given canonical ID, ordered by created_at DESC.
 * 
 * @param pool Database pool
 * @param canonicalId CR canonical ID
 * @param options Optional pagination
 * @returns List of audit records
 */
export async function queryCrGithubIssueAudit(
  pool: Pool,
  canonicalId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ success: true; data: CrGithubIssueAuditRecord[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    const result = await pool.query(
      `SELECT 
        id,
        canonical_id,
        session_id,
        cr_version_id,
        cr_hash,
        lawbook_version,
        owner,
        repo,
        issue_number,
        action,
        rendered_issue_hash,
        used_sources_hash,
        created_at,
        result_json
      FROM cr_github_issue_audit
      WHERE canonical_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
      [canonicalId, limit, offset]
    );
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        canonical_id: row.canonical_id,
        session_id: row.session_id,
        cr_version_id: row.cr_version_id,
        cr_hash: row.cr_hash,
        lawbook_version: row.lawbook_version,
        owner: row.owner,
        repo: row.repo,
        issue_number: row.issue_number,
        action: row.action,
        rendered_issue_hash: row.rendered_issue_hash,
        used_sources_hash: row.used_sources_hash,
        created_at: row.created_at.toISOString(),
        result_json: row.result_json,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying audit records:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query audit records by canonical ID with cursor-based pagination
 * 
 * Returns records ordered by created_at DESC, id DESC for deterministic ordering.
 * 
 * @param pool Database pool
 * @param canonicalId CR canonical ID
 * @param options Pagination options with cursor
 * @returns List of audit records
 */
export async function queryCrGithubIssueAuditWithCursor(
  pool: Pool,
  canonicalId: string,
  options?: {
    limit?: number;
    before?: string; // Format: "timestamp:id"
  }
): Promise<{ success: true; data: CrGithubIssueAuditRecord[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 51; // Fetch one extra to determine hasMore
    
    let query: string;
    let params: any[];
    
    if (options?.before) {
      // Parse cursor: "timestamp:id"
      const [beforeTimestamp, beforeId] = options.before.split(':');
      
      query = `
        SELECT 
          id,
          canonical_id,
          session_id,
          cr_version_id,
          cr_hash,
          lawbook_version,
          owner,
          repo,
          issue_number,
          action,
          rendered_issue_hash,
          used_sources_hash,
          created_at,
          result_json
        FROM cr_github_issue_audit
        WHERE canonical_id = $1 
          AND (created_at, id) < ($2, $3)
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `;
      params = [canonicalId, beforeTimestamp, beforeId, limit];
    } else {
      query = `
        SELECT 
          id,
          canonical_id,
          session_id,
          cr_version_id,
          cr_hash,
          lawbook_version,
          owner,
          repo,
          issue_number,
          action,
          rendered_issue_hash,
          used_sources_hash,
          created_at,
          result_json
        FROM cr_github_issue_audit
        WHERE canonical_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `;
      params = [canonicalId, limit];
    }
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        canonical_id: row.canonical_id,
        session_id: row.session_id,
        cr_version_id: row.cr_version_id,
        cr_hash: row.cr_hash,
        lawbook_version: row.lawbook_version,
        owner: row.owner,
        repo: row.repo,
        issue_number: row.issue_number,
        action: row.action,
        rendered_issue_hash: row.rendered_issue_hash,
        used_sources_hash: row.used_sources_hash,
        created_at: row.created_at.toISOString(),
        result_json: row.result_json,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying audit records with cursor:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Query audit records by owner/repo/issue_number with cursor-based pagination
 * 
 * Returns records ordered by created_at DESC, id DESC for deterministic ordering.
 * 
 * @param pool Database pool
 * @param owner GitHub repo owner
 * @param repo GitHub repo name
 * @param issueNumber GitHub issue number
 * @param options Pagination options with cursor
 * @returns List of audit records
 */
export async function queryByIssueWithCursor(
  pool: Pool,
  owner: string,
  repo: string,
  issueNumber: number,
  options?: {
    limit?: number;
    before?: string; // Format: "timestamp:id"
  }
): Promise<{ success: true; data: CrGithubIssueAuditRecord[] } | { success: false; error: string }> {
  try {
    const limit = options?.limit || 51; // Fetch one extra to determine hasMore
    
    let query: string;
    let params: any[];
    
    if (options?.before) {
      // Parse cursor: "timestamp:id"
      const [beforeTimestamp, beforeId] = options.before.split(':');
      
      query = `
        SELECT 
          id,
          canonical_id,
          session_id,
          cr_version_id,
          cr_hash,
          lawbook_version,
          owner,
          repo,
          issue_number,
          action,
          rendered_issue_hash,
          used_sources_hash,
          created_at,
          result_json
        FROM cr_github_issue_audit
        WHERE owner = $1 AND repo = $2 AND issue_number = $3
          AND (created_at, id) < ($4, $5)
        ORDER BY created_at DESC, id DESC
        LIMIT $6
      `;
      params = [owner, repo, issueNumber, beforeTimestamp, beforeId, limit];
    } else {
      query = `
        SELECT 
          id,
          canonical_id,
          session_id,
          cr_version_id,
          cr_hash,
          lawbook_version,
          owner,
          repo,
          issue_number,
          action,
          rendered_issue_hash,
          used_sources_hash,
          created_at,
          result_json
        FROM cr_github_issue_audit
        WHERE owner = $1 AND repo = $2 AND issue_number = $3
        ORDER BY created_at DESC, id DESC
        LIMIT $4
      `;
      params = [owner, repo, issueNumber, limit];
    }
    
    const result = await pool.query(query, params);
    
    return {
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        canonical_id: row.canonical_id,
        session_id: row.session_id,
        cr_version_id: row.cr_version_id,
        cr_hash: row.cr_hash,
        lawbook_version: row.lawbook_version,
        owner: row.owner,
        repo: row.repo,
        issue_number: row.issue_number,
        action: row.action,
        rendered_issue_hash: row.rendered_issue_hash,
        used_sources_hash: row.used_sources_hash,
        created_at: row.created_at.toISOString(),
        result_json: row.result_json,
      })),
    };
  } catch (error) {
    console.error('[DB] Error querying audit records by issue with cursor:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
