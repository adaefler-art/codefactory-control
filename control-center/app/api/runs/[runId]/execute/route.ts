/**
 * API Route: /api/runs/[runId]/execute
 * 
 * Execute a run.
 * 
 * Idempotency: Returns 409 if run is not in QUEUED status (already executed or executing)
 * 
 * Reference: I633 (Issue UI Runs Tab), Merge-Blocker B
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getRunnerService } from '../../../../../src/lib/runner-service';
import { withApi } from '../../../../../src/lib/http/withApi';
import { handleApiError, runAlreadyExecutedError } from '../../../../../src/lib/api/errors';

/**
 * POST /api/runs/[runId]/execute
 * Execute a run (dummy implementation for I631/I633)
 * 
 * Idempotency Policy (Option A - Strict):
 * - Returns 409 if run is not in QUEUED status
 * - First call executes, subsequent calls return error
 * - Prevents accidental re-execution
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  try {
    const pool = getPool();
    const runnerService = getRunnerService(pool);
    const { runId } = await params;

    // Execute synchronously to catch idempotency errors
    // The actual execution happens asynchronously in the background,
    // but the idempotency check is done synchronously
    await runnerService.executeRun(runId);

    return NextResponse.json({
      runId,
      status: 'executing',
    });
  } catch (error) {
    // Check if it's an idempotency error (run already executed)
    if (error instanceof Error && error.message.includes('already executed or in progress')) {
      const match = error.message.match(/status: (\w+)/);
      const status = match ? match[1] : 'UNKNOWN';
      const { runId } = await params;
      return runAlreadyExecutedError(runId, status);
    }
    
    return handleApiError(error);
  }
});
