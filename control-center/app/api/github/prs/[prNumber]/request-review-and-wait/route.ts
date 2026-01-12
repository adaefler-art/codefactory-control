/**
 * POST /api/github/prs/{prNumber}/request-review-and-wait
 * 
 * Requests PR reviews and waits for checks to complete with bounded polling.
 * 
 * Features:
 * - Bounded polling with deterministic intervals
 * - Early termination on terminal states
 * - Status rollup (checks, reviews, mergeable)
 * 
 * Epic E83.4: Tool request_review_and_wait_checks
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPrReviewWaitService } from '@/lib/pr-review-wait-service';
import {
  RequestReviewAndWaitInputSchema,
  RegistryAuthorizationError,
  PrNotFoundError,
} from '@/lib/types/pr-review-wait';
import { logger } from '@/lib/logger';
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * POST /api/github/prs/{prNumber}/request-review-and-wait
 * 
 * Request body:
 * {
 *   owner: string,
 *   repo: string,
 *   reviewers?: string[],
 *   maxWaitSeconds?: number, // Default: 900, Max: 3600
 *   pollSeconds?: number, // Default: 15, Min: 5, Max: 300
 *   requestId?: string
 * }
 * 
 * Response:
 * {
 *   rollup: {
 *     checks: 'GREEN' | 'YELLOW' | 'RED',
 *     reviews: 'APPROVED' | 'PENDING' | 'CHANGES_REQUESTED',
 *     mergeable: boolean | null
 *   },
 *   evidence: {
 *     checks: CheckRunEvidence[],
 *     reviews: ReviewEvidence[]
 *   },
 *   pollingStats: {
 *     totalPolls: number,
 *     elapsedSeconds: number,
 *     timedOut: boolean,
 *     terminatedEarly: boolean,
 *     terminationReason?: string
 *   },
 *   requestId?: string
 * }
 * 
 * Status codes:
 * - 200: Success
 * - 400: Invalid input
 * - 401: Authentication required
 * - 403: Registry authorization failed or repo access denied
 * - 404: PR not found
 * - 409: Conflict (e.g., concurrent operation)
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
    const input = RequestReviewAndWaitInputSchema.parse({
      ...body,
      prNumber,
      requestId,
    });

    logger.info('Requesting review and waiting for checks', {
      owner: input.owner,
      repo: input.repo,
      prNumber,
      reviewers: input.reviewers,
      maxWaitSeconds: input.maxWaitSeconds,
      pollSeconds: input.pollSeconds,
      requestId,
    }, 'RequestReviewAndWaitAPI');

    // Request review and wait
    const service = getPrReviewWaitService();
    const result = await service.requestReviewAndWait(input);

    logger.info('Completed review request and checks wait', {
      rollup: result.rollup,
      pollingStats: result.pollingStats,
      requestId,
    }, 'RequestReviewAndWaitAPI');

    return NextResponse.json(result, {
      status: 200,
      headers: { 'x-request-id': requestId || '' },
    });
  } catch (error) {
    logger.error(
      'Failed to request review and wait for checks',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'RequestReviewAndWaitAPI'
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
