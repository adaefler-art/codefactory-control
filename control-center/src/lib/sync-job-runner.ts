/**
 * Sync Job Runner
 * E85.2: Bi-directional Sync (AFU-9 ↔ GitHub)
 * 
 * Orchestrates bi-directional sync operations between AFU-9 and GitHub.
 * Supports dry-run mode, fail-closed error handling, and comprehensive audit logging.
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { BidirectionalSyncEngine, SyncResult } from './bidirectional-sync';
import { getAfu9IssueById } from './db/afu9Issues';
import { createIssueSyncRun, updateIssueSyncRun } from './db/issueSync';

/**
 * Sync job options
 */
export interface SyncJobOptions {
  dryRun?: boolean;
  direction?: 'AFU9_TO_GITHUB' | 'GITHUB_TO_AFU9' | 'BOTH';
  allowManualOverride?: boolean;
  createdBy?: string;
}

/**
 * Sync job result
 */
export interface SyncJobResult {
  success: boolean;
  runId: string;
  totalIssues: number;
  syncedIssues: number;
  failedIssues: number;
  conflictsDetected: number;
  transitionsBlocked: number;
  dryRun: boolean;
  results: SyncResult[];
  error?: string;
}

/**
 * Issue to sync
 */
export interface IssueToSync {
  issueId: string;
  githubOwner: string;
  githubRepo: string;
  githubIssueNumber: number;
}

/**
 * Sync Job Runner
 * 
 * Deterministic, idempotent sync job execution.
 * Features:
 * - Pull-based sync
 * - Dry-run mode
 * - Fail-closed error handling
 * - Comprehensive audit logging
 */
export class SyncJobRunner {
  private pool: Pool;
  private octokit: Octokit;
  private syncEngine: BidirectionalSyncEngine;

  constructor(pool: Pool, octokit: Octokit) {
    this.pool = pool;
    this.octokit = octokit;
    this.syncEngine = new BidirectionalSyncEngine(pool, octokit);
  }

