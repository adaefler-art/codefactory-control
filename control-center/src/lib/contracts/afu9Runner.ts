/**
 * AFU-9 Runner Contracts for Control Center
 * 
 * Re-exports and extends contracts from the afu9-runner MCP server.
 * These are used by the Control Center UI and APIs.
 * 
 * Reference: I631 (MCP Runner Tools), I632 (Runs Ledger), I633 (Issue UI)
 */

import { z } from 'zod';

// Step expectation schema for validation
export const StepExpectSchema = z.object({
  exitCode: z.number().optional(),
  stdoutRegex: z.array(z.string()).optional(),
  stderrRegex: z.array(z.string()).optional(),
  fileExists: z.array(z.string()).optional(),
}).strict();

export type StepExpect = z.infer<typeof StepExpectSchema>;

// Step schema - defines a single command step in a run
export const StepSchema = z.object({
  name: z.string().min(1, 'Step name is required'),
  shell: z.enum(['pwsh', 'bash']).describe('Shell to execute the command'),
  command: z.string().min(1, 'Command is required'),
  cwd: z.string().optional().describe('Working directory for command execution'),
  timeoutSec: z.number().positive().optional().describe('Timeout in seconds'),
  expect: StepExpectSchema.optional().describe('Expected outcomes for validation'),
  artifacts: z.array(z.string()).optional().describe('Artifact glob patterns (metadata only in I631)'),
}).strict();

export type Step = z.infer<typeof StepSchema>;

// Runtime types - extensible for future implementations
export const RuntimeSchema = z.enum(['dummy', 'github-runner', 'ecs-task', 'ssm']);
export type Runtime = z.infer<typeof RuntimeSchema>;

// RunSpec schema - input contract for creating/executing a run
export const RunSpecSchema = z.object({
  runId: z.string().optional().describe('Optional run ID, server will generate if not provided'),
  issueId: z.string().optional().describe('Optional GitHub issue ID for tracking'),
  title: z.string().min(1, 'Title is required'),
  runtime: RuntimeSchema.describe('Execution runtime (only "dummy" implemented in I631)'),
  steps: z.array(StepSchema).min(1, 'At least one step is required'),
  envRefs: z.record(z.string(), z.string()).optional().describe('Environment variable references'),
}).strict();

export type RunSpec = z.infer<typeof RunSpecSchema>;

// Step result schema - output for each executed step
export const StepResultSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'running', 'success', 'failed', 'timeout', 'skipped']),
  exitCode: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
}).strict();

export type StepResult = z.infer<typeof StepResultSchema>;

// Evidence Reference schema - I201.6: Link to Engine evidence
export const EvidenceRefSchema = z.object({
  url: z.string().describe('URL to Engine evidence (e.g., s3://, https://)'),
  evidenceHash: z.string().length(64).describe('SHA256 hash for verification'),
  fetchedAt: z.string().datetime().describe('Timestamp when evidence was fetched'),
  version: z.string().optional().describe('Evidence format/schema version'),
}).strict();

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

// RunResult schema - output contract for run execution results
export const RunResultSchema = z.object({
  runId: z.string(),
  issueId: z.string().optional(),
  title: z.string(),
  runtime: RuntimeSchema,
  status: z.enum(['created', 'running', 'success', 'failed', 'timeout', 'cancelled']),
  steps: z.array(StepResultSchema),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  artifacts: z.array(z.object({
    id: z.string(),
    kind: z.enum(['log', 'file']),
    name: z.string(),
    ref: z.string(),
    bytes: z.number().optional(),
    stepIdx: z.number().optional(),
  })).optional(),
  evidenceRef: EvidenceRefSchema.optional().describe('I201.6: Reference to Engine evidence'),
}).strict();

export type RunResult = z.infer<typeof RunResultSchema>;

// Playbook schema for listing/getting playbooks
export const PlaybookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  spec: RunSpecSchema,
}).strict();

export type Playbook = z.infer<typeof PlaybookSchema>;

// Run summary for list view (minimal fields)
export const RunSummarySchema = z.object({
  runId: z.string(),
  title: z.string(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  playbookId: z.string().nullable(),
  parentRunId: z.string().nullable(),
});

export type RunSummary = z.infer<typeof RunSummarySchema>;

// RunSpec override for API (allows partial spec)
export const RunSpecOverrideSchema = RunSpecSchema.partial().extend({
  title: z.string().min(1, 'Title is required'),
});

export type RunSpecOverride = z.infer<typeof RunSpecOverrideSchema>;
