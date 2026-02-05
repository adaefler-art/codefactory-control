/**
 * POST /api/afu9/issues/{id}/merge
 * 
 * AFU-9 S5 Merge endpoint with gate verdict validation.
 * 
 * Features:
 * - Gate-controlled merge (only when S4 gate verdict is PASS)
 * - Idempotent merge operations
 * - Fail-closed semantics (no bypass)
 * - Audit logging via loop events
 * 
 * E9.3-CTRL-04: Merge Gate & Controlled Merge
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { executeS5 } from '@/lib/loop/stepExecutors/s5-merge';
import { logger } from '@/lib/logger';
import { getLoopRunStore } from '@/lib/loop/runStore';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../../../issues/_shared';

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * POST /api/afu9/issues/{id}/merge
 * 
 * Request body:
 * {
 *   mode?: 'execute' | 'dryRun',  // Default: 'dryRun'
 *   requestId?: string
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   issueId: string,
 *   runId: string,
 *   merged: boolean,
 *   mergeSha?: string,
 *   blocked?: boolean,
 *   blockerCode?: string,
 *   blockerMessage?: string,
 *   stateBefore: string,
 *   stateAfter: string,
 *   message: string,
 *   requestId: string
 * }
 * 
 * Status codes:
 * - 200: Success (merged or dry-run success)
 * - 400: Invalid input or issue not in correct state
 * - 404: Issue not found
 * - 409: Gate verdict FAIL or merge blocked
 * - 500: Internal error
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
)
{
  const requestId = getRequestId(request);
  const responseHeaders = getControlResponseHeaders(requestId);

  try {
    // Get issue ID from params
    const params = await context.params;
    const resolved = await resolveIssueIdentifier(params.id, requestId);

    if (!resolved.ok) {
      return jsonResponse(resolved.body, {
        status: resolved.status,
        requestId,
        headers: responseHeaders,
      });
    }

    const issueId = resolved.uuid;

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'execute' ? 'execute' : 'dryRun';
    const actor = 'api-user'; // TODO: Extract from auth context

    logger.info('AFU-9 Merge request', {
      issueId,
      mode,
      requestId,
    }, 'AFU9MergeAPI');

    // Get pool and stores
    const pool = getPool();
    const runStore = getLoopRunStore(pool);

    // Create run record
    const run = await runStore.createRun({
      issueId,
      actor,
      requestId,
      mode,
      metadata: {
        initialStatus: 'pending',
        source: 'afu9-merge-api',
      },
    });

    logger.info('Created merge run record', {
      runId: run.id,
      issueId,
      mode,
      requestId,
    }, 'AFU9MergeAPI');

    // Update run to running status
    await runStore.updateRunStatus(run.id, {
      status: 'running',
      startedAt: new Date(),
    });

    try {
      // Execute S5 merge step
      const stepResult = await executeS5(pool, {
        issueId,
        runId: run.id,
        requestId,
        actor,
        mode,
      });

      // Update run status based on result
      const completedAt = new Date();
      const durationMs = stepResult.durationMs || 0;

      if (stepResult.blocked) {
        await runStore.updateRunStatus(run.id, {
          status: 'completed',
          completedAt,
          durationMs,
          metadata: {
            blocked: true,
            blockerCode: stepResult.blockerCode,
            blockerMessage: stepResult.blockerMessage,
          },
        });

        logger.warn('AFU-9 Merge blocked', {
          issueId,
          runId: run.id,
          blockerCode: stepResult.blockerCode,
          blockerMessage: stepResult.blockerMessage,
          requestId,
        }, 'AFU9MergeAPI');

        // Return 409 for blocked merge
        return jsonResponse(
          {
            success: false,
            issueId,
            runId: run.id,
            merged: false,
            blocked: true,
            blockerCode: stepResult.blockerCode,
            blockerMessage: stepResult.blockerMessage,
            stateBefore: stepResult.stateBefore,
            stateAfter: stepResult.stateAfter,
            message: stepResult.message,
            requestId,
          },
          {
            status: 409,
            requestId,
            headers: responseHeaders,
          }
        );
      }

      // Success case
      await runStore.updateRunStatus(run.id, {
        status: 'completed',
        completedAt,
        durationMs,
        metadata: {
          success: true,
          stateBefore: stepResult.stateBefore,
          stateAfter: stepResult.stateAfter,
        },
      });

      logger.info('AFU-9 Merge completed successfully', {
        issueId,
        runId: run.id,
        stateBefore: stepResult.stateBefore,
        stateAfter: stepResult.stateAfter,
        mode,
        requestId,
      }, 'AFU9MergeAPI');

      return jsonResponse(
        {
          success: true,
          issueId,
          runId: run.id,
          merged: mode === 'execute',
          stateBefore: stepResult.stateBefore,
          stateAfter: stepResult.stateAfter,
          message: stepResult.message,
          requestId,
        },
        {
          status: 200,
          requestId,
          headers: responseHeaders,
        }
      );
    } catch (error) {
      // Update run status to failed
      await runStore.updateRunStatus(run.id, {
        status: 'failed',
        completedAt: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  } catch (error) {
    logger.error(
      'Failed to execute AFU-9 merge',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'AFU9MergeAPI'
    );

    // Handle specific errors
    if (error instanceof Error && error.message.includes('Issue not found')) {
      return jsonResponse(
        {
          error: 'Issue not found',
          code: 'ISSUE_NOT_FOUND',
          requestId,
        },
        {
          status: 404,
          requestId,
          headers: responseHeaders,
        }
      );
    }

    // Generic error
    return jsonResponse(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
        requestId,
      },
      {
        status: 500,
        requestId,
        headers: responseHeaders,
      }
    );
  }
}
