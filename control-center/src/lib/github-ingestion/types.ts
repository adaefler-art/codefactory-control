/**
 * GitHub Ingestion Types
 * 
 * Type definitions for GitHub ingestion into Timeline/Linkage Model.
 * 
 * Reference: I722 (E72.2 - GitHub Ingestion)
 */

import { z } from 'zod';

// ========================================
// Input Schemas
// ========================================

/**
 * Schema for ingestIssue parameters
 */
export const IngestIssueParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.number().int().positive(),
}).strict();

export type IngestIssueParams = z.infer<typeof IngestIssueParamsSchema>;

/**
 * Schema for ingestPullRequest parameters
 */
export const IngestPullRequestParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
}).strict();

export type IngestPullRequestParams = z.infer<typeof IngestPullRequestParamsSchema>;

/**
 * Schema for ingestIssueComments parameters
 */
export const IngestIssueCommentsParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.number().int().positive(),
}).strict();

export type IngestIssueCommentsParams = z.infer<typeof IngestIssueCommentsParamsSchema>;

/**
 * Schema for ingestLabels parameters
 */
export const IngestLabelsParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
}).strict();

export type IngestLabelsParams = z.infer<typeof IngestLabelsParamsSchema>;

// ========================================
// Result Types
// ========================================

/**
 * Common ingestion result
 */
export interface IngestionResult {
  nodeId: string;
  naturalKey: string;
  isNew: boolean;
  source_system: string;
  source_type: string;
  source_id: string;
}

/**
 * Issue ingestion result
 */
export interface IngestIssueResult extends IngestionResult {
  issueNumber: number;
}

/**
 * Pull Request ingestion result
 */
export interface IngestPullRequestResult extends IngestionResult {
  prNumber: number;
}

/**
 * Comments ingestion result
 */
export interface IngestCommentsResult {
  commentNodes: IngestionResult[];
  parentNodeId: string;
  edgeIds: string[];
}

/**
 * Labels ingestion result
 */
export interface IngestLabelsResult {
  labelNodes: IngestionResult[];
}

// ========================================
// Error Types
// ========================================

export class GitHubIngestionError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GitHubIngestionError';
    this.code = code;
    this.details = details;
  }
}

export class IssueNotFoundError extends GitHubIngestionError {
  constructor(owner: string, repo: string, issueNumber: number) {
    super(
      'ISSUE_NOT_FOUND',
      `Issue #${issueNumber} not found in ${owner}/${repo}`,
      { owner, repo, issueNumber }
    );
  }
}

export class PullRequestNotFoundError extends GitHubIngestionError {
  constructor(owner: string, repo: string, prNumber: number) {
    super(
      'PR_NOT_FOUND',
      `Pull Request #${prNumber} not found in ${owner}/${repo}`,
      { owner, repo, prNumber }
    );
  }
}
