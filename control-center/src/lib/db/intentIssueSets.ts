/**
 * Database Access Layer: INTENT Issue Sets
 * 
 * Provides functions for managing issue sets per INTENT session.
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 */

import { Pool } from 'pg';
import { validateIssueDraft } from '../validators/issueDraftValidator';
import type { IssueDraft } from '../schemas/issueDraft';
import type { IssueSet, IssueSetItem } from '../schemas/issueSet';
import { generateBriefingHash } from '../schemas/issueSet';
import { ensureIssueForCommittedDraft, getPublicId } from './afu9Issues';
import type { Afu9IssueRow } from '../contracts/afu9Issue';

export interface IntentIssueSet {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  source_hash: string;
  briefing_text: string | null;
  constraints_json: Record<string, unknown> | null;
  generated_at: string;
  is_committed: boolean;
  committed_at: string | null;
}

export interface IntentIssueSetItem {
  id: string;
  issue_set_id: string;
  created_at: string;
  issue_json: unknown;
  issue_hash: string;
  canonical_id: string;
  last_validation_status: 'unknown' | 'valid' | 'invalid';
  last_validation_at: string | null;
  last_validation_result: any;
  position: number;
}

/**
 * Extended commit result with created AFU-9 Issues
 */
export interface CommitResult {
  issueSet: IntentIssueSet;
  createdIssues: Array<{
    itemId: string;
    canonicalId: string;
    issueId: string;
    publicId: string;
    state: string;
    isNew: boolean;
  }>;
}

/**
 * Get the current issue set for a session
 * Only returns set if session belongs to the specified user
 */
export async function getIssueSet(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: IntentIssueSet | null; items?: IntentIssueSetItem[] } | { success: false; error: string }> {
  try {
    // First verify session ownership
    const sessionCheck = await pool.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }
    
    // Get the issue set
    const result = await pool.query(
      `SELECT id, session_id, created_at, updated_at, source_hash,
              briefing_text, constraints_json, generated_at, is_committed, committed_at
       FROM intent_issue_sets
       WHERE session_id = $1`,
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      return {
        success: true,
        data: null,
      };
    }
    
    const row = result.rows[0];
    const issueSet: IntentIssueSet = {
      id: row.id,
      session_id: row.session_id,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      source_hash: row.source_hash,
      briefing_text: row.briefing_text,
      constraints_json: row.constraints_json,
      generated_at: row.generated_at.toISOString(),
      is_committed: row.is_committed,
      committed_at: row.committed_at?.toISOString() || null,
    };

    // Get items for this set, ordered by position
    const itemsResult = await pool.query(
      `SELECT id, issue_set_id, created_at, issue_json, issue_hash, canonical_id,
              last_validation_status, last_validation_at, last_validation_result, position
       FROM intent_issue_set_items
       WHERE issue_set_id = $1
       ORDER BY position ASC`,
      [issueSet.id]
    );

    const items: IntentIssueSetItem[] = itemsResult.rows.map(item => ({
      id: item.id,
      issue_set_id: item.issue_set_id,
      created_at: item.created_at.toISOString(),
      issue_json: item.issue_json,
      issue_hash: item.issue_hash,
      canonical_id: item.canonical_id,
      last_validation_status: item.last_validation_status,
      last_validation_at: item.last_validation_at?.toISOString() || null,
      last_validation_result: item.last_validation_result,
      position: item.position,
    }));
    
    return {
      success: true,
      data: issueSet,
      items,
    };
  } catch (error) {
    console.error('[DB] Error getting issue set:', error);
    return {
      success: false,
      error: 'Database error',
    };
  }
}

/**
 * Generate and save an issue set for a session (replaces existing)
 * 
 * @param pool - Database pool
 * @param sessionId - Session ID
 * @param userId - User ID
 * @param briefingText - The briefing text
 * @param issueDrafts - Array of issue drafts to include in set
 * @param constraints - Optional constraints
 * @returns The saved issue set with items
 */
