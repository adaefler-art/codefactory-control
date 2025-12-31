/**
 * Unified Tool Response Helpers for GitHub Evidence Tools
 * 
 * Provides consistent response envelopes (success + error) for GitHub Evidence Tools:
 * - searchCode (E71.4)
 * - listTree (E71.2)
 * - readFile (E71.3)
 * 
 * Success Response Format:
 * {
 *   success: true,
 *   data: T,
 *   meta?: object
 * }
 * 
 * Error Response Format:
 * {
 *   success: false,
 *   error: {
 *     code: string,
 *     message: string,
 *     details?: object
 *   }
 * }
 * 
 * Reference: I714 (E71.4), I712 (E71.2), I713 (E71.3)
 */

import { NextResponse } from 'next/server';

// ========================================
// Response Envelope Types
// ========================================

export interface ToolSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    requestId?: string;
    generatedAt?: string;
    [key: string]: any;
  };
}

export interface ToolErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export type ToolResponse<T> = ToolSuccessResponse<T> | ToolErrorResponse;

// ========================================
// Error Code Mapping
// ========================================

/**
 * Standard error codes for GitHub Evidence Tools
 */
export enum GitHubToolErrorCode {
  // Query/Parameter Validation (400)
  QUERY_INVALID = 'QUERY_INVALID',
  INVALID_PARAMS = 'INVALID_PARAMS',
  INVALID_PATH = 'INVALID_PATH',
  RANGE_INVALID = 'RANGE_INVALID',
  NOT_A_FILE = 'NOT_A_FILE',
  
  // Authorization/Policy (403)
  REPO_NOT_ALLOWED = 'REPO_NOT_ALLOWED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // Resource Errors (404, 413, 415)
  GITHUB_API_ERROR = 'GITHUB_API_ERROR',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  TREE_TOO_LARGE = 'TREE_TOO_LARGE',
  BINARY_OR_UNSUPPORTED_ENCODING = 'BINARY_OR_UNSUPPORTED_ENCODING',
  
  // Server Errors (500)
  AUTH_MISCONFIGURED = 'AUTH_MISCONFIGURED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Map error codes to HTTP status codes
 */
export const ERROR_CODE_TO_HTTP_STATUS: Record<string, number> = {
  // 400 - Bad Request
  [GitHubToolErrorCode.QUERY_INVALID]: 400,
  [GitHubToolErrorCode.INVALID_PARAMS]: 400,
  [GitHubToolErrorCode.INVALID_PATH]: 400,
  [GitHubToolErrorCode.RANGE_INVALID]: 400,
  [GitHubToolErrorCode.NOT_A_FILE]: 400,
  
  // 403 - Forbidden
  [GitHubToolErrorCode.REPO_NOT_ALLOWED]: 403,
  [GitHubToolErrorCode.RATE_LIMIT_EXCEEDED]: 403,
  
  // 404 - Not Found (used by GITHUB_API_ERROR with details.httpStatus)
  
  // 413 - Payload Too Large
  [GitHubToolErrorCode.FILE_TOO_LARGE]: 413,
  [GitHubToolErrorCode.TREE_TOO_LARGE]: 413,
  
  // 415 - Unsupported Media Type
  [GitHubToolErrorCode.BINARY_OR_UNSUPPORTED_ENCODING]: 415,
  
  // 500 - Internal Server Error
  [GitHubToolErrorCode.GITHUB_API_ERROR]: 500,
  [GitHubToolErrorCode.AUTH_MISCONFIGURED]: 500,
  [GitHubToolErrorCode.INTERNAL_ERROR]: 500,
};

// ========================================
// Response Helpers
// ========================================

/**
 * Create a success response
 */
export function ok<T>(
  data: T,
  meta?: Record<string, any>
): NextResponse<ToolSuccessResponse<T>> {
  const response: ToolSuccessResponse<T> = {
    success: true,
    data,
  };
  
  if (meta) {
    response.meta = {
      generatedAt: new Date().toISOString(),
      ...meta,
    };
  }
  
  return NextResponse.json(response, { status: 200 });
}

/**
 * Create an error response
 */
export function fail(
  code: string,
  message: string,
  details?: any,
  httpStatus?: number
): NextResponse<ToolErrorResponse> {
  // Determine HTTP status from code or use provided httpStatus
  let status = httpStatus;
  
  if (!status) {
    // Try to get from error code mapping
    status = ERROR_CODE_TO_HTTP_STATUS[code];
    
    // If GITHUB_API_ERROR and details has httpStatus, use that
    if (code === GitHubToolErrorCode.GITHUB_API_ERROR && details?.httpStatus) {
      status = details.httpStatus;
    }
    
    // Fallback to 500
    if (!status) {
      status = 500;
    }
  }
  
  const response: ToolErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
  
  return NextResponse.json(response, { status });
}

/**
 * Create error response from error object
 */
export function failFromError(error: any): NextResponse<ToolErrorResponse> {
  // Handle known error types with code and details properties
  if (error.code && typeof error.code === 'string') {
    const code = error.code;
    const message = error.message || 'An error occurred';
    const details = error.details;
    const httpStatus = error.details?.httpStatus;
    
    return fail(code, message, details, httpStatus);
  }
  
  // Handle Zod validation errors
  if (error.name === 'ZodError') {
    return fail(
      GitHubToolErrorCode.INVALID_PARAMS,
      'Validation failed',
      { errors: error.errors },
      400
    );
  }
  
  // Generic error fallback
  return fail(
    GitHubToolErrorCode.INTERNAL_ERROR,
    error instanceof Error ? error.message : 'An unexpected error occurred',
    undefined,
    500
  );
}

// ========================================
// Specific Error Helpers
// ========================================

/**
 * Query validation error
 */
export function queryInvalidError(
  message: string,
  details?: any
): NextResponse<ToolErrorResponse> {
  return fail(GitHubToolErrorCode.QUERY_INVALID, message, details);
}

/**
 * Invalid parameters error
 */
export function invalidParamsError(
  message: string = 'Invalid query parameters',
  details?: any
): NextResponse<ToolErrorResponse> {
  return fail(GitHubToolErrorCode.INVALID_PARAMS, message, details);
}

/**
 * Repository not allowed by policy error
 */
export function repoNotAllowedError(
  owner: string,
  repo: string,
  details?: any
): NextResponse<ToolErrorResponse> {
  return fail(
    GitHubToolErrorCode.REPO_NOT_ALLOWED,
    `Access denied to repository ${owner}/${repo}`,
    { owner, repo, ...details }
  );
}

/**
 * Rate limit exceeded error
 */
export function rateLimitError(
  message: string,
  retryAfter?: number
): NextResponse<ToolErrorResponse> {
  return fail(
    GitHubToolErrorCode.RATE_LIMIT_EXCEEDED,
    message,
    retryAfter ? { retryAfter } : undefined
  );
}

/**
 * GitHub API error
 */
export function githubApiError(
  message: string,
  httpStatus?: number,
  details?: any
): NextResponse<ToolErrorResponse> {
  return fail(
    GitHubToolErrorCode.GITHUB_API_ERROR,
    message,
    { ...details, httpStatus },
    httpStatus
  );
}