  /**
   * Run sync job for a list of issues
   * 
   * @param issues - List of issues to sync
   * @param options - Sync job options
   * @returns Sync job result
   */
  async runSyncJob(
    issues: IssueToSync[],
    options: SyncJobOptions = {}
  ): Promise<SyncJobResult> {
    const dryRun = options.dryRun !== false; // Default to dry-run for safety
    const direction = options.direction || 'BOTH';

    console.log(`[SyncJobRunner] Starting sync job: ${dryRun ? 'DRY-RUN' : 'LIVE'} mode, direction: ${direction}`);
    console.log(`[SyncJobRunner] Syncing ${issues.length} issues`);

    // Create sync run record
    const runResult = await createIssueSyncRun(this.pool, `Bi-directional sync: ${direction} (${dryRun ? 'dry-run' : 'live'})`);
    if (!runResult.success || !runResult.data) {
      return {
        success: false,
        runId: '',
        totalIssues: issues.length,
        syncedIssues: 0,
        failedIssues: 0,
        conflictsDetected: 0,
        transitionsBlocked: 0,
        dryRun,
        results: [],
        error: runResult.error || 'Failed to create sync run',
      };
    }

    const runId = runResult.data;

    const results: SyncResult[] = [];
    let syncedCount = 0;
    let failedCount = 0;
    let conflictsCount = 0;
    let blockedCount = 0;

    // Process each issue
    for (const issue of issues) {
      try {
        // GitHub → AFU-9 sync
        if (direction === 'GITHUB_TO_AFU9' || direction === 'BOTH') {
          const result = await this.syncEngine.syncGitHubToAfu9(
            issue.issueId,
            issue.githubOwner,
            issue.githubRepo,
            issue.githubIssueNumber,
            {
              dryRun,
              allowManualOverride: options.allowManualOverride,
              syncRunId: runId,
              createdBy: options.createdBy,
            }
          );

          results.push(result);

          if (result.success) {
            if (result.statusChanged) {
              syncedCount++;
            }
            if (result.conflictDetected) {
              conflictsCount++;
            }
            if (result.transitionAllowed === false) {
              blockedCount++;
            }
          } else {
            failedCount++;
          }
        }

        // AFU-9 → GitHub sync
        if (direction === 'AFU9_TO_GITHUB' || direction === 'BOTH') {
          const result = await this.syncEngine.syncAfu9ToGitHub(
            issue.issueId,
            issue.githubOwner,
            issue.githubRepo,
            issue.githubIssueNumber,
            {
              dryRun,
              syncRunId: runId,
              createdBy: options.createdBy,
            }
          );

          results.push(result);

          if (result.success) {
            if (result.statusChanged) {
              syncedCount++;
            }
            if (result.conflictDetected) {
              conflictsCount++;
            }
            if (result.transitionAllowed === false) {
              blockedCount++;
            }
          } else {
            failedCount++;
          }
        }
      } catch (error) {
        console.error(`[SyncJobRunner] Error syncing issue ${issue.issueId}:`, error);
        failedCount++;
        results.push({
          success: false,
          issueId: issue.issueId,
          oldStatus: 'UNKNOWN' as any,
          newStatus: 'UNKNOWN' as any,
          statusChanged: false,
          transitionAllowed: null,
          conflictDetected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Update sync run record
    await updateIssueSyncRun(this.pool, runId, {
      status: failedCount > 0 ? 'FAILED' : 'SUCCESS',
      total_count: issues.length,
      upserted_count: syncedCount,
      error: failedCount > 0 ? `${failedCount} issues failed to sync` : null,
    });

    console.log(`[SyncJobRunner] Sync job completed: ${syncedCount} synced, ${failedCount} failed, ${conflictsCount} conflicts, ${blockedCount} blocked`);

    return {
      success: failedCount === 0,
      runId,
      totalIssues: issues.length,
      syncedIssues: syncedCount,
      failedIssues: failedCount,
      conflictsDetected: conflictsCount,
      transitionsBlocked: blockedCount,
      dryRun,
      results,
    };
  }

  /**
   * Sync a single issue (convenience method)
   * 
   * @param issueId - AFU-9 issue UUID
   * @param githubOwner - GitHub repository owner
   * @param githubRepo - GitHub repository name
   * @param githubIssueNumber - GitHub issue number
   * @param options - Sync job options
   * @returns Sync result
   */
  async syncSingleIssue(
    issueId: string,
    githubOwner: string,
    githubRepo: string,
    githubIssueNumber: number,
    options: SyncJobOptions = {}
  ): Promise<SyncResult> {
    const direction = options.direction || 'BOTH';
    const dryRun = options.dryRun !== false;

    console.log(`[SyncJobRunner] Syncing single issue: ${issueId} (${dryRun ? 'dry-run' : 'live'})`);

    // Run sync job for single issue
    const jobResult = await this.runSyncJob(
      [
        {
          issueId,
          githubOwner,
          githubRepo,
          githubIssueNumber,
        },
      ],
      options
    );

    if (jobResult.results.length === 0) {
      return {
        success: false,
        issueId,
        oldStatus: 'UNKNOWN' as any,
        newStatus: 'UNKNOWN' as any,
        statusChanged: false,
        transitionAllowed: null,
        conflictDetected: false,
        error: 'No sync results',
      };
    }

    return jobResult.results[0];
  }

  /**
   * Sync all open AFU-9 issues with GitHub
   * 
   * @param options - Sync job options
   * @returns Sync job result
   */
  async syncAllOpenIssues(
    options: SyncJobOptions = {}
  ): Promise<SyncJobResult> {
    console.log('[SyncJobRunner] Fetching all open AFU-9 issues');

    try {
      // Query all open AFU-9 issues with GitHub handoff
      const result = await this.pool.query<{
        id: string;
        github_repo: string;
        github_issue_number: number;
      }>(
        `SELECT id, github_repo, github_issue_number
         FROM afu9_issues
         WHERE status NOT IN ('DONE', 'KILLED')
           AND github_issue_number IS NOT NULL
           AND github_repo IS NOT NULL
           AND deleted_at IS NULL
         ORDER BY updated_at DESC`
      );

      const issues: IssueToSync[] = result.rows
        .filter(row => row.github_repo)
        .map(row => {
          const [owner, repo] = row.github_repo.split('/');
          return {
            issueId: row.id,
            githubOwner: owner,
            githubRepo: repo,
            githubIssueNumber: row.github_issue_number,
          };
        })
        .filter(issue => issue.githubOwner && issue.githubRepo);

      console.log(`[SyncJobRunner] Found ${issues.length} open issues to sync`);

      return await this.runSyncJob(issues, options);
    } catch (error) {
      console.error('[SyncJobRunner] Error fetching open issues:', error);
      return {
        success: false,
        runId: '',
        totalIssues: 0,
        syncedIssues: 0,
        failedIssues: 0,
        conflictsDetected: 0,
        transitionsBlocked: 0,
        dryRun: options.dryRun !== false,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get sync job statistics
   * 
   * @returns Sync job statistics
   */
  async getSyncStats(): Promise<{
    success: boolean;
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    lastRunAt: string | null;
    totalIssuesSynced: number;
  }> {
    try {
      const result = await this.pool.query<{
        total_runs: string;
        successful_runs: string;
        failed_runs: string;
        last_run_at: Date | null;
        total_issues_synced: string;
      }>(
        `SELECT 
          COUNT(*) as total_runs,
          COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_runs,
          COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_runs,
          MAX(started_at) as last_run_at,
          SUM(upserted_count) as total_issues_synced
         FROM issue_sync_runs`
      );

      const row = result.rows[0];

      return {
        success: true,
        totalRuns: parseInt(row.total_runs || '0', 10),
        successfulRuns: parseInt(row.successful_runs || '0', 10),
        failedRuns: parseInt(row.failed_runs || '0', 10),
        lastRunAt: row.last_run_at ? row.last_run_at.toISOString() : null,
        totalIssuesSynced: parseInt(row.total_issues_synced || '0', 10),
      };
    } catch (error) {
      console.error('[SyncJobRunner] Error getting sync stats:', error);
      return {
        success: false,
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        lastRunAt: null,
        totalIssuesSynced: 0,
      };
    }
  }
}
