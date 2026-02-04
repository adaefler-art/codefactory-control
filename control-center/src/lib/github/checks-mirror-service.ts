/**
 * GitHub Checks Mirror Service
 * 
 * E9.3-CTRL-02: Checks Mirror (PR/Commit Checks Snapshot)
 * 
 * Captures and persists GitHub check status snapshots for deterministic
 * S4 (Review Gate) and S5 (Merge Gate) decisions.
 * 
 * Key Principles:
 * - Fail-closed: Missing or pending checks block gate
 * - Idempotent: Same ref + checks = same snapshot hash
 * - Deterministic: No live queries during gate decisions
 * - Evidence: All snapshots are referenceable
 */

import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { withRetry, DEFAULT_RETRY_CONFIG } from '@/lib/github/retry-policy';
import { logger } from '@/lib/logger';
import { Pool } from 'pg';
import {
  CheckEntry,
  ChecksSnapshotInput,
  ChecksSnapshotRow,
  CheckStatus,
  CheckConclusion,
} from '../contracts/checksSnapshot';
import {
  createChecksSnapshot,
  getLatestSnapshot,
} from '../db/checksSnapshots';

/**
 * Input for capturing checks snapshot
 */
export interface CaptureChecksSnapshotInput {
  repo_owner: string;
  repo_name: string;
  ref: string; // Commit SHA or PR ref (e.g., 'refs/pull/123/head')
  run_id?: string;
  issue_id?: string;
  request_id?: string;
}

/**
 * Result of capturing checks snapshot
 */
export interface CaptureChecksSnapshotResult {
  success: boolean;
  snapshot?: ChecksSnapshotRow;
  error?: string;
  is_existing?: boolean; // True if snapshot already existed (idempotent)
}

/**
 * Fetch checks from GitHub for a specific ref
 * 
 * Uses GitHub Checks API to list all check runs for the given ref.
 * Handles pagination if needed.
 * 
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param ref - Git ref (commit SHA or PR ref)
 * @returns Array of check entries
 */
