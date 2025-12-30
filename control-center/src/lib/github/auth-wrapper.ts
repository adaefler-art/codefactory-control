/**
 * GitHub Auth Wrapper with Repo Access Policy Enforcement
 * 
 * Server-side wrapper for GitHub App authentication with allowlist-based access control.
 * Enforces policy before token acquisition, ensuring deny-by-default security.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy + Auth Wrapper
 */

import { Octokit } from 'octokit';
import { getGitHubInstallationToken } from '../github-app-auth';
import { loadRepoAccessPolicy, RepoAccessDeniedError } from './policy';

// ========================================
// Types
// ========================================

export interface GitHubAuthRequest {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}

export interface GitHubAuthResult {
  token: string;
  expiresAt?: string;
}

// ========================================
// Policy-Enforcing Auth Wrapper
// ========================================

// Cached policy instance (loaded once per runtime)
let cachedPolicy: ReturnType<typeof loadRepoAccessPolicy> | null = null;

function getPolicy() {
  if (!cachedPolicy) {
    cachedPolicy = loadRepoAccessPolicy();
  }
  return cachedPolicy;
}

/**
 * Reset cached policy (for testing only)
 * @internal
 */
export function __resetPolicyCache() {
  cachedPolicy = null;
}

/**
 * Get GitHub installation token with policy enforcement
 * 
 * This is the primary entry point for all GitHub API operations.
 * It validates the request against the repo access policy before
 * obtaining an installation token.
 * 
 * @param request - Repository and optional branch/path to access
 * @returns GitHub installation token
 * @throws RepoAccessDeniedError if access is denied by policy
 */
export async function getAuthenticatedToken(
  request: GitHubAuthRequest
): Promise<GitHubAuthResult> {
  // 1. Enforce policy BEFORE any network calls
  const policy = getPolicy();
  policy.checkAccess(request);

  // 2. Obtain installation token (existing implementation)
  const { token, expiresAt } = await getGitHubInstallationToken({
    owner: request.owner,
    repo: request.repo,
  });

  return { token, expiresAt };
}

/**
 * Create an authenticated Octokit client with policy enforcement
 * 
 * @param request - Repository and optional branch/path to access
 * @returns Authenticated Octokit instance
 * @throws RepoAccessDeniedError if access is denied by policy
 */
export async function createAuthenticatedClient(
  request: GitHubAuthRequest
): Promise<Octokit> {
  const { token } = await getAuthenticatedToken(request);
  return new Octokit({ auth: token });
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

// ========================================
// Re-export for convenience
// ========================================

export { RepoAccessDeniedError } from './policy';
