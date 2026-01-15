/**
 * Evidence Tool: searchCode
 * 
 * INTENT agent tool for searching code in GitHub repositories with:
 * - Query constraints (max 200 chars, disallow empty/dangerous queries)
 * - maxResults clamping (default 20, max 50)
 * - Deterministic ordering (path, then line, then sha)
 * - Result hash (SHA-256 of canonical results)
 * - Rate-limit handling with E82.4 retry policy
 * - Optional path prefix filtering
 * 
 * Reference: E89.4 - Evidence Tool "searchCode"
 */

import { searchCode as githubSearchCode, SearchCodeItem } from '../github/search-code';
import { withRetry, DEFAULT_RETRY_CONFIG } from '../github/retry-policy';
import { createHash } from 'crypto';

// ========================================
// Constants
// ========================================

/**
 * Maximum query length for evidence tool (200 chars)
 * Stricter than base searchCode (256) to ensure bounded queries
 */
export const MAX_EVIDENCE_QUERY_LENGTH = 200;

/**
 * Maximum results returned in a single request (50)
 */
export const MAX_EVIDENCE_RESULTS = 50;

/**
 * Default results if not specified (20)
 */
export const DEFAULT_EVIDENCE_RESULTS = 20;

// ========================================
// Types
// ========================================

export interface SearchCodeEvidenceParams {
  owner: string;
  repo: string;
  ref?: string; // branch/tag/commit SHA (default: 'main')
  query: string;
  path?: string; // Optional path prefix filter
  maxResults?: number; // Max results (default: 20, max: 50)
}

export interface SearchCodeEvidenceResult {
  success: boolean;
  items?: SearchCodeEvidenceItem[];
  meta?: {
    owner: string;
    repo: string;
    ref: string;
    query: string;
    path?: string;
    maxResults: number;
    totalReturned: number;
    resultHash: string; // SHA-256 hash of canonical results
    resultHashShort: string; // First 12 chars of hash
    ordering: 'deterministic_path_sha';
    generatedAt: string;
  };
  error?: string;
  errorCode?: string;
}

export interface SearchCodeEvidenceItem {
  path: string;
  sha: string | null;
  url: string | null;
  preview: string;
  previewHash: string;
}

// ========================================
// Query Validation
// ========================================

/**
 * Validate query for dangerous patterns
 */
function validateQuery(query: string): { valid: boolean; error?: string } {
  // Check empty
  if (!query || query.trim().length === 0) {
    return {
      valid: false,
      error: 'Query cannot be empty',
    };
  }

  // Check length
  if (query.length > MAX_EVIDENCE_QUERY_LENGTH) {
    return {
      valid: false,
      error: `Query exceeds maximum length of ${MAX_EVIDENCE_QUERY_LENGTH} characters (got ${query.length})`,
    };
  }

  // Check for dangerous broad queries
  const trimmed = query.trim();
  if (trimmed === '*' || trimmed === '**') {
    return {
      valid: false,
      error: 'Query cannot be wildcard-only (* or **)',
    };
  }

  // Check for control characters
  if (/[\r\n\x00-\x1F\x7F]/.test(query)) {
    return {
      valid: false,
      error: 'Query must not contain newline or control characters',
    };
  }

  return { valid: true };
}

// ========================================
// Deterministic Sorting
// ========================================

/**
 * Sort items deterministically by path, then sha
 * 
 * This ensures identical inputs produce identical ordering.
 */
function sortItemsDeterministic(items: SearchCodeItem[]): SearchCodeItem[] {
  return [...items].sort((a, b) => {
    // Primary: path (ascending)
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;

    // Secondary: sha (ascending, null comes last)
    if (a.sha === null && b.sha === null) return 0;
    if (a.sha === null) return 1;
    if (b.sha === null) return -1;
    if (a.sha < b.sha) return -1;
    if (a.sha > b.sha) return 1;

    return 0;
  });
}

// ========================================
// Result Hashing
// ========================================

/**
 * Create canonical string representation of results for hashing
 * 
 * Format: path|sha|preview\n (one per item, deterministically sorted)
 */
