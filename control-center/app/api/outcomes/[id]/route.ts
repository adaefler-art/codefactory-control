/**
 * API Route: Get Outcome Record by ID
 * 
 * GET /api/outcomes/[id]
 * 
 * Retrieves a specific outcome record by UUID.
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getOutcomeRecordsDAO } from '../../../../src/lib/db/outcomes';
import { getRequestId, errorResponse, jsonResponse } from '../../../../src/lib/api/response-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;

    console.log('[API] Getting outcome record:', id, 'userId:', userId);

    const pool = getPool();
    const dao = getOutcomeRecordsDAO(pool);

    // Fetch outcome record
    const outcome = await dao.getOutcomeRecord(id);

    if (!outcome) {
      return errorResponse('Outcome record not found', {
        status: 404,
        requestId,
        details: `No outcome record found with ID: ${id}`,
      });
    }

    return jsonResponse({
      success: true,
      outcome,
    }, { requestId });
  } catch (error) {
    console.error('[API] Error getting outcome record:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
