/**
 * GitHub Search Code Tool (I714 - E71.4)
 * 
 * Server-side tool for searching code within allowed repositories with:
 * - Query constraints (length, control chars, scoping)
 * - Rate limit handling with backoff
 * - Result hashing (SHA-256 for snippets)
 * - Deterministic pagination
 * - Policy enforcement via I711 auth wrapper
 * 
 * Reference: I714 (E71.4) - Tool searchCode
 */

import { z } from 'zod';
import { createAuthenticatedClient, RepoAccessDeniedError } from './auth-wrapper';
import { createHash } from 'crypto';

// ========================================
// Schemas and Types
// ========================================

/**
 * Schema for searchCode parameters
 */
export const SearchCodeParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default('main'),
  query: z.string()
    .min(2, 'Query must be at least 2 characters')
    .max(256, 'Query must not exceed 256 characters')
    .refine(
      (q) => !/[\r\n\x00-\x1F\x7F]/.test(q),
      { message: 'Query must not contain newline or control characters' }
    ),
  pathPrefix: z.string().optional(),
  fileGlobs: z.array(z.string()).optional(),
  caseSensitive: z.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export type SearchCodeParams = z.infer<typeof SearchCodeParamsSchema>;

/**
 * Match preview with hash
 */
export interface MatchPreview {
  preview: string;
  previewSha256: string;
  previewHash: string;
}

/**
 * Search result item
 */
export interface SearchCodeItem {
  path: string;
  sha: string | null;
  repository: {
    owner: string;
    repo: string;
  };
  url: string | null;
  score: number | null;
  match: MatchPreview;
}

/**
 * Pagination info
 */
export interface PageInfo {
  nextCursor: string | null;
}

/**
 * Metadata for the response
 */
export interface SearchCodeMeta {
  owner: string;
  repo: string;
  branch: string;
  branchEffective?: string;
  branchWarning?: string;
  query: string;
  pathPrefix?: string;
  limit: number;
  generatedAt: string;
  ordering: 'path_asc' | 'github_default_then_path_asc';
}

/**
 * Complete searchCode response
 */
export interface SearchCodeResult {
  items: SearchCodeItem[];
  pageInfo: PageInfo;
  meta: SearchCodeMeta;
}

/**
 * Cursor data structure (base64-encoded JSON)
 */
interface CursorData {
  lastPath: string;
  offset: number;
}

/**
 * Standard error response
 */
export interface SearchCodeError {
  code: string;
  message: string;
  details: {
    owner: string;
    repo: string;
    branch?: string;
    query?: string;
    pathPrefix?: string;
    httpStatus?: number;
    retryAfter?: number;
    requestId?: string;
  };
}

// ========================================
// Error Classes
// ========================================

export class QueryInvalidError extends Error {
  public readonly code = 'QUERY_INVALID';
  public readonly details: SearchCodeError['details'];

  constructor(message: string, details: Partial<SearchCodeError['details']> = {}) {
    super(message);
    this.name = 'QueryInvalidError';
    this.details = {
      owner: details.owner || '',
      repo: details.repo || '',
      ...details,
    };
  }
}

export class RateLimitError extends Error {
  public readonly code = 'RATE_LIMIT_EXCEEDED';
  public readonly details: SearchCodeError['details'];

  constructor(message: string, details: SearchCodeError['details']) {
    super(message);
    this.name = 'RateLimitError';
    this.details = details;
  }
}

export class GitHubAPIError extends Error {
  public readonly code = 'GITHUB_API_ERROR';
  public readonly details: SearchCodeError['details'];

  constructor(message: string, details: SearchCodeError['details']) {
    super(message);
    this.name = 'GitHubAPIError';
    this.details = details;
  }
}

// ========================================
// Hashing
// ========================================

/**
 * Compute SHA-256 hash of content
 */
function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Get short hash (first 12 chars of SHA-256)
 */
function getShortHash(sha256: string): string {
  return sha256.substring(0, 12);
}

/**
 * Sanitize and truncate preview text
 */
