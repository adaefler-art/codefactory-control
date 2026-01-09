/**
 * GitHub Issue Batch Publisher for IssueDraft → GitHub Issue Flow (E82.1)
 * 
 * Idempotent batch publishing of IssueDrafts to GitHub issues.
 * 
 * NON-NEGOTIABLES:
 * - GitHub App server-to-server auth only
 * - Repo allowlist enforced
 * - Idempotency: same canonicalId → same issue (create or update)
 * - Determinism: stable title/body/labels
 * - Partial success: continue on individual failures, report all results
 */

import { renderIssueDraftAsIssue, generateLabelsForIssueDraft, mergeLabelsForIssueDraftUpdate, type RenderedIssueDraft } from './issue-draft-renderer';
import { resolveCanonicalId, type ResolveCanonicalIdInput } from './canonical-id-resolver';
import { createAuthenticatedClient } from './auth-wrapper';
import type { IssueDraft } from '../schemas/issueDraft';
import { validateIssueDraft } from '../validators/issueDraftValidator';
import { createHash } from 'crypto';

/**
 * Result of a single issue publish operation
 */
export interface PublishResult {
  /** Canonical ID of the issue */
  canonicalId: string;
  /** Success or failure */
  success: boolean;
  /** Operation mode: created new or updated existing */
  mode?: 'created' | 'updated';
  /** GitHub issue number */
  issueNumber?: number;
  /** GitHub issue URL */
  url?: string;
  /** Hash of rendered body */
  renderedHash?: string;
  /** Labels applied to issue */
  labelsApplied?: string[];
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: string;
}

/**
 * Batch publish result
 */
export interface BatchPublishResult {
  /** Total number of issues attempted */
  total: number;
  /** Number of successful publishes */
  successful: number;
  /** Number of failed publishes */
  failed: number;
  /** Individual results for each issue */
  results: PublishResult[];
}

/**
 * Error codes for issue publishing
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  REPO_ACCESS_DENIED: 'REPO_ACCESS_DENIED',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  ISSUE_CREATE_FAILED: 'ISSUE_CREATE_FAILED',
  ISSUE_UPDATE_FAILED: 'ISSUE_UPDATE_FAILED',
  MISSING_REPO_INFO: 'MISSING_REPO_INFO',
} as const;

/**
 * Publish multiple IssueDrafts to GitHub as issues (batch operation)
 * 
 * **Algorithm:**
 * 1. Validate each draft
 * 2. For each valid draft:
 *    a. Resolve canonical issue
 *    b. Create or update based on result
 * 3. Return batch result with all successes and failures
 * 
 * **Idempotency:**
 * - Same canonicalId → same issue (via resolver)
 * - Repeatable without side effects
 * 
 * **Partial Success:**
 * - Continues on individual failures
 * - Reports all results (success + failure)
 * 
 * @param drafts - Array of IssueDrafts to publish
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @returns Batch publish result with individual outcomes
 */
export async function publishIssueDraftBatch(
  drafts: IssueDraft[],
  owner: string,
  repo: string
): Promise<BatchPublishResult> {
  const results: PublishResult[] = [];
  
  // Validate inputs
  if (!owner || !repo) {
    // Return all as failed
    return {
      total: drafts.length,
      successful: 0,
      failed: drafts.length,
      results: drafts.map(draft => ({
        canonicalId: draft.canonicalId,
        success: false,
        error: 'Missing repository owner or name',
        errorCode: ERROR_CODES.MISSING_REPO_INFO,
      })),
    };
  }
  
  // Process each draft
  for (const draft of drafts) {
    try {
      const result = await publishSingleIssueDraft(draft, owner, repo);
      results.push(result);
    } catch (error) {
      // Catch unexpected errors
      results.push({
        canonicalId: draft.canonicalId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: ERROR_CODES.GITHUB_API_ERROR,
      });
    }
  }
  
  // Compute summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  return {
    total: drafts.length,
    successful,
    failed,
    results,
  };
}

