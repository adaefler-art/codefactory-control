/**
 * GitHub Ingestion - Core Functions
 * 
 * Server-side ingestion of GitHub Issues, PRs, Comments, and Labels
 * into the Timeline/Linkage Model with idempotent upsert semantics.
 * 
 * Reference: I722 (E72.2 - GitHub Ingestion)
 * 
 * NON-NEGOTIABLES:
 * - GitHub App server-to-server auth only (via createAuthenticatedClient)
 * - I711 Repo Access Policy enforced on every GitHub call
 * - Idempotent ingestion (safe to re-run, no duplicates)
 * - Deterministic node IDs via natural keys
 * - Evidence-friendly source references with etags/timestamps
 */

import { Octokit } from 'octokit';
import { Pool } from 'pg';
import { createAuthenticatedClient, RepoAccessDeniedError } from '../github/auth-wrapper';
import { TimelineDAO } from '../db/timeline';
import { createHash } from 'crypto';
import {
  IngestIssueParams,
  IngestIssueParamsSchema,
  IngestPullRequestParams,
  IngestPullRequestParamsSchema,
  IngestIssueCommentsParams,
  IngestIssueCommentsParamsSchema,
  IngestLabelsParams,
  IngestLabelsParamsSchema,
  IngestIssueResult,
  IngestPullRequestResult,
  IngestCommentsResult,
  IngestLabelsResult,
  IssueNotFoundError,
  PullRequestNotFoundError,
  GitHubIngestionError,
} from './types';

// ========================================
// Helper Functions
// ========================================

/**
 * Generate deterministic source_id for GitHub objects
 * Format: {owner}/{repo}/issues/{number} or {owner}/{repo}/pulls/{number}
 */
function generateGitHubSourceId(owner: string, repo: string, type: string, id: string | number): string {
  return `${owner}/${repo}/${type}/${id}`;
}

/**
 * Compute SHA-256 hash of content for evidence
 */
function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Check if issue was already fetched recently (to track isNew)
 */
async function checkIfNodeExists(
  dao: TimelineDAO,
  source_system: string,
  source_type: string,
  source_id: string
): Promise<boolean> {
  const existing = await dao.getNodeByNaturalKey(source_system, source_type, source_id);
  return existing !== null;
}

// ========================================
// Core Ingestion Functions
// ========================================

/**
 * Ingest a single GitHub Issue into the Timeline/Linkage Model
 * 
 * Creates/updates:
 * - ISSUE node with metadata
 * - COMMENT nodes (optional, if issue body exists)
 * - Source reference with API endpoint and etag
 * 
 * @param params - Issue parameters
 * @param pool - Database connection pool
 * @returns Ingestion result with node ID and metadata
 * @throws RepoAccessDeniedError if I711 policy denies access
 * @throws IssueNotFoundError if issue doesn't exist
 */
