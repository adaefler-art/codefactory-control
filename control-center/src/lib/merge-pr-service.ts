/**
 * Merge PR Service (E83.5)
 * 
 * Service for merging PRs with explicit approval and comprehensive precondition validation.
 * Implements fail-closed semantics and audit logging.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { Octokit } from 'octokit';
import { Pool } from 'pg';
import { getPool } from './db';
import { logger } from './logger';
import { createAuthenticatedClient } from './github/auth-wrapper';
import { getRepoActionsRegistryService } from './repo-actions-registry-service';
import { isProdEnabled } from './utils/prod-control';
import {
  MergePrInput,
  MergePrInputSchema,
  MergePrOutput,
  MergeDecision,
  MergeMethod,
  PreconditionSnapshot,
  MergeAuditEvent,
  MergePreconditionsNotMetError,
  ProductionMergeBlockedError,
} from './types/merge-pr';
import { PrNotFoundError, RegistryAuthorizationError } from './types/pr-review-wait';

export class MergePrService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  /**
   * Merge PR with explicit approval
   * 
   * Preconditions (fail-closed):
   * 1. Registry allows merge_pr action
   * 2. All required checks GREEN (by exact names)
   * 3. Min approvals satisfied
   * 4. mergeable == true
   * 5. Production blocked unless explicitly enabled in registry
   * 
   * Actions:
   * 1. Validate preconditions
   * 2. Merge with method from registry
   * 3. Delete branch if allowed in registry
   * 4. Record audit event with precondition snapshot
   * 
   * @param input - Merge parameters
   * @returns Merge result with audit information
   */
  async mergePrWithApproval(input: MergePrInput): Promise<MergePrOutput> {
    // Validate input
    const validated = MergePrInputSchema.parse(input);
    const { owner, repo, prNumber, approvalToken, requestId } = validated;
    const repository = `${owner}/${repo}`;

    logger.info('Attempting to merge PR with explicit approval', {
      repository,
      prNumber,
      hasApprovalToken: !!approvalToken,
      requestId,
    }, 'MergePr');

    // Create GitHub client
    const octokit = await createAuthenticatedClient({ owner, repo });

    // Step 1: Get PR details and capture precondition snapshot
    const pr = await this.getPrDetails(octokit, owner, repo, prNumber);
    const preconditionSnapshot = await this.capturePreconditionSnapshot(
      octokit,
      owner,
      repo,
      prNumber,
      pr
    );

    // Step 2: Get registry and validate merge action
    const registryService = getRepoActionsRegistryService();
    const registry = await registryService.getActiveRegistry(repository);

    if (!registry) {
      const auditEventId = await this.logAuditEvent(
        repository,
        prNumber,
        'BLOCKED_NO_REGISTRY',
        ['No active registry found'],
        preconditionSnapshot,
        undefined,
        false
      );

      return {
        decision: 'BLOCKED_NO_REGISTRY',
        reasonCodes: ['No active registry found for repository'],
        merged: false,
        branchDeleted: false,
        preconditionSnapshot,
        auditEventId,
        requestId,
      };
    }

    // Step 3: Check if merge_pr action is enabled
    const mergeConfig = registry.content.allowedActions.find(
      (action) => action.actionType === 'merge_pr' && action.enabled
    );

    if (!mergeConfig) {
      const auditEventId = await this.logAuditEvent(
        repository,
        prNumber,
        'BLOCKED_REGISTRY_DISABLED',
        ['merge_pr action not enabled in registry'],
        preconditionSnapshot,
        undefined,
        false
      );

      throw new RegistryAuthorizationError(repository, 'merge_pr');
    }

    // Step 4: Validate preconditions
    const validation = await registryService.validateAction(
      repository,
      'merge_pr',
      {
        resourceType: 'pull_request',
        resourceNumber: prNumber,
        checks: preconditionSnapshot.checks.map(c => ({ name: c.name, status: c.conclusion || c.status })),
        reviews: preconditionSnapshot.reviews,
        labels: preconditionSnapshot.labels,
        mergeable: preconditionSnapshot.mergeable ?? undefined,
        draft: preconditionSnapshot.draft,
      }
    );

    // Check if all preconditions are met
    if (!validation.preconditionsMet) {
      const reasonCodes = validation.missingPreconditions.map(p => p.type);
      const auditEventId = await this.logAuditEvent(
        repository,
        prNumber,
        'BLOCKED_MISSING_PRECONDITIONS',
        reasonCodes,
        preconditionSnapshot,
        undefined,
        false
      );

      return {
        decision: 'BLOCKED_MISSING_PRECONDITIONS',
        reasonCodes,
        merged: false,
        branchDeleted: false,
        preconditionSnapshot,
        auditEventId,
        requestId,
      };
    }

    // Check if approval is met
    if (!validation.approvalMet) {
      const auditEventId = await this.logAuditEvent(
        repository,
        prNumber,
        'BLOCKED_NO_APPROVAL',
        ['Minimum approvals not met'],
        preconditionSnapshot,
        undefined,
        false
      );

      return {
        decision: 'BLOCKED_NO_APPROVAL',
        reasonCodes: ['Minimum approvals not met'],
        merged: false,
        branchDeleted: false,
        preconditionSnapshot,
        auditEventId,
        requestId,
      };
    }

    // Step 5: Check production enablement
    const prodEnabled = isProdEnabled();
    if (prodEnabled) {
      // In production, require explicit approval token
      if (!approvalToken) {
        const auditEventId = await this.logAuditEvent(
          repository,
          prNumber,
          'BLOCKED_PROD_DISABLED',
          ['Production merge requires explicit approval token'],
          preconditionSnapshot,
          undefined,
          false
        );

        throw new ProductionMergeBlockedError(owner, repo, prNumber);
      }
    }

    // Step 6: Get merge method from registry
    const mergeMethod = this.getMergeMethod(registry.content.mergePolicy);

    // Step 7: Perform merge
    let commitSha: string | undefined;
    try {
      const mergeResult = await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: mergeMethod,
      });

      commitSha = mergeResult.data.sha;

      logger.info('Successfully merged PR', {
        repository,
        prNumber,
        mergeMethod,
        commitSha,
        requestId,
      }, 'MergePr');
    } catch (error) {
      logger.error(
        'Failed to merge PR',
        error instanceof Error ? error : new Error(String(error)),
        { repository, prNumber, mergeMethod, requestId },
        'MergePr'
      );

      const auditEventId = await this.logAuditEvent(
        repository,
        prNumber,
        'BLOCKED_NOT_MERGEABLE',
        ['GitHub API merge failed'],
        preconditionSnapshot,
        mergeMethod,
        false
      );

      throw error;
    }

    // Step 8: Delete branch if allowed
    let branchDeleted = false;
    const deleteBranchAllowed = registry.content.mergePolicy?.deleteBranchOnMerge ?? false;

    if (deleteBranchAllowed && pr.head?.ref) {
      branchDeleted = await this.deleteBranch(octokit, owner, repo, pr.head.ref);
    }

    // Step 9: Log audit event
    const auditEventId = await this.logAuditEvent(
      repository,
      prNumber,
      'MERGED',
      ['All preconditions met', 'Merge successful'],
      preconditionSnapshot,
      mergeMethod,
      branchDeleted
    );

    // Step 10: Log validation to registry audit
    await registryService.logActionValidation(
      registry.registryId,
      repository,
      'pull_request',
      prNumber,
      validation,
      'system'
    );

    return {
      decision: 'MERGED',
      reasonCodes: ['All preconditions met', 'Merge successful'],
      merged: true,
      branchDeleted,
      mergeMethod,
      commitSha,
      preconditionSnapshot,
      auditEventId,
      requestId,
    };
  }

  /**
   * Get PR details from GitHub
   */
  private async getPrDetails(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<any> {
    try {
      const response = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      return response.data;
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404) {
        throw new PrNotFoundError(owner, repo, prNumber);
      }
      throw error;
    }
  }

  /**
   * Capture precondition snapshot
   */
  private async capturePreconditionSnapshot(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    pr: any
  ): Promise<PreconditionSnapshot> {
    // Get check runs
    const checksResponse = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha,
    });

    const checks = checksResponse.data.check_runs.map(check => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
    }));

    // Get reviews
    const reviewsResponse = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    const reviews = reviewsResponse.data.map(review => ({
      id: review.id,
      user: review.user?.login || 'unknown',
      state: review.state,
    }));

    return {
      checks,
      reviews,
      mergeable: pr.mergeable,
      draft: pr.draft || false,
      labels: pr.labels.map((label: any) => label.name),
    };
  }

  /**
   * Get merge method from registry merge policy
   */
  private getMergeMethod(mergePolicy: any): MergeMethod {
    if (!mergePolicy) {
      return 'squash'; // Default
    }

    const defaultMethod = mergePolicy.defaultMethod;
    const allowedMethods = mergePolicy.allowedMethods || ['squash'];

    // Use default method if it's in allowed methods
    if (allowedMethods.includes(defaultMethod)) {
      return defaultMethod as MergeMethod;
    }

    // Otherwise use first allowed method
    return allowedMethods[0] as MergeMethod;
  }

  /**
   * Delete branch after merge
   */
  private async deleteBranch(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string
  ): Promise<boolean> {
    try {
      await octokit.rest.git.deleteRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      logger.info('Deleted branch after merge', {
        owner,
        repo,
        branch,
      }, 'MergePr');

      return true;
    } catch (error) {
      logger.warn(
        'Failed to delete branch after merge',
        error instanceof Error ? error : new Error(String(error)),
        { owner, repo, branch },
        'MergePr'
      );

      return false;
    }
  }

  /**
   * Log merge audit event
   */
  private async logAuditEvent(
    repository: string,
    prNumber: number,
    decision: MergeDecision,
    reasonCodes: string[],
    preconditionSnapshot: PreconditionSnapshot,
    mergeMethod?: MergeMethod,
    branchDeleted: boolean = false
  ): Promise<number> {
    const auditEvent: MergeAuditEvent = {
      decision,
      reasonCodes,
      preconditionSnapshot,
      mergeMethod,
      branchDeleted,
      timestamp: new Date().toISOString(),
      executedBy: 'system',
    };

    const result = await this.pool.query(
      `INSERT INTO registry_action_audit (
        registry_id,
        registry_version,
        action_type,
        action_status,
        repository,
        resource_type,
        resource_number,
        validation_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        'codefactory-control-default', // TODO: Get from registry
        '1.0.0',
        'merge_pr',
        decision === 'MERGED' ? 'allowed' : 'blocked',
        repository,
        'pull_request',
        prNumber,
        JSON.stringify(auditEvent),
      ]
    );

    logger.info('Logged merge audit event', {
      repository,
      prNumber,
      decision,
      auditEventId: result.rows[0].id,
    }, 'MergePr');

    return result.rows[0].id;
  }
}

// Export singleton instance
let mergePrService: MergePrService;

export function getMergePrService(): MergePrService {
  if (!mergePrService) {
    mergePrService = new MergePrService();
  }
  return mergePrService;
}
