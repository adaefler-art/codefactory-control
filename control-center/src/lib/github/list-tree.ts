/**
 * GitHub List Tree Tool (I712 - E71.2, E89.2)
 * 
 * Server-side tool for listing repository contents with:
 * - Deterministic ordering (path ascending)
 * - Cursor-based pagination
 * - Policy enforcement via I711 auth wrapper
 * - Support for recursive and non-recursive listing
 * - Result hash (SHA256) for deterministic verification (E89.2)
 * - Evidence metadata for audit trails (E89.2)
 * 
 * Reference: I712 (E71.2) - Tool listTree (branch/path, pagination, deterministic ordering)
 * Reference: E89.2 - Evidence Tool with result-hash and metadata
 */

import { z } from 'zod';
import { createHash } from 'crypto';
import { createAuthenticatedClient, RepoAccessDeniedError } from './auth-wrapper';

// ========================================
// Schemas and Types
// ========================================

/**
 * Schema for listTree parameters
 */
export const ListTreeParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default('main'),
  path: z.string().default(''),
  recursive: z.boolean().default(false),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(200),
  requestId: z.string().optional(), // E89.2: Request ID for audit trail
}).strict();

export type ListTreeParams = z.infer<typeof ListTreeParamsSchema>;

// ========================================
// E89.2: Bounded Output Constraints
// ========================================

const MAX_ITEMS_PER_PAGE = 200;
const MAX_RESPONSE_BYTES = 200 * 1024; // 200KB

/**
 * Tree entry item
 */
export interface TreeEntry {
  type: 'file' | 'dir';
  path: string;
  name: string;
  sha: string | null;
  size: number | null;
}

/**
 * Pagination info
 */
export interface PageInfo {
  nextCursor: string | null;
  totalEstimate: number | null;
}

/**
 * E89.2: Evidence metadata for audit trail
 */
export interface EvidenceMetadata {
  requestId: string;
  owner: string;
  repo: string;
  ref: string; // branch/tag
  path: string;
  itemCount: number;
  truncated: boolean; // true if output was clamped due to size/count limits
}

/**
 * Metadata for the response
 */
export interface TreeMeta {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  recursive: boolean;
  generatedAt: string;
  toolVersion: string;
  contractVersion: string;
  ordering: 'path_asc';
}

/**
 * Complete listTree response (E89.2)
 */
export interface ListTreeResult {
  items: TreeEntry[];
  pageInfo: PageInfo;
  meta: TreeMeta;
  evidence: EvidenceMetadata; // E89.2: Evidence metadata
  resultHash: string; // E89.2: SHA256 hash of canonical result
}

/**
 * Cursor data structure (base64-encoded JSON)
 */
interface CursorData {
  lastPath: string;
  lastSha?: string;
}

/**
 * Standard error response
 */
export interface ListTreeError {
  code: string;
  message: string;
  details: {
    owner: string;
    repo: string;
    branch?: string;
    path?: string;
    httpStatus?: number;
    requestId?: string;
  };
}

// ========================================
// Error Classes
// ========================================

export class InvalidPathError extends Error {
  public readonly code = 'INVALID_PATH';
  public readonly details: ListTreeError['details'];

  constructor(path: string, reason: string, details: Partial<ListTreeError['details']> = {}) {
    super(`Invalid path '${path}': ${reason}`);
    this.name = 'InvalidPathError';
    this.details = {
      owner: details.owner || '',
      repo: details.repo || '',
      path,
      ...details,
    };
  }
}

export class TreeTooLargeError extends Error {
  public readonly code = 'TREE_TOO_LARGE';
  public readonly details: ListTreeError['details'];

  constructor(message: string, details: ListTreeError['details']) {
    super(message);
    this.name = 'TreeTooLargeError';
    this.details = details;
  }
}

export class GitHubAPIError extends Error {
  public readonly code = 'GITHUB_API_ERROR';
  public readonly details: ListTreeError['details'];

  constructor(message: string, details: ListTreeError['details']) {
    super(message);
    this.name = 'GitHubAPIError';
    this.details = details;
  }
}

// ========================================
// Path Validation & Normalization
// ========================================

/**
 * Normalize and validate a path
 * - Remove leading/trailing slashes
 * - Reject ".." traversal
 * - Reject backslashes
 * - Return normalized path or throw InvalidPathError
 */
