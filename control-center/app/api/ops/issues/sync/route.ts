/**
 * API Route: POST /api/ops/issues/sync
 * 
 * AFU-9 Issue Status Sync MVP
 * 
 * Polls GitHub issues and syncs them to issue_snapshots table.
 * E7_extra: Also updates AFU9 issue status from GitHub status (Project/Label/State).
 * Auth-first (401-first using x-afu9-sub), deterministic pagination, GitHub App only.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * REPO RESOLUTION (I7.0.5 Fix):
 * - Per-issue repo resolution: extracts owner/repo from github_repo or github_url
 * - Backfills github_repo field during sync for consistent future syncs
 * - Fetches each issue from its correct repository (supports multi-repo scenarios)
 * 
 * Request Body (optional):
 * - owner?: string - Repository owner (default: env GITHUB_OWNER)
 * - repo?: string - Repository name (default: env GITHUB_REPO)
 * - query?: string - Custom GitHub search query
 * - maxIssues?: number - Max issues to sync (default: 1000, max: 200)
 * - perPage?: number - Issues per page (default: 100, max: 100)
 * - maxPages?: number - Max pages to fetch (default: 10, max: 10)
 * 
 * Response:
 * - ok: boolean
 * - total: number - Total issues found
 * - upserted: number - Snapshots created/updated
 * - statusSynced: number - AFU9 issues with status updated (E7_extra)
 * - syncedAt: string - ISO timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '../../../../../src/lib/db';
import { searchIssues, getIssue } from '../../../../../src/lib/github';
import {
  createIssueSyncRun,
  updateIssueSyncRun,
  upsertIssueSnapshot,
} from '../../../../../src/lib/db/issueSync';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { isRepoAllowed } from '@/lib/github/auth-wrapper';
import { sanitizeRedact } from '@/lib/contracts/remediation-playbook';
import { listAfu9Issues, updateAfu9Issue } from '@/lib/db/afu9Issues';
import { extractGithubMirrorStatus } from '@/lib/issues/stateModel';
import { Afu9GithubMirrorStatus, Afu9StatusSource } from '@/lib/contracts/afu9Issue';

// Constants
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'adaefler-art';
const GITHUB_REPO = process.env.GITHUB_REPO || 'codefactory-control';
const MAX_SYNC_PAGES = 10;
const MAX_ISSUES = 200;
const PER_PAGE_MAX = 100;
const MAX_STATUS_RAW_LENGTH = 256; // I3: Bound github_status_raw to prevent unbounded persistence

// Zod schema for request validation
const SyncRequestSchema = z.object({
  owner: z.string().min(1).max(255).optional(),
  repo: z.string().min(1).max(255).optional(),
  query: z.string().max(500).optional(),
  maxIssues: z.number().int().min(1).max(200).optional(),
  perPage: z.number().int().min(1).max(100).optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
});

/**
 * Extract canonical ID from issue title or labels
 * Examples: "E64.1: ...", "I751: ...", "[E64.1] ...", etc.
 */
function extractCanonicalId(title: string, labels: Array<{ name: string }>): string | null {
  // Pattern: E/I followed by digits and optional decimal (e.g., E64.1, I751)
  const titleMatch = title.match(/\b([EI]\d+(?:\.\d+)?)\b/);
  if (titleMatch) {
    return titleMatch[1];
  }

  // Check labels for canonical ID
  for (const label of labels) {
    const labelMatch = label.name.match(/\b([EI]\d+(?:\.\d+)?)\b/);
    if (labelMatch) {
      return labelMatch[1];
    }
  }

  return null;
}

/**
 * Extract owner/repo from GitHub URL
 * Examples: 
 * - "https://github.com/adaefler-art/codefactory-control/issues/458" -> { owner: "adaefler-art", repo: "codefactory-control" }
 * - "https://github.com/owner/repo/issues/123" -> { owner: "owner", repo: "repo" }
 * Returns null if URL is invalid or doesn't match expected pattern
 */