export async function generateIssueSet(
  pool: Pool,
  sessionId: string,
  userId: string,
  briefingText: string,
  issueDrafts: IssueDraft[],
  constraints?: Record<string, unknown>
): Promise<{ success: true; data: IntentIssueSet; items: IntentIssueSetItem[] } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // First verify session ownership
    const sessionCheck = await client.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }

    // Validate bounded size
    if (issueDrafts.length > 20) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Issue set exceeds maximum size of 20 items',
      };
    }

    // Generate source hash
    const sourceHash = await generateBriefingHash(briefingText, constraints);

    // Delete existing issue set and items for this session (cascades)
    await client.query(
      `DELETE FROM intent_issue_sets WHERE session_id = $1`,
      [sessionId]
    );

    // Create new issue set
    const setResult = await client.query(
      `INSERT INTO intent_issue_sets (
        session_id, source_hash, briefing_text, constraints_json, generated_at
      )
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, session_id, created_at, updated_at, source_hash,
                 briefing_text, constraints_json, generated_at, is_committed, committed_at`,
      [sessionId, sourceHash, briefingText, JSON.stringify(constraints || {})]
    );

    const setRow = setResult.rows[0];
    const issueSet: IntentIssueSet = {
      id: setRow.id,
      session_id: setRow.session_id,
      created_at: setRow.created_at.toISOString(),
      updated_at: setRow.updated_at.toISOString(),
      source_hash: setRow.source_hash,
      briefing_text: setRow.briefing_text,
      constraints_json: setRow.constraints_json,
      generated_at: setRow.generated_at.toISOString(),
      is_committed: setRow.is_committed,
      committed_at: setRow.committed_at?.toISOString() || null,
    };

    // Sort drafts by canonicalId for stable ordering
    const sortedDrafts = [...issueDrafts].sort((a, b) => 
      a.canonicalId.localeCompare(b.canonicalId)
    );

    // Create items
    const items: IntentIssueSetItem[] = [];
    for (let i = 0; i < sortedDrafts.length; i++) {
      const draft = sortedDrafts[i];
      
      // Validate the draft
      const validation = validateIssueDraft(draft);
      const validationStatus = validation.isValid ? 'valid' : 'invalid';

      // Compute hash
      const crypto = await import('crypto');
      const canonical = JSON.stringify(draft);
      const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

      const itemResult = await client.query(
        `INSERT INTO intent_issue_set_items (
          issue_set_id, issue_json, issue_hash, canonical_id,
          last_validation_status, last_validation_at, last_validation_result, position
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, issue_set_id, created_at, issue_json, issue_hash, canonical_id,
                   last_validation_status, last_validation_at, last_validation_result, position`,
        [
          issueSet.id,
          JSON.stringify(draft),
          hash,
          draft.canonicalId,
          validationStatus,
          new Date(),
          JSON.stringify(validation),
          i,
        ]
      );

      const itemRow = itemResult.rows[0];
      items.push({
        id: itemRow.id,
        issue_set_id: itemRow.issue_set_id,
        created_at: itemRow.created_at.toISOString(),
        issue_json: itemRow.issue_json,
        issue_hash: itemRow.issue_hash,
        canonical_id: itemRow.canonical_id,
        last_validation_status: itemRow.last_validation_status,
        last_validation_at: itemRow.last_validation_at?.toISOString() || null,
        last_validation_result: itemRow.last_validation_result,
        position: itemRow.position,
      });
    }

    await client.query('COMMIT');

    return {
      success: true,
      data: issueSet,
      items,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error generating issue set:', error);
    return {
      success: false,
      error: 'Database error',
    };
  } finally {
    client.release();
  }
}

/**
 * Commit an issue set (mark as immutable)
 * Only commits if all items are valid
 * AFU9-I-P1.4: Creates canonical AFU-9 Issues for each item on commit
 */
