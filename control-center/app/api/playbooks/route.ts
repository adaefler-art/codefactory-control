/**
 * API Route: /api/playbooks
 * 
 * List available playbooks for running on issues.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';
import { getRunnerService } from '../../../src/lib/runner-service';
import { withApi } from '../../../src/lib/http/withApi';
import { handleApiError } from '../../../src/lib/api/errors';

/**
 * GET /api/playbooks
 * List all available playbooks
 */
export const GET = withApi(async (request: NextRequest) => {
  try {
    const pool = getPool();
    const runnerService = getRunnerService(pool);

    const playbooks = await runnerService.listPlaybooks();

    return NextResponse.json({
      playbooks: playbooks.map((pb) => ({
        id: pb.id,
        name: pb.name,
        description: pb.description,
        // Don't send full spec in list view
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
});