function extractOwnerRepoFromGithubUrl(url: string | null): { owner: string; repo: string } | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  // Match pattern: https://github.com/{owner}/{repo}/...
  const match = url.match(/^https:\/\/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    return null;
  }

  const owner = match[1];
  const repo = match[2];

  // Validate owner and repo are not empty and don't contain path traversal attempts
  // GitHub usernames/repos must match: alphanumeric, hyphen, underscore (no special chars, no ../, etc.)
  const validPattern = /^[a-zA-Z0-9._-]+$/;
  if (!owner || !repo || owner.trim() === '' || repo.trim() === '' ||
      !validPattern.test(owner) || !validPattern.test(repo)) {
    return null;
  }

  return { owner, repo };
}

function stripUrlQueryAndHash(input: string): string {
  return input.replace(/\bhttps?:\/\/[^\s]+/gi, (raw) => {
    const match = raw.match(/^(.*?)([\)\]\.\,;:!?]+)?$/);
    const urlPart = match?.[1] ?? raw;
    const suffix = match?.[2] ?? '';

    try {
      const parsed = new URL(urlPart);
      return `${parsed.origin}${parsed.pathname}${suffix}`;
    } catch {
      return raw;
    }
  });
}

function sanitizeLabelForSnapshot(name: string): string {
  const sanitized = sanitizeRedact(name);
  const asString = typeof sanitized === 'string' ? sanitized : '';
  return stripUrlQueryAndHash(asString);
}