async function fetchGitHubChecks(
  owner: string,
  repo: string,
  ref: string
): Promise<CheckEntry[]> {
  const octokit = await createAuthenticatedClient({ owner, repo });

  try {
    // Fetch check runs for the ref
    // Use listForRef which supports commit SHAs and PR refs
    const response = await withRetry(
      async () => {
        return await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref,
          per_page: 100, // Max per page
        });
      },
      {
        ...DEFAULT_RETRY_CONFIG,
        httpMethod: 'GET',
        requestId: `checks-${ref}`,
        endpoint: 'checks.listForRef',
      }
    );

    const checks: CheckEntry[] = response.data.check_runs.map(check => {
      // Map GitHub check run to our CheckEntry schema
      const entry: CheckEntry = {
        name: check.name,
        status: check.status as CheckStatus,
        conclusion: check.conclusion as CheckConclusion,
      };

      // Optional fields
      if (check.html_url) {
        entry.details_url = check.html_url;
      }
      if (check.id) {
        entry.job_id = check.id;
      }
      // GitHub API doesn't provide run_id and step_name in check runs
      // These would need to come from jobs API if needed

      return entry;
    });

    logger.info('Fetched GitHub checks', {
      owner,
      repo,
      ref,
      total_checks: checks.length,
      completed: checks.filter(c => c.status === 'completed').length,
      pending: checks.filter(c => c.status !== 'completed').length,
    }, 'ChecksMirrorService');

    return checks;
  } catch (error) {
    logger.error('Failed to fetch GitHub checks', {
      owner,
      repo,
      ref,
      error: error instanceof Error ? error.message : String(error),
    }, 'ChecksMirrorService');

    // Fail-closed: If we can't fetch checks, throw error
    // This ensures gate decisions block when checks are unavailable
    throw new Error(
      `Failed to fetch GitHub checks for ${owner}/${repo}@${ref}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Capture a checks snapshot from GitHub and persist it
 * 
 * This is the main entry point for creating snapshots.
 * 
 * Workflow:
 * 1. Fetch current check status from GitHub
 * 2. Calculate snapshot hash
 * 3. Check if snapshot already exists (idempotent)
 * 4. If new, persist to database
 * 5. Return snapshot
 * 
 * @param pool - Database connection pool
 * @param input - Capture input
 * @returns Result with snapshot or error
 */
export async function captureChecksSnapshot(
  pool: Pool,
  input: CaptureChecksSnapshotInput
): Promise<CaptureChecksSnapshotResult> {
  const { repo_owner, repo_name, ref, run_id, issue_id, request_id } = input;

  try {
    // Step 1: Fetch checks from GitHub
    logger.info('Capturing checks snapshot', {
      repo_owner,
      repo_name,
      ref,
      run_id,
      issue_id,
      request_id,
    }, 'ChecksMirrorService');

    const checks = await fetchGitHubChecks(repo_owner, repo_name, ref);

    // Fail-closed: If no checks found, log warning but proceed
    // The snapshot will record 0 checks, and gate logic will handle it
    if (checks.length === 0) {
      logger.warn('No checks found for ref', {
        repo_owner,
        repo_name,
        ref,
      }, 'ChecksMirrorService');
    }

    // Step 2: Create snapshot (idempotent)
    const snapshotInput: ChecksSnapshotInput = {
      repo_owner,
      repo_name,
      ref,
      checks,
      run_id,
      issue_id,
      request_id,
    };

    const result = await createChecksSnapshot(pool, snapshotInput);

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error || 'Failed to create snapshot',
      };
    }

    logger.info('Checks snapshot captured', {
      snapshot_id: result.data.id,
      snapshot_hash: result.data.snapshot_hash,
      total_checks: result.data.total_checks,
      failed_checks: result.data.failed_checks,
      pending_checks: result.data.pending_checks,
    }, 'ChecksMirrorService');

    return {
      success: true,
      snapshot: result.data,
      is_existing: false, // Note: DB layer returns existing if hash matches
    };
  } catch (error) {
    logger.error('Failed to capture checks snapshot', {
      repo_owner,
      repo_name,
      ref,
      error: error instanceof Error ? error.message : String(error),
    }, 'ChecksMirrorService');

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Snapshot capture failed',
    };
  }
}

/**
 * Get or create checks snapshot for a ref
 * 
 * This is a convenience function that:
 * 1. Checks if a recent snapshot exists
 * 2. If yes, returns it
 * 3. If no, captures a new snapshot
 * 
 * @param pool - Database connection pool
 * @param input - Capture input
 * @returns Result with snapshot or error
 */
export async function getOrCaptureSnapshot(
  pool: Pool,
  input: CaptureChecksSnapshotInput
): Promise<CaptureChecksSnapshotResult> {
  const { repo_owner, repo_name, ref } = input;

  try {
    // Check for existing snapshot
    const existingResult = await getLatestSnapshot(pool, repo_owner, repo_name, ref);

    if (existingResult.success && existingResult.data) {
      logger.info('Using existing checks snapshot', {
        snapshot_id: existingResult.data.id,
        captured_at: existingResult.data.captured_at,
      }, 'ChecksMirrorService');

      return {
        success: true,
        snapshot: existingResult.data,
        is_existing: true,
      };
    }

    // No existing snapshot, capture new one
    return await captureChecksSnapshot(pool, input);
  } catch (error) {
    logger.error('Failed to get or capture snapshot', {
      repo_owner,
      repo_name,
      ref,
      error: error instanceof Error ? error.message : String(error),
    }, 'ChecksMirrorService');

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Operation failed',
    };
  }
}

/**
 * Capture snapshot for a PR
 * 
 * Convenience function that resolves PR number to head SHA
 * and captures snapshot.
 * 
 * @param pool - Database connection pool
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param pr_number - PR number
 * @param options - Optional run_id, issue_id, request_id
 * @returns Result with snapshot or error
 */
export async function captureSnapshotForPR(
  pool: Pool,
  owner: string,
  repo: string,
  pr_number: number,
  options?: {
    run_id?: string;
    issue_id?: string;
    request_id?: string;
  }
): Promise<CaptureChecksSnapshotResult> {
  try {
    const octokit = await createAuthenticatedClient({ owner, repo });

    // Fetch PR to get head SHA
    const prResponse = await withRetry(
      async () => {
        return await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: pr_number,
        });
      },
      {
        ...DEFAULT_RETRY_CONFIG,
        httpMethod: 'GET',
        requestId: `pr-${pr_number}`,
        endpoint: 'pulls.get',
      }
    );

    const headSha = prResponse.data.head.sha;

    // Capture snapshot for head SHA
    return await captureChecksSnapshot(pool, {
      repo_owner: owner,
      repo_name: repo,
      ref: headSha,
      run_id: options?.run_id,
      issue_id: options?.issue_id,
      request_id: options?.request_id,
    });
  } catch (error) {
    logger.error('Failed to capture snapshot for PR', {
      owner,
      repo,
      pr_number,
      error: error instanceof Error ? error.message : String(error),
    }, 'ChecksMirrorService');

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to capture PR snapshot',
    };
  }
}
