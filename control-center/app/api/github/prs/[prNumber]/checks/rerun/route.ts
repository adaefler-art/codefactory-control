/**
 * POST /api/github/prs/{prNumber}/checks/rerun
 * 
 * Reruns failed GitHub workflow jobs with bounded retry policy and audit trail.
 * Implements fail-closed security: validates against repo actions registry.
 * 
 * Epic E84.3: Tool: rerun_failed_jobs (bounded retry + audit)
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { rerunFailedJobs } from '@/lib/github/job-rerun-service';
import { JobRerunInputSchema } from '@/lib/types/job-rerun';
import { RepoActionsRegistryService } from '@/lib/repo-actions-registry-service';
import { logger } from '@/lib/logger';
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * POST /api/github/prs/{prNumber}/checks/rerun
 * 
 * Request body:
 * {
 *   owner: string,
 *   repo: string,
 *   runId?: number,
 *   mode?: "FAILED_ONLY" | "ALL_JOBS",
 *   maxAttempts?: number (default 2, max 5),
 *   requestId?: string
 * }
 * 
 * Response:
 * {
 *   schemaVersion: "1.0",
 *   requestId: string,
 *   lawbookHash: string,
 *   deploymentEnv: "staging" | "prod",
 *   target: { prNumber, runId? },
 *   decision: "RERUN_TRIGGERED" | "NOOP" | "BLOCKED",
 *   reasons: string[],
 *   jobs: JobRerunStatus[],
 *   metadata: { totalJobs, rerunJobs, blockedJobs, skippedJobs }
 * }
 * 
 * Status codes:
 * - 200: Success
 * - 400: Invalid input
 * - 401: Authentication required
 * - 403: Repository access denied
 * - 409: Action not allowed by registry (production default)
 * - 500: Internal error
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || `rerun-${Date.now()}`;

  try {
    // Get PR number from params
    const params = await context.params;
    const prNumber = parseInt(params.prNumber, 10);

    if (isNaN(prNumber) || prNumber <= 0) {
      return NextResponse.json(
        { error: 'Invalid PR number', code: 'INVALID_PR_NUMBER' },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Parse request body
    const body = await request.json();
    
    if (!body.owner || !body.repo) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, repo', code: 'MISSING_PARAMS' },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Validate input
    const input = JobRerunInputSchema.parse({
      owner: body.owner,
      repo: body.repo,
      prNumber,
      runId: body.runId,
      mode: body.mode || 'FAILED_ONLY',
      maxAttempts: body.maxAttempts || 2,
      requestId,
    });

    logger.info('Processing job rerun request', {
      owner: input.owner,
      repo: input.repo,
      prNumber,
      requestId,
    }, 'JobRerunAPI');

    // E83.1 Registry check: Validate action is allowed
    const registryService = new RepoActionsRegistryService();
    const repository = `${input.owner}/${input.repo}`;
    const registry = await registryService.getActiveRegistry(repository);

    // Fail-closed: if no registry exists in production, block by default
    const deployEnv = process.env.DEPLOY_ENV;
    if (!registry && (deployEnv === 'prod' || deployEnv === 'production')) {
      logger.warn('Repository not in registry (production blocked)', {
        repository,
        requestId,
      }, 'JobRerunAPI');
      
      return NextResponse.json(
        {
          error: 'Repository not in actions registry',
          code: 'REGISTRY_NOT_FOUND',
          details: { repository, policy: 'fail-closed' },
        },
        { status: 409, headers: { 'x-request-id': requestId } }
      );
    }

    // If registry exists, validate action is allowed
    if (registry) {
      const actionConfig = registry.content.allowedActions.find(
        (a) => a.actionType === 'rerun_failed_jobs'
      );

      if (!actionConfig || !actionConfig.enabled) {
        logger.warn('Action not allowed by registry', {
          repository,
          action: 'rerun_failed_jobs',
          requestId,
        }, 'JobRerunAPI');

        return NextResponse.json(
          {
            error: 'Action not allowed by repository registry',
            code: 'ACTION_NOT_ALLOWED',
            details: { action: 'rerun_failed_jobs', repository },
          },
          { status: 403, headers: { 'x-request-id': requestId } }
        );
      }

      // Respect registry's maxRetries if specified
      if (actionConfig.maxRetries && actionConfig.maxRetries < input.maxAttempts) {
        logger.info('Adjusting maxAttempts based on registry config', {
          requested: input.maxAttempts,
          registryLimit: actionConfig.maxRetries,
          requestId,
        }, 'JobRerunAPI');
        
        input.maxAttempts = actionConfig.maxRetries;
      }
    }

    // Execute rerun
    const result = await rerunFailedJobs(input);

    logger.info('Job rerun completed', {
      requestId,
      decision: result.decision,
      totalJobs: result.metadata.totalJobs,
      rerunJobs: result.metadata.rerunJobs,
    }, 'JobRerunAPI');

    return NextResponse.json(result, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error) {
    logger.error(
      'Failed to rerun jobs',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'JobRerunAPI'
    );

    // Handle specific errors
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        {
          error: 'Repository access denied',
          code: 'REPO_ACCESS_DENIED',
          details: { repository: error.repository },
        },
        { status: 403, headers: { 'x-request-id': requestId } }
      );
    }

    // Validation errors
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          code: 'INVALID_INPUT',
          details: error,
        },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // GitHub API errors
    if (error instanceof Error) {
      if (error.message.includes('Not Found')) {
        return NextResponse.json(
          {
            error: 'PR or workflow run not found',
            code: 'NOT_FOUND',
          },
          { status: 404, headers: { 'x-request-id': requestId } }
        );
      }

      if (error.message.includes('Unauthorized') || error.message.includes('401')) {
        return NextResponse.json(
          {
            error: 'GitHub authentication required',
            code: 'UNAUTHORIZED',
          },
          { status: 401, headers: { 'x-request-id': requestId } }
        );
      }
    }

    // Generic error
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}
