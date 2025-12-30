/**
 * Unified Error Handling for AFU-9 Runs API
 * 
 * Provides consistent error envelope and HTTP status codes across all API routes.
 * 
 * Error Envelope Format:
 * {
 *   error: {
 *     code: string,      // Machine-readable error code (e.g., "RUN_NOT_FOUND")
 *     message: string,   // Human-readable error message
 *     details?: object   // Optional additional context
 *   }
 * }
 * 
 * HTTP Status Codes:
 * - 400 VALIDATION_ERROR - Invalid input (Zod validation failure)
 * - 404 RUN_NOT_FOUND - Unknown runId
 * - 404 PLAYBOOK_NOT_FOUND - Unknown playbookId
 * - 409 RUN_ALREADY_EXECUTED - Execute called on non-QUEUED run
 * - 500 INTERNAL - Unexpected server error
 * 
 * Reference: I633 (Issue UI Runs Tab), Merge-Blocker A
 */

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * Error codes used across the Runs API
 */
export enum RunsErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RUN_NOT_FOUND = 'RUN_NOT_FOUND',
  PLAYBOOK_NOT_FOUND = 'PLAYBOOK_NOT_FOUND',
  RUN_ALREADY_EXECUTED = 'RUN_ALREADY_EXECUTED',
  INTERNAL = 'INTERNAL',
}

/**
 * Error envelope structure
 */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Create an error envelope object
 */
export function makeError(
  code: string,
  message: string,
  details?: any
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Create a JSON error response with proper status code
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: any
): NextResponse<ApiErrorEnvelope> {
  return NextResponse.json(makeError(code, message, details), { status });
}

/**
 * Handle Zod validation errors
 */
export function handleValidationError(error: ZodError): NextResponse<ApiErrorEnvelope> {
  return jsonError(
    400,
    RunsErrorCode.VALIDATION_ERROR,
    'Validation failed',
    {
      issues: error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    }
  );
}

/**
 * Handle run not found error
 */
export function runNotFoundError(runId: string): NextResponse<ApiErrorEnvelope> {
  return jsonError(
    404,
    RunsErrorCode.RUN_NOT_FOUND,
    `Run ${runId} not found`,
    { runId }
  );
}

/**
 * Handle playbook not found error
 */
export function playbookNotFoundError(playbookId: string): NextResponse<ApiErrorEnvelope> {
  return jsonError(
    404,
    RunsErrorCode.PLAYBOOK_NOT_FOUND,
    `Playbook ${playbookId} not found`,
    { playbookId }
  );
}

/**
 * Handle run already executed error (idempotency violation)
 */
export function runAlreadyExecutedError(
  runId: string,
  currentStatus: string
): NextResponse<ApiErrorEnvelope> {
  return jsonError(
    409,
    RunsErrorCode.RUN_ALREADY_EXECUTED,
    'Run already executed or in progress',
    { runId, status: currentStatus }
  );
}

/**
 * Handle internal server error
 */
export function internalError(message: string = 'Internal server error'): NextResponse<ApiErrorEnvelope> {
  return jsonError(500, RunsErrorCode.INTERNAL, message);
}

/**
 * Safely handle any error and convert to appropriate API response
 */
export function handleApiError(error: unknown): NextResponse<ApiErrorEnvelope> {
  console.error('[API Error]', error);

  if (error instanceof ZodError) {
    return handleValidationError(error);
  }

  if (error instanceof Error) {
    // Check for specific error messages to map to appropriate codes
    const message = error.message.toLowerCase();
    
    if (message.includes('not found')) {
      if (message.includes('run')) {
        const runIdMatch = error.message.match(/run (\S+) not found/i);
        const runId = runIdMatch ? runIdMatch[1] : 'unknown';
        return runNotFoundError(runId);
      }
      if (message.includes('playbook')) {
        const playbookIdMatch = error.message.match(/playbook (\S+) not found/i);
        const playbookId = playbookIdMatch ? playbookIdMatch[1] : 'unknown';
        return playbookNotFoundError(playbookId);
      }
    }
    
    return internalError(error.message);
  }

  return internalError();
}
