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

/**
 * GET /api/runs/[runId]
 * Get detailed run result
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const pool = getPool();
  const runnerService = getRunnerService(pool);
  const { runId } = await params;

  const result = await runnerService.getRunResult(runId);

  if (!result) {
    return NextResponse.json(
      { error: `Run ${runId} not found` },
      { status: 404 }
    );
  }

  return NextResponse.json(result);
});
