/**
 * GitHub Issue Batch Publisher for IssueDraft Versions (E89.6)
 * 
 * Idempotent batch publishing of IssueDraft versions to GitHub issues.
 * 
 * Key Features:
 * - Deterministic batch hash: stable order by canonicalId
 * - Bounded batch size: max 25 issues per call
 * - Idempotent: canonicalId resolver; update merges labels deterministically
 * - Guardrails: prod blocked by default, repo allowlist
 * - Audit ledger: batch summary + per-item record + hashes
 * 
 * NON-NEGOTIABLES:
 * - GitHub App server-to-server auth only
 * - Repo allowlist enforced
 * - Idempotency: same canonicalId → same issue (create or update)
 * - Determinism: stable title/body/labels
 * - Partial success: continue on individual failures, report all results
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { getIssueDraftVersion } from '../db/intentIssueDraftVersions';
import { publishIssueDraftBatch, type BatchPublishResult } from './issue-draft-publisher';
import { getActiveLawbook } from '../db/lawbook';
import type { IssueDraft } from '../schemas/issueDraft';

/**
 * Maximum batch size for publishing (bounded execution)
 */
export const MAX_BATCH_SIZE = 25;

/**
 * Input for publishing issue draft versions
 */
export interface PublishVersionBatchInput {
  /** Session ID */
  session_id: string;
  /** Version ID (single version) */
  version_id?: string;
  /** Issue set ID (multiple versions from a set) */
  issue_set_id?: string;
  /** GitHub repository owner */
  owner: string;
  /** GitHub repository name */
  repo: string;
  /** Request ID for tracing */
  request_id: string;
  /** User ID for authorization */
  user_id: string;
}

/**
 * Result from publishing issue draft versions
 */
export interface PublishVersionBatchResult {
  /** Batch ID for audit trail */
  batch_id: string;
  /** Summary statistics */
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  /** Individual results for each issue */
  items: Array<{
    canonical_id: string;
    action: 'created' | 'updated' | 'skipped' | 'failed';
    status: 'success' | 'failed';
    github_issue_number?: number;
    github_issue_url?: string;
    error_message?: string;
    rendered_issue_hash?: string;
    labels_applied?: string[];
  }>;
  /** Links for tracking */
  links: {
    batch_id: string;
    request_id: string;
  };
  /** Warnings (e.g., batch size clamped) */
  warnings?: string[];
}

/**
 * Generate deterministic batch hash for idempotency
 * Stable order by canonicalId ensures same input → same hash
 */
