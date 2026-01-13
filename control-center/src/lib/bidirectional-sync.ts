/**
 * Bi-directional Sync Engine
 * E85.2: AFU-9 ↔ GitHub Bi-directional Sync
 * 
 * Deterministic, idempotent bi-directional synchronization between AFU-9 and GitHub.
 * 
 * Features:
 * - Pull-based sync (no webhook dependency)
 * - Event hashing for idempotency
 * - State machine validation
 * - Conflict detection and marking
 * - Dry-run mode
 * - Fail-closed error handling
 * - Evidence-based transitions
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { Afu9IssueStatus } from './contracts/afu9Issue';
import {
  SyncEventType,
  SyncDirection,
  SyncConflictType,
  EvidenceType,
} from './contracts/sync-audit';
import { recordSyncAuditEvent, createSyncConflict } from './db/syncAudit';
import { getAfu9IssueById, updateAfu9Issue } from './db/afu9Issues';
import {
  loadStateMachineSpec,
  isTransitionAllowed,
  getTransition,
  checkPreconditions,
  mapGitHubStatusToAfu9 as mapGitHubStatusToAfu9Spec,
  getGitHubLabelsForStatus,
  StateMachineSpec,
} from './state-machine/loader';

/**
 * GitHub PR data for sync
 */
export interface GitHubPRData {
  number: number;
  state: 'open' | 'closed';
  merged: boolean;
  mergeable_state: string;
  labels: Array<{ name: string }>;
  reviews: Array<{
    state: string;
    submitted_at: string;
  }>;
  checks: {
    total_count: number;
    check_runs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
    }>;
  };
}

/**
 * Sync options
 */
export interface SyncOptions {
  dryRun?: boolean;
  allowManualOverride?: boolean;
  syncRunId?: string;
  createdBy?: string;
}

/**
 * Sync result
 */
export interface SyncResult {
  success: boolean;
  issueId: string;
  oldStatus: Afu9IssueStatus;
  newStatus: Afu9IssueStatus;
  statusChanged: boolean;
  transitionAllowed: boolean | null;
  conflictDetected: boolean;
  conflictReason?: string;
  auditEventId?: string | null;
  error?: string;
}

/**
 * Bi-directional Sync Engine
 */
export class BidirectionalSyncEngine {
  private pool: Pool;
  private octokit: Octokit;
  private spec: StateMachineSpec;

  constructor(pool: Pool, octokit: Octokit) {
    this.pool = pool;
    this.octokit = octokit;
    this.spec = loadStateMachineSpec();
  }