export function normalizePath(path: string, details?: Partial<ListTreeError['details']>): string {
  // Reject backslashes
  if (path.includes('\\')) {
    throw new InvalidPathError(path, 'Backslashes not allowed', details);
  }

  // Reject parent directory traversal
  if (path.includes('..')) {
    throw new InvalidPathError(path, 'Parent directory traversal (..) not allowed', details);
  }

  // Normalize: remove leading/trailing slashes
  let normalized = path.trim();
  normalized = normalized.replace(/^\/+/, ''); // Remove leading slashes
  normalized = normalized.replace(/\/+$/, ''); // Remove trailing slashes

  // Reject absolute paths that weren't caught above
  if (normalized.startsWith('/')) {
    throw new InvalidPathError(path, 'Absolute paths not allowed', details);
  }

  return normalized;
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
    if (!data.lastPath) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// ========================================
// E89.2: Canonical JSON & Result Hash
// ========================================

/**
 * Serialize object to canonical JSON with sorted keys
 * This ensures deterministic serialization for hash computation
 */
export function canonicalJSON(obj: any): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    // Arrays: serialize each element canonically
    return '[' + obj.map(item => canonicalJSON(item)).join(',') + ']';
  }
  
  // Objects: sort keys and serialize
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    const value = canonicalJSON(obj[key]);
    return `"${key}":${value}`;
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA256 hash of canonical JSON representation
 */
export function computeResultHash(result: Omit<ListTreeResult, 'resultHash'>): string {
  const canonical = canonicalJSON(result);
  return createHash('sha256')
    .update(canonical, 'utf-8')
    .digest('hex');
}

// ========================================
// GitHub API Adapters
// ========================================

/**
 * Fetch tree entries from GitHub (non-recursive mode)
 * Uses Contents API for directory listing
 */
async function fetchNonRecursive(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<TreeEntry[]> {
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: path || '',
    ref: branch,
  });

  // Handle single file response
  if (!Array.isArray(response.data)) {
    // Single file - return it as an array
    return [{
      type: response.data.type === 'dir' ? 'dir' : 'file',
      path: response.data.path,
      name: response.data.name,
      sha: response.data.sha || null,
      size: response.data.size || null,
    }];
  }

  // Directory listing
  return response.data.map((item: any) => ({
    type: item.type === 'dir' ? 'dir' : 'file',
    path: item.path,
    name: item.name,
    sha: item.sha || null,
    size: item.size || null,
  }));
}

/**
 * Fetch tree entries from GitHub (recursive mode)
 * Uses Git Trees API for recursive listing
 */
async function fetchRecursive(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<TreeEntry[]> {
  // Step 1: Get branch reference to get commit SHA
  const refResponse = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });

  const commitSha = refResponse.data.object.sha;

  // Step 2: Get commit to get tree SHA
  const commitResponse = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: commitSha,
  });

  const treeSha = commitResponse.data.tree.sha;

  // Step 3: Get tree recursively
  const treeResponse = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: 'true',
  });

  // Check if tree was truncated (too large)
  if (treeResponse.data.truncated) {
    throw new TreeTooLargeError(
      'Repository tree is too large for recursive listing. Use non-recursive mode or specify a narrower path.',
      { owner, repo, branch, path }
    );
  }

  // Convert to our format and filter by path prefix if needed
  let entries = treeResponse.data.tree.map((item: any) => ({
    type: item.type === 'tree' ? 'dir' : 'file',
    path: item.path,
    name: item.path.split('/').pop() || item.path,
    sha: item.sha || null,
    size: item.size || null,
  }));

  // Filter by path prefix if path is specified
  if (path) {
    const prefix = path + '/';
    entries = entries.filter((entry: TreeEntry) => 
      entry.path === path || entry.path.startsWith(prefix)
    );
  }

  return entries;
}

// ========================================
// Sorting & Pagination
// ========================================

/**
 * Sort entries by path (ascending, case-sensitive)
 */
export function sortByPath(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });
}

/**
 * Apply pagination to sorted entries with bounded output (E89.2)
 */