/**
 * Publish a single IssueDraft to GitHub
 * 
 * Internal function that handles the full create-or-update flow for one draft.
 * 
 * @param draft - IssueDraft to publish
 * @param owner - GitHub repository owner
 * @param repo - GitHub repository name
 * @returns Publish result
 */
async function publishSingleIssueDraft(
  draft: IssueDraft,
  owner: string,
  repo: string
): Promise<PublishResult> {
  // Step 1: Validate draft
  const validation = validateIssueDraft(draft);
  
  if (!validation.isValid) {
    return {
      canonicalId: draft.canonicalId,
      success: false,
      error: `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
      errorCode: ERROR_CODES.VALIDATION_FAILED,
    };
  }
  
  // Step 2: Render issue
  const rendered = renderIssueDraftAsIssue(draft);
  
  // Step 3: Resolve canonical issue (with policy enforcement)
  const resolveInput: ResolveCanonicalIdInput = {
    owner,
    repo,
    canonicalId: draft.canonicalId,
  };
  
  let resolveResult;
  try {
    resolveResult = await resolveCanonicalId(resolveInput);
  } catch (error) {
    // RepoAccessDeniedError from auth-wrapper
    if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
      return {
        canonicalId: draft.canonicalId,
        success: false,
        error: error.message,
        errorCode: ERROR_CODES.REPO_ACCESS_DENIED,
      };
    }
    
    // Other resolver errors
    return {
      canonicalId: draft.canonicalId,
      success: false,
      error: `Failed to resolve canonical ID: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: ERROR_CODES.GITHUB_API_ERROR,
    };
  }
  
  // Step 4: Create or update issue
  if (resolveResult.mode === 'not_found') {
    // Create new issue
    return await createIssueFromDraft(owner, repo, draft, rendered);
  } else {
    // Update existing issue
    return await updateIssueFromDraft(owner, repo, draft, rendered, resolveResult.issueNumber!);
  }
}

/**
 * Create a new GitHub issue from IssueDraft
 */
async function createIssueFromDraft(
  owner: string,
  repo: string,
  draft: IssueDraft,
  rendered: RenderedIssueDraft
): Promise<PublishResult> {
  try {
    // Get authenticated client (with policy enforcement)
    const octokit = await createAuthenticatedClient({ owner, repo });
    
    // Generate labels
    const labels = generateLabelsForIssueDraft(draft);
    
    // Create issue via GitHub API
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title: rendered.title,
      body: rendered.body,
      labels,
    });
    
    return {
      canonicalId: draft.canonicalId,
      success: true,
      mode: 'created',
      issueNumber: response.data.number,
      url: response.data.html_url,
      renderedHash: rendered.renderedHash,
      labelsApplied: labels,
    };
  } catch (error) {
    return {
      canonicalId: draft.canonicalId,
      success: false,
      error: `Failed to create issue: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: ERROR_CODES.ISSUE_CREATE_FAILED,
    };
  }
}

/**
 * Update an existing GitHub issue from IssueDraft
 */
async function updateIssueFromDraft(
  owner: string,
  repo: string,
  draft: IssueDraft,
  rendered: RenderedIssueDraft,
  issueNumber: number
): Promise<PublishResult> {
  try {
    // Get authenticated client (with policy enforcement)
    const octokit = await createAuthenticatedClient({ owner, repo });
    
    // Get existing issue to retrieve current labels
    const existingIssue = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    
    // Extract existing labels
    const existingLabelNames = existingIssue.data.labels.map(label => 
      typeof label === 'string' ? label : label.name || ''
    ).filter(Boolean);
    
    // Merge labels deterministically
    const labels = mergeLabelsForIssueDraftUpdate(existingLabelNames, draft);
    
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
      canonicalId: draft.canonicalId,
      success: true,
      mode: 'updated',
      issueNumber: response.data.number,
      url: response.data.html_url,
      renderedHash: rendered.renderedHash,
      labelsApplied: labels,
    };
  } catch (error) {
    return {
      canonicalId: draft.canonicalId,
      success: false,
      error: `Failed to update issue: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: ERROR_CODES.ISSUE_UPDATE_FAILED,
    };
  }
}
