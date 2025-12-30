/**
 * API Route: Get Playbook Run Details
 * 
 * GET /api/playbooks/runs/:id
 * 
 * Retrieves the details of a specific playbook run, including all step results.
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getPlaybookRunResult } from '../../../../../src/lib/playbook-executor';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../src/lib/api/response-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  const runId = params.id;

  try {
    const pool = getPool();
    const result = await getPlaybookRunResult(pool, runId);

    if (!result) {
      return errorResponse('Playbook run not found', {
        status: 404,
        requestId,
      });
    }

    return jsonResponse(result, {
      status: 200,
      requestId,
    });
  } catch (error: any) {
    console.error('[playbook] Error fetching run:', {
      runId,
      error: error.message,
      requestId,
    });

    return errorResponse('Failed to fetch playbook run', {
      status: 500,
      requestId,
      details: error.message,
    });
  }
}
