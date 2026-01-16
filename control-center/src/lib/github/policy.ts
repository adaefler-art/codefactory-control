/**
 * Repo Access Policy for AFU-9 GitHub Integration
 * 
 * Enforces allowlist-based access control for GitHub repositories.
 * Supports exact and glob-pattern matching for branches.
 * Deny-by-default with explicit, structured errors.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy
 */

import { z } from 'zod';

// ========================================
// Policy Configuration Schema
// ========================================

/**
 * Schema for a single repository allowlist entry
 */
export const RepoAllowlistEntrySchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branches: z.array(z.string()).min(1).default(['main']),
  paths: z.array(z.string()).optional(),
}).strict();

export type RepoAllowlistEntry = z.infer<typeof RepoAllowlistEntrySchema>;

/**
 * Internal normalized allowlist entry (for efficient matching)
 * @internal
 */
interface NormalizedRepoAllowlistEntry {
  owner: string; // lowercase
  repo: string; // lowercase
  branches: string[]; // original patterns (not normalized)
  paths?: string[];
}

/**
 * Schema for the full repository access policy
 */
export const RepoAccessPolicyConfigSchema = z.object({
  allowlist: z.array(RepoAllowlistEntrySchema).default([]),
}).strict();

export type RepoAccessPolicyConfig = z.infer<typeof RepoAccessPolicyConfigSchema>;

// ========================================
// Error Types
// ========================================

export class RepoAccessDeniedError extends Error {
  public readonly code: 'REPO_NOT_ALLOWED' | 'BRANCH_NOT_ALLOWED';
  public readonly details: {
    owner: string;
    repo: string;
    branch?: string;
    path?: string;
  };

  constructor(
    details: { owner: string; repo: string; branch?: string; path?: string },
    reason?: 'repo' | 'branch'
  ) {
    const branchInfo = details.branch ? ` on branch '${details.branch}'` : '';
    const pathInfo = details.path ? ` at path '${details.path}'` : '';
    super(`Access denied to repository ${details.owner}/${details.repo}${branchInfo}${pathInfo}`);
    this.name = 'RepoAccessDeniedError';
    this.code = reason === 'branch' ? 'BRANCH_NOT_ALLOWED' : 'REPO_NOT_ALLOWED';
    this.details = details;
  }
}

export class PolicyConfigError extends Error {
  public readonly code = 'POLICY_CONFIG_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PolicyConfigError';
  }
}

// ========================================
// Normalization
// ========================================

/**
 * Normalize owner name to lowercase for consistent matching
 * GitHub treats owner names case-insensitively, so we normalize to lowercase.
 * 
 * @param owner - Repository owner name
 * @returns Normalized (lowercase) owner name
 */
export function normalizeOwner(owner: string): string {
  return owner.trim().toLowerCase();
}

/**
 * Normalize repo name to lowercase for consistent matching
 * GitHub treats repo names case-insensitively, so we normalize to lowercase.
 * 
 * @param repo - Repository name
 * @returns Normalized (lowercase) repo name
 */
export function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase();
}

/**
 * Normalize branch name for canonical comparison
 * Removes leading/trailing whitespace and refs/ prefixes.
 * 
 * @param branch - Branch name or ref
 * @returns Normalized branch name
 */
export function normalizeBranch(branch: string): string {
  let normalized = branch.trim();
  
  // Remove common ref prefixes
  if (normalized.startsWith('refs/heads/')) {
    normalized = normalized.substring('refs/heads/'.length);
  }
  if (normalized.startsWith('refs/tags/')) {
    normalized = normalized.substring('refs/tags/'.length);
  }
  
  return normalized;
}

// ========================================
// Pattern Matching
// ========================================

/**
 * Match a branch name against a pattern.
 * Supports exact match and simple glob patterns (e.g., "release/*").
 * 
 * @param branch - The branch name to match
 * @param pattern - The pattern to match against (supports * wildcard)
 * @returns true if the branch matches the pattern
 */
export function matchBranchPattern(branch: string, pattern: string): boolean {
  // Exact match
  if (branch === pattern) {
    return true;
  }

  // Glob pattern matching (simple * wildcard only)
  if (pattern.includes('*')) {
    // Convert glob pattern to regex
    // Escape special regex chars except *
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(branch);
  }

  return false;
}

/**
 * Match a path against a pattern.
 * For now, uses same logic as branch patterns.
 * 
 * @param path - The path to match
 * @param pattern - The pattern to match against
 * @returns true if the path matches the pattern
 */
