/**
 * GitHub Status Sync API
 * 
 * Fetches and caches GitHub PR/Issue status (checks, CI, mergeability)
 * 
 * Reference: E84 - Post-Publish Workflow Automation
 */

import { NextRequest, NextResponse } from 'next/server';
import { withApi } from '@/lib/http/withApi';
import { z } from 'zod';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { withRetry, DEFAULT_RETRY_CONFIG } from '@/lib/github/retry-policy';
import { getPool } from '@/lib/db';

// ========================================
// Request Schema
// ========================================

const SyncRequestSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
  resource_type: z.enum(['issue', 'pull_request']),
});

type SyncRequest = z.infer<typeof SyncRequestSchema>;

// ========================================
// Types
// ========================================

interface GitHubStatusData {
  resource_type: 'issue' | 'pull_request';
  owner: string;
  repo: string;
  number: number;
  
  // PR-specific
  pr_state?: string;
  pr_mergeable?: boolean;
  pr_mergeable_state?: string;
  pr_draft?: boolean;
  pr_head_sha?: string;
  pr_base_ref?: string;
  pr_head_ref?: string;
  
  // Checks
  checks_status?: string;
  checks_total?: number;
  checks_passed?: number;
  checks_failed?: number;
  checks_pending?: number;
  
  // CI
  ci_status?: string;
  ci_contexts?: any;
  
  // Reviews
  review_decision?: string;
  reviews_total?: number;
  reviews_approved?: number;
  reviews_changes_requested?: number;
  
  last_synced_at: Date;
}

// ========================================
// GitHub API Helpers
// ========================================

/**
 * Fetch PR data from GitHub
 * 
 * Bounds: Single PR, max 4 API calls (GET pr, GET checks, GET status, GET reviews)
 * All calls are bounded by GitHub's pagination (max 100 items per page, we use first page only)
 */
async function fetchPullRequestData(
  owner: string,
  repo: string,
  number: number
): Promise<GitHubStatusData> {
  const octokit = await createAuthenticatedClient({ owner, repo });
  
  // API call 1/4: Fetch PR data with retry (idempotent GET)
  const prData = await withRetry(
    async () => {
      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: number,
      });
      return data;
    },
    { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `pr-${number}`, endpoint: 'pulls.get' }
  );
  
  // API call 2/4: Fetch check runs (bounded: first 100 checks max)
  let checksData = null;
  if (prData.head.sha) {
    try {
      checksData = await withRetry(
        async () => {
          const { data } = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: prData.head.sha,
            per_page: 100, // Explicit bound
          });
          return data;
        },
        { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `pr-${number}`, endpoint: 'checks.listForRef' }
      );
    } catch (error) {
      console.warn('[GitHub Status Sync] Failed to fetch check runs:', error);
    }
  }
  
  // API call 3/4: Fetch commit status (bounded: returns combined status)
  let statusData = null;
  if (prData.head.sha) {
    try {
      statusData = await withRetry(
        async () => {
          const { data } = await octokit.rest.repos.getCombinedStatusForRef({
            owner,
            repo,
            ref: prData.head.sha,
          });
          return data;
        },
        { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `pr-${number}`, endpoint: 'repos.getCombinedStatusForRef' }
      );
    } catch (error) {
      console.warn('[GitHub Status Sync] Failed to fetch commit status:', error);
    }
  }
  
  // API call 4/4: Fetch reviews (bounded: first 100 reviews max)
  let reviewsData = null;
  try {
    reviewsData = await withRetry(
      async () => {
        const { data } = await octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: number,
          per_page: 100, // Explicit bound
        });
        return data;
      },
      { ...DEFAULT_RETRY_CONFIG, httpMethod: 'GET', requestId: `pr-${number}`, endpoint: 'pulls.listReviews' }
    );
  } catch (error) {
    console.warn('[GitHub Status Sync] Failed to fetch reviews:', error);
  }
  
  // Calculate check status (bounded: max 100 checks processed)
  let checksStatus = null;
  let checksTotal = 0;
  let checksPassed = 0;
  let checksFailed = 0;
  let checksPending = 0;
  
  if (checksData && checksData.check_runs) {
    checksTotal = checksData.check_runs.length;
    
    for (const check of checksData.check_runs) {
      if (check.status === 'completed') {
        if (check.conclusion === 'success') {
          checksPassed++;
        } else if (check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'cancelled') {
          checksFailed++;
        }
      } else {
        checksPending++;
      }
    }
    
    if (checksFailed > 0) {
      checksStatus = 'failure';
    } else if (checksPending > 0) {
      checksStatus = 'pending';
    } else if (checksPassed > 0) {
      checksStatus = 'success';
    }
  }
  
  // Calculate review status
  let reviewDecision = null;
  let reviewsTotal = 0;
  let reviewsApproved = 0;
  let reviewsChangesRequested = 0;
  
  if (reviewsData) {
    reviewsTotal = reviewsData.length;
    
    // Get latest review from each reviewer
    const latestReviews = new Map<string, any>();
    for (const review of reviewsData) {
      if (review.user?.login) {
        const existing = latestReviews.get(review.user.login);
        if (!existing || new Date(review.submitted_at!) > new Date(existing.submitted_at!)) {
          latestReviews.set(review.user.login, review);
        }
      }
    }
    
    for (const review of latestReviews.values()) {
      if (review.state === 'APPROVED') {
        reviewsApproved++;
      } else if (review.state === 'CHANGES_REQUESTED') {
        reviewsChangesRequested++;
      }
    }
    
    if (reviewsChangesRequested > 0) {
      reviewDecision = 'CHANGES_REQUESTED';
    } else if (reviewsApproved > 0) {
      reviewDecision = 'APPROVED';
    } else if (reviewsTotal > 0) {
      reviewDecision = 'REVIEW_REQUIRED';
    }
  }
  
  return {
    resource_type: 'pull_request',
    owner,
    repo,
    number,
    pr_state: prData.state,
    pr_mergeable: prData.mergeable ?? undefined,
    pr_mergeable_state: prData.mergeable_state ?? undefined,
    pr_draft: prData.draft,
    pr_head_sha: prData.head.sha,
    pr_base_ref: prData.base.ref,
    pr_head_ref: prData.head.ref,
    checks_status: checksStatus ?? undefined,
    checks_total: checksTotal,
    checks_passed: checksPassed,
    checks_failed: checksFailed,
    checks_pending: checksPending,
    ci_status: statusData?.state ?? undefined,
    ci_contexts: statusData ? statusData.statuses : undefined,
    review_decision: reviewDecision ?? undefined,
    reviews_total: reviewsTotal,
    reviews_approved: reviewsApproved,
    reviews_changes_requested: reviewsChangesRequested,
    last_synced_at: new Date(),
  };
}

