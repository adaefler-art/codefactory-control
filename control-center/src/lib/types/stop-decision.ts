/**
 * Stop Decision Types (E84.4)
 * 
 * Types for lawbook-gated stop conditions to prevent infinite loops
 * in automated workflow reruns.
 * 
 * Epic E84: Post-Publish Workflow Automation
 */

import { z } from 'zod';

// ========================================
// Stop Decision Types
// ========================================

/**
 * Stop decision outcome
 */
export const StopDecisionTypeSchema = z.enum([
  'CONTINUE',  // Safe to continue with automation
  'HOLD',      // Pause automation, prompt for human review
  'KILL',      // Stop automation permanently for this context
]);

export type StopDecisionType = z.infer<typeof StopDecisionTypeSchema>;

/**
 * Reason codes for stop decisions
 */
export const StopReasonCodeSchema = z.enum([
  'MAX_ATTEMPTS',          // Exceeded maximum rerun attempts per job
  'MAX_TOTAL_RERUNS',      // Exceeded total reruns for PR
  'TIMEOUT',               // Exceeded maximum wait time for green checks
  'NON_RETRIABLE',         // Failure class is non-retriable
  'NO_SIGNAL_CHANGE',      // Same failures detected over multiple cycles
  'LAWBOOK_BLOCK',         // Blocked by lawbook rule
  'COOLDOWN_ACTIVE',       // Within cooldown period
]);

export type StopReasonCode = z.infer<typeof StopReasonCodeSchema>;

/**
 * Recommended next action when stopped
 */
export const RecommendedNextStepSchema = z.enum([
  'PROMPT',          // Generate prompt for Copilot fix
  'MANUAL_REVIEW',   // Requires human investigation
  'FIX_REQUIRED',    // Code fix required before retry
  'WAIT',            // Wait for cooldown/external condition
]);

export type RecommendedNextStep = z.infer<typeof RecommendedNextStepSchema>;

// ========================================
// Stop Decision Input
// ========================================

/**
 * Context for stop decision evaluation
 */
export const StopDecisionContextSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  runId: z.number().int().positive().optional(),
  
  // Failure classification (from E84.1)
  failureClass: z.string().optional(), // 'flaky probable', 'infra transient', 'build deterministic', etc.
  
  // Current attempt counts
  attemptCounts: z.object({
    currentJobAttempts: z.number().int().min(0), // Attempts for this specific job
    totalPrAttempts: z.number().int().min(0),    // Total rerun attempts for this PR
  }),
  
  // Timing information
  lastChangedAt: z.string().datetime().optional(), // ISO 8601 timestamp of last check status change
  firstFailureAt: z.string().datetime().optional(), // ISO 8601 timestamp of first failure
  
  // Signal tracking (for "no signal change" detection)
  previousFailureSignals: z.array(z.string()).optional(), // Hashes of previous failure signals
  
  requestId: z.string().optional(),
});

export type StopDecisionContext = z.infer<typeof StopDecisionContextSchema>;

// ========================================
// Stop Decision Output
// ========================================

/**
 * Complete stop decision result (v1)
 */
export const StopDecisionV1Schema = z.object({
  schemaVersion: z.literal('1.0'),
  requestId: z.string(),
  lawbookHash: z.string(),
  deploymentEnv: z.enum(['staging', 'prod']),
  
  target: z.object({
    prNumber: z.number().int().positive(),
    runId: z.number().int().positive().optional(),
  }),
  
  decision: StopDecisionTypeSchema,
  reasonCode: StopReasonCodeSchema.optional(),
  reasons: z.array(z.string()), // Human-readable explanations
  
  recommendedNextStep: RecommendedNextStepSchema,
  
  // Evidence and context
  evidence: z.object({
    attemptCounts: z.object({
      currentJobAttempts: z.number().int().min(0),
      totalPrAttempts: z.number().int().min(0),
    }),
    thresholds: z.object({
      maxRerunsPerJob: z.number().int().positive(),
      maxTotalRerunsPerPr: z.number().int().positive(),
      maxWaitMinutesForGreen: z.number().int().positive().optional(),
      cooldownMinutes: z.number().int().positive().optional(),
    }),
    appliedRules: z.array(z.string()), // List of lawbook rules that were evaluated
  }),
  
  metadata: z.object({
    evaluatedAt: z.string().datetime(), // ISO 8601 timestamp
    lawbookVersion: z.string().optional(),
  }),
});

export type StopDecisionV1 = z.infer<typeof StopDecisionV1Schema>;

// ========================================
// Database Types
// ========================================

/**
 * Stop decision audit record from database
 */
export interface StopDecisionAuditRecord {
  id: number;
  resource_owner: string;
  resource_repo: string;
  pr_number: number;
  workflow_run_id: number | null;
  request_id: string;
  decision: StopDecisionType;
  reason_code: StopReasonCode | null;
  reasons: string[];
  recommended_next_step: RecommendedNextStep;
  failure_class: string | null;
  current_job_attempts: number;
  total_pr_attempts: number;
  lawbook_hash: string;
  lawbook_version: string | null;
  applied_rules: string[];
  evidence: Record<string, unknown>;
  created_at: Date;
}
