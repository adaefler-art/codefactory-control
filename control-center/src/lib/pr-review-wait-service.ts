/**
 * PR Review and Wait Service (E83.4)
 * 
 * Service for requesting PR reviews and waiting for checks to complete
 * with bounded polling and early termination.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { Octokit } from 'octokit';
import { logger } from './logger';
import { createAuthenticatedClient } from './github/auth-wrapper';
import { getRepoActionsRegistryService } from './repo-actions-registry-service';
import {
  RequestReviewAndWaitInput,
  RequestReviewAndWaitInputSchema,
  RequestReviewAndWaitOutput,
  StatusRollup,
  Evidence,
  CheckStatus,
  ReviewStatus,
  CheckRunEvidence,
  ReviewEvidence,
  PrNotFoundError,
  RegistryAuthorizationError,
} from './types/pr-review-wait';

export class PrReviewWaitService {
  /**
   * Request PR review and wait for checks to complete
   * 
   * Steps:
   * 1. Validate registry authorization for request_review and wait_for_checks
   * 2. Request reviewers on the PR (if any provided)
   * 3. Poll checks and reviews with bounded intervals
   * 4. Terminate early on terminal states (RED checks, changes_requested, mergeable=false)
   * 5. Return rollup and evidence
   * 
   * @param input - Request parameters
   * @returns Rollup and evidence of PR status
   */
  async requestReviewAndWait(
    input: RequestReviewAndWaitInput
  ): Promise<RequestReviewAndWaitOutput> {
    // Validate input
    const validated = RequestReviewAndWaitInputSchema.parse(input);
    const { owner, repo, prNumber, reviewers, maxWaitSeconds, pollSeconds, requestId } = validated;
    const repository = `${owner}/${repo}`;

    logger.info('Requesting review and waiting for checks', {
      repository,
      prNumber,
      reviewers,
      maxWaitSeconds,
      pollSeconds,
      requestId,
    }, 'PrReviewWait');

    // Step 1: Check registry authorization
    await this.checkRegistryAuthorization(repository);

    // Step 2: Request reviewers (if any)
    const octokit = await createAuthenticatedClient({ owner, repo });
    if (reviewers.length > 0) {
      await this.requestReviewers(octokit, owner, repo, prNumber, reviewers);
    }

    // Step 3: Poll checks and reviews with bounded intervals
    const result = await this.pollChecksAndReviews(
      octokit,
      owner,
      repo,
      prNumber,
      maxWaitSeconds,
      pollSeconds
    );

    logger.info('Completed review request and checks wait', {
      repository,
      prNumber,
      rollup: result.rollup,
      pollingStats: result.pollingStats,
      requestId,
    }, 'PrReviewWait');

    return {
      ...result,
      requestId,
    };
  }

  /**
   * Check if registry allows request_review and wait_for_checks actions
   */
  private async checkRegistryAuthorization(repository: string): Promise<void> {
    const registryService = getRepoActionsRegistryService();
    const registry = await registryService.getActiveRegistry(repository);

    if (!registry) {
      throw new RegistryAuthorizationError(repository, 'request_review,wait_for_checks');
    }

    // Check if both actions are allowed
    const requestReviewConfig = registry.content.allowedActions.find(
      (action) => action.actionType === 'request_review' && action.enabled
    );
    const waitChecksConfig = registry.content.allowedActions.find(
      (action) => action.actionType === 'wait_for_checks' && action.enabled
    );

    if (!requestReviewConfig || !waitChecksConfig) {
      throw new RegistryAuthorizationError(repository, 'request_review,wait_for_checks');
    }
  }

  /**
   * Request reviewers on a PR
   */
  private async requestReviewers(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    try {
      await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: prNumber,
        reviewers,
      });

      logger.info('Requested reviewers on PR', {
        owner,
        repo,
        prNumber,
        reviewers,
      }, 'PrReviewWait');
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        throw new PrNotFoundError(owner, repo, prNumber);
      }
      throw error;
    }
  }

  /**
   * Poll checks and reviews until completion or timeout
   */
  private async pollChecksAndReviews(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    maxWaitSeconds: number,
    pollSeconds: number
  ): Promise<Omit<RequestReviewAndWaitOutput, 'requestId'>> {
    const startTime = Date.now();
    const maxPolls = Math.ceil(maxWaitSeconds / pollSeconds);
    let totalPolls = 0;
    let timedOut = false;
    let terminatedEarly = false;
    let terminationReason: string | undefined;

    let rollup: StatusRollup = {
      checks: 'YELLOW',
      reviews: 'PENDING',
      mergeable: null,
    };
    let evidence: Evidence = {
      checks: [],
      reviews: [],
    };

    while (totalPolls < maxPolls) {
      totalPolls++;

      // Fetch current state
      const currentState = await this.fetchPrState(octokit, owner, repo, prNumber);
      rollup = currentState.rollup;
      evidence = currentState.evidence;

      logger.info('Poll result', {
        owner,
        repo,
        prNumber,
        poll: totalPolls,
        rollup,
        checksCount: evidence.checks.length,
        reviewsCount: evidence.reviews.length,
      }, 'PrReviewWait');

      // Check for terminal states
      if (rollup.checks === 'RED') {
        terminatedEarly = true;
        terminationReason = 'checks_failed';
        break;
      }

      if (rollup.reviews === 'CHANGES_REQUESTED') {
        terminatedEarly = true;
        terminationReason = 'changes_requested';
        break;
      }

      if (rollup.mergeable === false) {
        terminatedEarly = true;
        terminationReason = 'not_mergeable';
        break;
      }

      // Check if we've reached success state
      if (rollup.checks === 'GREEN' && rollup.reviews === 'APPROVED' && rollup.mergeable === true) {
        terminatedEarly = true;
        terminationReason = 'success';
        break;
      }

      // Wait for next poll (unless this is the last poll)
      if (totalPolls < maxPolls) {
        await this.sleep(pollSeconds * 1000);
      }
    }

    // Check if we timed out
    if (totalPolls >= maxPolls && !terminatedEarly) {
      timedOut = true;
    }

    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);

    return {
      rollup,
      evidence,
      pollingStats: {
        totalPolls,
        elapsedSeconds,
        timedOut,
        terminatedEarly,
        terminationReason,
      },
    };
  }

  /**
   * Fetch current PR state including checks, reviews, and mergeable status
   */
  private async fetchPrState(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ rollup: StatusRollup; evidence: Evidence }> {
    try {
      // Fetch PR details
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Fetch check runs for the head SHA
      const { data: checkRuns } = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: pr.head.sha,
      });

      // Fetch reviews
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Build evidence
      const checksEvidence: CheckRunEvidence[] = checkRuns.check_runs.map((check) => ({
        id: check.id,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        completedAt: check.completed_at,
        url: check.html_url,
      }));

      const reviewsEvidence: ReviewEvidence[] = reviews.map((review) => ({
        id: review.id,
        user: review.user?.login || 'unknown',
        state: review.state,
        submittedAt: review.submitted_at,
        url: review.html_url,
      }));

      // Calculate rollup
      const checksStatus = this.calculateChecksStatus(checksEvidence);
      const reviewsStatus = this.calculateReviewsStatus(reviewsEvidence);
      const mergeable = pr.mergeable;

      return {
        rollup: {
          checks: checksStatus,
          reviews: reviewsStatus,
          mergeable,
        },
        evidence: {
          checks: checksEvidence,
          reviews: reviewsEvidence,
        },
      };
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        throw new PrNotFoundError(owner, repo, prNumber);
      }
      throw error;
    }
  }

  /**
   * Calculate check status rollup
   * 
   * GREEN: All checks completed successfully
   * YELLOW: Checks in progress or pending
   * RED: Any check failed
   */
  private calculateChecksStatus(checks: CheckRunEvidence[]): CheckStatus {
    if (checks.length === 0) {
      return 'YELLOW'; // No checks yet
    }

    // Check for failures
    const hasFailure = checks.some(
      (check) =>
        check.conclusion === 'failure' ||
        check.conclusion === 'timed_out' ||
        check.conclusion === 'action_required'
    );
    if (hasFailure) {
      return 'RED';
    }

    // Check if all completed successfully
    const allSuccess = checks.every(
      (check) => check.status === 'completed' && check.conclusion === 'success'
    );
    if (allSuccess) {
      return 'GREEN';
    }

    // Some checks pending or in progress
    return 'YELLOW';
  }

  /**
   * Calculate review status rollup
   * 
   * APPROVED: At least one approval, no changes requested
   * CHANGES_REQUESTED: At least one review requesting changes
   * PENDING: No reviews or only comments
   */
  private calculateReviewsStatus(reviews: ReviewEvidence[]): ReviewStatus {
    if (reviews.length === 0) {
      return 'PENDING';
    }

    // Check for changes requested
    const hasChangesRequested = reviews.some((review) => review.state === 'CHANGES_REQUESTED');
    if (hasChangesRequested) {
      return 'CHANGES_REQUESTED';
    }

    // Check for approval
    const hasApproval = reviews.some((review) => review.state === 'APPROVED');
    if (hasApproval) {
      return 'APPROVED';
    }

    // Only comments or dismissed reviews
    return 'PENDING';
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let serviceInstance: PrReviewWaitService | null = null;

/**
 * Get singleton instance of PrReviewWaitService
 */
export function getPrReviewWaitService(): PrReviewWaitService {
  if (!serviceInstance) {
    serviceInstance = new PrReviewWaitService();
  }
  return serviceInstance;
}