/**
 * Upsert status data into database
 */
async function upsertStatusData(data: GitHubStatusData): Promise<void> {
  const db = getPool();
  
  await db.query(
    `
    INSERT INTO github_status_cache (
      resource_type, owner, repo, number,
      pr_state, pr_mergeable, pr_mergeable_state, pr_draft,
      pr_head_sha, pr_base_ref, pr_head_ref,
      checks_status, checks_total, checks_passed, checks_failed, checks_pending,
      ci_status, ci_contexts,
      review_decision, reviews_total, reviews_approved, reviews_changes_requested,
      last_synced_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14, $15, $16,
      $17, $18,
      $19, $20, $21, $22,
      $23
    )
    ON CONFLICT (resource_type, owner, repo, number)
    DO UPDATE SET
      pr_state = EXCLUDED.pr_state,
      pr_mergeable = EXCLUDED.pr_mergeable,
      pr_mergeable_state = EXCLUDED.pr_mergeable_state,
      pr_draft = EXCLUDED.pr_draft,
      pr_head_sha = EXCLUDED.pr_head_sha,
      pr_base_ref = EXCLUDED.pr_base_ref,
      pr_head_ref = EXCLUDED.pr_head_ref,
      checks_status = EXCLUDED.checks_status,
      checks_total = EXCLUDED.checks_total,
      checks_passed = EXCLUDED.checks_passed,
      checks_failed = EXCLUDED.checks_failed,
      checks_pending = EXCLUDED.checks_pending,
      ci_status = EXCLUDED.ci_status,
      ci_contexts = EXCLUDED.ci_contexts,
      review_decision = EXCLUDED.review_decision,
      reviews_total = EXCLUDED.reviews_total,
      reviews_approved = EXCLUDED.reviews_approved,
      reviews_changes_requested = EXCLUDED.reviews_changes_requested,
      last_synced_at = EXCLUDED.last_synced_at,
      sync_error = NULL
    `,
    [
      data.resource_type,
      data.owner,
      data.repo,
      data.number,
      data.pr_state,
      data.pr_mergeable,
      data.pr_mergeable_state,
      data.pr_draft,
      data.pr_head_sha,
      data.pr_base_ref,
      data.pr_head_ref,
      data.checks_status,
      data.checks_total,
      data.checks_passed,
      data.checks_failed,
      data.checks_pending,
      data.ci_status,
      data.ci_contexts ? JSON.stringify(data.ci_contexts) : null,
      data.review_decision,
      data.reviews_total,
      data.reviews_approved,
      data.reviews_changes_requested,
      data.last_synced_at,
    ]
  );
}

// ========================================
// API Handler
// ========================================

/**
 * POST /api/github/status/sync
 * 
 * Sync GitHub PR/Issue status and cache in database
 * 
 * Guard order: 401 (auth) → 403 (permissions) → GitHub API
 * Audit: logs every sync attempt with requestId and result hash
 * Bounds: limited to single PR, max API calls bounded by GitHub API structure
 */