export function matchPathPattern(path: string, pattern: string): boolean {
  return matchBranchPattern(path, pattern);
}

// ========================================
// Policy Enforcement
// ========================================

export class RepoAccessPolicy {
  private readonly config: RepoAccessPolicyConfig;
  private readonly normalizedAllowlist: NormalizedRepoAllowlistEntry[];

  constructor(config: RepoAccessPolicyConfig) {
    this.config = config;
    // Normalize allowlist entries once at initialization for performance
    this.normalizedAllowlist = config.allowlist.map(entry => ({
      owner: normalizeOwner(entry.owner),
      repo: normalizeRepo(entry.repo),
      branches: entry.branches, // Keep original patterns
      paths: entry.paths,
    }));
  }

  /**
   * Check if access to a repository is allowed
   * 
   * @param request - The access request details
   * @throws RepoAccessDeniedError if access is denied
   */
  public checkAccess(request: {
    owner: string;
    repo: string;
    branch?: string;
    path?: string;
  }): void {
    // Normalize inputs for consistent matching
    const owner = normalizeOwner(request.owner);
    const repo = normalizeRepo(request.repo);
    const branch = request.branch ? normalizeBranch(request.branch) : undefined;
    const { path } = request;

    // Find matching entry (using pre-normalized allowlist)
    const entry = this.normalizedAllowlist.find(
      (e) => e.owner === owner && e.repo === repo
    );

    if (!entry) {
      throw new RepoAccessDeniedError({ owner, repo, branch, path }, 'repo');
    }

    // If branch is specified, check branch pattern
    if (branch !== undefined) {
      const branchAllowed = entry.branches.some((pattern) =>
        matchBranchPattern(branch, pattern)
      );
      if (!branchAllowed) {
        throw new RepoAccessDeniedError({ owner, repo, branch, path }, 'branch');
      }
    }

    // If path is specified and entry has path restrictions, check path pattern
    if (path !== undefined && entry.paths && entry.paths.length > 0) {
      const pathAllowed = entry.paths.some((pattern) =>
        matchPathPattern(path, pattern)
      );
      if (!pathAllowed) {
        throw new RepoAccessDeniedError({ owner, repo, branch, path }, 'repo');
      }
    }

    // Access allowed
  }

  /**
   * Check if a repository is in the allowlist (branch/path agnostic)
   * 
   * @param owner - Repository owner
   * @param repo - Repository name
   * @returns true if the repository is in the allowlist
   */
  public isRepoAllowed(owner: string, repo: string): boolean {
    const normalizedOwner = normalizeOwner(owner);
    const normalizedRepo = normalizeRepo(repo);
    return this.normalizedAllowlist.some(
      (e) => e.owner === normalizedOwner && e.repo === normalizedRepo
    );
  }

  /**
   * Get all allowed repositories
   */
  public getAllowedRepos(): Array<{ owner: string; repo: string }> {
    return this.config.allowlist.map((e) => ({ owner: e.owner, repo: e.repo }));
  }
}

// ========================================
// Configuration Loading
// ========================================

/**
 * Load repo access policy from environment variable
 * 
 * Reads from GITHUB_REPO_ALLOWLIST env var (JSON format)
 * Falls back to permissive default in development
 */
export function loadRepoAccessPolicy(): RepoAccessPolicy {
  const allowlistJson = process.env.GITHUB_REPO_ALLOWLIST;

  if (!allowlistJson) {
    // Default: allow codefactory-control repository for development
    console.warn('[RepoAccessPolicy] No GITHUB_REPO_ALLOWLIST configured, using development default');
    const defaultConfig: RepoAccessPolicyConfig = {
      allowlist: [
        {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branches: ['main', 'develop', 'release/*', 'hotfix/*', 'feature/*', 'copilot/*'],
        },
      ],
    };
    return new RepoAccessPolicy(defaultConfig);
  }

  // Parse and validate
  let parsed: unknown;
  try {
    parsed = JSON.parse(allowlistJson);
  } catch (error) {
    throw new PolicyConfigError(
      `Invalid GITHUB_REPO_ALLOWLIST JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Validate with Zod
  const result = RepoAccessPolicyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new PolicyConfigError(
      `Invalid GITHUB_REPO_ALLOWLIST schema: ${result.error.message}`
    );
  }

  return new RepoAccessPolicy(result.data);
}