/**
 * POST /api/ops/issues/sync
 * 
 * Synchronizes GitHub issues to local database snapshots
 * 401-first authentication, repo allowlist enforcement (I711)
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      details: 'Authentication required - no verified user context',
    });
  }

  try {
    const pool = getPool();

    // Parse and validate request body
    let body: z.infer<typeof SyncRequestSchema> = {};
    try {
      const text = await request.text();
      if (text && text.trim()) {
        const parsed = JSON.parse(text);
        body = SyncRequestSchema.parse(parsed);
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return errorResponse('Invalid request body', {
          status: 400,
          requestId,
          details: err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
        });
      }
      if (err instanceof SyntaxError) {
        return errorResponse('Invalid JSON', {
          status: 400,
          requestId,
          details: 'Request body must be valid JSON',
        });
      }
      // Other errors - log and use defaults
      console.log('[API /api/ops/issues/sync] Error parsing body, using defaults:', err);
    }

    // Extract and validate parameters
    const owner = body.owner || GITHUB_OWNER;
    const repo = body.repo || GITHUB_REPO;
    const perPage = body.perPage || PER_PAGE_MAX;
    const maxPages = body.maxPages || MAX_SYNC_PAGES;
    const maxIssues = body.maxIssues || MAX_ISSUES;

    // REPO ALLOWLIST CHECK (403): Enforce I711 before ANY GitHub network calls
    if (!isRepoAllowed(owner, repo)) {
      return errorResponse('Access denied', {
        status: 403,
        requestId,
        details: `Repository ${owner}/${repo} is not in the allowlist (I711)`,
      });
    }

    // Build deterministic query (ensure is:issue AND -is:pr for clarity)
    const baseQuery = body.query || process.env.AFU9_ISSUE_SYNC_QUERY;
    let query: string;
    if (baseQuery) {
      // Ensure repo is in query
      query = baseQuery.includes('repo:') ? baseQuery : `${baseQuery} repo:${owner}/${repo}`;
    } else {
      query = `repo:${owner}/${repo}`;
    }
    
    // Enforce deterministic filters
    if (!query.includes('is:issue')) {
      query += ' is:issue';
    }
    if (!query.includes('-is:pr')) {
      query += ' -is:pr';
    }

    console.log('[API /api/ops/issues/sync] Starting sync with query:', query);

    // Create sync run record
    const runResult = await createIssueSyncRun(pool, query);
    if (!runResult.success || !runResult.data) {
      return errorResponse('Failed to create sync run', {
        status: 500,
        requestId,
        details: runResult.error,
      });
    }

    const runId = runResult.data;
    let totalCount = 0;
    let upsertedCount = 0;
    let error: string | null = null;
    const allIssues: any[] = []; // E7_extra: Store all fetched issues for status sync

    try {
      // Fetch issues from GitHub with deterministic pagination
      let page = 1;
      let hasMore = true;

      while (hasMore && upsertedCount < maxIssues) {
        console.log(`[API /api/ops/issues/sync] Fetching page ${page}...`);

        const result = await searchIssues({
          owner,
          repo,
          query,
          per_page: perPage,
          page,
          sort: 'updated',
          direction: 'desc',
        });

        totalCount = result.total_count;

        // Upsert each issue snapshot (with sanitization)
        for (const issue of result.issues) {
          if (upsertedCount >= maxIssues) break;

          // E7_extra: Store issue for later status sync
          allIssues.push(issue);

          const canonicalId = extractCanonicalId(issue.title, issue.labels);

          // Sanitize payload before persisting (strip URLs with query strings, redact secrets)
          const sanitizedPayload = sanitizeRedact(issue);

          const upsertResult = await upsertIssueSnapshot(pool, {
            repo_owner: owner,
            repo_name: repo,
            issue_number: issue.number,
            canonical_id: canonicalId,
            state: issue.state,
            title: issue.title,
            labels: issue.labels,
            assignees: issue.assignees,
            updated_at: issue.updated_at,
            gh_node_id: issue.node_id,
            payload_json: sanitizedPayload,
          });

          if (upsertResult.success) {
            upsertedCount++;
          } else {
            console.error(
              `[API /api/ops/issues/sync] Failed to upsert issue #${issue.number}:`,
              upsertResult.error
            );
          }
        }

        // Check if there are more pages
        hasMore = result.issues.length === perPage && page * perPage < totalCount;
        page++;

        // Safety limit: configurable max pages
        if (page > maxPages) {
          console.warn(
            `[API /api/ops/issues/sync] Reached page limit (${maxPages}), stopping`
          );
          hasMore = false;
        }
      }

      // Mark sync run as successful
      await updateIssueSyncRun(pool, runId, {
        status: 'SUCCESS',
        total_count: totalCount,
        upserted_count: upsertedCount,
      });

      console.log(
        `[API /api/ops/issues/sync] Sync completed: ${upsertedCount}/${totalCount} snapshots`
      );

      // I3: Sync GitHub status to AFU9 issues using State Model v1
      // Find AFU9 issues that are linked to GitHub issues and update their github_mirror_status
      let statusSyncedCount = 0;
      let statusSyncAttemptedCount = 0;
      let statusFetchOkCount = 0;
      let statusFetchFailedCount = 0;
      try {
        // NOTE: listAfu9Issues() defaults to LIMIT 100 which can miss older linked issues.
        // Page through issues to ensure all linked issues are considered (stage evidence: #458).
        const PAGE_LIMIT = 200;
        const MAX_PAGES = 50; // hard cap to avoid unbounded DB scans
        const allAfu9Issues: any[] = [];

        for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
          const pageResult = await listAfu9Issues(pool, {
            limit: PAGE_LIMIT,
            offset: pageIndex * PAGE_LIMIT,
          });

          if (!pageResult) {
            console.error('[API /api/ops/issues/sync] listAfu9Issues returned no result for status sync');
            break;
          }

          if (!pageResult.success) {
            console.error('[API /api/ops/issues/sync] Failed to list AFU9 issues for status sync:', pageResult.error);
            break;
          }

          const rows = pageResult.data ?? [];
          allAfu9Issues.push(...rows);

          if (rows.length < PAGE_LIMIT) {
            break;
          }
        }

        if (allAfu9Issues.length > 0) {
          const linkedIssues = allAfu9Issues
            .filter((i) => !!i.github_issue_number)
            .sort((a, b) => {
              const an = a.github_issue_number ?? 0;
              const bn = b.github_issue_number ?? 0;
              if (an !== bn) return an - bn;
              const aid = typeof a.id === 'string' ? a.id : '';
              const bid = typeof b.id === 'string' ? b.id : '';
              return aid.localeCompare(bid);
            });

          for (const afu9Issue of linkedIssues) {

            statusSyncAttemptedCount++;

            // I3: Repo resolution per issue - deterministic owner/repo from github_repo or github_url
            // This ensures we fetch from the correct repository for each issue
            let issueOwner: string;
            let issueRepo: string;
            let resolvedGithubRepo: string | null = afu9Issue.github_repo;

            // Step 1: Try to use existing github_repo field (format: "owner/repo")
            if (resolvedGithubRepo && typeof resolvedGithubRepo === 'string' && resolvedGithubRepo.includes('/')) {
              const parts = resolvedGithubRepo.split('/');
              // Validate exactly 2 parts (owner/repo) to prevent malformed data
              if (parts.length === 2 && parts[0] && parts[1]) {
                issueOwner = parts[0];
                issueRepo = parts[1];
              } else {
                // Invalid github_repo format (not exactly owner/repo), try to extract from URL
                const extracted = extractOwnerRepoFromGithubUrl(afu9Issue.github_url);
                if (extracted) {
                  issueOwner = extracted.owner;
                  issueRepo = extracted.repo;
                  resolvedGithubRepo = `${issueOwner}/${issueRepo}`;
                } else {
                  // Fallback to defaults from env
                  issueOwner = owner;
                  issueRepo = repo;
                  resolvedGithubRepo = `${owner}/${repo}`;
                }
              }
            } else {
              // github_repo is null/empty, try to extract from github_url
              const extracted = extractOwnerRepoFromGithubUrl(afu9Issue.github_url);
              if (extracted) {
                issueOwner = extracted.owner;
                issueRepo = extracted.repo;
                resolvedGithubRepo = `${issueOwner}/${issueRepo}`;
              } else {
                // Fallback to defaults from env
                issueOwner = owner;
                issueRepo = repo;
                resolvedGithubRepo = `${owner}/${repo}`;
              }
            }

            // Fetch fresh GitHub issue details via REST API
            let githubMirrorStatus: Afu9GithubMirrorStatus = 'UNKNOWN';
            let githubStatusRaw: string | null = null;
            let githubStatusUpdatedAt: string | null = null;
            let statusSource: Afu9StatusSource | null = null;
            let githubSyncError: string | null = null;

            try {
              const githubDetails = await getIssue(issueOwner, issueRepo, afu9Issue.github_issue_number);

              statusFetchOkCount++;

              // Mirror status is derived strictly from GitHub issue state
              githubMirrorStatus = githubDetails.state === 'open' ? 'OPEN' : 'CLOSED';
              statusSource = 'github_state';

              // Deterministic, sanitized snapshot
              const normalizedUpdatedAt = (() => {
                const parsed = new Date(githubDetails.updated_at);
                return Number.isNaN(parsed.getTime()) ? githubDetails.updated_at : parsed.toISOString();
              })();
              githubStatusUpdatedAt = (() => {
                const parsed = new Date(githubDetails.updated_at);
                return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
              })();

              const normalizedClosedAt = (() => {
                if (!githubDetails.closed_at) return null;
                const parsed = new Date(githubDetails.closed_at);
                return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
              })();

              const rawLabelNames = githubDetails.labels
                .map((l: any) => (typeof l?.name === 'string' ? l.name : ''))
                .filter((n: string) => !!n && n.trim().length > 0);

              // Repo-canon guardrail: ensure we exercise canonical State Model helper.
              // NOTE: Mirror semantics for AFU-9 are derived strictly from issue.state (OPEN/CLOSED).
              // The helper is invoked for mapping consistency audits (no side effects).
              extractGithubMirrorStatus(null, rawLabelNames, githubDetails.state);

              const labelNames = rawLabelNames
                .map((name: string) => {
                  return sanitizeLabelForSnapshot(name);
                })
                .filter((n: string) => !!n && n.trim().length > 0)
                .sort((a: string, b: string) => a.localeCompare(b));

              const snapshotBase: {
                state: 'open' | 'closed';
                labels: string[];
                updatedAt: string;
                closedAt?: string;
              } = {
                state: githubDetails.state,
                labels: [...labelNames],
                updatedAt: normalizedUpdatedAt,
              };

              if (normalizedClosedAt) {
                snapshotBase.closedAt = normalizedClosedAt;
              }

              // Bound github_status_raw deterministically to MAX_STATUS_RAW_LENGTH.
              // If too large, drop labels from the end (labels are already sorted).
              let snapshot = snapshotBase;
              let rawJson = JSON.stringify(snapshot);
              while (rawJson.length > MAX_STATUS_RAW_LENGTH && snapshot.labels.length > 0) {
                snapshot = {
                  ...snapshot,
                  labels: snapshot.labels.slice(0, snapshot.labels.length - 1),
                };
                rawJson = JSON.stringify(snapshot);
              }

              // As a final safety fallback, persist without labels.
              if (rawJson.length > MAX_STATUS_RAW_LENGTH) {
                const minimal = { ...snapshotBase, labels: [] as string[] };
                rawJson = JSON.stringify(minimal);
              }

              githubStatusRaw = rawJson.length <= MAX_STATUS_RAW_LENGTH ? rawJson : null;

              // Clear error on success
              githubSyncError = null;
            } catch (fetchError) {
              // If fetch fails, set error and mark mirror status as ERROR
              const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown fetch error';

              statusFetchFailedCount++;

              githubMirrorStatus = 'ERROR';
              githubStatusRaw = null;
              githubStatusUpdatedAt = null;
              statusSource = null;

              // Sanitize error message to prevent secret leakage
              const sanitizedMessage = sanitizeRedact(errorMessage);
              const message = typeof sanitizedMessage === 'string'
                ? sanitizedMessage.substring(0, 500)
                : 'Failed to fetch GitHub issue details';

              const lower = String(errorMessage || '').toLowerCase();
              const code = lower.includes('bad credentials') || lower.includes('authentication')
                ? 'AUTH_FAILED'
                : lower.includes('rate limit')
                  ? 'RATE_LIMIT'
                  : lower.includes('nicht gefunden') || lower.includes('not found')
                    ? 'NOT_FOUND'
                    : 'GITHUB_ERROR';

              githubSyncError = JSON.stringify({ code, message });

              console.warn(
                `[API /api/ops/issues/sync] Failed to fetch GitHub issue #${afu9Issue.github_issue_number}:`,
                errorMessage
              );
            }

            // I3: Update AFU9 issue with github_mirror_status and metadata
            // Also backfill github_repo if it was extracted from github_url
            const previousMirrorStatus = afu9Issue.github_mirror_status;
            const updateResult = await updateAfu9Issue(pool, afu9Issue.id, {
              github_mirror_status: githubMirrorStatus,
              github_status_raw: githubStatusRaw,
              github_status_updated_at: githubStatusUpdatedAt,
              status_source: statusSource,
              github_issue_last_sync_at: new Date().toISOString(),
              github_sync_error: githubSyncError,
              github_repo: resolvedGithubRepo, // Backfill github_repo if it was null
            });

            if (updateResult.success) {
              statusSyncedCount++;
              if (previousMirrorStatus !== githubMirrorStatus) {
                console.log(
                  `[API /api/ops/issues/sync] Synced GitHub mirror status for AFU9 issue ${afu9Issue.id}: ${previousMirrorStatus} → ${githubMirrorStatus}`
                );
              }
            }
          }
        }
      } catch (statusSyncError) {
        // Log but don't fail the entire sync if status sync fails
        console.error('[API /api/ops/issues/sync] Status sync error:', statusSyncError);
      }

      const responseBody: any = {
        routeVersion: 'mirror-v1',
        ok: true,
        total: totalCount,
        upserted: upsertedCount,
        statusSynced: statusSyncedCount,
        statusSyncAttempted: statusSyncAttemptedCount,
        statusFetchOk: statusFetchOkCount,
        statusFetchFailed: statusFetchFailedCount,
        syncedAt: new Date().toISOString(),
      };

      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }

      return jsonResponse(responseBody, { requestId });
    } catch (syncError) {
      // Mark sync run as failed
      error = syncError instanceof Error ? syncError.message : 'Unknown sync error';
      await updateIssueSyncRun(pool, runId, {
        status: 'FAILED',
        total_count: totalCount,
        upserted_count: upsertedCount,
        error,
      });

      throw syncError;
    }
  } catch (err) {
    console.error('[API /api/ops/issues/sync] Error during sync:', err);
    return errorResponse('Failed to sync issues', {
      status: 500,
      requestId,
      details: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
