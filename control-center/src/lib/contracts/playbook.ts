/**
 * Playbook Contract Schema
 * 
 * Defines contracts for post-deploy verification playbooks.
 * Ensures type safety and validation for playbook definitions and executions.
 * 
 * Reference: E65.2 (Post-Deploy Verification Playbook)
 */

import { z } from 'zod';

// ========================================
// Step Type Schemas
// ========================================

/**
 * HTTP Check Step - Validates HTTP endpoint availability and response
 */
export const HttpCheckStepSchema = z.object({
  type: z.literal('http_check'),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  expectedBodyIncludes: z.string().optional(),
  timeoutSeconds: z.number().int().positive().default(30),
  headers: z.record(z.string()).optional(),
}).strict();

export type HttpCheckStep = z.infer<typeof HttpCheckStepSchema>;

/**
 * DB Check Step - Validates database connectivity (stub for future)
 */
export const DbCheckStepSchema = z.object({
  type: z.literal('db_check'),
  query: z.string().default('SELECT 1'),
  timeoutSeconds: z.number().int().positive().default(10),
}).strict();

export type DbCheckStep = z.infer<typeof DbCheckStepSchema>;

/**
 * Log Check Step - Validates log patterns (stub for future)
 */
export const LogCheckStepSchema = z.object({
  type: z.literal('log_check'),
  pattern: z.string(),
  timeoutSeconds: z.number().int().positive().default(30),
  source: z.string().optional(),
}).strict();

export type LogCheckStep = z.infer<typeof LogCheckStepSchema>;

/**
 * Union of all step types
 */
export const PlaybookStepInputSchema = z.discriminatedUnion('type', [
  HttpCheckStepSchema,
  DbCheckStepSchema,
  LogCheckStepSchema,
]);

export type PlaybookStepInput = z.infer<typeof PlaybookStepInputSchema>;

/**
 * Playbook Step Definition - Wrapper with metadata
 */
export const PlaybookStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  retries: z.number().int().min(0).max(3).default(0),
  input: PlaybookStepInputSchema,
}).strict();

export type PlaybookStep = z.infer<typeof PlaybookStepSchema>;

// ========================================
// Playbook Definition Schema
// ========================================

/**
 * Playbook Metadata
 */
export const PlaybookMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format (e.g., 1.0.0)'),
  environments: z.array(z.enum(['stage', 'prod'])).min(1),
  description: z.string().optional(),
  requiredSecrets: z.array(z.string()).optional(),
}).strict();

export type PlaybookMetadata = z.infer<typeof PlaybookMetadataSchema>;

/**
 * Complete Playbook Definition
 */
export const PlaybookDefinitionSchema = z.object({
  metadata: PlaybookMetadataSchema,
  steps: z.array(PlaybookStepSchema).min(1),
}).strict();

export type PlaybookDefinition = z.infer<typeof PlaybookDefinitionSchema>;

// ========================================
// Execution Result Schemas
// ========================================

/**
 * Step Execution Evidence - Captured during step execution
 */
export const StepEvidenceSchema = z.object({
  type: z.string(),
  status: z.number().optional(),
  responseTime: z.number().optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  message: z.string().optional(),
}).passthrough(); // Allow additional fields for extensibility

export type StepEvidence = z.infer<typeof StepEvidenceSchema>;

/**
 * Step Execution Error
 */
export const StepErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().optional(),
  stack: z.string().optional(),
}).strict();

export type StepError = z.infer<typeof StepErrorSchema>;

/**
 * Step Execution Status
 */
export const StepStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'failed',
  'timeout',
  'skipped',
]);

export type StepStatus = z.infer<typeof StepStatusSchema>;

/**
 * Step Execution Result
 */
export const PlaybookStepResultSchema = z.object({
  stepId: z.string(),
  stepIndex: z.number().int().min(0),
  status: StepStatusSchema,
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  evidence: StepEvidenceSchema.nullable(),
  error: StepErrorSchema.nullable(),
}).strict();

export type PlaybookStepResult = z.infer<typeof PlaybookStepResultSchema>;

/**
 * Run Execution Status
 */
export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'failed',
  'timeout',
  'cancelled',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Run Summary
 */
export const RunSummarySchema = z.object({
  totalSteps: z.number().int().min(0),
  successCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
}).strict();

export type RunSummary = z.infer<typeof RunSummarySchema>;

/**
 * Complete Playbook Run Result
 */
export const PlaybookRunResultSchema = z.object({
  id: z.string().uuid(),
  playbookId: z.string(),
  playbookVersion: z.string(),
  env: z.enum(['stage', 'prod']),
  status: RunStatusSchema,
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  summary: RunSummarySchema.nullable(),
  steps: z.array(PlaybookStepResultSchema),
  createdAt: z.string().datetime(),
}).strict();

export type PlaybookRunResult = z.infer<typeof PlaybookRunResultSchema>;

// ========================================
// Database Row Schemas
// ========================================

/**
 * Playbook Run Row (from database)
 */
export interface PlaybookRunRow {
  id: string;
  playbook_id: string;
  playbook_version: string;
  env: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  summary: RunSummary | null;
  created_at: string;
}

/**
 * Playbook Run Step Row (from database)
 */
export interface PlaybookRunStepRow {
  id: string;
  run_id: string;
  step_id: string;
  step_index: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  evidence: StepEvidence | null;
  error: StepError | null;
  created_at: string;
}

/**
 * Playbook Run Input
 */
export interface PlaybookRunInput {
  playbookId: string;
  playbookVersion: string;
  env: 'stage' | 'prod';
}

/**
 * Playbook Step Result Input (for DB insert)
 */
export interface PlaybookStepResultInput {
  runId: string;
  stepId: string;
  stepIndex: number;
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  evidence?: StepEvidence;
  error?: StepError;
}

// ========================================
// Validation Functions
// ========================================

/**
 * Validate playbook definition
 */
export function validatePlaybookDefinition(data: unknown): {
  valid: boolean;
  errors?: z.ZodError;
  playbook?: PlaybookDefinition;
} {
  const result = PlaybookDefinitionSchema.safeParse(data);
  
  if (result.success) {
    return { valid: true, playbook: result.data };
  } else {
    return { valid: false, errors: result.error };
  }
}

/**
 * Validate playbook run result
 */
export function validatePlaybookRunResult(data: unknown): {
  valid: boolean;
  errors?: z.ZodError;
  result?: PlaybookRunResult;
} {
  const result = PlaybookRunResultSchema.safeParse(data);
  
  if (result.success) {
    return { valid: true, result: result.data };
  } else {
    return { valid: false, errors: result.error };
  }
}
