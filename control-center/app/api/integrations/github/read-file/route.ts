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
 * Returns:
 * - 200: { meta: ReadFileMeta, content: ReadFileContent }
 * - 400: Invalid parameters (INVALID_PATH, RANGE_INVALID, INVALID_PARAMS)
 * - 403: Repository not allowed by policy (REPO_NOT_ALLOWED)
 * - 413: File too large (FILE_TOO_LARGE)
 * - 415: Binary or unsupported encoding (BINARY_OR_UNSUPPORTED_ENCODING)
 * - 500: GitHub API or internal error (GITHUB_API_ERROR, AUTH_MISCONFIGURED)
 */

import { NextRequest, NextResponse } from 'next/server';
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
    return NextResponse.json(
      {
        error: 'Invalid query parameters',
        code: 'INVALID_PARAMS',
        details: {
          errors: validation.error.errors,
        },
      },
      { status: 400 }
    );
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
    return NextResponse.json(
      {
        error: 'Both startLine and endLine must be provided for range requests',
        code: 'INVALID_PARAMS',
        details: {
          startLine: params.startLine,
          endLine: params.endLine,
        },
      },
      { status: 400 }
    );
  }

  try {
    // Call readFile function (enforces policy via I711 auth wrapper)
    const result = await readFile(readFileParams);

    // Return result as-is
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    // Handle specific error types with appropriate status codes

    if (error instanceof InvalidPathError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 400 }
      );
    }

    if (error instanceof NotAFileError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 400 }
      );
    }

    if (error instanceof RangeInvalidError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 400 }
      );
    }

    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 403 }
      );
    }

    if (error instanceof FileTooLargeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 413 } // 413 Payload Too Large
      );
    }

    if (error instanceof BinaryOrUnsupportedEncodingError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 415 } // 415 Unsupported Media Type
      );
    }

    if (error instanceof AuthMisconfiguredError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 500 }
      );
    }

    if (error instanceof GitHubAPIError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.details?.httpStatus || 500 }
      );
    }

    // Zod validation errors (from ReadFileParamsSchema)
    if (error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: 'Invalid parameters',
          code: 'INVALID_PARAMS',
          details: {
            errors: error.errors,
          },
        },
        { status: 400 }
      );
    }

    // Generic error handling
    console.error('[GitHub Read File API] Unexpected error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'INTERNAL_ERROR',
        details: {
          owner: params.owner,
          repo: params.repo,
          path: params.path,
        },
      },
      { status: 500 }
    );
  }
}
