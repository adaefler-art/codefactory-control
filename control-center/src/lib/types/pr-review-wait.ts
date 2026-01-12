/**
 * PR Review and Wait Types (E83.4)
 * 
 * Types for requesting PR reviews and waiting for checks to complete.
 * Implements bounded polling with deterministic intervals and early termination.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { z } from 'zod';

// ========================================
// Status Rollup Types
// ========================================

/**
 * Check status rollup
 */
export const CheckStatusSchema = z.enum(['GREEN', 'YELLOW', 'RED']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/**
 * Review status rollup
 */
export const ReviewStatusSchema = z.enum(['APPROVED', 'PENDING', 'CHANGES_REQUESTED']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

/**
 * Rollup of PR status
 */
export const StatusRollupSchema = z.object({
  checks: CheckStatusSchema,
  reviews: ReviewStatusSchema,
  mergeable: z.boolean().nullable(),
});

export type StatusRollup = z.infer<typeof StatusRollupSchema>;

// ========================================
// Evidence Types
// ========================================

/**
 * Check run evidence
 */
export const CheckRunEvidenceSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(), // queued, in_progress, completed
  conclusion: z.string().nullable(), // success, failure, neutral, cancelled, skipped, timed_out, action_required, null
  completedAt: z.string().nullable(),
  url: z.string().optional(),
});

export type CheckRunEvidence = z.infer<typeof CheckRunEvidenceSchema>;

/**
 * Review evidence
 */
export const ReviewEvidenceSchema = z.object({
  id: z.number(),
  user: z.string(),
  state: z.string(), // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
  submittedAt: z.string().nullable(),
  url: z.string().optional(),
});

export type ReviewEvidence = z.infer<typeof ReviewEvidenceSchema>;

/**
 * Evidence bundle
 */
export const EvidenceSchema = z.object({
  checks: z.array(CheckRunEvidenceSchema),
  reviews: z.array(ReviewEvidenceSchema),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

// ========================================
// API Input/Output Types
// ========================================

/**
 * Input for requesting review and waiting for checks
 */
export const RequestReviewAndWaitInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int().positive(),
  reviewers: z.array(z.string()).default([]),
  maxWaitSeconds: z.number().int().min(0).max(3600).default(900), // Max 1 hour, default 15 min
  pollSeconds: z.number().int().min(5).max(300).default(15), // Min 5s, max 5min, default 15s
  requestId: z.string().optional(),
});

export type RequestReviewAndWaitInput = z.infer<typeof RequestReviewAndWaitInputSchema>;

/**
 * Output from request review and wait
 */
export const RequestReviewAndWaitOutputSchema = z.object({
  rollup: StatusRollupSchema,
  evidence: EvidenceSchema,
  pollingStats: z.object({
    totalPolls: z.number(),
    elapsedSeconds: z.number(),
    timedOut: z.boolean(),
    terminatedEarly: z.boolean(),
    terminationReason: z.string().optional(),
  }),
  requestId: z.string().optional(),
});

export type RequestReviewAndWaitOutput = z.infer<typeof RequestReviewAndWaitOutputSchema>;

// ========================================
// Error Types
// ========================================

/**
 * Error when PR is not found
 */
export class PrNotFoundError extends Error {
  code = 'PR_NOT_FOUND';
  details: { owner: string; repo: string; prNumber: number };

  constructor(owner: string, repo: string, prNumber: number) {
    super(`Pull request #${prNumber} not found in ${owner}/${repo}`);
    this.name = 'PrNotFoundError';
    this.details = { owner, repo, prNumber };
  }
}

/**
 * Error when registry authorization fails
 */
export class RegistryAuthorizationError extends Error {
  code = 'REGISTRY_AUTHORIZATION_FAILED';
  details: { repository: string; action: string };

  constructor(repository: string, action: string) {
    super(`Registry does not allow action '${action}' for repository ${repository}`);
    this.name = 'RegistryAuthorizationError';
    this.details = { repository, action };
  }
}
