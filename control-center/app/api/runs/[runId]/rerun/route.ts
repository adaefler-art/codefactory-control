/**
 * API Route: /api/runs/[runId]/rerun
 * 
 * Create a re-run from an existing run.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getRunnerService } from '../../../../../src/lib/runner-service';
import { withApi } from '../../../../../src/lib/http/withApi';
import { handleApiError, runNotFoundError } from '../../../../../src/lib/api/errors';

/**
 * POST /api/runs/[runId]/rerun
 * Create a new run based on an existing run, with parentRunId set
 * 
 * Body (optional):
 * - autoExecute?: boolean (default true)
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  try {
    const pool = getPool();
    const runnerService = getRunnerService(pool);
    const { runId } = await params;

    const body = await request.json().catch(() => ({}));
    const { autoExecute = true } = body;

    // Create re-run
    const newRunId = await runnerService.rerun(runId);

    // Execute if requested
    if (autoExecute) {
      runnerService.executeRun(newRunId).catch((err) => {
        console.error(`[API] Failed to execute re-run ${newRunId}:`, err);
      });
    }

    return NextResponse.json({
      newRunId,
      parentRunId: runId,
      status: autoExecute ? 'executing' : 'created',
    });
  } catch (error) {
    return handleApiError(error);
  }
});
