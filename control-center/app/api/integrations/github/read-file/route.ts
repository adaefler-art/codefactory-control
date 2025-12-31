/**
 * E71.3: GitHub Read File API Endpoint
 * 
 * Server-side API route for reading file contents with line range support,
 * deterministic hashing, size limits, and policy enforcement.
 * 
 * GET /api/integrations/github/read-file?owner=X&repo=Y&branch=Z&path=P&startLine=S&endLine=E&maxBytes=M
 * 
 * Query Parameters:
 * - owner (required): Repository owner
 * - repo (required): Repository name
 * - path (required): File path (POSIX)
 * - branch (optional): Branch name (default: 'main')
 * - startLine (optional): Start line number (1-based, inclusive)
 * - endLine (optional): End line number (1-based, inclusive)
 * - maxBytes (optional): Max bytes to return (default: 200000, max: 1000000)
 * - includeSha (optional): Include blob/commit SHA (default: 'true')
 * - includeLineNumbers (optional): Include line numbers array (default: 'true')
 * 
 * Returns unified tool response envelope:
 * - 200: { success: true, data: ReadFileResult }
 * - 400: { success: false, error: { code, message, details } } - INVALID_PATH, RANGE_INVALID, INVALID_PARAMS, NOT_A_FILE
 * - 403: { success: false, error: { code, message, details } } - REPO_NOT_ALLOWED
 * - 413: { success: false, error: { code, message, details } } - FILE_TOO_LARGE
 * - 415: { success: false, error: { code, message, details } } - BINARY_OR_UNSUPPORTED_ENCODING
 * - 500: { success: false, error: { code, message, details } } - GITHUB_API_ERROR, AUTH_MISCONFIGURED
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  readFile,
  ReadFileParams,
  InvalidPathError,
  NotAFileError,
  FileTooLargeError,
  RangeInvalidError,
  BinaryOrUnsupportedEncodingError,
  GitHubAPIError,
  AuthMisconfiguredError,
  RepoAccessDeniedError,
} from '@/lib/github/read-file';
import {
  ok,
  failFromError,
  invalidParamsError,
} from '@/lib/api/tool-response';

/**
 * Schema for query parameter validation
 */
const QueryParamsSchema = z.object({
  owner: z.string().min(1, 'owner is required'),
  repo: z.string().min(1, 'repo is required'),
  path: z.string().min(1, 'path is required'),
  branch: z.string().optional(),
  startLine: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseInt(val, 10);
    if (isNaN(num)) return undefined;
    return num;
  }),
  endLine: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseInt(val, 10);
    if (isNaN(num)) return undefined;
    return num;
  }),
  maxBytes: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseInt(val, 10);
    if (isNaN(num)) return undefined;
    return num;
  }),
  includeSha: z.string().optional().transform((val) => {
    if (val === undefined) return undefined;
    return val === 'true';
  }),
  includeLineNumbers: z.string().optional().transform((val) => {
    if (val === undefined) return undefined;
    return val === 'true';
  }),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Extract and validate query parameters
  const rawParams = {
    owner: searchParams.get('owner') || undefined,
    repo: searchParams.get('repo') || undefined,
    path: searchParams.get('path') || undefined,
    branch: searchParams.get('branch') || undefined,
    startLine: searchParams.get('startLine') || undefined,
    endLine: searchParams.get('endLine') || undefined,
    maxBytes: searchParams.get('maxBytes') || undefined,
    includeSha: searchParams.get('includeSha') || undefined,
    includeLineNumbers: searchParams.get('includeLineNumbers') || undefined,
  };

  // Validate parameters
  const validation = QueryParamsSchema.safeParse(rawParams);
  if (!validation.success) {
    return invalidParamsError('Invalid query parameters', {
      errors: validation.error.errors,
    });
  }

  const params = validation.data;

  // Build readFile parameters
  const readFileParams: ReadFileParams = {
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    branch: params.branch,
    maxBytes: params.maxBytes,
    includeSha: params.includeSha,
    includeLineNumbers: params.includeLineNumbers,
  };

  // Add range if both startLine and endLine are provided
  if (params.startLine !== undefined && params.endLine !== undefined) {
    readFileParams.range = {
      startLine: params.startLine,
      endLine: params.endLine,
    };
  } else if (params.startLine !== undefined || params.endLine !== undefined) {
    // If only one is provided, return error
    return invalidParamsError(
      'Both startLine and endLine must be provided for range requests',
      {
        startLine: params.startLine,
        endLine: params.endLine,
      }
    );
  }

  try {
    // Call readFile function (enforces policy via I711 auth wrapper)
    const result = await readFile(readFileParams);

    // Return unified success response
    return ok(result);
  } catch (error: any) {
    // Use unified error handling
    return failFromError(error);
  }
}
