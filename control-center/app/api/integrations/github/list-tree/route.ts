/**
 * E71.2: GitHub List Tree API Endpoint
 * 
 * Server-side API route for listing repository tree contents with deterministic
 * ordering, cursor-based pagination, and policy enforcement.
 * 
 * GET /api/integrations/github/list-tree?owner=X&repo=Y&branch=Z&path=P&recursive=R&limit=L&cursor=C
 * 
 * Query Parameters:
 * - owner (required): Repository owner
 * - repo (required): Repository name
 * - branch (optional): Branch name (default: 'main')
 * - path (optional): Path within repo (default: '')
 * - recursive (optional): Recursive listing (default: 'false')
 * - limit (optional): Page size 1-500 (default: 200)
 * - cursor (optional): Pagination cursor from previous response
 * 
 * Returns:
 * - 200: { items: TreeEntry[], pageInfo: PageInfo, meta: TreeMeta }
 * - 400: Invalid parameters (INVALID_PATH, INVALID_PARAMS)
 * - 403: Repository not allowed by policy (REPO_NOT_ALLOWED)
 * - 413: Tree too large for recursive mode (TREE_TOO_LARGE)
 * - 500: GitHub API or internal error (GITHUB_API_ERROR, AUTH_MISCONFIGURED)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listTree,
  ListTreeParams,
  InvalidPathError,
  TreeTooLargeError,
  GitHubAPIError,
  RepoAccessDeniedError,
} from '@/lib/github/list-tree';

/**
 * Schema for query parameter validation
 */
const QueryParamsSchema = z.object({
  owner: z.string().min(1, 'owner is required'),
  repo: z.string().min(1, 'repo is required'),
  branch: z.string().optional(),
  path: z.string().optional(),
  recursive: z.string().optional().transform((val) => val === 'true'),
  limit: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const num = parseInt(val, 10);
    if (isNaN(num)) return undefined;
    return num;
  }),
  cursor: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Extract and validate query parameters
  const rawParams = {
    owner: searchParams.get('owner') || undefined,
    repo: searchParams.get('repo') || undefined,
    branch: searchParams.get('branch') || undefined,
    path: searchParams.get('path') || undefined,
    recursive: searchParams.get('recursive') || undefined,
    limit: searchParams.get('limit') || undefined,
    cursor: searchParams.get('cursor') || undefined,
  };

  // Validate required parameters
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

  // Build listTree parameters
  const listTreeParams: ListTreeParams = {
    owner: params.owner,
    repo: params.repo,
    branch: params.branch,
    path: params.path,
    recursive: params.recursive,
    limit: params.limit,
    cursor: params.cursor,
  };

  try {
    // Call listTree function (enforces policy via I711 auth wrapper)
    const result = await listTree(listTreeParams);

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

    if (error instanceof TreeTooLargeError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 413 } // 413 Payload Too Large
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

    // Generic error handling
    console.error('[GitHub List Tree API] Unexpected error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'INTERNAL_ERROR',
        details: {
          owner: params.owner,
          repo: params.repo,
        },
      },
      { status: 500 }
    );
  }
}
