/**
 * API Route: /api/intent/cr/versions/[versionId]
 * 
 * Get a specific CR version
 * Issue E74.4: CR Versioning + Diff
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCrVersion } from '@/lib/db/intentCrVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/cr/versions/[versionId]
 * Returns full CR JSON
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { versionId: string } }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const versionId = params.versionId;
    
    // Get authenticated user ID from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    if (!versionId) {
      return errorResponse('Version ID required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await getCrVersion(pool, versionId);
    
    if (!result.success) {
      if (result.error === 'Version not found') {
        return errorResponse('Version not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get CR version', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse({ version: result.data }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/cr/versions/[versionId]] Error getting CR version:', error);
    return errorResponse('Failed to get CR version', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
