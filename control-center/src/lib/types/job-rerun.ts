/**
 * Job Rerun Types (E84.3)
 * 
 * Types for rerunning failed GitHub workflow jobs with bounded retry policy
 * and audit trail.
 * 
 * Epic E84: Post-Publish Workflow Automation
 */

import { z } from 'zod';

// ========================================
// Rerun Decision Types
// ========================================

/**
 * Rerun decision outcome
 */
export const RerunDecisionSchema = z.enum([
  'RERUN_TRIGGERED', // Successfully triggered rerun
  'NOOP',            // No action needed (e.g., all checks passing)
  'BLOCKED',         // Blocked by policy or max attempts
]);

export type RerunDecision = z.infer<typeof RerunDecisionSchema>;

/**
 * Rerun mode
 */
export const RerunModeSchema = z.enum([
  'FAILED_ONLY', // Rerun only failed jobs
  'ALL_JOBS',    // Rerun all jobs in the workflow
]);

export type RerunMode = z.infer<typeof RerunModeSchema>;

// ========================================
// Job Status Types
// ========================================

/**
 * Single job rerun status
 */
export const JobRerunStatusSchema = z.object({
  jobName: z.string(),
  jobId: z.number().optional(),
  priorConclusion: z.string().nullable(), // 'failure', 'timed_out', etc.
  action: z.enum(['RERUN', 'SKIP', 'BLOCKED']),
  attemptNumber: z.number().int().min(1),
  reasonCode: z.string().optional(), // 'flaky_probable', 'max_attempts_exceeded', etc.
});

export type JobRerunStatus = z.infer<typeof JobRerunStatusSchema>;

// ========================================
// Rerun Result Types
// ========================================

/**
 * Target of the rerun operation
 */
export const RerunTargetSchema = z.object({
  prNumber: z.number().int().positive(),
  runId: z.number().int().positive().optional(),
});

export type RerunTarget = z.infer<typeof RerunTargetSchema>;

/**
 * Complete rerun result (v1)
 */
export const RerunResultV1Schema = z.object({
  schemaVersion: z.literal('1.0'),
  requestId: z.string(),
  lawbookHash: z.string(),
  deploymentEnv: z.enum(['staging', 'prod']),
  target: RerunTargetSchema,
  decision: RerunDecisionSchema,
  reasons: z.array(z.string()),
  jobs: z.array(JobRerunStatusSchema),
  metadata: z.object({
    totalJobs: z.number(),
    rerunJobs: z.number(),
    blockedJobs: z.number(),
    skippedJobs: z.number(),
  }),
});

export type RerunResultV1 = z.infer<typeof RerunResultV1Schema>;

// ========================================
// API Input Types
// ========================================

/**
 * Input for job rerun API
 */
export const JobRerunInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  runId: z.number().int().positive().optional(), // Optional: if not provided, will find from PR
  mode: RerunModeSchema.default('FAILED_ONLY'),
  maxAttempts: z.number().int().min(1).max(5).default(2), // Hard cap at 5
  requestId: z.string().optional(),
});

export type JobRerunInput = z.infer<typeof JobRerunInputSchema>;

// ========================================
// Database Types
// ========================================

/**
 * Job rerun attempt record from database
 */
export interface JobRerunAttemptRecord {
  id: number;
  resource_owner: string;
  resource_repo: string;
  pr_number: number;
  workflow_run_id: number;
  job_name: string;
  attempt_number: number;
  request_id: string;
  decision: RerunDecision;
  reason_code: string | null;
  reasons: string[];
  prior_conclusion: string | null;
  failure_class: string | null;
  lawbook_hash: string | null;
  max_attempts_limit: number;
  github_response: Record<string, unknown> | null;
  github_error: string | null;
  created_at: Date;
}

/**
 * Aggregated attempt count for idempotency
 */
export interface JobRerunAttemptCount {
  resource_owner: string;
  resource_repo: string;
  pr_number: number;
  workflow_run_id: number;
  job_name: string;
  total_attempts: number;
  max_attempt_number: number;
  last_attempt_at: Date;
  decision_history: RerunDecision[];
}
