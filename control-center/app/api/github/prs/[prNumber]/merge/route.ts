/**
 * POST /api/github/prs/{prNumber}/merge
 * 
 * Merge PR with explicit approval and comprehensive precondition validation.
 * 
 * Features:
 * - Fail-closed semantics (blocks if preconditions not met)
 * - Registry-driven merge method selection
 * - Automatic branch cleanup (if enabled)
 * - Comprehensive audit logging
 * 
 * Epic E83.5: Merge Gate
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMergePrService } from '@/lib/merge-pr-service';
import {
  MergePrInputSchema,
  MergePreconditionsNotMetError,
  ProductionMergeBlockedError,
  ExplicitApprovalRequiredError,
} from '@/lib/types/merge-pr';
import { PrNotFoundError, RegistryAuthorizationError } from '@/lib/types/pr-review-wait';
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';
import { logger } from '@/lib/logger';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * POST /api/github/prs/{prNumber}/merge
 * 
 * Request body:
 * {
 *   owner: string,
 *   repo: string,
 *   approvalToken?: string,  // Explicit approval token/flag
 *   requestId?: string
 * }
 * 
 * Response:
 * {
 *   decision: 'MERGED' | 'BLOCKED_*',
 *   reasonCodes: string[],
 *   merged: boolean,
 *   branchDeleted: boolean,
 *   mergeMethod?: 'merge' | 'squash' | 'rebase',
 *   commitSha?: string,
 *   preconditionSnapshot: {
 *     checks: CheckEvidence[],
 *     reviews: ReviewEvidence[],
 *     mergeable: boolean | null,
 *     draft: boolean,
 *     labels: string[]
 *   },
 *   auditEventId?: number,
 *   requestId?: string
 * }
 * 
 * Status codes:
 * - 200: Success (either merged or blocked with reason)
 * - 400: Invalid input
 * - 401: Authentication required
 * - 403: Registry authorization failed, repo access denied, or prod merge blocked
 * - 404: PR not found
 * - 409: Conflict (e.g., merge conflict, not mergeable)
 * - 500: Internal error
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || undefined;

  try {
    // Get PR number from params
    const params = await context.params;
    const prNumber = parseInt(params.prNumber, 10);

    if (isNaN(prNumber) || prNumber <= 0) {
      return NextResponse.json(
        { error: 'Invalid PR number', code: 'INVALID_PR_NUMBER' },
        { status: 400, headers: { 'x-request-id': requestId || '' } }
      );
    }

    // Parse request body
    const body = await request.json();

    // Validate input
    const input = MergePrInputSchema.parse({
      ...body,
      prNumber,
      requestId,
    });

    logger.info('Merging PR with explicit approval', {
      owner: input.owner,
      repo: input.repo,
      prNumber,
      hasApprovalToken: !!input.approvalToken,
      requestId,
    }, 'MergePrAPI');

    // Merge PR
    const service = getMergePrService();
    const result = await service.mergePrWithApproval(input);

    logger.info('Completed merge PR operation', {
      decision: result.decision,
      merged: result.merged,
      branchDeleted: result.branchDeleted,
      requestId,
    }, 'MergePrAPI');

    // Return 200 for both success and blocked scenarios
    // The decision field indicates the actual outcome
    return NextResponse.json(result, {
      status: 200,
      headers: { 'x-request-id': requestId || '' },
    });
  } catch (error) {
    logger.error(
      'Failed to merge PR',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'MergePrAPI'
    );

    // Handle specific errors
    if (error instanceof RegistryAuthorizationError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 403, headers: { 'x-request-id': requestId || '' } }
      );
    }

    if (error instanceof PrNotFoundError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 404, headers: { 'x-request-id': requestId || '' } }
      );
    }

    if (error instanceof ProductionMergeBlockedError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 403, headers: { 'x-request-id': requestId || '' } }
      );
    }

    if (error instanceof MergePreconditionsNotMetError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 409, headers: { 'x-request-id': requestId || '' } }
      );
    }

    if (error instanceof ExplicitApprovalRequiredError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 403, headers: { 'x-request-id': requestId || '' } }
      );
    }

    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        {
          error: 'Repository access denied',
          code: 'REPO_ACCESS_DENIED',
          details: { repository: error.repository },
        },
        { status: 403, headers: { 'x-request-id': requestId || '' } }
      );
    }

    // Validation errors
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          code: 'INVALID_INPUT',
          message: error.message,
        },
        { status: 400, headers: { 'x-request-id': requestId || '' } }
      );
    }

    // Generic error
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: { 'x-request-id': requestId || '' } }
    );
  }
}
