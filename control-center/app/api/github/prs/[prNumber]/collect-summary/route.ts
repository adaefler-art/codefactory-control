/**
 * POST /api/github/prs/{prNumber}/collect-summary
 * 
 * Collects implementation summary from a PR including:
 * - PR description
 * - Top N comments (bounded)
 * - Check run conclusion summaries
 * 
 * Returns stable hash for same PR state, new hash after changes.
 * 
 * Epic E83.3: Implementation Summary Ingestion
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { getImplementationSummaryService } from '@/lib/implementation-summary-service';
import {
  CollectSummaryInputSchema,
  RegistryAuthorizationError,
  PrNotFoundError,
} from '@/lib/types/implementation-summary';
import { logger } from '@/lib/logger';
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * POST /api/github/prs/{prNumber}/collect-summary
 * 
 * Request body:
 * {
 *   owner: string,
 *   repo: string,
 *   include?: { description?: boolean, comments?: boolean, checks?: boolean },
 *   requestId?: string,
 *   maxComments?: number
 * }
 * 
 * Response:
 * {
 *   summaryId: string,
 *   contentHash: string,
 *   sources: SourceReference[],
 *   version: number,
 *   content: SummaryContent,
 *   collectedAt: string,
 *   isNewVersion: boolean
 * }
 * 
 * Status codes:
 * - 200: Success (existing version, content unchanged)
 * - 201: Success (new version created)
 * - 400: Invalid input
 * - 401: Authentication required
 * - 403: Registry authorization failed
 * - 404: PR not found
 * - 409: Conflict (e.g., concurrent collection)
 * - 500: Internal error
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || undefined;
  const collectedBy = request.headers.get('x-afu9-sub') || 'system';

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
    const input = CollectSummaryInputSchema.parse({
      ...body,
      prNumber,
      requestId,
    });

    logger.info('Collecting implementation summary', {
      owner: input.owner,
      repo: input.repo,
      prNumber,
      requestId,
    }, 'CollectSummaryAPI');

    // Collect summary
    const service = getImplementationSummaryService();
    const result = await service.collectSummary(input, collectedBy);

    // Return appropriate status code
    const statusCode = result.isNewVersion ? 201 : 200;

    logger.info('Implementation summary collected', {
      summaryId: result.summaryId,
      contentHash: result.contentHash,
      version: result.version,
      isNewVersion: result.isNewVersion,
      requestId,
    }, 'CollectSummaryAPI');

    return NextResponse.json(result, {
      status: statusCode,
      headers: { 'x-request-id': requestId || '' },
    });
  } catch (error) {
    logger.error(
      'Failed to collect implementation summary',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'CollectSummaryAPI'
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
          details: error,
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
