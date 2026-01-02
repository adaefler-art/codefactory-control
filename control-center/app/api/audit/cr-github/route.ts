/**
 * API Route: GET /api/audit/cr-github
 * 
 * Query audit trail for CR → GitHub Issue operations.
 * Issue E75.4: Audit Trail (CR↔Issue mapping, hashes, timestamps, lawbookVersion)
 * 
 * Query Parameters:
 * - canonicalId: CR canonical ID (required if owner/repo/issueNumber not provided)
 * - owner: GitHub repo owner (required if canonicalId not provided)
 * - repo: GitHub repo name (required if canonicalId not provided)
 * - issueNumber: GitHub issue number (required if canonicalId not provided)
 * - limit: Max results (default: 50, max: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Returns:
 * - List of audit records matching the query
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { queryCrGithubIssueAudit, queryByIssue } from '@/lib/db/crGithubIssueAudit';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/audit/cr-github
 * 
 * Query audit trail by canonical ID or by owner/repo/issue
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const { searchParams } = new URL(request.url);
    
    const canonicalId = searchParams.get('canonicalId');
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const issueNumber = searchParams.get('issueNumber');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    // Validate query parameters
    if (!canonicalId && (!owner || !repo || !issueNumber)) {
      return errorResponse('Missing required query parameters', {
        status: 400,
        requestId,
        details: 'Provide either canonicalId OR (owner + repo + issueNumber)',
      });
    }
    
    if (limit < 1 || limit > 100) {
      return errorResponse('Invalid limit parameter', {
        status: 400,
        requestId,
        details: 'Limit must be between 1 and 100',
      });
    }
    
    if (offset < 0) {
      return errorResponse('Invalid offset parameter', {
        status: 400,
        requestId,
        details: 'Offset must be >= 0',
      });
    }
    
    const pool = getPool();
    
    // Query by canonical ID or by issue
    let result;
    if (canonicalId) {
      result = await queryCrGithubIssueAudit(pool, canonicalId, { limit, offset });
    } else {
      // These values are guaranteed to be non-null by validation above
      const ownerValue = owner as string;
      const repoValue = repo as string;
      const issueNumberValue = parseInt(issueNumber as string, 10);
      
      result = await queryByIssue(
        pool,
        ownerValue,
        repoValue,
        issueNumberValue,
        { limit, offset }
      );
    }
    
    if (!result.success) {
      return errorResponse('Failed to query audit trail', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(
      {
        success: true,
        data: result.data,
        pagination: {
          limit,
          offset,
          count: result.data.length,
        },
      },
      { requestId }
    );
  } catch (error) {
    console.error('[API /api/audit/cr-github] Error querying audit trail:', error);
    return errorResponse('Failed to query audit trail', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