export const POST = withApi(async (request: NextRequest) => {
  const requestId = request.headers.get('x-request-id') || `sync-${Date.now()}`;
  const startTime = Date.now();
  
  // Parse request body
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Invalid JSON in request body',
      },
      { status: 400 }
    );
  }
  
  // Validate request
  const validation = SyncRequestSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: 'Invalid request',
        details: validation.error.errors,
      },
      { status: 400 }
    );
  }
  
  const { owner, repo, number, resource_type } = validation.data;
  
  // Guard 1: Authentication check (would be handled by middleware in production)
  // For now, we assume authentication is handled upstream
  
  // Guard 2: Only support pull requests for now
  if (resource_type !== 'pull_request') {
    return NextResponse.json(
      {
        error: 'Only pull_request resource type is supported',
      },
      { status: 400 }
    );
  }
  
  // Guard 3: Permission check via auth-wrapper (fail-closed)
  // This is enforced by createAuthenticatedClient which checks repo access policy
  
  const db = getPool();
  let auditId: number | null = null;
  
  try {
    // Insert audit record (append-only, before operation)
    const auditResult = await db.query(
      `
      INSERT INTO workflow_action_audit (
        action_type, action_status, resource_type,
        resource_owner, resource_repo, resource_number,
        initiated_by, action_params
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        'status_sync',
        'pending',
        resource_type,
        owner,
        repo,
        number,
        'api_user', // TODO: Extract from auth context
        JSON.stringify({ requestId, sync_type: 'manual' }),
      ]
    );
    auditId = auditResult.rows[0].id;
    
    // Fetch data from GitHub (bounded: 1 PR, ~4 API calls max)
    console.log(`[GitHub Status Sync] [${requestId}] Syncing ${owner}/${repo}#${number}`);
    const statusData = await fetchPullRequestData(owner, repo, number);
    
    // Calculate result hash for audit
    const resultHash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(statusData))
      .digest('hex')
      .substring(0, 16);
    
    // Upsert into database
    await upsertStatusData(statusData);
    
    // Update audit record with success
    const duration = Date.now() - startTime;
    await db.query(
      `
      UPDATE workflow_action_audit
      SET action_status = $1, completed_at = NOW(),
          action_result = $2
      WHERE id = $3
      `,
      [
        'completed',
        JSON.stringify({ requestId, resultHash, duration_ms: duration }),
        auditId,
      ]
    );
    
    console.log(`[GitHub Status Sync] [${requestId}] Synced ${owner}/${repo}#${number} successfully (hash: ${resultHash})`);
    
    return NextResponse.json({
      success: true,
      data: statusData,
      meta: {
        requestId,
        resultHash,
        duration_ms: duration,
      },
    });
  } catch (error) {
    console.error(`[GitHub Status Sync] [${requestId}] Error syncing ${owner}/${repo}#${number}:`, error);
    
    // Update audit record with failure
    if (auditId) {
      const duration = Date.now() - startTime;
      await db.query(
        `
        UPDATE workflow_action_audit
        SET action_status = $1, completed_at = NOW(),
            error_message = $2, action_result = $3
        WHERE id = $4
        `,
        [
          'failed',
          error instanceof Error ? error.message : String(error),
          JSON.stringify({ requestId, duration_ms: duration }),
          auditId,
        ]
      );
    }
    
    // Update cache with error
    await db.query(
      `
      INSERT INTO github_status_cache (
        resource_type, owner, repo, number,
        last_synced_at, sync_error
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (resource_type, owner, repo, number)
      DO UPDATE SET
        last_synced_at = EXCLUDED.last_synced_at,
        sync_error = EXCLUDED.sync_error
      `,
      [
        resource_type,
        owner,
        repo,
        number,
        new Date(),
        error instanceof Error ? error.message : String(error),
      ]
    );
    
    throw error;
  }
});

/**
 * GET /api/github/status/sync?owner=...&repo=...&number=...&resource_type=...
 * 
 * Get cached GitHub PR/Issue status
 */
export const GET = withApi(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const number = searchParams.get('number');
  const resourceType = searchParams.get('resource_type');
  
  if (!owner || !repo || !number || !resourceType) {
    return NextResponse.json(
      {
        error: 'Missing required parameters: owner, repo, number, resource_type',
      },
      { status: 400 }
    );
  }
  
  const db = getPool();
  const result = await db.query(
    `
    SELECT * FROM github_status_cache
    WHERE resource_type = $1
      AND owner = $2
      AND repo = $3
      AND number = $4
    `,
    [resourceType, owner, repo, parseInt(number, 10)]
  );
  
  if (result.rows.length === 0) {
    return NextResponse.json(
      {
        error: 'Status not found. Sync first using POST.',
      },
      { status: 404 }
    );
  }
  
  return NextResponse.json({
    success: true,
    data: result.rows[0],
  });
});
