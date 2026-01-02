/**
 * GitHub Issue Creator for AFU-9 CR → Issue Flow (I752 / E75.2)
 * 
 * Core implementation of idempotent create/update flow using Canonical-ID Resolver.
 * 
 * NON-NEGOTIABLES:
 * - GitHub App server-to-server auth only
 * - Repo allowlist enforced (I711)
 * - Idempotency: repeated generation updates same issue
 * - Determinism: stable title/body/labels
 * - CR validation before network calls
 */

import { validateChangeRequest, type ValidationResult } from '../validators/changeRequestValidator';
import { resolveCanonicalId, type ResolveCanonicalIdInput } from './canonical-id-resolver';
import { renderCRAsIssue, generateLabelsForNewIssue, mergeLabelsForUpdate } from './issue-renderer';
import { createAuthenticatedClient, type GitHubAuthRequest } from './auth-wrapper';
import type { ChangeRequest } from '../schemas/changeRequest';

/**
 * Result of create or update operation
 */
export interface CreateOrUpdateResult {
  /** Operation mode: created new or updated existing */
  mode: 'created' | 'updated';
  /** GitHub issue number */
  issueNumber: number;
  /** GitHub issue URL */
  url: string;
  /** Canonical ID */
  canonicalId: string;
  /** Hash of rendered body */
  renderedHash: string;
  /** Labels applied to issue */
  labelsApplied: string[];
}

/**
 * Error codes for issue creation/update
 */
export const ERROR_CODES = {
  CR_INVALID: 'CR_INVALID',
  REPO_ACCESS_DENIED: 'REPO_ACCESS_DENIED',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  ISSUE_CREATE_FAILED: 'ISSUE_CREATE_FAILED',
  ISSUE_UPDATE_FAILED: 'ISSUE_UPDATE_FAILED',
} as const;

/**
 * Issue creator error
 */
export class IssueCreatorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'IssueCreatorError';
  }
}

/**
 * Create or update a GitHub issue from a Change Request
 * 
 * **Algorithm:**
 * 1. Validate CR using I742 validator
 * 2. Resolve canonical issue using I751 resolver
 * 3. If not_found → create new issue
 * 4. If found → update existing issue
 * 5. Return result with mode, issueNumber, url, etc.
 * 
 * **Idempotency:**
 * - Same CR canonical ID → same issue (via resolver)
 * - Same CR content → no-op update (same title/body/labels)
 * 
 * **Policy Enforcement:**
 * - Repo access enforced via auth-wrapper (I711)
 * - Throws RepoAccessDeniedError if repo not allowed
 * 
 * @param cr - Change Request to create/update issue from
 * @returns Result with mode, issue number, URL, etc.
 * @throws IssueCreatorError if CR invalid or operation fails
 */
export async function createOrUpdateFromCR(cr: ChangeRequest): Promise<CreateOrUpdateResult> {
  // Step 1: Validate CR
  const validation = validateChangeRequest(cr);
  
  if (!validation.ok) {
    throw new IssueCreatorError(
      'CR validation failed',
      ERROR_CODES.CR_INVALID,
      { errors: validation.errors, warnings: validation.warnings }
    );
  }
  
  // Step 2: Extract repo/owner from CR
  const { owner, repo } = cr.targets.repo;
  
  // Step 3: Resolve canonical issue (with policy enforcement)
  const resolveInput: ResolveCanonicalIdInput = {
    owner,
    repo,
    canonicalId: cr.canonicalId,
  };
  
  let resolveResult;
  try {
    resolveResult = await resolveCanonicalId(resolveInput);
  } catch (error) {
    // RepoAccessDeniedError from auth-wrapper
    if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
      throw new IssueCreatorError(
        error.message,
        ERROR_CODES.REPO_ACCESS_DENIED,
        { owner, repo }
      );
    }
    
    // Other resolver errors
    throw new IssueCreatorError(
      `Failed to resolve canonical ID: ${error instanceof Error ? error.message : String(error)}`,
      ERROR_CODES.GITHUB_API_ERROR,
      { owner, repo, canonicalId: cr.canonicalId }
    );
  }
  
  // Step 4: Render issue
  const rendered = renderCRAsIssue(cr);
  
  // Step 5: Create or update issue
  if (resolveResult.mode === 'not_found') {
    // Create new issue
    return await createIssue(owner, repo, cr, rendered);
  } else {
    // Update existing issue
    return await updateIssue(owner, repo, cr, rendered, resolveResult.issueNumber!);
  }
}

/**
 * Create a new GitHub issue
 */
async function createIssue(
  owner: string,
  repo: string,
  cr: ChangeRequest,
  rendered: { title: string; body: string; renderedHash: string }
): Promise<CreateOrUpdateResult> {
  // Get authenticated client (with policy enforcement)
  const octokit = await createAuthenticatedClient({ owner, repo });
  
  // Generate labels for new issue
  const labels = generateLabelsForNewIssue(cr);
  
  try {
    // Create issue via GitHub API
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title: rendered.title,
      body: rendered.body,
      labels,
    });
    
    return {
      mode: 'created',
      issueNumber: response.data.number,
      url: response.data.html_url,
      canonicalId: cr.canonicalId,
      renderedHash: rendered.renderedHash,
      labelsApplied: labels,
    };
  } catch (error) {
    throw new IssueCreatorError(
      `Failed to create issue: ${error instanceof Error ? error.message : String(error)}`,
      ERROR_CODES.ISSUE_CREATE_FAILED,
      { owner, repo, canonicalId: cr.canonicalId, error }
    );
  }
}

/**
 * Update an existing GitHub issue
 */
async function updateIssue(
  owner: string,
  repo: string,
  cr: ChangeRequest,
  rendered: { title: string; body: string; renderedHash: string },
  issueNumber: number
): Promise<CreateOrUpdateResult> {
  // Get authenticated client (with policy enforcement)
  const octokit = await createAuthenticatedClient({ owner, repo });
  
  try {
    // Get existing issue to retrieve current labels
    const existingIssue = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    
    // Merge labels deterministically
    const existingLabelNames = existingIssue.data.labels.map(label => 
      typeof label === 'string' ? label : label.name || ''
    ).filter(Boolean);
    
    const labels = mergeLabelsForUpdate(existingLabelNames, cr);
    
    // Update issue via GitHub API
    const response = await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      title: rendered.title,
      body: rendered.body,
      labels,
    });
    
    return {
      mode: 'updated',
      issueNumber: response.data.number,
      url: response.data.html_url,
      canonicalId: cr.canonicalId,
      renderedHash: rendered.renderedHash,
      labelsApplied: labels,
    };
  } catch (error) {
    throw new IssueCreatorError(
      `Failed to update issue: ${error instanceof Error ? error.message : String(error)}`,
      ERROR_CODES.ISSUE_UPDATE_FAILED,
      { owner, repo, canonicalId: cr.canonicalId, issueNumber, error }
    );
  }
}
