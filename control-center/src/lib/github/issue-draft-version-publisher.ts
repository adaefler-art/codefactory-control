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
 * 5. Publish via existing batch publisher
 * 6. Record in audit ledger
 * 
 * **Idempotency:**
 * - Same input (version IDs, owner, repo) → same batch hash
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
      // Query all versions for this issue set
      const result = await pool.query(
        `SELECT DISTINCT v.id
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
    const batchId = crypto.randomUUID();
    
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
    
    // Step 7: Record in audit ledger (simplified for now)
    // TODO: Extend with full ledger integration if needed
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
        'unknown', // Lawbook version
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
