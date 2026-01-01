/**
 * Canonical-ID Resolver for GitHub Issues (I751 / E75.1)
 * 
 * Ensures CR → GitHub Issue generation is idempotent by finding existing
 * GitHub issues for the same Canonical ID and updating them, or creating new ones.
 * 
 * NON-NEGOTIABLES:
 * - GitHub auth: GitHub App server-to-server only (JWT → Installation Token)
 * - Enforce Repo Access Policy (I711) for every GitHub call
 * - Idempotency: same canonicalId maps to exactly one GitHub issue
 * - Determinism: stable resolver behavior and error formats
 * 
 * CANONICAL ID MARKERS:
 * - Title prefix: `[CID:<canonicalId>] <CR title>`
 * - Body marker: `Canonical-ID: <canonicalId>` (single line)
 * - Resolver matches either marker; prefers body marker if both exist
 */

import { createAuthenticatedClient } from './auth-wrapper';

// ========================================
// Types
// ========================================

/**
 * Resolver mode indicating whether an issue was found or not
 */
export type ResolverMode = 'found' | 'not_found';

/**
 * Which marker was used to match the issue
 */
export type MatchedBy = 'title' | 'body';

/**
 * Result of resolving a canonical ID to a GitHub issue
 */
export interface CanonicalIdResolverResult {
  /** Whether an existing issue was found */
  mode: ResolverMode;
  /** GitHub issue number (only present when mode='found') */
  issueNumber?: number;
  /** GitHub issue URL (only present when mode='found') */
  issueUrl?: string;
  /** Which marker was used to match (only present when mode='found') */
  matchedBy?: MatchedBy;
}

/**
 * Input for resolving a canonical ID
 */
export interface ResolveCanonicalIdInput {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Canonical ID to search for */
  canonicalId: string;
}

// ========================================
// Constants
// ========================================

/**
 * Title marker prefix for canonical ID
 * Format: [CID:<canonicalId>] <title>
 */
const TITLE_MARKER_PREFIX = '[CID:';
const TITLE_MARKER_SUFFIX = ']';

/**
 * Body marker for canonical ID
 * Format: Canonical-ID: <canonicalId>
 */
const BODY_MARKER_PREFIX = 'Canonical-ID:';

// ========================================
// Error Types
// ========================================

export class CanonicalIdResolverError extends Error {
  public readonly code = 'CANONICAL_ID_RESOLVER_ERROR';
  
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalIdResolverError';
  }
}

// ========================================
// Marker Extraction Functions
// ========================================

/**
 * Extract canonical ID from issue title
 * 
 * Expected format: [CID:<canonicalId>] <title>
 * 
 * @param title - GitHub issue title
 * @returns Canonical ID if found, null otherwise
 * 
 * @example
 * extractCanonicalIdFromTitle('[CID:CR-2026-01-01-001] Fix bug')
 * // → 'CR-2026-01-01-001'
 * 
 * extractCanonicalIdFromTitle('Regular title')
 * // → null
 */
export function extractCanonicalIdFromTitle(title: string): string | null {
  if (!title || typeof title !== 'string') {
    return null;
  }

  const trimmed = title.trim();
  
  // Check if title starts with [CID:
  if (!trimmed.startsWith(TITLE_MARKER_PREFIX)) {
    return null;
  }

  // Find the closing ]
  const closingBracketIndex = trimmed.indexOf(TITLE_MARKER_SUFFIX, TITLE_MARKER_PREFIX.length);
  if (closingBracketIndex === -1) {
    return null;
  }

  // Extract the canonical ID between [CID: and ]
  const canonicalId = trimmed.substring(TITLE_MARKER_PREFIX.length, closingBracketIndex).trim();
  
  // Validate it's non-empty
  if (!canonicalId) {
    return null;
  }

  return canonicalId;
}

/**
 * Extract canonical ID from issue body
 * 
 * Expected format: Single line containing "Canonical-ID: <canonicalId>"
 * 
 * @param body - GitHub issue body
 * @returns Canonical ID if found, null otherwise
 * 
 * @example
 * extractCanonicalIdFromBody('Description\n\nCanonical-ID: CR-2026-01-01-001\n\nMore text')
 * // → 'CR-2026-01-01-001'
 * 
 * extractCanonicalIdFromBody('No marker here')
 * // → null
 */
export function extractCanonicalIdFromBody(body: string | null | undefined): string | null {
  if (!body || typeof body !== 'string') {
    return null;
  }

  // Split into lines and search for the marker
  const lines = body.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check if line starts with Canonical-ID:
    if (trimmed.startsWith(BODY_MARKER_PREFIX)) {
      // Extract the canonical ID after the prefix
      const canonicalId = trimmed.substring(BODY_MARKER_PREFIX.length).trim();
      
      // Validate it's non-empty
      if (canonicalId) {
        return canonicalId;
      }
    }
  }

  return null;
}

/**
 * Check if an issue matches the canonical ID
 * 
 * Checks both title and body markers.
 * Returns match info including which marker was used.
 * Prefers body marker if both are present.
 * 
 * @param issue - GitHub issue object
 * @param canonicalId - Canonical ID to match
 * @returns Match result with matchedBy indicator, or null if no match
 */
export function checkIssueMatch(
  issue: { title: string; body?: string | null },
  canonicalId: string
): { matched: true; matchedBy: MatchedBy } | { matched: false } {
  const titleCanonicalId = extractCanonicalIdFromTitle(issue.title);
  const bodyCanonicalId = extractCanonicalIdFromBody(issue.body);

  // Prefer body marker if both exist
  if (bodyCanonicalId === canonicalId) {
    return { matched: true, matchedBy: 'body' };
  }

  if (titleCanonicalId === canonicalId) {
    return { matched: true, matchedBy: 'title' };
  }

  return { matched: false };
}

