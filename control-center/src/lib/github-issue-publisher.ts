/**
 * GitHub Issue Publisher Service
 * 
 * Publishes issue sets to GitHub with idempotency and full audit trail.
 * Issue E82.3: Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { createIssue, updateIssue } from './github';
import type { IssueDraft } from './schemas/issueDraft';
import {
  createPublishBatch,
  createPublishItem,
  generateBatchHash,
  type PublishBatch,
  type PublishItem,
} from './db/intentIssueSetPublishLedger';
import { getIssueSet, type IntentIssueSet, type IntentIssueSetItem } from './db/intentIssueSets';
import { insertAuditRecord } from './db/crGithubIssueAudit';
import { getActiveLawbook } from './db/lawbook';

/**
 * Result from publishing a single issue
 */
export interface PublishIssueResult {
  canonical_id: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  status: 'success' | 'failed';
  github_issue_number?: number;
  github_issue_url?: string;
  error_message?: string;
  error_details?: unknown;
  rendered_issue_hash?: string;
  labels_applied?: string[];
}

/**
 * Result from publishing an issue set
 */
export interface PublishIssueSetResult {
  batch_id: string;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  items: PublishIssueResult[];
  links: {
    batch_id: string;
    request_id: string;
  };
}

/**
 * Options for publishing an issue set
 */
export interface PublishIssueSetOptions {
  owner: string;
  repo: string;
  request_id: string;
  user_id: string;
}

/**
 * Resolve canonical ID to existing GitHub issue number
 * Returns null if no issue exists for this canonical ID
 */
