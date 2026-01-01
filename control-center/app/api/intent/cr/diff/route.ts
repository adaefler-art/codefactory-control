/**
 * API Route: /api/intent/cr/diff
 * 
 * Compute diff between two CR versions
 * Issue E74.4: CR Versioning + Diff
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getCrVersion } from '@/lib/db/intentCrVersions';
import { computeCrDiff } from '@/lib/utils/crDiff';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/intent/cr/diff?from=<versionId>&to=<versionId>
 * Compute deterministic diff between two versions
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const fromId = searchParams.get('from');
    const toId = searchParams.get('to');
    
    if (!fromId || !toId) {
      return errorResponse('Both from and to query parameters are required', {
        status: 400,
        requestId,
      });
    }
    
    // Get both versions
    const fromResult = await getCrVersion(pool, fromId);
    if (!fromResult.success) {
      return errorResponse(`From version not found: ${fromResult.error}`, {
        status: 404,
        requestId,
      });
    }
    
    const toResult = await getCrVersion(pool, toId);
    if (!toResult.success) {
      return errorResponse(`To version not found: ${toResult.error}`, {
        status: 404,
        requestId,
      });
    }
    
    // Compute diff
    const diff = computeCrDiff(fromResult.data, toResult.data);
    
    return jsonResponse({ diff }, { requestId });
  } catch (error) {
    console.error('[API /api/intent/cr/diff] Error computing CR diff:', error);
    return errorResponse('Failed to compute CR diff', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
