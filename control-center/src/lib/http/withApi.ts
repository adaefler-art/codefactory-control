/**
 * API Handler Wrapper Module
 * 
 * Provides structured error handling for Next.js API routes.
 * Prevents unhandled 500 errors and ensures consistent JSON response format.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getRequestId as extractRequestId, getRouteHeaderValue } from '../api/response-helpers';

/**
 * Structured API error response
 */
export interface ApiErrorResponse {
  error: string;
  details?: string;
  requestId: string;
  timestamp: string;
}

/**
 * Handler function type for API routes
 */
export type ApiHandler<T = any> = (
  request: NextRequest,
  context?: any
) => Promise<NextResponse<T>>;

/**
 * Options for API wrapper
 */
export interface WithApiOptions {
  /**
   * Custom error mapper to transform errors before sending
   */
  mapError?: (error: unknown, requestId: string) => Partial<ApiErrorResponse>;

  /**
   * Custom logger function
   */
  logger?: (error: unknown, requestId: string) => void;

  /**
   * Include stack traces in error responses (default: false in production)
   */
  includeStackTrace?: boolean;
}

/**
 * Default error logger
 */
function defaultLogger(error: unknown, requestId: string): void {
  console.error('[API Error]', {
    requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Determine if stack traces should be included
 */
function shouldIncludeStackTrace(options?: WithApiOptions): boolean {
  if (options?.includeStackTrace !== undefined) {
    return options.includeStackTrace;
  }
  return process.env.NODE_ENV !== 'production';
}

/**
 * Wrap an API handler to provide structured error handling
 * 
 * Features:
 * - Catches all unhandled errors
 * - Returns structured JSON errors with requestId
 * - Prevents 500 errors from bubbling up without proper formatting
 * - Logs errors for debugging
 * 
 * @param handler - The API route handler function
 * @param options - Optional configuration
 * @returns Wrapped handler with error handling
 * 
 * @example
 * export const GET = withApi(async (request) => {
 *   const data = await fetchData();
 *   return NextResponse.json(data);
 * });
 */
export function withApi<T = any>(
  handler: ApiHandler<T>,
  options?: WithApiOptions
): ApiHandler<T | ApiErrorResponse> {
  return async (request: NextRequest, context?: any) => {
    // Extract request-id from middleware (or generate if missing)
    const requestId = extractRequestId(request);
    
    const logger = options?.logger ?? defaultLogger;

    const routeHeaderValue = getRouteHeaderValue(request);

    try {
      // Execute the handler
      const response = await handler(request, context);
      
      // Ensure x-request-id header is set on the response
      if (!response.headers.has('x-request-id')) {
        response.headers.set('x-request-id', requestId);
      }

      if (!response.headers.has('x-afu9-handler')) {
        response.headers.set('x-afu9-handler', 'control');
      }

      if (!response.headers.has('x-afu9-route')) {
        response.headers.set('x-afu9-route', routeHeaderValue);
      }
      
      return response;
    } catch (error) {
      // Log the error
      logger(error, requestId);

      // Build structured error response
      const timestamp = new Date().toISOString();
      const baseError: ApiErrorResponse = {
        error: 'Internal server error',
        requestId,
        timestamp,
      };

      // Apply custom error mapping if provided
      if (options?.mapError) {
        const mapped = options.mapError(error, requestId);
        Object.assign(baseError, mapped);
      } else {
        // Default error handling
        if (error instanceof Error) {
          baseError.details = error.message;

          // Include stack trace in development
          if (shouldIncludeStackTrace(options)) {
            (baseError as any).stack = error.stack;
          }
        } else {
          baseError.details = String(error);
        }
      }

      // Return structured JSON error with request-id header
      const errorResponse = NextResponse.json<ApiErrorResponse>(baseError, { status: 500 });
      errorResponse.headers.set('x-request-id', requestId);
      errorResponse.headers.set('x-afu9-handler', 'control');
      errorResponse.headers.set('x-afu9-route', routeHeaderValue);
      return errorResponse;
    }
  };
}

/**
 * Create a structured API error response (for controlled errors)
 * 
 * Use this when you want to return an error response without throwing
 * 
 * @param error - Error message
 * @param status - HTTP status code (default: 400)
 * @param details - Additional error details
 * @param requestId - Optional request ID (will be generated if not provided)
 * @returns NextResponse with structured error
 * 
 * @example
 * if (!isValid) {
 *   return apiError('Invalid input', 400, 'Field x is required');
 * }
 */
export function apiError(
  error: string,
  status: number = 400,
  details?: string,
  requestId?: string
): NextResponse<ApiErrorResponse> {
  const response: ApiErrorResponse = {
    error,
    requestId: requestId || randomUUID(),
    timestamp: new Date().toISOString(),
  };

  if (details) {
    response.details = details;
  }

  const nextResponse = NextResponse.json(response, { status });
  nextResponse.headers.set('x-request-id', response.requestId);
  return nextResponse;
}

/**
 * Create a service unavailable (503) response
 * Use for external service failures or temporary unavailability
 * 
 * @param service - Name of the unavailable service
 * @param details - Additional details
 * @param requestId - Optional request ID
 * @returns NextResponse with 503 status
 */
export function serviceUnavailable(
  service: string,
  details?: string,
  requestId?: string
): NextResponse<ApiErrorResponse> {
  return apiError(
    `Service unavailable: ${service}`,
    503,
    details,
    requestId
  );
}

/**
 * Create a not found (404) response
 * 
 * @param resource - Name of the resource not found
 * @param id - Optional resource identifier
 * @param requestId - Optional request ID
 * @returns NextResponse with 404 status
 */
export function notFound(
  resource: string,
  id?: string,
  requestId?: string
): NextResponse<ApiErrorResponse> {
  const message = id ? `${resource} not found: ${id}` : `${resource} not found`;
  return apiError(message, 404, undefined, requestId);
}
