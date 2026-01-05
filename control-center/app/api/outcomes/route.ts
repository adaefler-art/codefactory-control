/**
 * API Route: List/Get Outcome Records
 * 
 * GET /api/outcomes
 * 
 * Lists outcome records with optional filters.
 * 
 * Query parameters:
 * - incidentId: Filter by incident UUID (optional)
 * - remediationRunId: Filter by remediation run UUID (optional)
 * - limit: Max results to return (default: 50, max: 200)
 * - offset: Pagination offset (default: 0)
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';
import { getOutcomeRecordsDAO } from '../../../src/lib/db/outcomes';
import { getRequestId, errorResponse, jsonResponse } from '../../../src/lib/api/response-helpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    // Authentication: fail-closed, require x-afu9-sub
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const incidentId = searchParams.get('incidentId') || undefined;
    const remediationRunId = searchParams.get('remediationRunId') || undefined;
    const limitStr = searchParams.get('limit');
    const offsetStr = searchParams.get('offset');

    // Validate and parse pagination parameters
    const limitParsed = limitStr ? parseInt(limitStr, 10) : 50;
    const offsetParsed = offsetStr ? parseInt(offsetStr, 10) : 0;

    // Check for invalid numbers
    if (isNaN(limitParsed) || isNaN(offsetParsed)) {
      return errorResponse('Invalid pagination parameters', {
        status: 400,
        requestId,
        details: 'limit and offset must be valid integers',
      });
    }

    const limit = Math.min(Math.max(1, limitParsed), 200); // Clamp between 1 and 200
    const offset = Math.max(0, offsetParsed); // Ensure non-negative

    console.log('[API] Listing outcome records:', {
      incidentId,
      remediationRunId,
      limit,
      offset,
      userId,
    });

    const pool = getPool();
    const dao = getOutcomeRecordsDAO(pool);

    let outcomes;
    if (incidentId) {
      // Filter by incident
      outcomes = await dao.getOutcomeRecordsByIncident(incidentId, limit);
    } else if (remediationRunId) {
      // Filter by remediation run
      outcomes = await dao.getOutcomeRecordsByRemediationRun(remediationRunId, limit);
    } else {
      // List all (paginated)
      outcomes = await dao.listOutcomeRecords(limit, offset);
    }

    return jsonResponse({
      success: true,
      outcomes,
      count: outcomes.length,
      hasMore: outcomes.length >= limit,
      limit,
      offset,
    }, { requestId });
  } catch (error) {
    console.error('[API] Error listing outcome records:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
