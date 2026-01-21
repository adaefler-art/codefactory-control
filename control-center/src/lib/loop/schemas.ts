/**
 * Loop API Schemas
 * 
 * E9.1-CTRL-1: Contract-first API design for Loop control system
 * 
 * Zod schemas for request validation and response structure.
 * Ensures type safety and strict enum validation.
 */

import { z } from 'zod';

/**
 * Schema version for the Loop API
 */
export const LOOP_SCHEMA_VERSION = 'loop.runNextStep.v1';

/**
 * Execution mode for the loop step
 * Optional - defaults to "execute" if not provided
 */
export const ExecutionModeSchema = z.enum(['execute', 'dryRun']).default('execute');

export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

/**
 * Request schema for run-next-step endpoint
 * POST /api/loop/issues/[issueId]/run-next-step
 */
export const RunNextStepRequestSchema = z.object({
  mode: ExecutionModeSchema,
}).strict();

export type RunNextStepRequest = z.infer<typeof RunNextStepRequestSchema>;

/**
 * Step execution status
 */
export const StepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
]);

export type StepStatus = z.infer<typeof StepStatusSchema>;

/**
 * Response schema for successful run-next-step execution
 */
export const RunNextStepResponseSchema = z.object({
  schemaVersion: z.literal(LOOP_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  issueId: z.string(),
  stepExecuted: z.object({
    stepNumber: z.number().int().positive(),
    stepType: z.string(),
    status: StepStatusSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  }).optional(),
  nextStep: z.object({
    stepNumber: z.number().int().positive(),
    stepType: z.string(),
    estimatedDurationMs: z.number().int().nonnegative().optional(),
  }).optional(),
  loopStatus: z.enum(['active', 'completed', 'failed', 'paused']),
  message: z.string().optional(),
}).strict();

export type RunNextStepResponse = z.infer<typeof RunNextStepResponseSchema>;

/**
 * Error code enum for Loop API
 */
export const LoopErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'ISSUE_NOT_FOUND',
  'LOOP_CONFLICT',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
]);

export type LoopErrorCode = z.infer<typeof LoopErrorCodeSchema>;

/**
 * Error response schema
 */
export const LoopErrorResponseSchema = z.object({
  schemaVersion: z.literal(LOOP_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  error: z.object({
    code: LoopErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.any()).optional(),
  }),
  timestamp: z.string().datetime(),
}).strict();

export type LoopErrorResponse = z.infer<typeof LoopErrorResponseSchema>;

/**
 * Helper to create error responses with proper schema version
 */
export function createLoopError(
  requestId: string,
  code: LoopErrorCode,
  message: string,
  details?: Record<string, any>
): LoopErrorResponse {
  return {
    schemaVersion: LOOP_SCHEMA_VERSION,
    requestId,
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Map error codes to HTTP status codes
 */
export function getHttpStatusForErrorCode(code: LoopErrorCode): number {
  const statusMap: Record<LoopErrorCode, number> = {
    UNAUTHORIZED: 401,
    ISSUE_NOT_FOUND: 404,
    LOOP_CONFLICT: 409,
    INVALID_REQUEST: 400,
    INTERNAL_ERROR: 500,
  };
  return statusMap[code];
}
