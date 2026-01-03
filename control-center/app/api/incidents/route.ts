/**
 * API Route: List Incidents
 * 
 * GET /api/incidents
 * 
 * Lists incidents with optional filters (status, severity) and pagination.
 * Results are deterministically ordered by last_seen_at DESC, id ASC.
 * 
 * Query parameters:
 * - status: Filter by incident status (OPEN, ACKED, MITIGATED, CLOSED)
 * - severity: Filter by severity (YELLOW, RED)
 * - limit: Max results to return (default: 50, max: 200)
 * - offset: Pagination offset (default: 0)
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware (see proxy.ts:397-401).
 * This prevents header spoofing attacks. Routes fail-closed if x-afu9-sub is missing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';
import { getIncidentDAO } from '../../../src/lib/db/incidents';
import { getRequestId, errorResponse, jsonResponse } from '../../../src/lib/api/response-helpers';
import { IncidentFilterSchema } from '../../../src/lib/contracts/incident';

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
    const status = searchParams.get('status') || undefined;
    const severity = searchParams.get('severity') || undefined;
    const limitStr = searchParams.get('limit');
    const offsetStr = searchParams.get('offset');

    // Build filter object
    const filter: any = {
      limit: limitStr ? parseInt(limitStr, 10) : 50,
      offset: offsetStr ? parseInt(offsetStr, 10) : 0,
    };

    if (status) {
      filter.status = status;
    }

    if (severity) {
      filter.severity = severity;
    }

    // Validate filter
    const validationResult = IncidentFilterSchema.safeParse(filter);
    if (!validationResult.success) {
      return errorResponse('Invalid filter parameters', {
        status: 400,
        requestId,
        details: validationResult.error.message,
      });
    }

    console.log('[API] Listing incidents:', validationResult.data, 'userId:', userId);

    const pool = getPool();
    const dao = getIncidentDAO(pool);

    // Fetch incidents
    const incidents = await dao.listIncidents(validationResult.data);

    return jsonResponse({
      success: true,
      incidents,
      count: incidents.length,
      hasMore: incidents.length >= validationResult.data.limit,
      filter: validationResult.data,
    }, { requestId });
  } catch (error) {
    console.error('[API] Error listing incidents:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