  /**
   * Sync GitHub status to AFU-9
   * GitHub → AFU-9 direction
   * 
   * @param issueId - AFU-9 issue UUID
   * @param owner - GitHub repository owner
   * @param repo - GitHub repository name
   * @param issueNumber - GitHub issue number
   * @param options - Sync options
   * @returns Sync result
   */
  async syncGitHubToAfu9(
    issueId: string,
    owner: string,
    repo: string,
    issueNumber: number,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    try {
      // Get current AFU-9 issue
      const issueResult = await getAfu9IssueById(this.pool, issueId);
      if (!issueResult.success || !issueResult.data) {
        return {
          success: false,
          issueId,
          oldStatus: Afu9IssueStatus.CREATED,
          newStatus: Afu9IssueStatus.CREATED,
          statusChanged: false,
          transitionAllowed: null,
          conflictDetected: false,
          error: issueResult.error || 'Issue not found',
        };
      }

      const currentIssue = issueResult.data;
      const oldStatus = currentIssue.status;

      // Fetch GitHub issue and PR data
      const githubData = await this.fetchGitHubData(owner, repo, issueNumber);

      // Determine new status from GitHub
      const newStatus = this.determineStatusFromGitHub(githubData, currentIssue.status_source);

      // If no status change, just update sync timestamp
      if (!newStatus || newStatus === oldStatus) {
        await this.recordSyncEvent({
          eventType: SyncEventType.GITHUB_TO_AFU9_PR_STATUS,
          issueId,
          owner,
          repo,
          issueNumber,
          syncDirection: SyncDirection.GITHUB_TO_AFU9,
          oldStatus,
          newStatus: oldStatus,
          transitionAllowed: true,
          githubData,
          dryRun: options.dryRun || false,
          conflictDetected: false,
          syncRunId: options.syncRunId,
          createdBy: options.createdBy,
        });

        return {
          success: true,
          issueId,
          oldStatus,
          newStatus: oldStatus,
          statusChanged: false,
          transitionAllowed: true,
          conflictDetected: false,
        };
      }

      // Validate transition is allowed
      const transitionAllowed = isTransitionAllowed(this.spec, oldStatus, newStatus);

      // If transition not allowed, create conflict
      if (!transitionAllowed) {
        const conflict = await this.handleConflict({
          issueId,
          owner,
          repo,
          issueNumber,
          conflictType: SyncConflictType.TRANSITION_NOT_ALLOWED,
          afu9Status: oldStatus,
          githubData,
          description: `Transition from ${oldStatus} to ${newStatus} not allowed by state machine spec`,
          options,
        });

        return {
          success: true,
          issueId,
          oldStatus,
          newStatus: oldStatus,
          statusChanged: false,
          transitionAllowed: false,
          conflictDetected: true,
          conflictReason: conflict.description,
        };
      }

      // Get transition definition
      const transition = getTransition(this.spec, oldStatus, newStatus);
      if (!transition) {
        const conflict = await this.handleConflict({
          issueId,
          owner,
          repo,
          issueNumber,
          conflictType: SyncConflictType.TRANSITION_NOT_ALLOWED,
          afu9Status: oldStatus,
          githubData,
          description: `No transition definition found for ${oldStatus} → ${newStatus}`,
          options,
        });

        return {
          success: true,
          issueId,
          oldStatus,
          newStatus: oldStatus,
          statusChanged: false,
          transitionAllowed: false,
          conflictDetected: true,
          conflictReason: conflict.description,
        };
      }

      // Check preconditions
      const evidence = this.extractEvidenceFromGitHub(githubData);
      const preconditionsResult = checkPreconditions(transition, evidence);

      if (!preconditionsResult.met) {
        const conflict = await this.handleConflict({
          issueId,
          owner,
          repo,
          issueNumber,
          conflictType: SyncConflictType.PRECONDITION_FAILED,
          afu9Status: oldStatus,
          githubData,
          description: `Preconditions not met for ${oldStatus} → ${newStatus}: ${preconditionsResult.missing.join(', ')}`,
          options,
        });

        return {
          success: true,
          issueId,
          oldStatus,
          newStatus: oldStatus,
          statusChanged: false,
          transitionAllowed: false,
          conflictDetected: true,
          conflictReason: conflict.description,
        };
      }

      // Update AFU-9 status (if not dry-run)
      if (!options.dryRun) {
        const updateResult = await updateAfu9Issue(this.pool, issueId, {
          status: newStatus,
          github_status_raw: this.getGitHubStatusRaw(githubData),
          github_status_updated_at: new Date().toISOString(),
          status_source: this.getStatusSource(githubData),
        });

        if (!updateResult.success) {
          return {
            success: false,
            issueId,
            oldStatus,
            newStatus,
            statusChanged: false,
            transitionAllowed: true,
            conflictDetected: false,
            error: updateResult.error || 'Failed to update issue',
          };
        }
      }

      // Record sync event
      const auditResult = await this.recordSyncEvent({
        eventType: SyncEventType.GITHUB_TO_AFU9_PR_STATUS,
        issueId,
        owner,
        repo,
        issueNumber,
        syncDirection: SyncDirection.GITHUB_TO_AFU9,
        oldStatus,
        newStatus,
        transitionAllowed: true,
        githubData,
        evidenceType: this.determineEvidenceType(githubData),
        dryRun: options.dryRun || false,
        conflictDetected: false,
        syncRunId: options.syncRunId,
        createdBy: options.createdBy,
      });

      return {
        success: true,
        issueId,
        oldStatus,
        newStatus,
        statusChanged: true,
        transitionAllowed: true,
        conflictDetected: false,
        auditEventId: auditResult.data,
      };
    } catch (error) {
      console.error('[syncGitHubToAfu9] Error:', error);
      return {
        success: false,
        issueId,
        oldStatus: Afu9IssueStatus.CREATED,
        newStatus: Afu9IssueStatus.CREATED,
        statusChanged: false,
        transitionAllowed: null,
        conflictDetected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync AFU-9 status to GitHub
   * AFU-9 → GitHub direction
   * 
   * @param issueId - AFU-9 issue UUID
   * @param owner - GitHub repository owner
   * @param repo - GitHub repository name
   * @param issueNumber - GitHub issue number
   * @param options - Sync options
   * @returns Sync result
   */
  async syncAfu9ToGitHub(
    issueId: string,
    owner: string,
    repo: string,
    issueNumber: number,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    try {
      // Get current AFU-9 issue
      const issueResult = await getAfu9IssueById(this.pool, issueId);
      if (!issueResult.success || !issueResult.data) {
        return {
          success: false,
          issueId,
          oldStatus: Afu9IssueStatus.CREATED,
          newStatus: Afu9IssueStatus.CREATED,
          statusChanged: false,
          transitionAllowed: null,
          conflictDetected: false,
          error: issueResult.error || 'Issue not found',
        };
      }

      const currentIssue = issueResult.data;
      const currentStatus = currentIssue.status;

      // Get GitHub labels for this status
      const labels = getGitHubLabelsForStatus(this.spec, currentStatus);
      if (!labels) {
        return {
          success: false,
          issueId,
          oldStatus: currentStatus,
          newStatus: currentStatus,
          statusChanged: false,
          transitionAllowed: null,
          conflictDetected: false,
          error: `No GitHub label mapping for status: ${currentStatus}`,
        };
      }

      // Update GitHub labels (if not dry-run)
      if (!options.dryRun) {
        try {
          // Set labels on GitHub issue
          await this.octokit.rest.issues.setLabels({
            owner,
            repo,
            issue_number: issueNumber,
            labels: [labels.primary, ...labels.additional],
          });
        } catch (error) {
          console.error('[syncAfu9ToGitHub] Failed to update GitHub labels:', error);
          return {
            success: false,
            issueId,
            oldStatus: currentStatus,
            newStatus: currentStatus,
            statusChanged: false,
            transitionAllowed: null,
            conflictDetected: false,
            error: error instanceof Error ? error.message : 'Failed to update GitHub labels',
          };
        }
      }

      // Record sync event
      const auditResult = await this.recordSyncEvent({
        eventType: SyncEventType.AFU9_TO_GITHUB_LABEL,
        issueId,
        owner,
        repo,
        issueNumber,
        syncDirection: SyncDirection.AFU9_TO_GITHUB,
        oldStatus: currentStatus,
        newStatus: currentStatus,
        transitionAllowed: true,
        githubData: null,
        evidenceType: EvidenceType.MANUAL_TRANSITION,
        dryRun: options.dryRun || false,
        conflictDetected: false,
        syncRunId: options.syncRunId,
        createdBy: options.createdBy,
      });

      return {
        success: true,
        issueId,
        oldStatus: currentStatus,
        newStatus: currentStatus,
        statusChanged: false,
        transitionAllowed: true,
        conflictDetected: false,
        auditEventId: auditResult.data,
      };
    } catch (error) {
      console.error('[syncAfu9ToGitHub] Error:', error);
      return {
        success: false,
        issueId,
        oldStatus: Afu9IssueStatus.CREATED,
        newStatus: Afu9IssueStatus.CREATED,
        statusChanged: false,
        transitionAllowed: null,
        conflictDetected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch GitHub data (issue, PR, reviews, checks)
   */
  private async fetchGitHubData(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<GitHubPRData> {
    // Fetch PR data
    const pr = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: issueNumber,
    });

    // Fetch reviews
    const reviews = await this.octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: issueNumber,
    });

    // Fetch check runs
    const checks = await this.octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: pr.data.head.sha,
    });

    return {
      number: pr.data.number,
      state: pr.data.state as 'open' | 'closed',
      merged: pr.data.merged || false,
      mergeable_state: pr.data.mergeable_state || 'unknown',
      labels: pr.data.labels.map(label => ({ name: typeof label === 'string' ? label : label.name || '' })),
      reviews: reviews.data.map(review => ({
        state: review.state,
        submitted_at: review.submitted_at || '',
      })),
      checks: {
        total_count: checks.data.total_count,
        check_runs: checks.data.check_runs.map(run => ({
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
        })),
      },
    };
  }

  /**
   * Determine AFU-9 status from GitHub data
   */
  private determineStatusFromGitHub(
    githubData: GitHubPRData,
    statusSource: string | null
  ): Afu9IssueStatus | null {
    // Priority: PR merged > PR status > labels

    // Check if PR is merged
    if (githubData.merged) {
      return Afu9IssueStatus.DONE;
    }

    // Check PR state
    if (githubData.state === 'closed' && !githubData.merged) {
      return Afu9IssueStatus.KILLED;
    }

    // Check checks and reviews for MERGE_READY
    const allChecksPass = githubData.checks.check_runs.every(
      run => run.conclusion === 'success' || run.conclusion === 'skipped'
    );
    const hasApproval = githubData.reviews.some(review => review.state === 'APPROVED');

    if (allChecksPass && hasApproval && githubData.state === 'open') {
      return Afu9IssueStatus.MERGE_READY;
    }

    // Check labels for status
    for (const label of githubData.labels) {
      const mappedStatus = mapGitHubStatusToAfu9Spec(this.spec, label.name, 'labels');
      if (mappedStatus) {
        return mappedStatus as Afu9IssueStatus;
      }
    }

    return null;
  }

  /**
   * Extract evidence from GitHub data for precondition checking
   */
  private extractEvidenceFromGitHub(githubData: GitHubPRData): Record<string, boolean> {
    const allChecksPass = githubData.checks.check_runs.every(
      run => run.conclusion === 'success' || run.conclusion === 'skipped'
    );
    const hasApproval = githubData.reviews.some(review => review.state === 'APPROVED');

    return {
      pr_merged: githubData.merged,
      tests_pass: allChecksPass,
      ci_checks_pass: allChecksPass,
      ci_checks_green: allChecksPass,
      code_review_approved: hasApproval,
      no_merge_conflicts: githubData.mergeable_state === 'clean',
      code_committed: true, // Assume code is committed if PR exists
    };
  }

  /**
   * Handle sync conflict
   */
  private async handleConflict(params: {
    issueId: string;
    owner: string;
    repo: string;
    issueNumber: number;
    conflictType: SyncConflictType;
    afu9Status: string;
    githubData: GitHubPRData | null;
    description: string;
    options: SyncOptions;
  }): Promise<{ id: string; description: string }> {
    // Record conflict audit event
    await this.recordSyncEvent({
      eventType: SyncEventType.SYNC_CONFLICT_DETECTED,
      issueId: params.issueId,
      owner: params.owner,
      repo: params.repo,
      issueNumber: params.issueNumber,
      syncDirection: SyncDirection.CONFLICT,
      oldStatus: params.afu9Status,
      newStatus: params.afu9Status,
      transitionAllowed: false,
      transitionBlockedReason: params.description,
      githubData: params.githubData,
      dryRun: params.options.dryRun || false,
      conflictDetected: true,
      conflictReason: params.description,
      syncRunId: params.options.syncRunId,
      createdBy: params.options.createdBy,
    });

    // Create conflict record (if not dry-run)
    let conflictId = 'dry-run';
    if (!params.options.dryRun) {
      const conflictResult = await createSyncConflict(this.pool, {
        issue_id: params.issueId,
        github_owner: params.owner,
        github_repo: params.repo,
        github_issue_number: params.issueNumber,
        conflict_type: params.conflictType,
        afu9_status: params.afu9Status,
        github_status_raw: this.getGitHubStatusRaw(params.githubData),
        github_pr_state: params.githubData?.state || null,
        description: params.description,
      });

      if (conflictResult.success && conflictResult.data) {
        conflictId = conflictResult.data;
      }
    }

    return {
      id: conflictId,
      description: params.description,
    };
  }

  /**
   * Record sync audit event
   */
  private async recordSyncEvent(params: {
    eventType: SyncEventType;
    issueId: string;
    owner: string;
    repo: string;
    issueNumber: number;
    syncDirection: SyncDirection;
    oldStatus: string;
    newStatus: string;
    transitionAllowed: boolean;
    transitionBlockedReason?: string;
    githubData: GitHubPRData | null;
    evidenceType?: string;
    dryRun: boolean;
    conflictDetected: boolean;
    conflictReason?: string;
    syncRunId?: string;
    createdBy?: string;
  }): Promise<{ success: boolean; data: string | null }> {
    const evidence = params.githubData ? this.extractEvidenceFromGitHub(params.githubData) : {};

    return await recordSyncAuditEvent(this.pool, {
      event_type: params.eventType,
      issue_id: params.issueId,
      github_owner: params.owner,
      github_repo: params.repo,
      github_issue_number: params.issueNumber,
      sync_direction: params.syncDirection,
      old_status: params.oldStatus,
      new_status: params.newStatus,
      transition_allowed: params.transitionAllowed,
      transition_blocked_reason: params.transitionBlockedReason || null,
      evidence_type: params.evidenceType || null,
      evidence_payload: evidence,
      github_pr_state: params.githubData?.state || null,
      github_pr_merged: params.githubData?.merged || null,
      github_checks_status: this.getChecksStatus(params.githubData),
      github_review_status: this.getReviewStatus(params.githubData),
      github_labels: params.githubData?.labels.map(l => l.name) || [],
      dry_run: params.dryRun,
      conflict_detected: params.conflictDetected,
      conflict_reason: params.conflictReason || null,
      sync_run_id: params.syncRunId || null,
      created_by: params.createdBy || null,
    });
  }

  /**
   * Helper methods
   */
  private getGitHubStatusRaw(githubData: GitHubPRData | null): string | null {
    if (!githubData) return null;
    if (githubData.merged) return 'merged';
    if (githubData.state === 'closed') return 'closed';
    return githubData.labels.map(l => l.name).join(',') || null;
  }

  private getStatusSource(githubData: GitHubPRData): string {
    if (githubData.merged) return 'github_pr_status';
    if (githubData.labels.length > 0) return 'github_label';
    return 'github_state';
  }

  private getChecksStatus(githubData: GitHubPRData | null): string | null {
    if (!githubData) return null;
    const allPass = githubData.checks.check_runs.every(
      run => run.conclusion === 'success' || run.conclusion === 'skipped'
    );
    return allPass ? 'success' : 'failure';
  }

  private getReviewStatus(githubData: GitHubPRData | null): string | null {
    if (!githubData) return null;
    const hasApproval = githubData.reviews.some(review => review.state === 'APPROVED');
    return hasApproval ? 'approved' : 'pending';
  }

  private determineEvidenceType(githubData: GitHubPRData): string {
    if (githubData.merged) return EvidenceType.PR_MERGE_COMMIT;
    if (githubData.checks.total_count > 0) return EvidenceType.GITHUB_CHECKS;
    if (githubData.reviews.length > 0) return EvidenceType.CODE_REVIEW_APPROVAL;
    if (githubData.labels.length > 0) return EvidenceType.GITHUB_LABEL_CHANGE;
    return EvidenceType.GITHUB_PR_STATE;
  }
}
