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
 * Returns unified tool response envelope:
 * - 200: { success: true, data: SearchCodeResult }
 * - 400: { success: false, error: { code, message, details } } - QUERY_INVALID, INVALID_PARAMS
 * - 403: { success: false, error: { code, message, details } } - REPO_NOT_ALLOWED, RATE_LIMIT_EXCEEDED
 * - 500: { success: false, error: { code, message, details } } - GITHUB_API_ERROR
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  searchCode,
  SearchCodeParams,
  QueryInvalidError,
  RateLimitError,
  GitHubAPIError,
  RepoAccessDeniedError,
} from '@/lib/github/search-code';
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
    return invalidParamsError('Invalid query parameters', {
      errors: validation.error.errors,
    });
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

    // Return unified success response
    return ok(result);
  } catch (error: any) {
    // Use unified error handling
    return failFromError(error);
  }
}
