/**
 * AFU-9 Issue Publish Orchestrator
 * 
 * Coordinates the complete publish flow for AFU-9 Issues:
 * Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence
 * 
 * This replaces the INTENT-specific publish path with a canonical AFU-9 Issue orchestration.
 */

import { Pool } from 'pg';
import crypto from 'crypto';
import { createIssue, updateIssue } from './github';
import { getAfu9IssueById, updateAfu9Issue, getAfu9IssueByGithubNumber } from './db/afu9Issues';
import { logTimelineEvent } from './db/issueTimeline';
import { recordEvidence } from './db/issueEvidence';
import { assignDefaultControlPack } from './db/controlPackAssignments';
import { IssueTimelineEventType } from './contracts/issueTimeline';
import { IssueEvidenceType } from './contracts/issueEvidence';
import { Afu9IssueStatus, Afu9HandoffState } from './contracts/afu9Issue';

/**
 * Publish options for AFU-9 Issue
 */
export interface PublishIssueOptions {
  owner: string;
  repo: string;
  request_id?: string;
  user_id?: string;
  labels?: string[];
}

/**
 * Publish result for AFU-9 Issue
 */
export interface PublishIssueResult {
  success: boolean;
  issue_id: string;
  public_id: string;
  github_issue_number?: number;
  github_url?: string;
  action?: 'created' | 'updated';
  error?: string;
  timeline_events?: string[];
  evidence_records?: string[];
  cp_assignments?: string[];
}

/**
 * Validate issue is ready for publishing
 * 
 * Checks:
 * - Issue exists
 * - Has active CR bound (required for publish)
 * - Not already published (or allows re-publish for updates)
 */
async function validateIssueForPublish(
  pool: Pool,
  issueId: string
): Promise<{ valid: boolean; error?: string; issue?: any }> {
  // Get issue
  const issueResult = await getAfu9IssueById(pool, issueId);
  
  if (!issueResult.success || !issueResult.data) {
    return {
      valid: false,
      error: `Issue not found: ${issueId}`,
    };
  }

  const issue = issueResult.data;

  // Check if issue has active CR bound
  if (!issue.active_cr_id) {
    return {
      valid: false,
      error: 'No active CR bound to issue. Please bind a Change Request before publishing.',
      issue,
    };
  }

  // Issue is valid for publish
  return {
    valid: true,
    issue,
  };
}

/**
 * Render issue for GitHub publication
 * 
 * Converts AFU-9 Issue to GitHub issue format
 */
function renderIssueForGithub(issue: any): { title: string; body: string; labels: string[] } {
  const title = issue.title;
  const body = issue.body || '';
  const labels = issue.labels || [];

  return { title, body, labels };
}

/**
 * Compute hash of rendered issue content (for idempotency)
 */
