/**
 * API Route: POST /api/intent/issues/[id]/publish
 * 
 * Publish AFU-9 Issue to GitHub (orchestrated flow)
 * 
 * Canonical publish orchestrator for AFU-9 Issues.
 * Replaces direct GitHub issue creation with deterministic lifecycle:
 * Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence
 * 
 * Requires:
 * - Issue must have active CR bound
 * - User must be authenticated
 * - Publishing must be enabled (staging only)
 * 
 * Returns:
 * - 200: Success with GitHub issue details and audit trail
 * - 400: Invalid request (no active CR, validation failed)
 * - 401: Unauthorized
 * - 403: Forbidden (not admin user)
 * - 404: Issue not found
 * - 409: Production blocked (feature not enabled) or No active CR
 * - 500: Internal error
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { publishAfu9Issue } from '@/lib/afu9-publish-orchestrator';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';

// Check if publishing is enabled
function isPublishingEnabled(): boolean {
  const publishingEnabled = process.env.ISSUE_SET_PUBLISHING_ENABLED === 'true';
  return publishingEnabled;
}

// Check if user is admin (from AFU9_ADMIN_SUBS)
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    // Fail-closed: no admin allowlist configured → deny all
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

/**
 * POST /api/intent/issues/[id]/publish
 * Publish AFU-9 Issue via canonical orchestrator
 * 
 * Guard order:
 * 1. 401: Authentication required
 * 2. 409: Production block (publishing not enabled)
 * 3. 403: Admin check (AFU9_ADMIN_SUBS)
 * 4. Validation: Issue exists, has active CR
 * 5. Orchestration: GH publish, timeline, evidence, CP assignment
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    // GUARD 1: Authentication (401-first)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
      });
    }
    
    // GUARD 2: Publishing enabled check (409)
    const deploymentEnv = getDeploymentEnv();
    if (deploymentEnv === 'production' && !isPublishingEnabled()) {
      console.log(`[PUBLISH-GUARD] Blocked AFU-9 publish in production: ${request.method} ${request.url}`);
      
      return jsonResponse(
        {
          error: 'Publishing not enabled',
          message: 'AFU-9 Issue publishing is not enabled in production environment',
          code: 'PUBLISHING_DISABLED',
          details: {
            environment: 'production',
            publishingEnabled: false,
            action: 'To enable publishing, set ISSUE_SET_PUBLISHING_ENABLED=true',
          },
        },
        { status: 409, requestId }
      );
    }
    
    // GUARD 3: Admin check (403)
    if (!isAdminUser(userId)) {
      const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
      const reason = !adminSubs.trim()
        ? 'Admin allowlist not configured (AFU9_ADMIN_SUBS missing/empty)'
        : 'User not in admin allowlist';
      
      return errorResponse('Forbidden', {
        status: 403,
        requestId,
        code: 'FORBIDDEN',
        details: reason,
      });
    }
    
    // Await params (Next.js 15+)
    const { id: issueId } = await context.params;
    
    if (!issueId) {
      return errorResponse('Issue ID required', {
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
    const { owner, repo, labels } = body;
    
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
    
    // Validate labels if provided
    if (labels !== undefined && !Array.isArray(labels)) {
      return errorResponse('Invalid labels format', {
        status: 400,
        requestId,
        details: 'labels must be an array of strings if provided',
      });
    }
    
    const pool = getPool();
    
    // ORCHESTRATE: Publish via canonical AFU-9 orchestrator
    const result = await publishAfu9Issue(pool, issueId, {
      owner,
      repo,
      request_id: requestId,
      user_id: userId,
      labels: labels || [],
    });
    
    if (!result.success) {
      // Map specific errors to appropriate status codes
      if (result.error?.includes('not found')) {
        return errorResponse('Issue not found', {
          status: 404,
          requestId,
          details: result.error,
        });
      }
      
      if (result.error?.includes('No active CR bound')) {
        return errorResponse('No active CR bound', {
          status: 409,
          requestId,
          code: 'NO_ACTIVE_CR',
          details: result.error,
        });
      }
      
      return errorResponse('Failed to publish issue', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    // Success!
    return jsonResponse({
      success: true,
      issue_id: result.issue_id,
      public_id: result.public_id,
      github_issue_number: result.github_issue_number,
      github_url: result.github_url,
      action: result.action,
      audit_trail: {
        timeline_events: result.timeline_events,
        evidence_records: result.evidence_records,
        cp_assignments: result.cp_assignments,
      },
      message: `Issue ${result.action} successfully on GitHub`,
    }, {
      status: 200,
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/issues/[id]/publish] Error publishing issue:', error);
    return errorResponse('Failed to publish issue', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