export function paginateEntries(
  entries: TreeEntry[],
  cursor: string | undefined,
  limit: number
): { items: TreeEntry[]; nextCursor: string | null; truncated: boolean } {
  // E89.2: Clamp limit to MAX_ITEMS_PER_PAGE
  const effectiveLimit = Math.min(limit, MAX_ITEMS_PER_PAGE);
  
  // Decode cursor if present
  let startIndex = 0;
  if (cursor) {
    const cursorData = decodeCursor(cursor);
    if (cursorData) {
      // Find the first item after the cursor's lastPath
      startIndex = entries.findIndex((e) => e.path > cursorData.lastPath);
      if (startIndex === -1) {
        // No more items after cursor
        return { items: [], nextCursor: null, truncated: false };
      }
    }
  }

  // Slice the page
  const items = entries.slice(startIndex, startIndex + effectiveLimit);

  // Generate next cursor if there are more items
  const nextCursor =
    startIndex + effectiveLimit < entries.length && items.length > 0
      ? encodeCursor({ lastPath: items[items.length - 1].path, lastSha: items[items.length - 1].sha || undefined })
      : null;

  // E89.2: Detect truncation (if limit was clamped or if there's more data)
  const truncated = limit > MAX_ITEMS_PER_PAGE || nextCursor !== null;

  return { items, nextCursor, truncated };
}

// ========================================
// Main listTree Function
// ========================================

/**
 * List repository tree with policy enforcement and deterministic pagination
 * 
 * @param params - List tree parameters
 * @returns Tree listing result with items, pagination, and metadata
 * @throws InvalidPathError, TreeTooLargeError, GitHubAPIError, RepoAccessDeniedError
 */
export async function listTree(params: ListTreeParams): Promise<ListTreeResult> {
  // Validate and normalize input
  const validated = ListTreeParamsSchema.parse(params);
  const { owner, repo, branch, path, recursive, cursor, limit, requestId } = validated;

  // E89.2: Generate requestId if not provided
  const effectiveRequestId = requestId || `listTree-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  // Normalize and validate path
  const normalizedPath = normalizePath(path, { owner, repo, branch });

  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({
    owner,
    repo,
    branch,
    path: normalizedPath,
    requestId: effectiveRequestId,
  });

  try {
    // Fetch entries from GitHub
    let entries: TreeEntry[];
    if (recursive) {
      entries = await fetchRecursive(octokit, owner, repo, branch, normalizedPath);
    } else {
      entries = await fetchNonRecursive(octokit, owner, repo, branch, normalizedPath);
    }

    // Sort deterministically by path
    const sortedEntries = sortByPath(entries);

    // Apply pagination with bounded output (E89.2)
    const { items, nextCursor, truncated } = paginateEntries(sortedEntries, cursor, limit);

    // E89.2: Build evidence metadata
    const evidence: EvidenceMetadata = {
      requestId: effectiveRequestId,
      owner,
      repo,
      ref: branch,
      path: normalizedPath,
      itemCount: items.length,
      truncated,
    };

    // Build response without hash first
    const resultWithoutHash: Omit<ListTreeResult, 'resultHash'> = {
      items,
      pageInfo: {
        nextCursor,
        totalEstimate: sortedEntries.length,
      },
      meta: {
        owner,
        repo,
        branch,
        path: normalizedPath,
        recursive,
        generatedAt: new Date().toISOString(),
        toolVersion: '1.1.0', // E89.2
        contractVersion: 'E89.2',
        ordering: 'path_asc',
      },
      evidence,
    };

    // E89.2: Compute result hash
    const resultHash = computeResultHash(resultWithoutHash);

    // Build final result with hash
    const result: ListTreeResult = {
      ...resultWithoutHash,
      resultHash,
    };

    return result;
  } catch (error: any) {
    // Handle specific error types
    if (error instanceof TreeTooLargeError || error instanceof InvalidPathError) {
      throw error;
    }

    if (error instanceof RepoAccessDeniedError) {
      throw error;
    }

    // Handle GitHub API errors
    if (error.status === 404) {
      throw new GitHubAPIError(
        `Repository, branch, or path not found: ${owner}/${repo} (branch: ${branch}, path: ${normalizedPath})`,
        { owner, repo, branch, path: normalizedPath, httpStatus: 404, requestId: effectiveRequestId }
      );
    }

    if (error.status === 403) {
      throw new GitHubAPIError(
        'GitHub API access forbidden. Check GitHub App permissions.',
        { owner, repo, branch, path: normalizedPath, httpStatus: 403, requestId: effectiveRequestId }
      );
    }

    // Generic error
    throw new GitHubAPIError(
      error instanceof Error ? error.message : 'Failed to list repository tree',
      { owner, repo, branch, path: normalizedPath, httpStatus: error.status, requestId: effectiveRequestId }
    );
  }
}

// ========================================
// Exports
// ========================================

export {
  RepoAccessDeniedError,
} from './auth-wrapper';