export async function ingestIssue(
  params: IngestIssueParams,
  pool: Pool
): Promise<IngestIssueResult> {
  // Validate input
  const validated = IngestIssueParamsSchema.parse(params);
  const { owner, repo, issueNumber } = validated;

  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({ owner, repo });

  // Initialize DAO
  const dao = new TimelineDAO(pool);

  // Fetch issue from GitHub
  let issueData: any;
  let etag: string | undefined;
  let fetchedAt: string;

  try {
    const response = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    issueData = response.data;
    etag = response.headers.etag;
    fetchedAt = new Date().toISOString();
  } catch (error: any) {
    if (error.status === 404) {
      throw new IssueNotFoundError(owner, repo, issueNumber);
    }
    throw new GitHubIngestionError(
      'GITHUB_API_ERROR',
      `Failed to fetch issue #${issueNumber}: ${error.message}`,
      { owner, repo, issueNumber, status: error.status }
    );
  }

  // Determine source_type (issue vs pull_request)
  // GitHub API returns PRs as issues, so we need to check
  const source_type = issueData.pull_request ? 'pull_request' : 'issue';
  const source_id = generateGitHubSourceId(owner, repo, source_type === 'issue' ? 'issues' : 'pulls', issueNumber);
  const node_type = source_type === 'issue' ? 'ISSUE' : 'PR';

  // Check if node exists before upserting
  const wasExisting = await checkIfNodeExists(dao, 'github', source_type, source_id);

  // Upsert node (idempotent)
  const node = await dao.upsertNode({
    source_system: 'github',
    source_type,
    source_id,
    node_type,
    title: issueData.title || null,
    url: issueData.html_url || null,
    payload_json: {
      number: issueData.number,
      state: issueData.state,
      created_at: issueData.created_at,
      updated_at: issueData.updated_at,
      closed_at: issueData.closed_at,
      user: issueData.user?.login,
      labels: issueData.labels?.map((l: any) => l.name),
    },
  });

  // Create source reference for evidence
  const apiEndpoint = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  await dao.createSource({
    node_id: node.id,
    source_kind: 'github_api',
    ref_json: {
      url: apiEndpoint,
      etag: etag || null,
      fetched_at: fetchedAt,
    },
  });

  // Ingest labels if present
  const labelNodeIds: string[] = [];
  if (issueData.labels && Array.isArray(issueData.labels)) {
    for (const label of issueData.labels) {
      if (label && label.name) {
        const labelSourceId = generateGitHubSourceId(owner, repo, 'labels', label.name);
        const labelNode = await dao.upsertNode({
          source_system: 'github',
          source_type: 'label',
          source_id: labelSourceId,
          node_type: 'COMMENT', // Using COMMENT as placeholder (labels don't have dedicated node type)
          title: label.name,
          url: null,
          payload_json: {
            color: label.color,
            description: label.description,
          },
        });
        labelNodeIds.push(labelNode.id);

        // Create edge from issue to label
        await dao.createEdge({
          from_node_id: node.id,
          to_node_id: labelNode.id,
          edge_type: 'ISSUE_HAS_COMMENT', // Using closest available edge type
          payload_json: { label: true },
        });
      }
    }
  }

  return {
    nodeId: node.id,
    naturalKey: `github:${source_type}:${source_id}`,
    isNew: !wasExisting,
    source_system: 'github',
    source_type,
    source_id,
    issueNumber,
    labelNodeIds: labelNodeIds.length > 0 ? labelNodeIds : undefined,
  };
}

/**
 * Ingest a single GitHub Pull Request into the Timeline/Linkage Model
 * 
 * @param params - PR parameters
 * @param pool - Database connection pool
 * @returns Ingestion result with node ID and metadata
 * @throws RepoAccessDeniedError if I711 policy denies access
 * @throws PullRequestNotFoundError if PR doesn't exist
 */