function sanitizePreview(text: string, maxLength: number = 300): string {
  // Remove control characters and normalize whitespace
  let sanitized = text.replace(/[\x00-\x1F\x7F]/g, ' ');
  
  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Create match preview with hashes
 */
function createMatchPreview(text: string): MatchPreview {
  const preview = sanitizePreview(text);
  const previewSha256 = computeSha256(preview);
  const previewHash = getShortHash(previewSha256);
  
  return {
    preview,
    previewSha256,
    previewHash,
  };
}

// ========================================
// Cursor Encoding/Decoding
// ========================================

/**
 * Encode cursor data to opaque string
 */
export function encodeCursor(data: CursorData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Decode cursor from opaque string
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8');
    const data = JSON.parse(json);
    if (typeof data.lastPath !== 'string' || typeof data.offset !== 'number') {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// ========================================
// Query Building
// ========================================

/**
 * Build GitHub Code Search query with constraints
 */
function buildSearchQuery(params: {
  owner: string;
  repo: string;
  query: string;
  pathPrefix?: string;
  fileGlobs?: string[];
}): string {
  const { owner, repo, query, pathPrefix, fileGlobs } = params;
  
  // Start with user query and repo scope
  const parts: string[] = [query];
  parts.push(`repo:${owner}/${repo}`);
  
  // Add path constraint if specified
  if (pathPrefix) {
    parts.push(`path:${pathPrefix}`);
  }
  
  // Add file glob constraints (minimal support)
  if (fileGlobs && fileGlobs.length > 0) {
    // GitHub search supports extension: and filename: qualifiers
    // Convert simple globs like "*.ts" to extension:ts
    fileGlobs.forEach((glob) => {
      if (glob.startsWith('**/*.') || glob.startsWith('*.')) {
        const ext = glob.replace(/^\*\*\/\*\./, '').replace(/^\*\./, '');
        if (ext && /^[a-zA-Z0-9]+$/.test(ext)) {
          parts.push(`extension:${ext}`);
        }
      } else if (glob.includes('/')) {
        // For paths with directories, use path: qualifier
        const pathPattern = glob.replace(/^\*\*\//, '');
        parts.push(`path:${pathPattern}`);
      }
    });
  }
  
  return parts.join(' ');
}

// ========================================
// Rate Limit Handling
// ========================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff calculation
 */
function calculateBackoff(attempt: number): number {
  // Base delay: 1s, max: 32s
  const baseDelay = 1000;
  const maxDelay = 32000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

// ========================================
// GitHub API Integration
// ========================================

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: Array<{
    name: string;
    path: string;
    sha: string;
    url: string;
    git_url: string;
    html_url: string;
    repository: {
      id: number;
      name: string;
      full_name: string;
      owner: {
        login: string;
      };
    };
    score: number;
    text_matches?: Array<{
      object_url: string;
      object_type: string;
      property: string;
      fragment: string;
      matches: Array<{
        text: string;
        indices: [number, number];
      }>;
    }>;
  }>;
}

/**
 * Fetch search results from GitHub Code Search API
 */
async function fetchSearchResults(
  octokit: any,
  searchQuery: string,
  perPage: number,
  page: number,
  maxRetries: number = 3
): Promise<GitHubSearchResponse> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await octokit.rest.search.code({
        q: searchQuery,
        per_page: perPage,
        page: page,
        // Request text_matches to get snippets
        headers: {
          accept: 'application/vnd.github.v3.text-match+json',
        },
      });
      
      return response.data;
    } catch (error: any) {
      // Handle rate limiting
      if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
        const resetTime = error.response?.headers?.['x-ratelimit-reset'];
        const retryAfter = resetTime 
          ? Math.max(0, parseInt(resetTime, 10) * 1000 - Date.now())
          : calculateBackoff(attempt);
        
        throw new RateLimitError(
          `GitHub API rate limit exceeded. Retry after ${Math.ceil(retryAfter / 1000)} seconds.`,
          {
            owner: '',
            repo: '',
            httpStatus: 403,
            retryAfter: Math.ceil(retryAfter / 1000),
          }
        );
      }
      
      // Handle secondary rate limit (abuse detection)
      if (error.status === 403 && error.message?.includes('secondary rate limit')) {
        attempt++;
        if (attempt >= maxRetries) {
          throw new RateLimitError(
            'GitHub API secondary rate limit exceeded. Please try again later.',
            {
              owner: '',
              repo: '',
              httpStatus: 403,
            }
          );
        }
        
        // Exponential backoff
        const backoffMs = calculateBackoff(attempt);
        await sleep(backoffMs);
        continue;
      }
      
      // Re-throw other errors
      throw error;
    }
  }
  
  // Should never reach here
  throw new Error('Unexpected error in fetchSearchResults');
}

// ========================================
// Result Processing
// ========================================

/**
 * Sort items by path (ascending)
 */
export function sortByPath(items: SearchCodeItem[]): SearchCodeItem[] {
  return [...items].sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });
}

/**
 * Convert GitHub API response to our format
 */