async function resolveCanonicalId(
  pool: Pool,
  canonicalId: string,
  owner: string,
  repo: string
): Promise<number | null> {
  try {
    // Query the CR GitHub issue audit table for this canonical ID
    const result = await pool.query(
      `SELECT github_issue_number
       FROM cr_github_issue_audit
       WHERE canonical_id = $1 AND owner = $2 AND repo = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [canonicalId, owner, repo]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0].github_issue_number;
    }
    
    return null;
  } catch (error) {
    console.error('[PublishService] Error resolving canonical ID:', error);
    return null;
  }
}

/**
 * Render issue draft to GitHub issue format
 */
function renderIssueDraft(draft: IssueDraft): { title: string; body: string; labels: string[] } {
  const title = draft.title;
  const body = draft.description || '';
  const labels = draft.labels || [];
  
  return { title, body, labels };
}

/**
 * Compute hash of rendered issue content
 */
function computeRenderedHash(title: string, body: string, labels: string[]): string {
  const content = JSON.stringify({ title, body, labels: labels.sort() });
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Publish a single issue to GitHub
 */
async function publishSingleIssue(
  pool: Pool,
  item: IntentIssueSetItem,
  owner: string,
  repo: string,
  lawbookVersion: string
): Promise<PublishIssueResult> {
  try {
    const draft = item.issue_json as IssueDraft;
    const canonicalId = item.canonical_id;
    
    // Render the issue
    const { title, body, labels } = renderIssueDraft(draft);
    const renderedHash = computeRenderedHash(title, body, labels);
    
    // Resolve canonical ID to see if issue already exists
    const existingIssueNumber = await resolveCanonicalId(pool, canonicalId, owner, repo);
    
    if (existingIssueNumber) {
      // Issue exists - update it
      try {
        const updateResult = await updateIssue({
          number: existingIssueNumber,
          title,
          body,
          labels,
        });
        
        // Record in audit trail
        await insertAuditRecord(pool, {
          canonical_id: canonicalId,
          cr_hash: item.issue_hash,
          lawbook_version: lawbookVersion,
          owner,
          repo,
          issue_number: updateResult.number,
          action: 'update',
          rendered_issue_hash: renderedHash,
          result_json: {
            url: updateResult.html_url,
            labelsApplied: labels,
          },
        });
        
        return {
          canonical_id: canonicalId,
          action: 'updated',
          status: 'success',
          github_issue_number: updateResult.number,
          github_issue_url: updateResult.html_url,
          rendered_issue_hash: renderedHash,
          labels_applied: labels,
        };
      } catch (error) {
        return {
          canonical_id: canonicalId,
          action: 'failed',
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Update failed',
          error_details: error,
        };
      }
    } else {
      // Issue doesn't exist - create it
      try {
        const createResult = await createIssue({
          title,
          body,
          labels,
        });
        
        // Record in audit trail
        await insertAuditRecord(pool, {
          canonical_id: canonicalId,
          cr_hash: item.issue_hash,
          lawbook_version: lawbookVersion,
          owner,
          repo,
          issue_number: createResult.number,
          action: 'create',
          rendered_issue_hash: renderedHash,
          result_json: {
            url: createResult.html_url,
            labelsApplied: labels,
          },
        });
        
        return {
          canonical_id: canonicalId,
          action: 'created',
          status: 'success',
          github_issue_number: createResult.number,
          github_issue_url: createResult.html_url,
          rendered_issue_hash: renderedHash,
          labels_applied: labels,
        };
      } catch (error) {
        return {
          canonical_id: canonicalId,
          action: 'failed',
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Create failed',
          error_details: error,
        };
      }
    }
  } catch (error) {
    return {
      canonical_id: item.canonical_id,
      action: 'failed',
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error',
      error_details: error,
    };
  }
}

/**
 * Publish an issue set to GitHub
 * 
 * This is an idempotent operation:
 * - Duplicate executions will not create duplicate issues
 * - Each item is resolved by canonical ID
 * - Full audit trail is maintained
 * 
 * @param pool Database pool
 * @param sessionId Session ID
 * @param options Publishing options
 * @returns Publish result with summary and links
 */
export async function publishIssueSet(
  pool: Pool,
  sessionId: string,
  options: PublishIssueSetOptions
): Promise<{ success: true; data: PublishIssueSetResult } | { success: false; error: string }> {
  const { owner, repo, request_id, user_id } = options;
  
  try {
    // Get the issue set
    const issueSetResult = await getIssueSet(pool, sessionId, user_id);
    
    if (!issueSetResult.success) {
      return {
        success: false,
        error: issueSetResult.error,
      };
    }
    
    if (!issueSetResult.data) {
      return {
        success: false,
        error: 'No issue set found for this session',
      };
    }
    
    const issueSet = issueSetResult.data;
    const items = issueSetResult.items || [];
    
    // Check if issue set is committed
    if (!issueSet.is_committed) {
      return {
        success: false,
        error: 'Issue set must be committed before publishing',
      };
    }
    
    // Get active lawbook version
    const lawbookResult = await getActiveLawbook(pool);
    const lawbookVersion = lawbookResult.success && lawbookResult.data 
      ? lawbookResult.data.lawbook_version 
      : 'unknown';
    
    // Create publish batch
    const batchResult = await createPublishBatch(pool, {
      issue_set_id: issueSet.id,
      session_id: sessionId,
      request_id,
      lawbook_version,
      total_items: items.length,
      source_hash: issueSet.source_hash,
    });
    
    if (!batchResult.success) {
      return {
        success: false,
        error: `Failed to create publish batch: ${batchResult.error}`,
      };
    }
    
    const batch = batchResult.data;
    
    // Publish each item
    const publishResults: PublishIssueResult[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    
    for (const item of items) {
      const publishResult = await publishSingleIssue(
        pool,
        item,
        owner,
        repo,
        lawbookVersion
      );
      
      publishResults.push(publishResult);
      
      // Update counts
      if (publishResult.status === 'success') {
        if (publishResult.action === 'created') {
          createdCount++;
        } else if (publishResult.action === 'updated') {
          updatedCount++;
        } else if (publishResult.action === 'skipped') {
          skippedCount++;
        }
      } else {
        failedCount++;
      }
      
      // Record item in ledger
      await createPublishItem(pool, {
        batch_id: batch.id,
        issue_set_item_id: item.id,
        canonical_id: item.canonical_id,
        issue_hash: item.issue_hash,
        owner,
        repo,
        github_issue_number: publishResult.github_issue_number,
        github_issue_url: publishResult.github_issue_url,
        action: publishResult.action,
        status: publishResult.status,
        error_message: publishResult.error_message,
        error_details: publishResult.error_details,
        lawbook_version,
        rendered_issue_hash: publishResult.rendered_issue_hash,
        labels_applied: publishResult.labels_applied,
        request_id,
      });
    }
    
    return {
      success: true,
      data: {
        batch_id: batch.id,
        summary: {
          total: items.length,
          created: createdCount,
          updated: updatedCount,
          skipped: skippedCount,
          failed: failedCount,
        },
        items: publishResults,
        links: {
          batch_id: batch.id,
          request_id,
        },
      },
    };
  } catch (error) {
    console.error('[PublishService] Error publishing issue set:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
