/**
 * GitHub Auth Wrapper with Repo Access Policy Enforcement
 * 
 * Server-side wrapper for GitHub App authentication with allowlist-based access control.
 * Enforces policy before token acquisition, ensuring deny-by-default security.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy + Auth Wrapper
 * Reference: E82.4 - GH Rate-limit & Retry Policy
 * Reference: E89.1 - Enhanced error codes and audit evidence
 */

import { Octokit } from 'octokit';
import { getGitHubInstallationToken } from '../github-app-auth';
import { loadRepoAccessPolicy, RepoAccessDeniedError } from './policy';
import { withRetry, DEFAULT_RETRY_CONFIG, type RetryPolicyConfig } from './retry-policy';
import { createHash } from 'crypto';

// ========================================
// Types
// ========================================

export interface GitHubAuthRequest {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  requestId?: string; // Optional request ID for audit trail
}

export interface GitHubAuthResult {
  token: string;
  expiresAt?: string;
  auditEvidence?: {
    requestId?: string;
    allowlistHash: string;
  };
}

export interface GitHubClientOptions {
  retryConfig?: RetryPolicyConfig;
}

// ========================================
// Error Types
// ========================================

export class GitHubAuthError extends Error {
  public readonly code = 'GITHUB_AUTH_FAILED';
  public readonly details: {
    owner: string;
    repo: string;
    reason?: string;
  };

  constructor(details: { owner: string; repo: string; reason?: string }) {
    super(`GitHub authentication failed for ${details.owner}/${details.repo}: ${details.reason || 'Unknown error'}`);
    this.name = 'GitHubAuthError';
    this.details = details;
  }
}

// ========================================
// Policy-Enforcing Auth Wrapper
// ========================================

// Cached policy instance (loaded once per runtime)
let cachedPolicy: ReturnType<typeof loadRepoAccessPolicy> | null = null;
let cachedPolicyHash: string | null = null;

// Default policy hash constant (used when GITHUB_REPO_ALLOWLIST is not set)
const DEFAULT_POLICY_HASH_SEED = 'default-dev-allowlist-codefactory-control';

function getPolicy() {
  if (!cachedPolicy) {
    cachedPolicy = loadRepoAccessPolicy();
    // Calculate hash of allowlist for audit evidence
    const allowlistJson = process.env.GITHUB_REPO_ALLOWLIST;
    const hashInput = allowlistJson || DEFAULT_POLICY_HASH_SEED;
    cachedPolicyHash = createHash('sha256')
      .update(hashInput)
      .digest('hex')
      .substring(0, 16);
  }
  return cachedPolicy;
}

function getPolicyHash(): string {
  if (!cachedPolicyHash) {
    getPolicy(); // Ensure policy is loaded and hash is calculated
  }
  return cachedPolicyHash!;
}

/**
 * Reset cached policy (for testing only)
 * @internal
 */
export function __resetPolicyCache() {
  cachedPolicy = null;
  cachedPolicyHash = null;
}

/**
 * Get GitHub installation token with policy enforcement and retry logic
 * 
 * This is the primary entry point for all GitHub API operations.
 * It validates the request against the repo access policy before
 * obtaining an installation token.
 * 
 * @param request - Repository and optional branch/path to access
 * @param options - Optional client options (retry config, etc.)
 * @returns GitHub installation token with audit evidence
 * @throws RepoAccessDeniedError if access is denied by policy
 * @throws GitHubAuthError if token acquisition fails
 */
export async function getAuthenticatedToken(
  request: GitHubAuthRequest,
  options?: GitHubClientOptions
): Promise<GitHubAuthResult> {
  // 1. Enforce policy BEFORE any network calls
  const policy = getPolicy();
  policy.checkAccess(request);

  // 2. Obtain installation token with retry logic (E82.4)
  const retryConfig = options?.retryConfig || DEFAULT_RETRY_CONFIG;
  
  try {
    const result = await withRetry(
      async () => {
        const { token, expiresAt } = await getGitHubInstallationToken({
          owner: request.owner,
          repo: request.repo,
        });
        
        return { 
          token, 
          expiresAt,
          auditEvidence: {
            requestId: request.requestId,
            allowlistHash: getPolicyHash(),
          },
        };
      },
      retryConfig,
      (decision, attempt) => {
        console.log(`[GitHub Auth] ${decision.reason}`);
      }
    );
    
    return result;
  } catch (error) {
    // Wrap token acquisition errors in GitHubAuthError
    if (error instanceof RepoAccessDeniedError) {
      throw error; // Re-throw policy errors as-is
    }
    throw new GitHubAuthError({
      owner: request.owner,
      repo: request.repo,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Create an authenticated Octokit client with policy enforcement and retry logic
 * 
 * @param request - Repository and optional branch/path to access
 * @param options - Optional client options (retry config, etc.)
 * @returns Authenticated Octokit instance with retry hooks
 * @throws RepoAccessDeniedError if access is denied by policy
 */
export async function createAuthenticatedClient(
  request: GitHubAuthRequest,
  options?: GitHubClientOptions
): Promise<Octokit> {
  const { token } = await getAuthenticatedToken(request, options);
  
  // Create Octokit client with retry plugin configuration
  // Note: Octokit has built-in retry, but we wrap it for consistency
  return new Octokit({ 
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: any) => {
        console.warn(`[GitHub] Rate limit hit, retrying after ${retryAfter}s`);
        return true; // Retry
      },
      onSecondaryRateLimit: (retryAfter: number, options: any) => {
        console.warn(`[GitHub] Secondary rate limit hit, retrying after ${retryAfter}s`);
        return true; // Retry
      },
    },
  });
}

/**
 * Check if a repository is allowed (without obtaining token)
 * Useful for pre-flight checks and UI logic
 * 
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns true if repository is in allowlist
 */
export function isRepoAllowed(owner: string, repo: string): boolean {
  const policy = getPolicy();
  return policy.isRepoAllowed(owner, repo);
}

/**
 * Get list of all allowed repositories
 * Useful for UI dropdowns and validation
 * 
 * @returns Array of allowed owner/repo pairs
 */
export function getAllowedRepos(): Array<{ owner: string; repo: string }> {
  const policy = getPolicy();
  return policy.getAllowedRepos();
}

/**
 * Post a comment to a GitHub issue with policy enforcement and retry logic
 * 
 * @param input - Issue comment details
 * @param options - Optional client options (retry config, etc.)
 * @throws RepoAccessDeniedError if repository not allowed
 */
export async function postGitHubIssueComment(
  input: {
    owner: string;
    repo: string;
    issue_number: number;
    body: string;
  },
  options?: GitHubClientOptions
): Promise<void> {
  const octokit = await createAuthenticatedClient({
    owner: input.owner,
    repo: input.repo,
  }, options);

  const retryConfig = options?.retryConfig || DEFAULT_RETRY_CONFIG;
  
  await withRetry(
    async () => {
      await octokit.rest.issues.createComment({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue_number,
        body: input.body,
      });
    },
    retryConfig,
    (decision, attempt) => {
      console.log(`[GitHub Comment] ${decision.reason}`);
    }
  );
}

// ========================================
// Re-export for convenience
// ========================================

export { RepoAccessDeniedError } from './policy';