// ========================================
// GitHub Search Functions
// ========================================

/**
 * Search GitHub issues in a repository for a canonical ID
 * 
 * Uses GitHub Search API to find issues that might contain the canonical ID.
 * Searches in both title and body.
 * 
 * @param input - Repository and canonical ID to search for
 * @returns Array of matching issues
 */
async function searchIssuesForCanonicalId(input: ResolveCanonicalIdInput): Promise<
  Array<{
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: string;
  }>
> {
  const { owner, repo, canonicalId } = input;

  // Get authenticated Octokit client (with policy enforcement)
  const octokit = await createAuthenticatedClient({ owner, repo });

  // Search for issues containing the canonical ID
  // We search in title and body to catch both markers
  const searchQuery = `repo:${owner}/${repo} is:issue "${canonicalId}"`;

  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: searchQuery,
      per_page: 100, // Get up to 100 results
    });

    // Filter out pull requests (we only want issues)
    const issues = response.data.items.filter((item) => !item.pull_request);

    return issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || null,
      html_url: issue.html_url,
      state: issue.state,
    }));
  } catch (error) {
    throw new CanonicalIdResolverError(
      `Failed to search issues in ${owner}/${repo}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// ========================================
// Main Resolver Function
// ========================================

/**
 * Resolve a canonical ID to a GitHub issue
 * 
 * **Algorithm:**
 * 1. Search issues in repo for canonicalId using GitHub Search API
 * 2. Filter results to find exact matches (by title or body marker)
 * 3. If multiple matches found (shouldn't happen), return first match with body marker,
 *    or first match overall
 * 4. If no matches found, return not_found
 * 
 * **Idempotency Guarantee:**
 * - Same canonicalId always maps to the same issue (if found)
 * - Deterministic search and matching logic
 * - No side effects (read-only operation)
 * 
 * **Policy Enforcement:**
 * - Uses auth-wrapper which enforces I711 Repo Access Policy
 * - Throws RepoAccessDeniedError if repo not allowed
 * 
 * @param input - Repository and canonical ID to resolve
 * @returns Resolver result with issue info if found
 * @throws RepoAccessDeniedError if repository access denied by policy
 * @throws CanonicalIdResolverError if search fails
 * 
 * @example
 * // Issue found
 * await resolveCanonicalId({
 *   owner: 'adaefler-art',
 *   repo: 'codefactory-control',
 *   canonicalId: 'CR-2026-01-01-001'
 * })
 * // → {
 * //   mode: 'found',
 * //   issueNumber: 742,
 * //   issueUrl: 'https://github.com/adaefler-art/codefactory-control/issues/742',
 * //   matchedBy: 'body'
 * // }
 * 
 * // Issue not found
 * await resolveCanonicalId({
 *   owner: 'adaefler-art',
 *   repo: 'codefactory-control',
 *   canonicalId: 'CR-NONEXISTENT'
 * })
 * // → { mode: 'not_found' }
 */
export async function resolveCanonicalId(
  input: ResolveCanonicalIdInput
): Promise<CanonicalIdResolverResult> {
  const { canonicalId } = input;

  // Validate input
  if (!canonicalId || typeof canonicalId !== 'string' || !canonicalId.trim()) {
    throw new CanonicalIdResolverError('canonicalId must be a non-empty string');
  }

  // Search for issues (with policy enforcement via auth-wrapper)
  const searchResults = await searchIssuesForCanonicalId(input);

  // Filter to find exact matches
  const matches: Array<{
    issue: typeof searchResults[number];
    matchedBy: MatchedBy;
  }> = [];

  for (const issue of searchResults) {
    const matchResult = checkIssueMatch(issue, canonicalId);
    if (matchResult.matched) {
      matches.push({
        issue,
        matchedBy: matchResult.matchedBy,
      });
    }
  }

  // If no matches, return not_found
  if (matches.length === 0) {
    return { mode: 'not_found' };
  }

  // Prefer body marker matches over title marker matches
  const bodyMatches = matches.filter((m) => m.matchedBy === 'body');
  const selectedMatch = bodyMatches.length > 0 ? bodyMatches[0] : matches[0];

  // Return found result
  return {
    mode: 'found',
    issueNumber: selectedMatch.issue.number,
    issueUrl: selectedMatch.issue.html_url,
    matchedBy: selectedMatch.matchedBy,
  };
}

// ========================================
// Marker Generation Helpers (for I752)
// ========================================

/**
 * Generate title with canonical ID marker
 * 
 * @param canonicalId - Canonical ID
 * @param title - Original title
 * @returns Title with canonical ID marker
 * 
 * @example
 * generateTitleWithMarker('CR-2026-01-01-001', 'Fix bug')
 * // → '[CID:CR-2026-01-01-001] Fix bug'
 */
export function generateTitleWithMarker(canonicalId: string, title: string): string {
  return `${TITLE_MARKER_PREFIX}${canonicalId}${TITLE_MARKER_SUFFIX} ${title}`;
}

/**
 * Generate body with canonical ID marker
 * 
 * @param canonicalId - Canonical ID
 * @param body - Original body content
 * @returns Body with canonical ID marker prepended
 * 
 * @example
 * generateBodyWithMarker('CR-2026-01-01-001', 'Description')
 * // → 'Canonical-ID: CR-2026-01-01-001\n\nDescription'
 */
export function generateBodyWithMarker(canonicalId: string, body: string): string {
  return `${BODY_MARKER_PREFIX} ${canonicalId}\n\n${body}`;
}