export async function ingestPullRequest(
  params: IngestPullRequestParams,
  pool: Pool
): Promise<IngestPullRequestResult> {
  // Validate input
  const validated = IngestPullRequestParamsSchema.parse(params);
  const { owner, repo, prNumber } = validated;

  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({ owner, repo });

  // Initialize DAO
  const dao = new TimelineDAO(pool);

  // Fetch PR from GitHub
  let prData: any;
  let etag: string | undefined;
  let fetchedAt: string;

  try {
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    prData = response.data;
    etag = response.headers.etag;
    fetchedAt = new Date().toISOString();
  } catch (error: any) {
    if (error.status === 404) {
      throw new PullRequestNotFoundError(owner, repo, prNumber);
    }
    throw new GitHubIngestionError(
      'GITHUB_API_ERROR',
      `Failed to fetch PR #${prNumber}: ${error.message}`,
      { owner, repo, prNumber, status: error.status }
    );
  }

  const source_type = 'pull_request';
  const source_id = generateGitHubSourceId(owner, repo, 'pulls', prNumber);

  // Check if node exists before upserting
  const wasExisting = await checkIfNodeExists(dao, 'github', source_type, source_id);

  // Upsert node (idempotent)
  const node = await dao.upsertNode({
    source_system: 'github',
    source_type,
    source_id,
    node_type: 'PR',
    title: prData.title || null,
    url: prData.html_url || null,
    payload_json: {
      number: prData.number,
      state: prData.state,
      created_at: prData.created_at,
      updated_at: prData.updated_at,
      closed_at: prData.closed_at,
      merged_at: prData.merged_at,
      user: prData.user?.login,
      base_ref: prData.base?.ref,
      head_ref: prData.head?.ref,
      labels: prData.labels?.map((l: any) => l.name),
    },
  });

  // Create source reference for evidence
  const apiEndpoint = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  await dao.createSource({
    node_id: node.id,
    source_kind: 'github_api',
    ref_json: {
      url: apiEndpoint,
      etag: etag || null,
      fetched_at: fetchedAt,
    },
  });

  // Ingest labels if present
  const labelNodeIds: string[] = [];
  if (prData.labels && Array.isArray(prData.labels)) {
    for (const label of prData.labels) {
      if (label && label.name) {
        const labelSourceId = generateGitHubSourceId(owner, repo, 'labels', label.name);
        const labelNode = await dao.upsertNode({
          source_system: 'github',
          source_type: 'label',
          source_id: labelSourceId,
          node_type: 'COMMENT', // Using COMMENT as placeholder
          title: label.name,
          url: null,
          payload_json: {
            color: label.color,
            description: label.description,
          },
        });
        labelNodeIds.push(labelNode.id);

        // Create edge from PR to label
        await dao.createEdge({
          from_node_id: node.id,
          to_node_id: labelNode.id,
          edge_type: 'PR_HAS_COMMENT', // Using closest available edge type
          payload_json: { label: true },
        });
      }
    }
  }

  return {
    nodeId: node.id,
    naturalKey: `github:${source_type}:${source_id}`,
    isNew: !wasExisting,
    source_system: 'github',
    source_type,
    source_id,
    prNumber,
    labelNodeIds: labelNodeIds.length > 0 ? labelNodeIds : undefined,
  };
}

/**
 * Ingest comments for a GitHub Issue or Pull Request
 * 
 * @param params - Issue/PR parameters
 * @param pool - Database connection pool
 * @returns Comments ingestion result
 * @throws RepoAccessDeniedError if I711 policy denies access
 */
export async function ingestIssueComments(
  params: IngestIssueCommentsParams,
  pool: Pool
): Promise<IngestCommentsResult> {
  // Validate input
  const validated = IngestIssueCommentsParamsSchema.parse(params);
  const { owner, repo, issueNumber } = validated;

  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({ owner, repo });

  // Initialize DAO
  const dao = new TimelineDAO(pool);

  // First, ensure parent issue/PR node exists
  const parentSourceId = generateGitHubSourceId(owner, repo, 'issues', issueNumber);
  let parentNode = await dao.getNodeByNaturalKey('github', 'issue', parentSourceId);
  
  // If not found as issue, try as PR
  if (!parentNode) {
    const prSourceId = generateGitHubSourceId(owner, repo, 'pulls', issueNumber);
    parentNode = await dao.getNodeByNaturalKey('github', 'pull_request', prSourceId);
  }

  // If still not found, ingest the issue/PR first
  if (!parentNode) {
    try {
      const issueResult = await ingestIssue({ owner, repo, issueNumber }, pool);
      parentNode = await dao.getNodeById(issueResult.nodeId);
      if (!parentNode) {
        throw new GitHubIngestionError(
          'PARENT_NOT_FOUND',
          `Failed to create parent node for issue #${issueNumber}`,
          { owner, repo, issueNumber }
        );
      }
    } catch (error: any) {
      throw new GitHubIngestionError(
        'PARENT_NOT_FOUND',
        `Parent issue #${issueNumber} not found and could not be created: ${error.message}`,
        { owner, repo, issueNumber }
      );
    }
  }

  // Fetch comments from GitHub
  let commentsData: any[];
  let fetchedAt: string;

  try {
    const response = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100, // Max allowed by GitHub API
    });

    commentsData = response.data;
    fetchedAt = new Date().toISOString();
  } catch (error: any) {
    throw new GitHubIngestionError(
      'GITHUB_API_ERROR',
      `Failed to fetch comments for issue #${issueNumber}: ${error.message}`,
      { owner, repo, issueNumber, status: error.status }
    );
  }

  // Ingest each comment
  const commentNodes: any[] = [];
  const edgeIds: string[] = [];

  for (const comment of commentsData) {
    const commentSourceId = generateGitHubSourceId(owner, repo, 'comments', comment.id);
    
    const wasExisting = await checkIfNodeExists(dao, 'github', 'comment', commentSourceId);

    // Upsert comment node
    const commentNode = await dao.upsertNode({
      source_system: 'github',
      source_type: 'comment',
      source_id: commentSourceId,
      node_type: 'COMMENT',
      title: null,
      url: comment.html_url || null,
      payload_json: {
        id: comment.id,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        user: comment.user?.login,
        body_snippet: comment.body?.substring(0, 200), // First 200 chars
      },
    });

    // Create source reference
    await dao.createSource({
      node_id: commentNode.id,
      source_kind: 'github_api',
      ref_json: {
        url: comment.url,
        fetched_at: fetchedAt,
        comment_id: comment.id,
      },
    });

    // Create edge from parent to comment
    const edgeType = parentNode.node_type === 'ISSUE' ? 'ISSUE_HAS_COMMENT' : 'PR_HAS_COMMENT';
    const edge = await dao.createEdge({
      from_node_id: parentNode.id,
      to_node_id: commentNode.id,
      edge_type: edgeType as any,
      payload_json: {
        created_at: comment.created_at,
      },
    });

    commentNodes.push({
      nodeId: commentNode.id,
      naturalKey: `github:comment:${commentSourceId}`,
      isNew: !wasExisting,
      source_system: 'github',
      source_type: 'comment',
      source_id: commentSourceId,
    });

    edgeIds.push(edge.id);
  }

  return {
    commentNodes,
    parentNodeId: parentNode.id,
    edgeIds,
  };
}

