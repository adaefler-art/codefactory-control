/**
 * Implementation Summary Types (E83.3)
 * 
 * Types for collecting and storing implementation summaries from PRs,
 * including descriptions, comments, and check runs.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { z } from 'zod';

// ========================================
// Source Reference Types
// ========================================

/**
 * Reference to a source of implementation summary data
 */
export const SourceReferenceSchema = z.object({
  type: z.enum(['pr_description', 'comment', 'check_run', 'review']),
  url: z.string(), // GitHub API URL or web URL
  timestamp: z.string(), // ISO 8601 timestamp
  etag: z.string().optional(), // GitHub etag for caching
  author: z.string().optional(), // GitHub username
  id: z.union([z.string(), z.number()]).optional(), // GitHub object ID
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;

// ========================================
// Summary Content Types
// ========================================

/**
 * Normalized PR description
 */
export const PrDescriptionSchema = z.object({
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.string().optional(),
});

export type PrDescription = z.infer<typeof PrDescriptionSchema>;

/**
 * Normalized comment
 */
export const CommentSchema = z.object({
  id: z.number(),
  body: z.string(),
  author: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Comment = z.infer<typeof CommentSchema>;

/**
 * Normalized check run summary
 */
export const CheckRunSummarySchema = z.object({
  name: z.string(),
  conclusion: z.string().nullable(), // success, failure, neutral, cancelled, skipped, timed_out, action_required, null
  status: z.string(), // queued, in_progress, completed
  completedAt: z.string().optional(),
});

export type CheckRunSummary = z.infer<typeof CheckRunSummarySchema>;

/**
 * Full summary content
 */
export const SummaryContentSchema = z.object({
  prDescription: PrDescriptionSchema.nullable(),
  comments: z.array(CommentSchema),
  checkRuns: z.array(CheckRunSummarySchema),
  metadata: z.object({
    prNumber: z.number(),
    repository: z.string(),
    owner: z.string(),
    repo: z.string(),
    collectCount: z.number().optional(), // How many comments were collected (for bounds)
    totalComments: z.number().optional(), // Total comments available
  }),
});

export type SummaryContent = z.infer<typeof SummaryContentSchema>;

// ========================================
// API Input/Output Types
// ========================================

/**
 * Input for collecting implementation summary
 */
export const CollectSummaryInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int().positive(),
  include: z.object({
    description: z.boolean().default(true),
    comments: z.boolean().default(true),
    checks: z.boolean().default(true),
  }).optional(),
  requestId: z.string().optional(),
  maxComments: z.number().int().positive().default(50).optional(), // Bounded collection
});

export type CollectSummaryInput = z.infer<typeof CollectSummaryInputSchema>;

/**
 * Output from collecting implementation summary
 */
export const CollectSummaryOutputSchema = z.object({
  summaryId: z.string().uuid(),
  contentHash: z.string().length(64), // SHA-256 hex string
  sources: z.array(SourceReferenceSchema),
  version: z.number().int().positive(),
  content: SummaryContentSchema,
  collectedAt: z.string(),
  isNewVersion: z.boolean(), // True if content changed since last collection
});

export type CollectSummaryOutput = z.infer<typeof CollectSummaryOutputSchema>;

// ========================================
// Database Record Types
// ========================================

/**
 * Implementation summary database record
 */
export interface ImplementationSummaryRecord {
  id: number;
  summaryId: string;
  repository: string;
  owner: string;
  repo: string;
  prNumber: number;
  contentHash: string;
  content: SummaryContent;
  sources: SourceReference[];
  version: number;
  requestId?: string;
  collectedAt: Date;
  collectedBy?: string;
}

// ========================================
// Error Types
// ========================================

export class ImplementationSummaryError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message);
    this.name = 'ImplementationSummaryError';
  }
}

export class PrNotFoundError extends ImplementationSummaryError {
  constructor(owner: string, repo: string, prNumber: number) {
    super(
      `Pull request #${prNumber} not found in ${owner}/${repo}`,
      'PR_NOT_FOUND',
      { owner, repo, prNumber }
    );
    this.name = 'PrNotFoundError';
  }
}

export class RegistryAuthorizationError extends ImplementationSummaryError {
  constructor(repository: string, action: string) {
    super(
      `Action '${action}' not allowed for repository ${repository}`,
      'REGISTRY_AUTHORIZATION_FAILED',
      { repository, action }
    );
    this.name = 'RegistryAuthorizationError';
  }
}
