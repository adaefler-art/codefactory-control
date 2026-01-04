/**
 * GitHub Status Sync Utility
 * E7_extra: Issue Status Parity — Sync GitHub Status to AFU9 canonical status
 * 
 * Fetches GitHub Project v2 status or falls back to labels/state,
 * maps to AFU9 canonical status, and updates the database.
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { Afu9IssueStatus, Afu9StatusSource } from './contracts/afu9Issue';
import { updateAfu9Issue, getAfu9IssueById } from './db/afu9Issues';
import { extractGitHubStatus, mapGitHubStatusToAfu9 } from './utils/status-mapping';

/**
 * GitHub Issue data needed for status sync
 */
export interface GitHubIssueForSync {
  number: number;
  state: 'open' | 'closed';
  labels: Array<{ name: string }>;
  // Project v2 status field (if available from GraphQL)
  projectStatus?: string | null;
}

/**
 * Result of syncing GitHub status to AFU9
 */
export interface StatusSyncResult {
  success: boolean;
  issueId: string;
  previousStatus: Afu9IssueStatus;
  newStatus: Afu9IssueStatus;
  githubStatusRaw: string | null;
  statusSource: Afu9StatusSource | null;
  changed: boolean;
  error?: string;
}

/**
 * Sync GitHub status to AFU9 issue
 * 
 * Deterministic, idempotent operation:
 * 1. Extract GitHub status (Project v2 > labels > state)
 * 2. Map to AFU9 canonical status
 * 3. Update AFU9 issue if status changed
 * 
 * @param pool - Database connection pool
 * @param issueId - AFU9 issue UUID
 * @param githubIssue - GitHub issue data with status information
 * @returns Sync result with status change details
 */
export async function syncGitHubStatusToAfu9(
  pool: Pool,
  issueId: string,
  githubIssue: GitHubIssueForSync
): Promise<StatusSyncResult> {
  try {
    // Get current AFU9 issue
    const issueResult = await getAfu9IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return {
        success: false,
        issueId,
        previousStatus: Afu9IssueStatus.CREATED,
        newStatus: Afu9IssueStatus.CREATED,
        githubStatusRaw: null,
        statusSource: null,
        changed: false,
        error: issueResult.error || 'Issue not found',
      };
    }

    const currentIssue = issueResult.data;
    const previousStatus = currentIssue.status;

    // Extract GitHub status (deterministic priority: project > label > state)
    const { raw: githubStatusRaw, source: statusSource } = extractGitHubStatus(
      githubIssue.projectStatus,
      githubIssue.labels,
      githubIssue.state
    );

    // Map GitHub status to AFU9 canonical status
    let newStatus: Afu9IssueStatus = previousStatus;
    if (githubStatusRaw) {
      const mappedStatus = mapGitHubStatusToAfu9(githubStatusRaw);
      if (mappedStatus) {
        newStatus = mappedStatus;
      }
    }

    // Check if status changed
    const changed = newStatus !== previousStatus;

    // Update AFU9 issue if status changed
    if (changed) {
      const updateResult = await updateAfu9Issue(pool, issueId, {
        status: newStatus,
        github_status_raw: githubStatusRaw,
        github_status_updated_at: new Date().toISOString(),
        status_source: statusSource,
      });

      if (!updateResult.success) {
        return {
          success: false,
          issueId,
          previousStatus,
          newStatus,
          githubStatusRaw,
          statusSource,
          changed: false,
          error: updateResult.error || 'Failed to update issue',
        };
      }
    } else {
      // Even if status didn't change, update the sync timestamp and raw status
      await updateAfu9Issue(pool, issueId, {
        github_status_raw: githubStatusRaw,
        github_status_updated_at: new Date().toISOString(),
        status_source: statusSource || currentIssue.status_source,
      });
    }

    return {
      success: true,
      issueId,
      previousStatus,
      newStatus,
      githubStatusRaw,
      statusSource,
      changed,
    };
  } catch (error) {
    console.error('[syncGitHubStatusToAfu9] Error:', error);
    return {
      success: false,
      issueId,
      previousStatus: Afu9IssueStatus.CREATED,
      newStatus: Afu9IssueStatus.CREATED,
      githubStatusRaw: null,
      statusSource: null,
      changed: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Fetch GitHub issue with status information
 * 
 * Note: This is a simple REST API version.
 * For Project v2 status, we would need GraphQL (future enhancement).
 * 
 * @param octokit - Authenticated Octokit client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - GitHub issue number
 * @returns GitHub issue data for status sync
 */
export async function fetchGitHubIssueForSync(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubIssueForSync> {
  const { data: issue } = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  return {
    number: issue.number,
    state: issue.state as 'open' | 'closed',
    labels: issue.labels.map((label) => ({
      name: typeof label === 'string' ? label : label.name || '',
    })),
    // TODO: Fetch Project v2 status via GraphQL if needed
    projectStatus: null,
  };
}
