/**
 * API Route: /api/issues/[id]/runs
 * 
 * List and create runs for a specific issue.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getRunsDAO } from '../../../../../src/lib/db/afu9Runs';
import { getRunnerService } from '../../../../../src/lib/runner-service';
import { withApi } from '../../../../../src/lib/http/withApi';
import { RunSpecSchema } from '../../../../../src/lib/contracts/afu9Runner';
import { 
  handleApiError, 
  playbookNotFoundError, 
  jsonError,
  RunsErrorCode,
  handleValidationError 
} from '../../../../../src/lib/api/errors';
import { ZodError } from 'zod';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../_shared';

/**
 * GET /api/issues/[id]/runs
 * List runs for a specific issue
 * 
 * Query params:
 * - limit: number (default 20)
 * - offset: number (default 0)
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const requestId = getRequestId(request);
    const responseHeaders = getControlResponseHeaders(requestId);
    const pool = getPool();
    const dao = getRunsDAO(pool);
    const { id: issueId } = await params;
    const resolved = await resolveIssueIdentifier(issueId, requestId);
    if (!resolved.ok) {
      return jsonResponse(resolved.body, {
        status: resolved.status,
        requestId,
        headers: responseHeaders,
      });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const runs = await dao.listRunsByIssue(resolved.uuid, limit, offset);

    return jsonResponse(
      {
        runs,
        total: runs.length, // Simple approximation; could query total count if needed
      },
      { requestId, headers: responseHeaders }
    );
  } catch (error) {
    const requestId = getRequestId(request);
    const response = handleApiError(error);
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-afu9-request-id', requestId);
    response.headers.set('x-afu9-auth-path', 'control');
    return response;
  }
});

/**
 * POST /api/issues/[id]/runs
 * Create and optionally execute a run for an issue
 * 
 * Body:
 * - playbookId?: string (load spec from playbook)
 * - spec?: RunSpec (provide custom spec)
 * - title?: string (override title)
 * - autoExecute?: boolean (default true - execute immediately)
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const requestId = getRequestId(request);
    const responseHeaders = getControlResponseHeaders(requestId);
    const pool = getPool();
    const runnerService = getRunnerService(pool);
    const { id: issueId } = await params;
    const resolved = await resolveIssueIdentifier(issueId, requestId);
    if (!resolved.ok) {
      return jsonResponse(resolved.body, {
        status: resolved.status,
        requestId,
        headers: responseHeaders,
      });
    }

    const body = await request.json();
    const { playbookId, spec: customSpec, title, autoExecute = true } = body;

    let spec;

    if (playbookId) {
      // Load spec from playbook
      const playbook = await runnerService.getPlaybook(playbookId);
      if (!playbook) {
        const response = playbookNotFoundError(playbookId);
        response.headers.set('x-afu9-request-id', requestId);
        response.headers.set('x-afu9-auth-path', 'control');
        response.headers.set('x-request-id', requestId);
        return response;
      }
      spec = { ...playbook.spec };
      if (title) {
        spec.title = title;
      }
    } else if (customSpec) {
      // Validate custom spec
      try {
        spec = RunSpecSchema.parse(customSpec);
      } catch (error) {
        if (error instanceof ZodError) {
          const response = handleValidationError(error);
          response.headers.set('x-afu9-request-id', requestId);
          response.headers.set('x-afu9-auth-path', 'control');
          response.headers.set('x-request-id', requestId);
          return response;
        }
        throw error;
      }
    } else {
      const response = jsonError(
        400,
        RunsErrorCode.VALIDATION_ERROR,
        'Either playbookId or spec must be provided'
      );
      response.headers.set('x-afu9-request-id', requestId);
      response.headers.set('x-afu9-auth-path', 'control');
      response.headers.set('x-request-id', requestId);
      return response;
    }

    // Create run
    const runId = await runnerService.createRun(spec, resolved.uuid, playbookId, undefined);

    // Execute if requested
    if (autoExecute) {
      // Execute asynchronously (don't await)
      // Note: Errors during async execution are logged but don't fail the API response
      // The run status will be updated in the database and visible via polling
      runnerService.executeRun(runId).catch((err) => {
        console.error(`[API] Failed to execute run ${runId}:`, err);
        // Future: Send to error tracking service, update run status with error
      });
    }

    return jsonResponse(
      {
        runId,
        status: autoExecute ? 'executing' : 'created',
      },
      { requestId, headers: responseHeaders }
    );
  } catch (error) {
    const requestId = getRequestId(request);
    const response = handleApiError(error);
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-afu9-request-id', requestId);
    response.headers.set('x-afu9-auth-path', 'control');
    return response;
  }
});
