import { z } from 'zod';

/**
 * AFU-9 Runner Contracts (I631)
 * 
 * Strict type-safe contracts using Zod for RunSpec and RunResult.
 * These define the input/output schemas for the afu9-runner service.
 */

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