function convertToSearchCodeItems(
  apiResponse: GitHubSearchResponse,
  owner: string,
  repo: string
): SearchCodeItem[] {
  return apiResponse.items.map((item) => {
    // Extract preview from text_matches or use fragment
    let previewText = '';
    if (item.text_matches && item.text_matches.length > 0) {
      // Use the first text match fragment
      previewText = item.text_matches[0].fragment || '';
    }
    
    // Create match preview with hashes
    const match = createMatchPreview(previewText);
    
    return {
      path: item.path,
      sha: item.sha || null,
      repository: {
        owner: owner,
        repo: repo,
      },
      url: item.html_url || null,
      score: item.score || null,
      match,
    };
  });
}

/**
 * Apply pagination to items
 */
export function paginateItems(
  items: SearchCodeItem[],
  cursor: string | undefined,
  limit: number
): { items: SearchCodeItem[]; nextCursor: string | null } {
  // Decode cursor if present
  let startIndex = 0;
  if (cursor) {
    const cursorData = decodeCursor(cursor);
    if (cursorData) {
      startIndex = cursorData.offset;
    }
  }
  
  // Slice the page
  const pageItems = items.slice(startIndex, startIndex + limit);
  
  // Generate next cursor if there are more items
  const nextCursor =
    startIndex + limit < items.length && pageItems.length > 0
      ? encodeCursor({
          lastPath: pageItems[pageItems.length - 1].path,
          offset: startIndex + limit,
        })
      : null;
  
  return { items: pageItems, nextCursor };
}

// ========================================
// Main searchCode Function
// ========================================

/**
 * Search code in GitHub repository with policy enforcement
 * 
 * Note: GitHub Code Search API has limited branch support. This implementation
 * searches the entire repository and documents branch limitations in metadata.
 * 
 * @param params - Search code parameters
 * @returns Search results with items, pagination, and metadata
 * @throws QueryInvalidError, RateLimitError, GitHubAPIError, RepoAccessDeniedError
 */
export async function searchCode(params: SearchCodeParams): Promise<SearchCodeResult> {
  // Validate and normalize input
  const validated = SearchCodeParamsSchema.parse(params);
  const { owner, repo, branch, query, pathPrefix, fileGlobs, caseSensitive, cursor, limit } = validated;
  
  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({
    owner,
    repo,
    branch,
  });
  
  try {
    // Build GitHub search query
    const searchQuery = buildSearchQuery({
      owner,
      repo,
      query,
      pathPrefix,
      fileGlobs,
    });
    
    // Note: GitHub Code Search doesn't reliably support branch filtering in the query
    // We document this limitation in the response metadata
    
    // Fetch results from GitHub
    // For simplicity, we fetch more results than needed and paginate locally
    // This provides deterministic ordering across pagination
    const maxFetch = 100; // GitHub max per_page is 100
    const apiResponse = await fetchSearchResults(octokit, searchQuery, maxFetch, 1);
    
    // Convert API response to our format
    let items = convertToSearchCodeItems(apiResponse, owner, repo);
    
    // Sort deterministically by path
    items = sortByPath(items);
    
    // Apply pagination
    const { items: pageItems, nextCursor } = paginateItems(items, cursor, limit);
    
    // Build metadata
    const meta: SearchCodeMeta = {
      owner,
      repo,
      branch,
      branchEffective: 'default',
      branchWarning: 'GitHub Code Search API does not reliably support branch filtering. Results reflect the default branch.',
      query,
      pathPrefix,
      limit,
      generatedAt: new Date().toISOString(),
      ordering: 'path_asc',
    };
    
    const result: SearchCodeResult = {
      items: pageItems,
      pageInfo: {
        nextCursor,
      },
      meta,
    };
    
    return result;
  } catch (error: any) {
    // Re-throw our custom errors
    if (
      error instanceof QueryInvalidError ||
      error instanceof RateLimitError ||
      error instanceof RepoAccessDeniedError
    ) {
      throw error;
    }
    
    // Handle GitHub API errors
    if (error.status === 404) {
      throw new GitHubAPIError(
        `Repository not found: ${owner}/${repo}`,
        { owner, repo, branch, query, httpStatus: 404 }
      );
    }
    
    if (error.status === 403) {
      throw new GitHubAPIError(
        'GitHub API access forbidden. Check GitHub App permissions.',
        { owner, repo, branch, query, httpStatus: 403 }
      );
    }
    
    if (error.status === 422) {
      throw new QueryInvalidError(
        'Invalid search query. GitHub rejected the query.',
        { owner, repo, branch, query }
      );
    }
    
    // Generic error
    throw new GitHubAPIError(
      error instanceof Error ? error.message : 'Failed to search code in repository',
      { owner, repo, branch, query, httpStatus: error.status }
    );
  }
}

// ========================================
// Exports
// ========================================

export {
  RepoAccessDeniedError,
} from './auth-wrapper';
