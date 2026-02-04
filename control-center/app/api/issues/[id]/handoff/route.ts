/**
 * API Route: /api/issues/[id]/handoff
 * 
 * Hands off an AFU9 issue to GitHub (creates GitHub issue)
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 * Issue #3: Identifier Consistency (UUID + publicId)
 * 
 * **Identifier Handling:**
 * - Accepts both UUID (canonical) and 8-hex publicId (display)
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import {
  updateAfu9Issue,
  getAfu9IssueByCanonicalId,
} from '../../../../../src/lib/db/afu9Issues';
import {
  Afu9HandoffState,
  Afu9IssueStatus,
} from '../../../../../src/lib/contracts/afu9Issue';
import { createIssue, updateIssue, findIssueByMarker } from '../../../../../src/lib/github';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { fetchIssueRowByIdentifier, normalizeIssueForApi } from '../../_shared';
import { validateAndNormalizeLabelsForHandoff } from '../../../../../src/lib/label-utils';
import { errorResponse, getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { RepoAccessDeniedError } from '@/lib/github/policy';

const GITHUB_OWNER = process.env.GITHUB_OWNER || "adaefler-art";
const GITHUB_REPO = process.env.GITHUB_REPO || "codefactory-control";

/**
 * POST /api/issues/[id]/handoff
 * 
 * E61.3: Idempotent GitHub Handoff with Metadata Tracking
 * 
 * Handoff Semantics:
 * - Unidirectional: AFU9 -> GitHub
 * - Idempotent: If github_issue_number exists, UPDATE instead of CREATE
 * - Deterministic: Uses AFU9-ISSUE:<id> marker in issue body
 * - Traceable: Stores handoff_at, github_repo, github_issue_last_sync_at
 * 
 * States:
 * - NOT_SENT -> PENDING -> SYNCED (on create)
 * - SYNCED/FAILED -> PENDING -> SYNCHRONIZED (on update)
 * - Any -> PENDING -> FAILED (on error)
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const requestId = getRequestId(request);
    const { id } = await params;

    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object') {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = null;
    }

    const bodyIssueId = typeof body?.issue_id === 'string' ? body.issue_id : undefined;
    const bodyCanonicalId = typeof body?.canonical_id === 'string' ? body.canonical_id : undefined;
    const lookupId = bodyIssueId || id;

    let resolved = await fetchIssueRowByIdentifier(pool, lookupId);
    if (!resolved.ok && resolved.status === 400) {
      const canonicalCandidate = bodyCanonicalId || lookupId;
      if (canonicalCandidate) {
        const canonicalResult = await getAfu9IssueByCanonicalId(pool, canonicalCandidate);
        if (canonicalResult.success && canonicalResult.data) {
          resolved = { ok: true as const, status: 200 as const, row: canonicalResult.data };
        } else {
          const message = typeof canonicalResult.error === 'string' ? canonicalResult.error : '';
          const isNotFound = message.toLowerCase().includes('not found');
          return errorResponse(isNotFound ? 'Issue not found' : 'Invalid issue identifier format', {
            status: isNotFound ? 404 : 400,
            requestId,
            details: isNotFound
              ? `canonical_id: ${canonicalCandidate}`
              : 'Identifier must be a valid UUID v4, 8-hex publicId, or canonicalId',
            code: isNotFound ? 'ISSUE_NOT_FOUND' : 'INVALID_ID',
          });
        }
      }
    }

    if (!resolved.ok) {
      return errorResponse(
        resolved.body?.error ? String(resolved.body.error) : 'Issue lookup failed',
        {
          status: resolved.status,
          requestId,
          details: resolved.body?.details ? String(resolved.body.details) : undefined,
          code: resolved.status === 404 ? 'ISSUE_NOT_FOUND' : 'INVALID_ID',
        }
      );
    }

    const issue = resolved.row as any;
    const internalId = String(issue.id);

    // Invariant: Require title for handoff
    if (!issue.title || issue.title.trim().length === 0) {
      return errorResponse('Cannot handoff issue without a title', {
        status: 400,
        requestId,
        details: 'Handoff requires a non-empty title. Please set a title before handing off to GitHub.',
        code: 'INVALID_ID',
      });
    }

    // Invariant: SYNCED/SYNCHRONIZED handoff_state cannot occur with CREATED status
    if (issue.status === Afu9IssueStatus.CREATED && 
        (issue.handoff_state === Afu9HandoffState.SYNCED || 
         issue.handoff_state === Afu9HandoffState.SYNCHRONIZED)) {
      return errorResponse('Invalid state combination', {
        status: 400,
        requestId,
        details: 'Issue with status CREATED cannot have handoff_state SYNCED/SYNCHRONIZED. This violates lifecycle invariants.',
        code: 'INVALID_ID',
      });
    }

    // E61.3: Determine if this is an update (idempotent) or create (new)
    const isUpdate = issue.github_issue_number !== null && issue.github_issue_number > 0;
    const targetState = isUpdate ? Afu9HandoffState.SYNCHRONIZED : Afu9HandoffState.SYNCED;

    // If already in final state for this operation type, return success (true idempotency)
    // - For creates (no github_issue_number): skip if state is SYNCED
    // - For updates (has github_issue_number): skip if state is SYNCHRONIZED
    // This means: SYNCED issues can be re-synced via UPDATE, but won't create duplicates
    if (issue.handoff_state === targetState) {
      const responseBody: any = {
        message: isUpdate 
          ? 'Issue already synchronized with GitHub'
          : 'Issue already handed off to GitHub',
        issue: normalizeIssueForApi(issue),
        github_url: issue.github_url,
        github_issue_number: issue.github_issue_number,
        github_repo: issue.github_repo,
      };
      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }
      return jsonResponse(responseBody, { requestId });
    }

    // Mark as PENDING before attempting GitHub operation
    const pendingResult = await updateAfu9Issue(pool, internalId, {
      handoff_state: Afu9HandoffState.PENDING,
      handoff_at: new Date().toISOString(),
      handoff_error: null, // Clear previous error
    });

    if (!pendingResult.success) {
      return errorResponse('Failed to update handoff state to PENDING', {
        status: 500,
        requestId,
        details: pendingResult.error,
        code: 'INTERNAL_ERROR',
      });
    }

    try {
      // Create idempotency key marker
      const idempotencyKey = `AFU9-ISSUE:${internalId}`;
      
      // Build GitHub issue body with idempotency marker
      const githubBody = [
        issue.body || '',
        '',
        '---',
        `<!-- ${idempotencyKey} -->`,
      ].join('\n');

      // Normalize and validate labels before sending to GitHub
      let normalizedLabels: string[];
      try {
        normalizedLabels = validateAndNormalizeLabelsForHandoff(issue.labels || []);
      } catch (labelError) {
        // Label validation failed - update state to FAILED
        await updateAfu9Issue(pool, internalId, {
          handoff_state: Afu9HandoffState.FAILED,
          handoff_error: labelError instanceof Error ? labelError.message : String(labelError),
        });
        
        return NextResponse.json(
          {
            error: 'Invalid labels for GitHub handoff',
            details: labelError instanceof Error ? labelError.message : String(labelError),
            invalidLabels: issue.labels,
          },
          { status: 400 }
        );
      }

      // Build labels array including priority if set
      const githubLabels = [...normalizedLabels];
      if (issue.priority) {
        githubLabels.push(`priority:${issue.priority}`);
      }

      let githubIssue: { number: number; html_url: string };
      let recoveredFromMarker = false;

      // E61.3: Idempotency - UPDATE if github_issue_number exists, CREATE otherwise
      if (isUpdate) {
        // UPDATE existing GitHub issue
        githubIssue = await updateIssue({
          number: issue.github_issue_number,
          title: issue.title,
          body: githubBody,
          labels: githubLabels,
        });
      } else {
        const recovered = await findIssueByMarker({
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          marker: idempotencyKey,
        });

        if (recovered) {
          githubIssue = recovered;
          recoveredFromMarker = true;
        } else {
        // CREATE new GitHub issue
        githubIssue = await createIssue({
          title: issue.title,
          body: githubBody,
          labels: githubLabels,
        });
        }
      }

      // Update AFU9 issue with GitHub details and sync metadata
      const syncedResult = await updateAfu9Issue(pool, internalId, {
        handoff_state: recoveredFromMarker ? Afu9HandoffState.SYNCED : targetState,
        github_issue_number: githubIssue.number,
        github_url: githubIssue.html_url,
        github_repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
        github_issue_last_sync_at: new Date().toISOString(),
        handoff_error: null,
      });

      if (!syncedResult.success) {
        // GitHub issue created/updated but failed to update AFU9 issue
        // This is a critical partial failure
        console.error(
          '[API /api/issues/[id]/handoff] GitHub issue created/updated but failed to update AFU9 issue:',
          {
            id,
            github_number: githubIssue.number,
            github_url: githubIssue.html_url,
            error: syncedResult.error,
            isUpdate,
          }
        );

        return errorResponse(
          `Partial handoff failure: GitHub issue ${isUpdate ? 'updated' : 'created'} but failed to update AFU9 issue`,
          {
            status: 500,
            requestId,
            details: syncedResult.error,
            code: 'PARTIAL_FAILURE',
          }
        );
      }

      const responseBody: any = {
        message: isUpdate 
          ? 'Issue synchronized with GitHub successfully'
          : 'Issue handed off to GitHub successfully',
        issue: normalizeIssueForApi(syncedResult.data),
        github_url: githubIssue.html_url,
        github_issue_number: githubIssue.number,
        github_repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
        handoff_state: targetState,
      };
      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }
      return jsonResponse(responseBody, { requestId });
    } catch (githubError) {
      // GitHub creation/update failed - update handoff_state to FAILED
      const errorMessage =
        githubError instanceof Error ? githubError.message : String(githubError);

      if (githubError instanceof RepoAccessDeniedError) {
        await updateAfu9Issue(pool, internalId, {
          handoff_state: Afu9HandoffState.FAILED,
          handoff_error: errorMessage,
        });

        return errorResponse('Repository access denied', {
          status: 403,
          requestId,
          details: errorMessage,
          code: 'POLICY_DENIED',
        });
      }

      // Log full error for debugging
      console.error('[API /api/issues/[id]/handoff] GitHub issue operation failed:', {
        id,
        error: errorMessage,
        isUpdate,
        fullError: githubError instanceof Error ? {
          message: githubError.message,
          stack: githubError.stack,
          name: githubError.name,
        } : githubError,
      });

      await updateAfu9Issue(pool, internalId, {
        handoff_state: Afu9HandoffState.FAILED,
        handoff_error: errorMessage,
      });

      const isRateLimit = errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('api-limit');
      const isAuthError = errorMessage.toLowerCase().includes('authentication failed');

      if (isRateLimit) {
        return jsonResponse(
          {
            error: `Failed to ${isUpdate ? 'update' : 'create'} GitHub issue`,
            details: errorMessage,
            code: 'TRANSIENT',
            retry_after: 60,
          },
          {
            status: 429,
            requestId,
            headers: {
              'retry-after': '60',
            },
          }
        );
      }

      return errorResponse(`Failed to ${isUpdate ? 'update' : 'create'} GitHub issue`, {
        status: isAuthError ? 401 : 500,
        requestId,
        details: errorMessage,
        code: isAuthError ? 'AUTH_REQUIRED' : 'INTERNAL_ERROR',
      });
    }
  } catch (error) {
    console.error('[API /api/issues/[id]/handoff] Error during handoff:', error);
    return errorResponse('Failed to handoff issue', {
      status: 500,
      requestId: getRequestId(request),
      details: error instanceof Error ? error.message : 'Unknown error',
      code: 'INTERNAL_ERROR',
    });
  }
}
