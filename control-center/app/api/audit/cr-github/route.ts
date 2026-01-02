/**
 * API Route: GET /api/audit/cr-github
 * 
 * Query audit trail for CR → GitHub Issue operations.
 * Issue E75.4: Audit Trail (CR↔Issue mapping, hashes, timestamps, lawbookVersion)
 * 
 * Authentication: Required (x-afu9-sub header set by middleware after JWT verification)
 * Authorization: Repo allowlist enforced (I711)
 * 
 * SECURITY: The x-afu9-sub header is set by middleware.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * Query Parameters:
 * - canonicalId: CR canonical ID (required if owner/repo/issueNumber not provided)
 * - owner: GitHub repo owner (required if canonicalId not provided)
 * - repo: GitHub repo name (required if canonicalId not provided)
 * - issueNumber: GitHub issue number (required if canonicalId not provided)
 * - limit: Max results (default: 50, max: 200)
 * - before: Cursor for pagination (created_at:id format)
 * 
 * Returns:
 * - List of audit records matching the query
 * - Pagination metadata with nextCursor and hasMore
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { queryCrGithubIssueAudit, queryByIssue, queryCrGithubIssueAuditWithCursor, queryByIssueWithCursor } from '@/lib/db/crGithubIssueAudit';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { isRepoAllowed, getAllowedRepos } from '@/lib/github/auth-wrapper';

/**
 * GET /api/audit/cr-github
 * 
 * Query audit trail by canonical ID or by owner/repo/issue
 * 
 * Authentication: Required (x-afu9-sub header verified by middleware)
 * Authorization: Repo allowlist enforced
 * 
 * The x-afu9-sub header can be trusted because:
 * 1. Middleware strips all client-provided x-afu9-* headers
 * 2. Middleware verifies JWT server-side (fail-closed)
 * 3. Middleware sets x-afu9-sub only after successful verification
 * 4. This route is protected by middleware (not public)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    // Authentication check: x-afu9-sub is set by middleware after JWT verification
    // If missing, middleware didn't authenticate the request (fail-closed)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'Authentication required - no verified user context',
      });
    }
    
    const { searchParams } = new URL(request.url);
    
    const canonicalId = searchParams.get('canonicalId');
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const issueNumber = searchParams.get('issueNumber');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const before = searchParams.get('before') || undefined;
    
    // Validate query parameters
    if (!canonicalId && (!owner || !repo || !issueNumber)) {
      return errorResponse('Missing required query parameters', {
        status: 400,
        requestId,
        details: 'Provide either canonicalId OR (owner + repo + issueNumber)',
      });
    }
    
    if (limit < 1 || limit > 200) {
      return errorResponse('Invalid limit parameter', {
        status: 400,
        requestId,
        details: 'Limit must be between 1 and 200',
      });
    }
    
    const pool = getPool();
    
    // Query by canonical ID or by issue
    let result;
    if (canonicalId) {
      // Query all repos for this canonical ID, then filter by allowlist
      result = await queryCrGithubIssueAuditWithCursor(pool, canonicalId, { limit: limit + 1, before });
      
      if (result.success) {
        // B) Enforce repo allowlist - filter out non-allowed repos
        const filteredData = result.data.filter(record => 
          isRepoAllowed(record.owner, record.repo)
        );
        
        // Check if we have more results (for pagination)
        const hasMore = filteredData.length > limit;
        const records = hasMore ? filteredData.slice(0, limit) : filteredData;
        
        // Generate next cursor if there are more results
        const nextCursor = hasMore && records.length > 0
          ? `${records[records.length - 1].created_at}:${records[records.length - 1].id}`
          : undefined;
        
        result = {
          success: true,
          data: records,
          hasMore,
          nextCursor,
        };
      }
    } else {
      // B) Enforce repo allowlist for direct owner/repo queries
      const ownerValue = owner as string;
      const repoValue = repo as string;
      
      if (!isRepoAllowed(ownerValue, repoValue)) {
        return errorResponse('Access denied', {
          status: 403,
          requestId,
          details: `Repository ${ownerValue}/${repoValue} is not in the allowlist`,
        });
      }
      
      const issueNumberValue = parseInt(issueNumber as string, 10);
      
      result = await queryByIssueWithCursor(
        pool,
        ownerValue,
        repoValue,
        issueNumberValue,
        { limit: limit + 1, before }
      );
      
      if (result.success) {
        // Check if we have more results
        const hasMore = result.data.length > limit;
        const records = hasMore ? result.data.slice(0, limit) : result.data;
        
        // Generate next cursor
        const nextCursor = hasMore && records.length > 0
          ? `${records[records.length - 1].created_at}:${records[records.length - 1].id}`
          : undefined;
        
        result = {
          success: true,
          data: records,
          hasMore,
          nextCursor,
        };
      }
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
          count: result.data.length,
          hasMore: result.hasMore || false,
          nextCursor: result.nextCursor,
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
