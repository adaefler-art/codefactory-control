/**
 * Merge PR Types (E83.5)
 * 
 * Types for merging PRs with explicit approval and branch cleanup.
 * Implements fail-closed semantics with comprehensive precondition validation.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { z } from 'zod';

// ========================================
// Merge Method Types
// ========================================

/**
 * GitHub merge methods
 */
export const MergeMethodSchema = z.enum(['merge', 'squash', 'rebase']);
export type MergeMethod = z.infer<typeof MergeMethodSchema>;

// ========================================
// API Input/Output Types
// ========================================

/**
 * Input for merging a PR with explicit approval
 */
export const MergePrInputSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int().positive(),
  approvalToken: z.string().optional(), // Explicit approval token/flag
  requestId: z.string().optional(),
});

export type MergePrInput = z.infer<typeof MergePrInputSchema>;

/**
 * Precondition snapshot captured before merge decision
 */
export const PreconditionSnapshotSchema = z.object({
  checks: z.array(z.object({
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
  })),
  reviews: z.array(z.object({
    id: z.number(),
    user: z.string(),
    state: z.string(),
  })),
  mergeable: z.boolean().nullable(),
  draft: z.boolean(),
  labels: z.array(z.string()),
});

export type PreconditionSnapshot = z.infer<typeof PreconditionSnapshotSchema>;

/**
 * Merge decision reasons
 */
export const MergeDecisionSchema = z.enum([
  'MERGED',
  'BLOCKED_NO_REGISTRY',
  'BLOCKED_REGISTRY_DISABLED',
  'BLOCKED_CHECKS_FAILED',
  'BLOCKED_NO_APPROVAL',
  'BLOCKED_NOT_MERGEABLE',
  'BLOCKED_DRAFT',
  'BLOCKED_PROD_DISABLED',
  'BLOCKED_MISSING_PRECONDITIONS',
]);

export type MergeDecision = z.infer<typeof MergeDecisionSchema>;

/**
 * Audit event for merge action
 */
export const MergeAuditEventSchema = z.object({
  decision: MergeDecisionSchema,
  reasonCodes: z.array(z.string()),
  preconditionSnapshot: PreconditionSnapshotSchema,
  mergeMethod: MergeMethodSchema.optional(),
  branchDeleted: z.boolean().default(false),
  timestamp: z.string().datetime(),
  executedBy: z.string().optional(),
});

export type MergeAuditEvent = z.infer<typeof MergeAuditEventSchema>;

/**
 * Output from merge PR operation
 */
export const MergePrOutputSchema = z.object({
  decision: MergeDecisionSchema,
  reasonCodes: z.array(z.string()),
  merged: z.boolean(),
  branchDeleted: z.boolean(),
  mergeMethod: MergeMethodSchema.optional(),
  commitSha: z.string().optional(),
  preconditionSnapshot: PreconditionSnapshotSchema,
  auditEventId: z.number().optional(),
  requestId: z.string().optional(),
});

export type MergePrOutput = z.infer<typeof MergePrOutputSchema>;

// ========================================
// Error Types
// ========================================

/**
 * Error when merge preconditions are not met
 */
export class MergePreconditionsNotMetError extends Error {
  code = 'MERGE_PRECONDITIONS_NOT_MET';
  details: {
    owner: string;
    repo: string;
    prNumber: number;
    reasons: string[];
  };

  constructor(owner: string, repo: string, prNumber: number, reasons: string[]) {
    super(`Merge preconditions not met for PR #${prNumber} in ${owner}/${repo}`);
    this.name = 'MergePreconditionsNotMetError';
    this.details = { owner, repo, prNumber, reasons };
  }
}

/**
 * Error when explicit approval is required but not provided
 */
export class ExplicitApprovalRequiredError extends Error {
  code = 'EXPLICIT_APPROVAL_REQUIRED';
  details: { owner: string; repo: string; prNumber: number };

  constructor(owner: string, repo: string, prNumber: number) {
    super(`Explicit approval required for merging PR #${prNumber} in ${owner}/${repo}`);
    this.name = 'ExplicitApprovalRequiredError';
    this.details = { owner, repo, prNumber };
  }
}

/**
 * Error when merge is attempted on a production environment without explicit enablement
 */
export class ProductionMergeBlockedError extends Error {
  code = 'PRODUCTION_MERGE_BLOCKED';
  details: { owner: string; repo: string; prNumber: number };

  constructor(owner: string, repo: string, prNumber: number) {
    super(`Production merge blocked for PR #${prNumber} in ${owner}/${repo} - explicit enablement required`);
    this.name = 'ProductionMergeBlockedError';
    this.details = { owner, repo, prNumber };
  }
}
