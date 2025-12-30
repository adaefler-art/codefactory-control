/**
 * API Route: /api/runs/[runId]/execute
 * 
 * Execute a run.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getRunnerService } from '../../../../../src/lib/runner-service';
import { withApi } from '../../../../../src/lib/http/withApi';

/**
 * POST /api/runs/[runId]/execute
 * Execute a run (dummy implementation for I631/I633)
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const pool = getPool();
  const runnerService = getRunnerService(pool);
  const { runId } = await params;

  // Execute asynchronously
  runnerService.executeRun(runId).catch((err) => {
    console.error(`[API] Failed to execute run ${runId}:`, err);
  });

  return NextResponse.json({
    runId,
    status: 'executing',
  });
});
