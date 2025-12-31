/**
 * E71.4: GitHub Search Code API Endpoint
 * 
 * Server-side API route for searching code with query constraints,
 * rate limit handling, result hashing, and policy enforcement.
 * 
 * GET /api/integrations/github/search-code?owner=X&repo=Y&branch=Z&query=Q&pathPrefix=P&limit=L&cursor=C
 * 
 * Query Parameters:
 * - owner (required): Repository owner
 * - repo (required): Repository name
 * - query (required): Search query (min 2, max 256 chars, no control chars)
 * - branch (optional): Branch name (default: 'main', NOTE: not reliably supported by GitHub API)
 * - pathPrefix (optional): Limit search to this path prefix
 * - fileGlobs (optional): Comma-separated file globs (e.g., "*.ts,*.md")
 * - caseSensitive (optional): Case-sensitive search (default: 'false')
 * - cursor (optional): Pagination cursor from previous response
 * - limit (optional): Results per page (default: 20, max: 50)
 * 
 * Returns:
 * - 200: { items: SearchCodeItem[], pageInfo: PageInfo, meta: SearchCodeMeta }
 * - 400: Invalid parameters (QUERY_INVALID, INVALID_PARAMS)
 * - 403: Repository not allowed by policy (REPO_NOT_ALLOWED) or rate limit (RATE_LIMIT_EXCEEDED)
 * - 500: GitHub API or internal error (GITHUB_API_ERROR)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  searchCode,
  SearchCodeParams,
  QueryInvalidError,
  RateLimitError,
  GitHubAPIError,
  RepoAccessDeniedError,
} from '@/lib/github/search-code';

/**
 * Schema for query parameter validation
 */
const QueryParamsSchema = z.object({
  owner: z.string().min(1, 'owner is required'),
  repo: z.string().min(1, 'repo is required'),
  query: z.string().min(1, 'query is required'),
  branch: z.string().optional(),
  pathPrefix: z.string().optional(),
  fileGlobs: z.string().optional().transform((val) => {
    if (!val) return undefined;
    return val.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }),
  caseSensitive: z.string().optional().transform((val) => {
    if (val === undefined) return undefined;
    return val === 'true';
  }),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseInt(val, 10);
    if (isNaN(num)) return undefined;
    return num;
  }),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Extract and validate query parameters
  const rawParams = {
    owner: searchParams.get('owner') || undefined,
    repo: searchParams.get('repo') || undefined,
    query: searchParams.get('query') || undefined,
    branch: searchParams.get('branch') || undefined,
    pathPrefix: searchParams.get('pathPrefix') || undefined,
    fileGlobs: searchParams.get('fileGlobs') || undefined,
    caseSensitive: searchParams.get('caseSensitive') || undefined,
    cursor: searchParams.get('cursor') || undefined,
    limit: searchParams.get('limit') || undefined,
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

  // Build searchCode parameters
  const searchCodeParams: SearchCodeParams = {
    owner: params.owner,
    repo: params.repo,
    query: params.query,
    branch: params.branch,
    pathPrefix: params.pathPrefix,
    fileGlobs: params.fileGlobs,
    caseSensitive: params.caseSensitive,
    cursor: params.cursor,
    limit: params.limit,
  };

  try {
    // Call searchCode function (enforces policy via I711 auth wrapper)
    const result = await searchCode(searchCodeParams);

    // Return result as-is
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    // Handle specific error types with appropriate status codes

    if (error instanceof QueryInvalidError) {
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

    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 403 }
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

    // Zod validation errors (from SearchCodeParamsSchema)
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
    console.error('[GitHub Search Code API] Unexpected error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'INTERNAL_ERROR',
        details: {
          owner: params.owner,
          repo: params.repo,
          query: params.query,
        },
      },
      { status: 500 }
    );
  }
}