function computeRenderedHash(title: string, body: string, labels: string[]): string {
  const content = JSON.stringify({ title, body, labels: labels.sort() });
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Publish AFU-9 Issue to GitHub (orchestrated flow)
 * 
 * This is the canonical publish orchestrator for AFU-9 Issues.
 * It handles the complete lifecycle:
 * 
 * 1. Validate issue (CR binding, state checks)
 * 2. Render issue content
 * 3. Create or update GitHub issue (idempotent via github_issue_number)
 * 4. Update AFU-9 Issue mirror fields
 * 5. Log timeline events
 * 6. Record evidence
 * 7. Assign default Control Pack (if not already assigned)
 * 
 * Idempotency:
 * - Re-publishing updates the existing GitHub issue (no duplicates)
 * - Timeline/evidence are append-only (safe to re-run)
 * - CP assignment is idempotent (unique constraint on active assignments)
 * 
 * @param pool - PostgreSQL connection pool
 * @param issueId - AFU-9 Issue UUID
 * @param options - Publish options (owner, repo, request_id, etc.)
 * @returns Publish result with GitHub issue details and audit trail
 */
export async function publishAfu9Issue(
  pool: Pool,
  issueId: string,
  options: PublishIssueOptions
): Promise<PublishIssueResult> {
  const { owner, repo, request_id, user_id, labels: extraLabels } = options;
  
  const timelineEvents: string[] = [];
  const evidenceRecords: string[] = [];
  const cpAssignments: string[] = [];

  try {
    // Step 1: Validate issue for publish
    const validation = await validateIssueForPublish(pool, issueId);
    
    if (!validation.valid) {
      return {
        success: false,
        issue_id: issueId,
        public_id: issueId.substring(0, 8),
        error: validation.error || 'Validation failed',
      };
    }

    const issue = validation.issue;
    const publicId = issueId.substring(0, 8).toLowerCase();

    // Step 2: Update issue status to PUBLISHING
    await updateAfu9Issue(pool, issueId, {
      status: Afu9IssueStatus.PUBLISHING,
      publish_request_id: request_id || undefined,
    });

    // Log publishing started event
    const publishingStartedEvent = await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.PUBLISHING_STARTED,
      event_data: {
        owner,
        repo,
        request_id,
      },
      actor: user_id || 'system',
      actor_type: user_id ? 'user' : 'system',
    });

    if (publishingStartedEvent.success && publishingStartedEvent.data) {
      timelineEvents.push(publishingStartedEvent.data.id);
    }

    // Step 3: Render issue content
    const rendered = renderIssueForGithub(issue);
    const { title, body } = rendered;
    const labels = [...rendered.labels, ...(extraLabels || [])];
    const renderedHash = computeRenderedHash(title, body, labels);

    // Step 4: Create or update GitHub issue
    let githubAction: 'created' | 'updated';
    let githubIssueNumber: number;
    let githubUrl: string;

    try {
      if (issue.github_issue_number) {
        // Update existing GitHub issue
        const updateResult = await updateIssue({
          number: issue.github_issue_number,
          title,
          body,
          labels,
        });

        githubAction = 'updated';
        githubIssueNumber = updateResult.number;
        githubUrl = updateResult.html_url;
      } else {
        // Create new GitHub issue
        const createResult = await createIssue({
          title,
          body,
          labels,
        });

        githubAction = 'created';
        githubIssueNumber = createResult.number;
        githubUrl = createResult.html_url;
      }
    } catch (githubError) {
      // GitHub operation failed - update issue status and log error
      await updateAfu9Issue(pool, issueId, {
        status: Afu9IssueStatus.HOLD,
        handoff_state: Afu9HandoffState.FAILED,
        last_error: githubError instanceof Error ? githubError.message : 'GitHub operation failed',
      });

      // Log publish failed event
      await logTimelineEvent(pool, {
        issue_id: issueId,
        event_type: IssueTimelineEventType.PUBLISH_FAILED,
        event_data: {
          error: githubError instanceof Error ? githubError.message : 'Unknown error',
          owner,
          repo,
        },
        actor: 'system',
        actor_type: 'system',
      });

      return {
        success: false,
        issue_id: issueId,
        public_id: publicId,
        error: `GitHub publish failed: ${githubError instanceof Error ? githubError.message : 'Unknown error'}`,
        timeline_events: timelineEvents,
      };
    }

    // Step 5: Update AFU-9 Issue with GitHub mirror fields
    const now = new Date().toISOString();
    await updateAfu9Issue(pool, issueId, {
      status: Afu9IssueStatus.PUBLISHED,
      handoff_state: Afu9HandoffState.SYNCED,
      github_issue_number: githubIssueNumber,
      github_url: githubUrl,
      github_repo: `${owner}/${repo}`,
      github_synced_at: now,
      last_error: null, // Clear any previous errors
    });

    // Step 6: Log timeline events
    // Log PUBLISHED event
    const publishedEvent = await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.PUBLISHED,
      event_data: {
        github_issue_number: githubIssueNumber,
        github_url: githubUrl,
        action: githubAction,
        rendered_hash: renderedHash,
        owner,
        repo,
      },
      actor: user_id || 'system',
      actor_type: user_id ? 'user' : 'system',
    });

    if (publishedEvent.success && publishedEvent.data) {
      timelineEvents.push(publishedEvent.data.id);
    }

    // Log GITHUB_MIRRORED event
    const mirroredEvent = await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.GITHUB_MIRRORED,
      event_data: {
        github_issue_number: githubIssueNumber,
        github_url: githubUrl,
        synced_at: now,
      },
      actor: 'system',
      actor_type: 'system',
    });

    if (mirroredEvent.success && mirroredEvent.data) {
      timelineEvents.push(mirroredEvent.data.id);
    }

    // Step 7: Record evidence
    // Publish receipt
    const publishReceipt = await recordEvidence(pool, {
      issue_id: issueId,
      evidence_type: IssueEvidenceType.PUBLISH_RECEIPT,
      evidence_data: {
        batch_id: request_id || crypto.randomUUID(),
        github_issue_number: githubIssueNumber,
        github_url: githubUrl,
        repo: `${owner}/${repo}`,
        action: githubAction,
        published_at: now,
        rendered_hash: renderedHash,
        labels_applied: labels,
      },
      request_id: request_id || undefined,
    });

    if (publishReceipt.success && publishReceipt.data) {
      evidenceRecords.push(publishReceipt.data.id);
    }

    // GitHub mirror receipt
    const mirrorReceipt = await recordEvidence(pool, {
      issue_id: issueId,
      evidence_type: IssueEvidenceType.GITHUB_MIRROR_RECEIPT,
      evidence_data: {
        github_issue_number: githubIssueNumber,
        github_url: githubUrl,
        synced_at: now,
        batch_id: request_id,
        mirror_status: 'SYNCED',
      },
      request_id: request_id || undefined,
    });

    if (mirrorReceipt.success && mirrorReceipt.data) {
      evidenceRecords.push(mirrorReceipt.data.id);
    }

    // Step 8: Assign default Control Pack (idempotent)
    const cpResult = await assignDefaultControlPack(pool, issueId, user_id || 'system');
    
    if (cpResult.success && cpResult.data) {
      cpAssignments.push(cpResult.data.id);

      // Log CP assignment event
      const cpEvent = await logTimelineEvent(pool, {
        issue_id: issueId,
        event_type: IssueTimelineEventType.CP_ASSIGNED,
        event_data: {
          control_pack_id: cpResult.data.control_pack_id,
          control_pack_name: cpResult.data.control_pack_name,
          assigned_by: user_id || 'system',
        },
        actor: user_id || 'system',
        actor_type: 'system',
      });

      if (cpEvent.success && cpEvent.data) {
        timelineEvents.push(cpEvent.data.id);
      }
    }

    // Success!
    return {
      success: true,
      issue_id: issueId,
      public_id: publicId,
      github_issue_number: githubIssueNumber,
      github_url: githubUrl,
      action: githubAction,
      timeline_events: timelineEvents,
      evidence_records: evidenceRecords,
      cp_assignments: cpAssignments,
    };

  } catch (error) {
    console.error('[PublishOrchestrator] Publish failed:', {
      error: error instanceof Error ? error.message : String(error),
      issueId,
      owner,
      repo,
      timestamp: new Date().toISOString(),
    });

    // Log error event
    await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.ERROR_OCCURRED,
      event_data: {
        error: error instanceof Error ? error.message : 'Unknown error',
        operation: 'publish',
        owner,
        repo,
      },
      actor: 'system',
      actor_type: 'system',
    });

    return {
      success: false,
      issue_id: issueId,
      public_id: issueId.substring(0, 8),
      error: error instanceof Error ? error.message : 'Unknown error',
      timeline_events: timelineEvents,
      evidence_records: evidenceRecords,
      cp_assignments: cpAssignments,
    };
  }
}