function createCanonicalResultString(items: SearchCodeEvidenceItem[]): string {
  return items
    .map((item) => `${item.path}|${item.sha || 'null'}|${item.preview}`)
    .join('\n');
}

/**
 * Compute SHA-256 hash of canonical results
 */
function computeResultHash(items: SearchCodeEvidenceItem[]): string {
  const canonical = createCanonicalResultString(items);
  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

/**
 * Get short hash (first 12 chars)
 */
function getShortHash(hash: string): string {
  return hash.substring(0, 12);
}

// ========================================
// Result Conversion
// ========================================

/**
 * Convert GitHub search code items to evidence items
 */
function convertToEvidenceItems(items: SearchCodeItem[]): SearchCodeEvidenceItem[] {
  return items.map((item) => ({
    path: item.path,
    sha: item.sha,
    url: item.url,
    preview: item.match.preview,
    previewHash: item.match.previewHash,
  }));
}

// ========================================
// Main Evidence Tool Function
// ========================================

/**
 * Search code in GitHub repository (evidence-aware)
 * 
 * Enforces stricter constraints than base searchCode for bounded evidence output.
 * Returns deterministic hashes for audit/reproducibility.
 * Uses E82.4 retry policy for rate-limit handling.
 * 
 * @param params - Search code parameters
 * @returns Evidence result with items, metadata, and result hash
 */
export async function searchCodeEvidence(
  params: SearchCodeEvidenceParams
): Promise<SearchCodeEvidenceResult> {
  const {
    owner,
    repo,
    ref = 'main',
    query,
    path,
    maxResults = DEFAULT_EVIDENCE_RESULTS,
  } = params;

  // Validate query
  const queryValidation = validateQuery(query);
  if (!queryValidation.valid) {
    return {
      success: false,
      error: queryValidation.error!,
      errorCode: 'INVALID_QUERY_400',
    };
  }

  // Clamp maxResults
  const clampedMaxResults = Math.min(Math.max(1, maxResults), MAX_EVIDENCE_RESULTS);

  try {
    // Call GitHub searchCode with retry policy (E82.4)
    const searchFn = async () => {
      return await githubSearchCode({
        owner,
        repo,
        branch: ref,
        query,
        pathPrefix: path,
        limit: clampedMaxResults,
      });
    };

    // Execute with retry policy for rate-limit handling
    const result = await withRetry(searchFn, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 3,
      httpMethod: 'GET',
      requestId: `searchCode-${owner}-${repo}-${Date.now()}`,
      endpoint: '/search/code',
    });

    // Sort items deterministically
    const sortedItems = sortItemsDeterministic(result.items);

    // Convert to evidence items
    const evidenceItems = convertToEvidenceItems(sortedItems);

    // Compute result hash
    const resultHash = computeResultHash(evidenceItems);
    const resultHashShort = getShortHash(resultHash);

    return {
      success: true,
      items: evidenceItems,
      meta: {
        owner,
        repo,
        ref,
        query,
        path,
        maxResults: clampedMaxResults,
        totalReturned: evidenceItems.length,
        resultHash,
        resultHashShort,
        ordering: 'deterministic_path_sha',
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error: any) {
    // Map known error types to evidence error codes
    const errorCode = error.code || 'UNKNOWN_ERROR';
    const errorMessage = error.message || 'Unknown error occurred';

    // Map error codes to HTTP-like status codes for clarity
    let mappedErrorCode = errorCode;
    if (errorCode === 'QUERY_INVALID') {
      mappedErrorCode = 'INVALID_QUERY_400';
    } else if (errorCode === 'RATE_LIMIT_EXCEEDED' || errorMessage.includes('rate limit')) {
      mappedErrorCode = 'GITHUB_RATE_LIMIT';
    } else if (errorCode === 'REPO_NOT_ALLOWED' || errorCode === 'BRANCH_NOT_ALLOWED') {
      mappedErrorCode = 'REPO_ACCESS_DENIED_403';
    } else if (errorCode === 'GITHUB_API_ERROR') {
      mappedErrorCode = 'GITHUB_API_ERROR';
    }

    return {
      success: false,
      error: errorMessage,
      errorCode: mappedErrorCode,
    };
  }
}