function generateBatchHash(
  sessionId: string,
  versionIds: string[],
  owner: string,
  repo: string
): string {
  // Sort version IDs for deterministic hash
  const sortedIds = [...versionIds].sort();
  const content = `${sessionId}:${sortedIds.join(',')}:${owner}:${repo}`;
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Load issue drafts from version ID(s)
 * Returns drafts sorted by canonicalId for deterministic ordering
 */
async function loadDraftsFromVersions(
  pool: Pool,
  versionIds: string[],
  userId?: string
): Promise<IssueDraft[]> {
  const drafts: IssueDraft[] = [];
  
  for (const versionId of versionIds) {
    const result = await getIssueDraftVersion(pool, versionId, userId);
    
    if (result.success && result.data) {
      const draft = result.data.issue_json as IssueDraft;
      drafts.push(draft);
    }
  }
  
  // Sort by canonicalId for deterministic ordering
  return drafts.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}

/**
 * Publish issue draft versions to GitHub as a batch
 * 
 * **Algorithm:**
 * 1. Load drafts from version ID(s)
 * 2. Sort by canonicalId for deterministic ordering
 * 3. Enforce batch size limit (max 25)
 * 4. Generate batch hash for idempotency
 * 5. Check if batch already published (by hash)
 *    - If yes: return existing results with 'skipped' status
 *    - If no: continue to publish
 * 6. Publish via existing batch publisher
 * 7. Record in audit ledger
 * 
 * **Idempotency:**
 * - Same input (version IDs, owner, repo) → same batch hash
 * - Second run with same hash returns all items as 'skipped'
 * - Delegate to issue-draft-publisher for canonicalId resolution
 * 
 * **Bounded Execution:**
 * - Max 25 issues per batch
 * - Warning returned if clamped
 * 
 * **Partial Success:**
 * - Continues on individual failures
 * - Reports all results (success + failure)
 * 
 * @param pool - Database pool
 * @param input - Publish input with version/set IDs
 * @returns Batch publish result with summary and links
 */
export async function publishIssueDraftVersionBatch(
  pool: Pool,
  input: PublishVersionBatchInput
): Promise<{ success: true; data: PublishVersionBatchResult } | { success: false; error: string }> {
  const { session_id, version_id, issue_set_id, owner, repo, request_id, user_id } = input;
  
  try {
    // Step 1: Determine version IDs to publish
    let versionIds: string[] = [];
    
    if (version_id) {
      // Single version
      versionIds = [version_id];
    } else if (issue_set_id) {
      // Multiple versions from issue set
      // Query all versions for this issue set, ordered by created_at DESC
      // No DISTINCT needed since v.id is a primary key
      const result = await pool.query(
        `SELECT v.id
         FROM intent_issue_draft_versions v
         JOIN intent_sessions s ON s.id = v.session_id
         WHERE v.session_id = $1 AND s.user_id = $2
         ORDER BY v.created_at DESC`,
        [session_id, user_id]
      );
      
      versionIds = result.rows.map(row => row.id);
    } else {
      return {
        success: false,
        error: 'Either version_id or issue_set_id is required',
      };
    }
    
    if (versionIds.length === 0) {
      return {
        success: false,
        error: 'No versions found to publish',
      };
    }
    
    // Step 2: Load drafts from versions (sorted by canonicalId)
    const drafts = await loadDraftsFromVersions(pool, versionIds, user_id);
    
    if (drafts.length === 0) {
      return {
        success: false,
        error: 'No valid drafts found in versions',
      };
    }
    
    // Step 3: Enforce batch size limit
    const warnings: string[] = [];
    let boundedDrafts = drafts;
    
    if (drafts.length > MAX_BATCH_SIZE) {
      warnings.push(
        `Batch size clamped from ${drafts.length} to ${MAX_BATCH_SIZE} issues. ` +
        `Remaining ${drafts.length - MAX_BATCH_SIZE} issues not published.`
      );
      boundedDrafts = drafts.slice(0, MAX_BATCH_SIZE);
    }
    
    // Step 4: Generate batch hash for idempotency
    const batchHash = generateBatchHash(session_id, versionIds, owner, repo);
    
    // Check if this batch has already been published (idempotency)
    const existingBatch = await pool.query(
      `SELECT batch_id, created_at, total_items, created_count, updated_count, skipped_count, failed_count
       FROM intent_issue_set_publish_batch_events
       WHERE batch_hash = $1 AND event_type = 'completed'
       ORDER BY created_at DESC
       LIMIT 1`,
      [batchHash]
    );
    
    if (existingBatch.rows.length > 0) {
      // Batch already published - return skipped result (idempotent)
      const existing = existingBatch.rows[0];
      
      // Query items for this batch
      const itemsQuery = await pool.query(
        `SELECT canonical_id, action, github_issue_number, github_issue_url,
                rendered_issue_hash, labels_applied, error_message
         FROM intent_issue_set_publish_item_events
         WHERE batch_id = $1 AND event_type = 'succeeded'
         ORDER BY created_at ASC`,
        [existing.batch_id]
      );
      
      const items = itemsQuery.rows.map(row => ({
        canonical_id: row.canonical_id,
        action: 'skipped' as const,
        status: 'success' as const,
        github_issue_number: row.github_issue_number,
        github_issue_url: row.github_issue_url,
        rendered_issue_hash: row.rendered_issue_hash,
        labels_applied: row.labels_applied,
      }));
      
      return {
        success: true,
        data: {
          batch_id: existing.batch_id,
          summary: {
            total: existing.total_items,
            created: 0,
            updated: 0,
            skipped: existing.total_items,
            failed: 0,
          },
          items,
          links: {
            batch_id: existing.batch_id,
            request_id,
          },
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    }
    
    // New batch - generate ID and publish
    const batchId = crypto.randomUUID();
    
    // Get active lawbook version
    const lawbookResult = await getActiveLawbook(pool);
    const lawbookVersion = lawbookResult.success && lawbookResult.data 
      ? lawbookResult.data.lawbook_version 
      : 'unknown';
    
    // Step 5: Publish via existing batch publisher
    const publishResult = await publishIssueDraftBatch(boundedDrafts, owner, repo);
    
    // Step 6: Map results to output format
    const items = publishResult.results.map(r => ({
      canonical_id: r.canonicalId,
      action: (r.success 
        ? (r.mode === 'created' ? 'created' : 'updated')
        : 'failed') as 'created' | 'updated' | 'skipped' | 'failed',
      status: (r.success ? 'success' : 'failed') as 'success' | 'failed',
      github_issue_number: r.issueNumber,
      github_issue_url: r.url,
      error_message: r.error,
      rendered_issue_hash: r.renderedHash,
      labels_applied: r.labelsApplied,
    }));
    
    // Step 7: Record in audit ledger
    await pool.query(
      `INSERT INTO intent_issue_set_publish_batch_events (
        batch_id, issue_set_id, session_id, event_type, request_id,
        lawbook_version, total_items, created_count, updated_count,
        skipped_count, failed_count, batch_hash, owner, repo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        batchId,
        issue_set_id || session_id, // Use session_id as fallback
        session_id,
        'completed',
        request_id,
        lawbookVersion,
        publishResult.total,
        items.filter(i => i.action === 'created').length,
        items.filter(i => i.action === 'updated').length,
        0, // skipped count
        publishResult.failed,
        batchHash,
        owner,
        repo,
      ]
    );
    
    return {
      success: true,
      data: {
        batch_id: batchId,
        summary: {
          total: publishResult.total,
          created: items.filter(i => i.action === 'created').length,
          updated: items.filter(i => i.action === 'updated').length,
          skipped: 0,
          failed: publishResult.failed,
        },
        items,
        links: {
          batch_id: batchId,
          request_id,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    };
  } catch (error) {
    console.error('[PublishVersionService] Error publishing version batch:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
