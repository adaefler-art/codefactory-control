/**
 * API Route: /api/runs/[runId]
 * 
 * Get run details.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getRunnerService } from '../../../../src/lib/runner-service';
import { withApi } from '../../../../src/lib/http/withApi';
import { handleApiError, runNotFoundError } from '../../../../src/lib/api/errors';

/**
 * GET /api/runs/[runId]
 * Get detailed run result
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  try {
    const pool = getPool();
    const runnerService = getRunnerService(pool);
    const { runId } = await params;

    const result = await runnerService.getRunResult(runId);

    if (!result) {
      return runNotFoundError(runId);
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
});
