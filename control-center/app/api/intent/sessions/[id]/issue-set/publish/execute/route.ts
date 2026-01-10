/**
 * API Route: /api/intent/sessions/[id]/issue-set/publish/execute
 * 
 * Publish issue set to GitHub (idempotent)
 * Issue E82.3: Publish Audit Log + Backlinks (AFU9 Issue ↔ GitHub Issue)
 * 
 * Guard order: 401 → 409 (prod-block) → 403 → GH/DB
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { publishIssueSet } from '@/lib/github-issue-publisher';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Environment-based publishing block
function isProductionBlocked(): boolean {
  const env = process.env.NEXT_PUBLIC_ENV || process.env.NODE_ENV || 'development';
  const publishingEnabled = process.env.ISSUE_SET_PUBLISHING_ENABLED === 'true';
  
  // Block in production unless explicitly enabled
  if (env === 'production' && !publishingEnabled) {
    return true;
  }
  
  return false;
}

/**
 * POST /api/intent/sessions/[id]/issue-set/publish/execute
 * Publish the committed issue set to GitHub
 * 
 * Guard order:
 * 1. 401: Authentication required
 * 2. 409: Production block (if enabled)
 * 3. 403: Session ownership check
 * 4. GH/DB: GitHub and database operations
 * 
 * Returns:
 * - 200: Success with batch summary and links
 * - 400: Invalid request (missing fields, set not committed)
 * - 401: Unauthorized
 * - 403: Forbidden (session not owned by user)
 * - 404: Session or issue set not found
 * - 409: Production blocked (feature not enabled)
 * - 500: Internal error
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    // GUARD 1: Authentication (401-first)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // GUARD 2: Production block check (409)
    if (isProductionBlocked()) {
      return errorResponse('Publishing not enabled', {
        status: 409,
        requestId,
        details: 'Issue set publishing is not enabled in production environment. Set ISSUE_SET_PUBLISHING_ENABLED=true to enable.',
      });
    }
    
    // Await params (Next.js 13.4+)
    const { id: sessionId } = await context.params;
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch (parseError) {
      return errorResponse('Invalid JSON body', {
        status: 400,
        requestId,
        details: parseError instanceof Error ? parseError.message : 'Parse error',
      });
    }
    
    // Validate required fields
    const { owner, repo } = body;
    
    if (!owner || !repo) {
      return errorResponse('Missing required fields', {
        status: 400,
        requestId,
        details: 'Both "owner" and "repo" are required',
      });
    }
    
    // Validate owner/repo format
    if (typeof owner !== 'string' || typeof repo !== 'string') {
      return errorResponse('Invalid field types', {
        status: 400,
        requestId,
        details: 'Both "owner" and "repo" must be strings',
      });
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
      return errorResponse('Invalid owner or repo format', {
        status: 400,
        requestId,
        details: 'Owner and repo must contain only alphanumeric characters, hyphens, underscores, and periods',
      });
    }
    
    const pool = getPool();
    
    // GUARD 3: Ownership check is implicit in publishIssueSet (403)
    // The service will verify session ownership
    
    // GUARD 4: Publish the issue set (GH/DB operations)
    const result = await publishIssueSet(pool, sessionId, {
      owner,
      repo,
      request_id: requestId,
      user_id: userId,
    });
    
    if (!result.success) {
      // Map specific errors to appropriate status codes
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
          details: result.error,
        });
      }
      
      if (result.error === 'No issue set found for this session') {
        return errorResponse('No issue set found', {
          status: 404,
          requestId,
          details: result.error,
        });
      }
      
      if (result.error === 'Issue set must be committed before publishing') {
        return errorResponse('Issue set not committed', {
          status: 400,
          requestId,
          details: result.error,
        });
      }
      
      return errorResponse('Failed to publish issue set', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    const { batch_id, summary, items, links } = result.data;
    
    return jsonResponse({
      success: true,
      batch_id,
      summary,
      items,
      links,
      message: `Published ${summary.total} issue(s): ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed`,
    }, {
      status: 200,
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-set/publish/execute] Error publishing issue set:', error);
    return errorResponse('Failed to publish issue set', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
