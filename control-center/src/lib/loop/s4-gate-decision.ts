/**
 * S4 Gate Decision Service (E9.3-CTRL-03)
 * 
 * Implements combined gate check for Review + Checks at S4 (Review Gate).
 * 
 * Purpose:
 * - Deterministic PASS/FAIL verdict
 * - Combines review approval status + checks snapshot status
 * - Explicit block reasons for fail-closed semantics
 * 
 * Contract: docs/contracts/step-executor-s4.v1.md
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { logger } from '@/lib/logger';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { getSnapshotById, type OperationResult } from '@/lib/db/checksSnapshots';
import type { ChecksSnapshotRow } from '@/lib/contracts/checksSnapshot';
import { getGateDecision as getChecksGateDecision } from '@/lib/contracts/checksSnapshot';

// ========================================
// Types
// ========================================

/**
 * Review approval status
 */
export type ReviewApprovalStatus = 'APPROVED' | 'NOT_APPROVED' | 'CHANGES_REQUESTED';

/**
 * Combined gate verdict
 */
export type GateVerdict = 'PASS' | 'FAIL';

/**
 * Explicit block reasons
 */
export enum S4BlockReason {
  // Review-related blocks
  NO_REVIEW_APPROVAL = 'NO_REVIEW_APPROVAL',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  
  // Check-related blocks
  CHECKS_PENDING = 'CHECKS_PENDING',
  CHECKS_FAILED = 'CHECKS_FAILED',
  NO_CHECKS_FOUND = 'NO_CHECKS_FOUND',
  
  // Snapshot-related blocks
  SNAPSHOT_NOT_FOUND = 'SNAPSHOT_NOT_FOUND',
  SNAPSHOT_FETCH_FAILED = 'SNAPSHOT_FETCH_FAILED',
  
  // PR-related blocks
  PR_FETCH_FAILED = 'PR_FETCH_FAILED',
}

/**
 * S4 Gate Decision Result
 */
export interface S4GateDecisionResult {
  verdict: GateVerdict;
  blockReason?: S4BlockReason;
  blockMessage?: string;
  reviewStatus: ReviewApprovalStatus;
  checksStatus: 'PASS' | 'FAIL';
  snapshot?: ChecksSnapshotRow;
}

/**
 * Input for S4 gate decision
 */
export interface S4GateDecisionInput {
  owner: string;
  repo: string;
  prNumber: number;
  snapshotId?: string;  // Optional: use existing snapshot, or fetch fresh
  requestId?: string;
}

// ========================================
// Review Status Fetcher
// ========================================

/**
 * Fetch review approval status from GitHub
 * 
 * Returns:
 * - APPROVED: At least one review is approved, no changes requested
 * - CHANGES_REQUESTED: At least one review requests changes
 * - NOT_APPROVED: No approvals found
 * 
 * @param octokit - Authenticated GitHub client
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @returns Review approval status
 */