/**
 * Ingest labels for a repository
 * 
 * Note: This ingests all repository labels, not per-issue labels.
 * Per-issue labels are ingested as part of ingestIssue/ingestPullRequest.
 * 
 * @param params - Repository parameters
 * @param pool - Database connection pool
 * @returns Labels ingestion result
 * @throws RepoAccessDeniedError if I711 policy denies access
 */
export async function ingestLabels(
  params: IngestLabelsParams,
  pool: Pool
): Promise<IngestLabelsResult> {
  // Validate input
  const validated = IngestLabelsParamsSchema.parse(params);
  const { owner, repo } = validated;

  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({ owner, repo });

  // Initialize DAO
  const dao = new TimelineDAO(pool);

  // Fetch labels from GitHub
  let labelsData: any[];
  let fetchedAt: string;

  try {
    const response = await octokit.rest.issues.listLabelsForRepo({
      owner,
      repo,
      per_page: 100, // Max allowed by GitHub API
    });

    labelsData = response.data;
    fetchedAt = new Date().toISOString();
  } catch (error: any) {
    throw new GitHubIngestionError(
      'GITHUB_API_ERROR',
      `Failed to fetch labels for ${owner}/${repo}: ${error.message}`,
      { owner, repo, status: error.status }
    );
  }

  // Ingest each label
  const labelNodes: any[] = [];

  for (const label of labelsData) {
    const labelSourceId = generateGitHubSourceId(owner, repo, 'labels', label.name);
    
    const wasExisting = await checkIfNodeExists(dao, 'github', 'label', labelSourceId);

    // Upsert label node
    const labelNode = await dao.upsertNode({
      source_system: 'github',
      source_type: 'label',
      source_id: labelSourceId,
      node_type: 'COMMENT', // Using COMMENT as placeholder
      title: label.name,
      url: null,
      payload_json: {
        name: label.name,
        color: label.color,
        description: label.description,
      },
    });

    // Create source reference
    await dao.createSource({
      node_id: labelNode.id,
      source_kind: 'github_api',
      ref_json: {
        url: label.url,
        fetched_at: fetchedAt,
      },
    });

    labelNodes.push({
      nodeId: labelNode.id,
      naturalKey: `github:label:${labelSourceId}`,
      isNew: !wasExisting,
      source_system: 'github',
      source_type: 'label',
      source_id: labelSourceId,
    });
  }

  return {
    labelNodes,
  };
}

// ========================================
// Exports
// ========================================

export { RepoAccessDeniedError } from '../github/auth-wrapper';
export * from './types';
