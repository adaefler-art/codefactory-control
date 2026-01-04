/**
 * API Route: POST /api/ops/issues/sync
 * 
 * AFU-9 Issue Status Sync MVP
 * 
 * Polls GitHub issues and syncs them to issue_snapshots table.
 * Auth-first (401-first using x-afu9-sub), deterministic pagination, GitHub App only.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
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
 * - syncedAt: string - ISO timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '../../../../../src/lib/db';
import { searchIssues } from '../../../../../src/lib/github';
import {
  createIssueSyncRun,
  updateIssueSyncRun,
  upsertIssueSnapshot,
} from '../../../../../src/lib/db/issueSync';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { isRepoAllowed } from '@/lib/github/auth-wrapper';
import { sanitizeRedact } from '@/lib/contracts/remediation-playbook';

// Constants
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'adaefler-art';
const GITHUB_REPO = process.env.GITHUB_REPO || 'codefactory-control';
const MAX_SYNC_PAGES = 10;
const MAX_ISSUES = 200;
const PER_PAGE_MAX = 100;

// Zod schema for request validation
const SyncRequestSchema = z.object({
  owner: z.string().min(1).max(255).optional(),
  repo: z.string().min(1).max(255).optional(),
  query: z.string().max(500).optional(),
  maxIssues: z.number().int().min(1).max(MAX_ISSUES).optional(),
  perPage: z.number().int().min(1).max(PER_PAGE_MAX).optional(),
  maxPages: z.number().int().min(1).max(MAX_SYNC_PAGES).optional(),
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

      const responseBody: any = {
        ok: true,
        total: totalCount,
        upserted: upsertedCount,
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