export async function commitIssueSet(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; data: CommitResult } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // First verify session ownership
    const sessionCheck = await client.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }

    // Get the issue set
    const setResult = await client.query(
      `SELECT id, is_committed FROM intent_issue_sets WHERE session_id = $1`,
      [sessionId]
    );

    if (setResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'No issue set exists for this session',
      };
    }

    const setRow = setResult.rows[0];

    if (setRow.is_committed) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Issue set is already committed',
      };
    }

    // Check if all items are valid
    const itemsResult = await client.query(
      `SELECT COUNT(*) as total, 
              SUM(CASE WHEN last_validation_status = 'valid' THEN 1 ELSE 0 END) as valid_count
       FROM intent_issue_set_items
       WHERE issue_set_id = $1`,
      [setRow.id]
    );

    const { total, valid_count } = itemsResult.rows[0];

    if (parseInt(total) !== parseInt(valid_count)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Cannot commit: not all items are valid',
      };
    }

    // Mark as committed
    const updateResult = await client.query(
      `UPDATE intent_issue_sets
       SET is_committed = TRUE, committed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, session_id, created_at, updated_at, source_hash,
                 briefing_text, constraints_json, generated_at, is_committed, committed_at`,
      [setRow.id]
    );

    // Get all items to create AFU-9 Issues
    const itemsResult = await client.query(
      `SELECT id, issue_json, canonical_id FROM intent_issue_set_items WHERE issue_set_id = $1 ORDER BY position ASC`,
      [setRow.id]
    );

    const createdIssues: CommitResult['createdIssues'] = [];

    // Create AFU-9 Issue for each item (idempotent)
    for (const item of itemsResult.rows) {
      const issueDraft = item.issue_json as IssueDraft;
      
      // Map IssueDraft to AFU-9 Issue input
      // Note: source field is always 'afu9' and is set by ensureIssueForCommittedDraft
      const issueInput = {
        title: issueDraft.title,
        body: issueDraft.body,
        labels: issueDraft.labels || [],
        priority: issueDraft.priority,
        canonical_id: item.canonical_id,
        kpi_context: issueDraft.kpi ? {
          dcu: issueDraft.kpi.dcu,
          intent: issueDraft.kpi.intent,
        } : null,
      };

      // Ensure AFU-9 Issue exists (idempotent)
      const ensureResult = await ensureIssueForCommittedDraft(
        pool,
        issueInput,
        sessionId,
        item.id // Use item ID as draft version reference
      );

      if (ensureResult.success && ensureResult.data) {
        const { issue, isNew } = ensureResult.data;
        createdIssues.push({
          itemId: item.id,
          canonicalId: item.canonical_id,
          issueId: issue.id,
          publicId: getPublicId(issue.id),
          state: issue.status,
          isNew,
        });
      } else {
        // Log error but continue (fail-soft for individual items)
        console.error('[DB] Failed to create AFU-9 Issue for item:', {
          itemId: item.id,
          canonicalId: item.canonical_id,
          error: ensureResult.error,
        });
      }
    }

    await client.query('COMMIT');

    const updated = updateResult.rows[0];
    return {
      success: true,
      data: {
        issueSet: {
          id: updated.id,
          session_id: updated.session_id,
          created_at: updated.created_at.toISOString(),
          updated_at: updated.updated_at.toISOString(),
          source_hash: updated.source_hash,
          briefing_text: updated.briefing_text,
          constraints_json: updated.constraints_json,
          generated_at: updated.generated_at.toISOString(),
          is_committed: updated.is_committed,
          committed_at: updated.committed_at?.toISOString() || null,
        },
        createdIssues,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error committing issue set:', error);
    return {
      success: false,
      error: 'Database error',
    };
  } finally {
    client.release();
  }
}

/**
 * Bulk validate all items in an issue set
 * Updates validation status for each item
 */
export async function validateIssueSetItems(
  pool: Pool,
  sessionId: string,
  userId: string
): Promise<{ success: true; validCount: number; invalidCount: number } | { success: false; error: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // First verify session ownership
    const sessionCheck = await client.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Session not found or access denied',
      };
    }

    // Get the issue set
    const setResult = await client.query(
      `SELECT id FROM intent_issue_sets WHERE session_id = $1`,
      [sessionId]
    );

    if (setResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'No issue set exists for this session',
      };
    }

    const setId = setResult.rows[0].id;

    // Get all items
    const itemsResult = await client.query(
      `SELECT id, issue_json FROM intent_issue_set_items WHERE issue_set_id = $1`,
      [setId]
    );

    let validCount = 0;
    let invalidCount = 0;

    // Validate each item
    for (const item of itemsResult.rows) {
      const validation = validateIssueDraft(item.issue_json);
      const validationStatus = validation.isValid ? 'valid' : 'invalid';
      
      if (validation.isValid) {
        validCount++;
      } else {
        invalidCount++;
      }

      await client.query(
        `UPDATE intent_issue_set_items
         SET last_validation_status = $1,
             last_validation_at = NOW(),
             last_validation_result = $2
         WHERE id = $3`,
        [validationStatus, JSON.stringify(validation), item.id]
      );
    }

    await client.query('COMMIT');

    return {
      success: true,
      validCount,
      invalidCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Error validating issue set items:', error);
    return {
      success: false,
      error: 'Database error',
    };
  } finally {
    client.release();
  }
}
