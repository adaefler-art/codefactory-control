/**
 * Implementation Summary Service (E83.3)
 * 
 * Service for collecting implementation summaries from GitHub PRs,
 * including descriptions, comments, and check runs. Implements
 * deterministic hashing and versioning.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { createHash } from 'crypto';
import { getPool } from './db';
import { logger } from './logger';
import { createAuthenticatedClient } from './github/auth-wrapper';
import { getRepoActionsRegistryService } from './repo-actions-registry-service';
import {
  CollectSummaryInput,
  CollectSummaryInputSchema,
  CollectSummaryOutput,
  SummaryContent,
  SourceReference,
  PrDescription,
  Comment,
  CheckRunSummary,
  ImplementationSummaryRecord,
  PrNotFoundError,
  RegistryAuthorizationError,
} from './types/implementation-summary';

export class ImplementationSummaryService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  /**
   * Collect implementation summary from a PR
   * 
   * Steps:
   * 1. Validate registry authorization
   * 2. Fetch PR data from GitHub
   * 3. Normalize and sort content deterministically
   * 4. Generate content hash
   * 5. Check if content changed since last version
   * 6. Store new version if changed
   * 
   * @param input - Collection parameters
   * @param collectedBy - User or system identifier
   * @returns Summary with ID, hash, and sources
   */
  async collectSummary(
    input: CollectSummaryInput,
    collectedBy?: string
  ): Promise<CollectSummaryOutput> {
    // Validate input
    const validated = CollectSummaryInputSchema.parse(input);
    const { owner, repo, prNumber, include, requestId, maxComments = 50 } = validated;
    const repository = `${owner}/${repo}`;

    logger.info('Collecting implementation summary', {
      repository,
      prNumber,
      requestId,
    }, 'ImplementationSummary');

    // Step 1: Check registry authorization
    await this.checkRegistryAuthorization(repository);

    // Step 2: Fetch PR data from GitHub
    const octokit = await createAuthenticatedClient({ owner, repo });
    const { content, sources } = await this.fetchPrData(
      octokit,
      owner,
      repo,
      prNumber,
      include || { description: true, comments: true, checks: true },
      maxComments
    );

    // Step 3: Generate deterministic content hash
    const contentHash = this.generateContentHash(content);

    // Step 4: Check for existing summaries and determine version
    const latestSummary = await this.getLatestSummary(owner, repo, prNumber);
    const isNewVersion = !latestSummary || latestSummary.contentHash !== contentHash;
    const version = isNewVersion ? (latestSummary?.version || 0) + 1 : latestSummary.version;

    // Step 5: Store new version if content changed
    let summaryId: string;
    let collectedAt: Date;

    if (isNewVersion) {
      const record = await this.storeSummary(
        owner,
        repo,
        prNumber,
        contentHash,
        content,
        sources,
        version,
        requestId,
        collectedBy
      );
      summaryId = record.summaryId;
      collectedAt = record.collectedAt;

      logger.info('Stored new implementation summary version', {
        summaryId,
        contentHash,
        version,
        repository,
        prNumber,
      }, 'ImplementationSummary');
    } else {
      summaryId = latestSummary!.summaryId;
      collectedAt = latestSummary!.collectedAt;

      logger.info('Content unchanged, returning existing summary', {
        summaryId,
        contentHash,
        version,
        repository,
        prNumber,
      }, 'ImplementationSummary');
    }

    return {
      summaryId,
      contentHash,
      sources,
      version,
      content,
      collectedAt: collectedAt.toISOString(),
      isNewVersion,
    };
  }

  /**
   * Check if collect_summary action is allowed by registry
   */
  private async checkRegistryAuthorization(repository: string): Promise<void> {
    const registryService = getRepoActionsRegistryService();
    const validation = await registryService.validateAction(
      repository,
      'collect_summary' as any, // Extended action type
      { resourceType: 'pull_request', resourceNumber: 0 } // Dummy context for registry check
    );

    if (!validation.allowed) {
      throw new RegistryAuthorizationError(repository, 'collect_summary');
    }
  }

  /**
   * Fetch PR data from GitHub
   */
  private async fetchPrData(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    include: { description?: boolean; comments?: boolean; checks?: boolean },
    maxComments: number
  ): Promise<{ content: SummaryContent; sources: SourceReference[] }> {
    const sources: SourceReference[] = [];
    let prDescription: PrDescription | null = null;
    const comments: Comment[] = [];
    const checkRuns: CheckRunSummary[] = [];

    // Fetch PR details
    let pr: any;
    try {
      const prResponse = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      pr = prResponse.data;

      if (include.description && pr.body) {
        prDescription = {
          body: this.normalizeWhitespace(pr.body),
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          author: pr.user?.login,
        };

        sources.push({
          type: 'pr_description',
          url: pr.html_url,
          timestamp: pr.updated_at,
          author: pr.user?.login,
        });
      }
    } catch (error: any) {
      if (error.status === 404) {
        throw new PrNotFoundError(owner, repo, prNumber);
      }
      throw error;
    }

    // Fetch comments (bounded, sorted deterministically)
    if (include.comments) {
      const commentsResponse = await octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: maxComments,
        sort: 'created',
        direction: 'asc',
      });

      // Sort deterministically: created_at ASC, then id ASC
      const sortedComments = commentsResponse.data
        .sort((a, b) => {
          const dateCompare = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          if (dateCompare !== 0) return dateCompare;
          return a.id - b.id;
        })
        .slice(0, maxComments);

      for (const comment of sortedComments) {
        comments.push({
          id: comment.id,
          body: this.normalizeWhitespace(comment.body || ''),
          author: comment.user?.login,
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
        });

        sources.push({
          type: 'comment',
          url: comment.html_url,
          timestamp: comment.updated_at,
          author: comment.user?.login,
          id: comment.id,
        });
      }
    }

    // Fetch check runs
    if (include.checks && pr.head?.sha) {
      try {
        const checksResponse = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: pr.head.sha,
          per_page: 100,
        });

        // Sort check runs deterministically by name
        const sortedChecks = checksResponse.data.check_runs.sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        for (const check of sortedChecks) {
          checkRuns.push({
            name: check.name,
            conclusion: check.conclusion,
            status: check.status,
            completedAt: check.completed_at || undefined,
          });

          sources.push({
            type: 'check_run',
            url: check.html_url,
            timestamp: check.completed_at || check.started_at || new Date().toISOString(),
            id: check.id,
          });
        }
      } catch (error) {
        // Check runs might not be available, log but don't fail
        logger.warn('Failed to fetch check runs', {
          owner,
          repo,
          prNumber,
          error: error instanceof Error ? error.message : String(error),
        }, 'ImplementationSummary');
      }
    }

    const content: SummaryContent = {
      prDescription,
      comments,
      checkRuns,
      metadata: {
        prNumber,
        repository: `${owner}/${repo}`,
        owner,
        repo,
        collectCount: comments.length,
        totalComments: comments.length, // Note: might be more, but we're bounded
      },
    };

    return { content, sources };
  }

  /**
   * Normalize whitespace in text content
   * - Trim leading/trailing whitespace
   * - Normalize line endings to \n
   * - Remove volatile fields (timestamps in content, etc.)
   */
  private normalizeWhitespace(text: string): string {
    return text
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  /**
   * Generate deterministic SHA-256 hash of content
   */
  private generateContentHash(content: SummaryContent): string {
    // Create normalized payload for hashing
    const normalized = JSON.stringify(content, Object.keys(content).sort());
    return createHash('sha256').update(normalized, 'utf-8').digest('hex');
  }

  /**
   * Get latest summary for a PR
   */
  async getLatestSummary(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ImplementationSummaryRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM implementation_summaries
       WHERE owner = $1 AND repo = $2 AND pr_number = $3
       ORDER BY version DESC, collected_at DESC
       LIMIT 1`,
      [owner, repo, prNumber]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRecord(result.rows[0]);
  }

  /**
   * Store implementation summary in database
   */
  private async storeSummary(
    owner: string,
    repo: string,
    prNumber: number,
    contentHash: string,
    content: SummaryContent,
    sources: SourceReference[],
    version: number,
    requestId?: string,
    collectedBy?: string
  ): Promise<ImplementationSummaryRecord> {
    const repository = `${owner}/${repo}`;

    const result = await this.pool.query(
      `INSERT INTO implementation_summaries (
        repository, owner, repo, pr_number, content_hash, content, sources,
        version, request_id, collected_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        repository,
        owner,
        repo,
        prNumber,
        contentHash,
        JSON.stringify(content),
        JSON.stringify(sources),
        version,
        requestId,
        collectedBy,
      ]
    );

    return this.mapRecord(result.rows[0]);
  }

  /**
   * Get summary by ID
   */
  async getSummaryById(summaryId: string): Promise<ImplementationSummaryRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM implementation_summaries WHERE summary_id = $1',
      [summaryId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRecord(result.rows[0]);
  }

  /**
   * Get all summaries for a PR
   */
  async getSummariesForPr(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ImplementationSummaryRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM implementation_summaries
       WHERE owner = $1 AND repo = $2 AND pr_number = $3
       ORDER BY version DESC, collected_at DESC`,
      [owner, repo, prNumber]
    );

    return result.rows.map((row) => this.mapRecord(row));
  }

  /**
   * Map database row to record
   */
  private mapRecord(row: any): ImplementationSummaryRecord {
    return {
      id: row.id,
      summaryId: row.summary_id,
      repository: row.repository,
      owner: row.owner,
      repo: row.repo,
      prNumber: row.pr_number,
      contentHash: row.content_hash,
      content: row.content,
      sources: row.sources,
      version: row.version,
      requestId: row.request_id,
      collectedAt: row.collected_at,
      collectedBy: row.collected_by,
    };
  }
}

// Export singleton instance
let implementationSummaryService: ImplementationSummaryService;

export function getImplementationSummaryService(): ImplementationSummaryService {
  if (!implementationSummaryService) {
    implementationSummaryService = new ImplementationSummaryService();
  }
  return implementationSummaryService;
}