export async function fetchReviewApprovalStatus(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<ReviewApprovalStatus> {
  try {
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Filter to most recent review per user
    const latestReviewsByUser = new Map<string, typeof reviews[0]>();
    
    for (const review of reviews) {
      const user = review.user?.login;
      if (!user) continue;
      
      const existing = latestReviewsByUser.get(user);
      const reviewDate = review.submitted_at ? new Date(review.submitted_at) : new Date(0);
      const existingDate = existing?.submitted_at ? new Date(existing.submitted_at) : new Date(0);
      
      if (!existing || reviewDate > existingDate) {
        latestReviewsByUser.set(user, review);
      }
    }

    const latestReviews = Array.from(latestReviewsByUser.values());

    // Check for changes requested (highest priority)
    const hasChangesRequested = latestReviews.some(
      (review) => review.state === 'CHANGES_REQUESTED'
    );
    
    if (hasChangesRequested) {
      return 'CHANGES_REQUESTED';
    }

    // Check for approvals
    const hasApproval = latestReviews.some(
      (review) => review.state === 'APPROVED'
    );
    
    if (hasApproval) {
      return 'APPROVED';
    }

    // No approvals found
    return 'NOT_APPROVED';
  } catch (error) {
    logger.error('Failed to fetch PR reviews', {
      owner,
      repo,
      prNumber,
      error: error instanceof Error ? error.message : String(error),
    }, 'S4GateDecision');
    
    throw error;
  }
}

// ========================================
// Combined Gate Decision
// ========================================

/**
 * Make S4 gate decision by combining review approval + checks status
 * 
 * Implements fail-closed semantics:
 * - PASS only if review approved AND checks passed
 * - FAIL if review not approved OR checks failed
 * - Explicit block reason for all FAIL cases
 * 
 * @param pool - PostgreSQL connection pool
 * @param input - Gate decision input
 * @returns S4 gate decision result
 */
export async function makeS4GateDecision(
  pool: Pool,
  input: S4GateDecisionInput
): Promise<S4GateDecisionResult> {
  const { owner, repo, prNumber, snapshotId, requestId } = input;
  
  logger.info('Making S4 gate decision', {
    owner,
    repo,
    prNumber,
    snapshotId,
    requestId,
  }, 'S4GateDecision');

  // Step 1: Fetch review approval status
  let reviewStatus: ReviewApprovalStatus;
  
  try {
    const octokit = await createAuthenticatedClient({ owner, repo });
    reviewStatus = await fetchReviewApprovalStatus(octokit, owner, repo, prNumber);
    
    logger.info('Review status fetched', {
      owner,
      repo,
      prNumber,
      reviewStatus,
      requestId,
    }, 'S4GateDecision');
  } catch (error) {
    logger.error('Failed to fetch review status', {
      owner,
      repo,
      prNumber,
      error: error instanceof Error ? error.message : String(error),
      requestId,
    }, 'S4GateDecision');
    
    return {
      verdict: 'FAIL',
      blockReason: S4BlockReason.PR_FETCH_FAILED,
      blockMessage: 'Failed to fetch PR review status from GitHub',
      reviewStatus: 'NOT_APPROVED',
      checksStatus: 'FAIL',
    };
  }

  // Step 2: Fetch checks snapshot (if snapshotId provided)
  let snapshot: ChecksSnapshotRow | undefined;
  let checksStatus: 'PASS' | 'FAIL' = 'FAIL';
  let checksBlockReason: S4BlockReason | undefined;
  let checksBlockMessage: string | undefined;

  if (snapshotId) {
    const snapshotResult: OperationResult<ChecksSnapshotRow | null> = await getSnapshotById(pool, snapshotId);
    
    if (!snapshotResult.success || !snapshotResult.data) {
      logger.warn('Snapshot not found', {
        snapshotId,
        requestId,
      }, 'S4GateDecision');
      
      checksBlockReason = S4BlockReason.SNAPSHOT_NOT_FOUND;
      checksBlockMessage = `Checks snapshot not found: ${snapshotId}`;
    } else {
      snapshot = snapshotResult.data;
      
      // Get checks gate decision
      const checksDecision = getChecksGateDecision(snapshot);
      
      if (checksDecision.decision === 'BLOCK') {
        // Map checks decision reason to S4 block reason
        if (snapshot.pending_checks > 0) {
          checksBlockReason = S4BlockReason.CHECKS_PENDING;
          checksBlockMessage = checksDecision.reason;
        } else if (snapshot.failed_checks > 0) {
          checksBlockReason = S4BlockReason.CHECKS_FAILED;
          checksBlockMessage = checksDecision.reason;
        } else if (snapshot.total_checks === 0) {
          checksBlockReason = S4BlockReason.NO_CHECKS_FOUND;
          checksBlockMessage = checksDecision.reason;
        } else {
          checksBlockReason = S4BlockReason.CHECKS_FAILED;
          checksBlockMessage = checksDecision.reason;
        }
      } else {
        checksStatus = 'PASS';
      }
      
      logger.info('Checks snapshot evaluated', {
        snapshotId,
        checksStatus,
        checksBlockReason,
        totalChecks: snapshot.total_checks,
        failedChecks: snapshot.failed_checks,
        pendingChecks: snapshot.pending_checks,
        requestId,
      }, 'S4GateDecision');
    }
  } else {
    // No snapshot provided - fail closed
    checksBlockReason = S4BlockReason.NO_CHECKS_FOUND;
    checksBlockMessage = 'No checks snapshot provided (fail-closed)';
    
    logger.warn('No checks snapshot provided', {
      owner,
      repo,
      prNumber,
      requestId,
    }, 'S4GateDecision');
  }

  // Step 3: Combine review + checks for final verdict
  let verdict: GateVerdict = 'FAIL';
  let blockReason: S4BlockReason | undefined;
  let blockMessage: string | undefined;

  // Fail-closed: Both must be PASS for gate to PASS
  if (reviewStatus === 'CHANGES_REQUESTED') {
    blockReason = S4BlockReason.CHANGES_REQUESTED;
    blockMessage = 'PR review requested changes';
  } else if (reviewStatus !== 'APPROVED') {
    blockReason = S4BlockReason.NO_REVIEW_APPROVAL;
    blockMessage = 'PR review not approved';
  } else if (checksStatus === 'FAIL') {
    blockReason = checksBlockReason;
    blockMessage = checksBlockMessage;
  } else {
    // Both review approved AND checks passed
    verdict = 'PASS';
  }

  logger.info('S4 gate decision made', {
    verdict,
    blockReason,
    reviewStatus,
    checksStatus,
    owner,
    repo,
    prNumber,
    requestId,
  }, 'S4GateDecision');

  return {
    verdict,
    blockReason,
    blockMessage,
    reviewStatus,
    checksStatus,
    snapshot,
  };
}
