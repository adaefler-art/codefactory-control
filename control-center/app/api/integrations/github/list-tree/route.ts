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
 * Returns unified tool response envelope:
 * - 200: { success: true, data: ListTreeResult }
 * - 400: { success: false, error: { code, message, details } } - INVALID_PATH, INVALID_PARAMS
 * - 403: { success: false, error: { code, message, details } } - REPO_NOT_ALLOWED
 * - 413: { success: false, error: { code, message, details } } - TREE_TOO_LARGE
 * - 500: { success: false, error: { code, message, details } } - GITHUB_API_ERROR
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  listTree,
  ListTreeParams,
  InvalidPathError,
  TreeTooLargeError,
  GitHubAPIError,
  RepoAccessDeniedError,
} from '@/lib/github/list-tree';
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
    return invalidParamsError('Invalid query parameters', {
      errors: validation.error.errors,
    });
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

    // Return unified success response
    return ok(result);
  } catch (error: any) {
    // Use unified error handling
    return failFromError(error);
  }
}
