/**
 * Checks Triage Types (E84.1)
 * 
 * Types for analyzing and classifying GitHub PR check failures,
 * extracting failure evidence, and providing actionable recommendations.
 * 
 * Epic E84: Post-Publish Workflow Automation
 */

import { z } from 'zod';

// ========================================
// Failure Classification Types
// ========================================

/**
 * Failure type classification
 */
export const FailureTypeSchema = z.enum([
  'lint',
  'test',
  'build',
  'e2e',
  'infra',
  'deploy',
  'unknown',
]);

export type FailureType = z.infer<typeof FailureTypeSchema>;

/**
 * Recommended next action based on failure analysis
 */
export const NextActionSchema = z.enum([
  'PROMPT',  // Use Copilot to fix the issue
  'RERUN',   // Rerun the checks (transient failure)
  'HOLD',    // Wait for external dependency/manual intervention
  'NONE',    // No action recommended
]);

export type NextAction = z.infer<typeof NextActionSchema>;

// ========================================
// Evidence Types
// ========================================

/**
 * Evidence of a failure (log excerpt, error message)
 */
export const EvidenceSchema = z.object({
  url: z.string(), // GitHub URL to the failing check/step
  excerpt: z.string(), // Bounded log excerpt (max maxLogBytes)
  excerptHash: z.string(), // SHA256 hash of normalized excerpt
});

export type Evidence = z.infer<typeof EvidenceSchema>;

/**
 * Recommendation for handling a failure
 */
export const RecommendationSchema = z.object({
  nextAction: NextActionSchema,
  rationale: z.string(), // Short explanation
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

// ========================================
// Failure Report Types
// ========================================

/**
 * Single failure entry in triage report
 */
export const FailureV1Schema = z.object({
  checkName: z.string(),
  type: FailureTypeSchema,
  conclusion: z.string().nullable(), // GitHub conclusion: failure, timed_out, etc.
  runId: z.number().optional(),
  jobId: z.number().optional(),
  stepName: z.string().optional(),
  evidence: EvidenceSchema,
  primarySignal: z.string(), // Short deterministic reason/error
  recommendation: RecommendationSchema,
});

export type FailureV1 = z.infer<typeof FailureV1Schema>;

/**
 * Overall status summary
 */
export const OverallStatusSchema = z.enum(['GREEN', 'YELLOW', 'RED']);

export type OverallStatus = z.infer<typeof OverallStatusSchema>;

/**
 * Summary of triage results
 */
export const TriageSummarySchema = z.object({
  overall: OverallStatusSchema,
  failingChecks: z.number(),
  failingRuns: z.number(),
});

export type TriageSummary = z.infer<typeof TriageSummarySchema>;

/**
 * Repository reference
 */
export const RepoRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
});

export type RepoRef = z.infer<typeof RepoRefSchema>;

/**
 * PR reference
 */
export const PrRefSchema = z.object({
  number: z.number(),
  headSha: z.string(),
});

export type PrRef = z.infer<typeof PrRefSchema>;

// ========================================
// Main Report Types
// ========================================

/**
 * Complete checks triage report (v1)
 */
export const ChecksTriageReportV1Schema = z.object({
  schemaVersion: z.literal('1.0'),
  requestId: z.string(),
  deploymentEnv: z.enum(['staging', 'prod']),
  lawbookHash: z.string(),
  repo: RepoRefSchema,
  pr: PrRefSchema,
  summary: TriageSummarySchema,
  failures: z.array(FailureV1Schema),
});

export type ChecksTriageReportV1 = z.infer<typeof ChecksTriageReportV1Schema>;

// ========================================
// API Input Types
// ========================================

/**
 * Input for checks triage API
 */
export const ChecksTriageInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  workflowRunId: z.number().int().positive().optional(),
  maxLogBytes: z.number().int().positive().default(65536), // 64KB default
  maxSteps: z.number().int().positive().default(50),
  requestId: z.string().optional(),
});

export type ChecksTriageInput = z.infer<typeof ChecksTriageInputSchema>;
