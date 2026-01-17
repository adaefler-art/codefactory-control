/**
 * API Route: /api/intent/sessions/[id]/issue-draft/versions/publish
 * 
 * Publish IssueDraft version(s) to GitHub (idempotent batch operation)
 * Issue E89.6: IssueDraft Version → GitHub Issues Batch Publish
 * 
 * Guard order: 401 → 409 (prod-block) → 403 → GH/DB
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { publishIssueDraftVersionBatch } from '@/lib/github/issue-draft-version-publisher';
import { getIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getLatestCommittedVersion } from '@/lib/db/intentIssueDraftVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';

// Check if publishing is enabled
function isPublishingEnabled(): boolean {
  const publishingEnabled = process.env.ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED === 'true';
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
 * POST /api/intent/sessions/[id]/issue-draft/versions/publish
 * Publish IssueDraft version(s) to GitHub
 * 
 * Guard order:
 * 1. 401: Authentication required
 * 2. 409: Production block (publishing not enabled)
 * 3. 403: Admin check (AFU9_ADMIN_SUBS)
 * 4. GH/DB: GitHub and database operations
 * 
 * Request body:
 * - version_id?: string (single version to publish)
 * - issue_set_id?: string (all versions from a set)
 * - owner: string (GitHub repo owner)
 * - repo: string (GitHub repo name)
 * 
 * Returns:
 * - 200: Success with batch summary and links
 * - 400: Invalid request (missing fields)
 * - 401: Unauthorized
 * - 403: Forbidden (not admin)
 * - 404: Session or versions not found
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
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
      });
    }
    
    // GUARD 2: Publishing enabled check (409)
    // Block if ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED is not set to 'true'
    const deploymentEnv = getDeploymentEnv();
    if (deploymentEnv === 'production' && !isPublishingEnabled()) {
      console.log(`[PUBLISH-GUARD] Blocked draft version publish in production: ${request.method} ${request.url}`);
      
      return jsonResponse(
        {
          error: 'Publishing not enabled',
          message: 'IssueDraft version publishing is not enabled in production environment',
          code: 'PUBLISHING_DISABLED',
          details: {
            environment: 'production',
            publishingEnabled: false,
            action: 'To enable publishing, set ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true',
          },
        },
        { status: 409, requestId }
      );
    }
    
    // GUARD 3: Admin check (403)
    // Publishing requires admin privileges
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
    const { owner, repo, version_id, issue_set_id } = body;
    
    if (!owner || !repo) {
      return errorResponse('Missing required fields', {
        status: 400,
        requestId,
        details: 'Both "owner" and "repo" are required',
      });
    }
    
    if (!version_id && !issue_set_id) {
      return errorResponse('Missing required fields', {
        status: 400,
        requestId,
        details: 'Either "version_id" or "issue_set_id" is required',
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
    
    // P1.3: Deterministic resolver - check for draft and committed version
    // If no specific version_id provided, use auto-resolve mode
    const autoResolve = !version_id;
    
    if (autoResolve) {
      // Step 1: Check if draft exists for session
      const draftResult = await getIssueDraft(pool, sessionId, userId);
      
      if (!draftResult.success) {
        return errorResponse('Failed to check draft', {
          status: 500,
          requestId,
          details: draftResult.error,
        });
      }
      
      if (!draftResult.data) {
        // P1.3: NO_DRAFT error
        return jsonResponse({
          error: 'No draft exists',
          message: 'No issue draft exists for this session. Create a draft first.',
          code: 'NO_DRAFT',
        }, { status: 404, requestId });
      }
      
      // Step 2: Check for committed version (P1.2)
      const versionResult = await getLatestCommittedVersion(pool, sessionId, userId);
      
      if (!versionResult.success) {
        return errorResponse('Failed to check committed version', {
          status: 500,
          requestId,
          details: versionResult.error,
        });
      }
      
      if (!versionResult.data) {
        // P1.2: NO_COMMITTED_VERSION error (409)
        return jsonResponse({
          error: 'No committed version',
          message: 'Commit a valid draft version first. Use the commit action or /commit command.',
          code: 'NO_COMMITTED_VERSION',
          suggestion: 'Call commit_issue_draft to create a version before publishing.',
        }, { status: 409, requestId });
      }
      
      // Use the latest committed version
      const latestVersion = versionResult.data;
      console.log(`[PUBLISH] Auto-resolved to version ${latestVersion.id.substring(0, 8)} (v${latestVersion.version_number})`);
      
      // Continue with the resolved version_id
      const result = await publishIssueDraftVersionBatch(pool, {
        session_id: sessionId,
        version_id: latestVersion.id,
        owner,
        repo,
        request_id: requestId,
        user_id: userId,
      });
      
      if (!result.success) {
        // P1.2: Map specific errors to proper codes
        if (result.error.includes('No versions') || result.error.includes('not found')) {
          return jsonResponse({
            error: 'No committed version',
            message: 'Commit a valid draft version first.',
            code: 'NO_COMMITTED_VERSION',
          }, { status: 409, requestId });
        }
        
        return errorResponse('Failed to publish draft version', {
          status: 500,
          requestId,
          details: result.error,
        });
      }
      
      const { batch_id, summary, items, links, warnings } = result.data;
      
      return jsonResponse({
        success: true,
        batch_id,
        summary,
        items,
        links,
        warnings,
        resolved_version_id: latestVersion.id,
        resolved_version_number: latestVersion.version_number,
        message: `Published ${summary.total} issue(s): ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed`,
      }, {
        status: 200,
        requestId,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }
    
    // Explicit version_id provided - use legacy flow
    // GUARD 4: Publish the draft version(s) (GH/DB operations)
    const result = await publishIssueDraftVersionBatch(pool, {
      session_id: sessionId,
      version_id,
      issue_set_id,
      owner,
      repo,
      request_id: requestId,
      user_id: userId,
    });
    
    if (!result.success) {
      // P1.2: Map specific errors to appropriate status codes with proper error codes
      if (result.error.includes('No versions') || result.error.includes('not found')) {
        // This means no committed version exists
        return jsonResponse({
          error: 'No committed version',
          message: 'Commit a valid draft version first. Use the commit action or /commit command.',
          code: 'NO_COMMITTED_VERSION',
        }, { status: 409, requestId });
      }
      
      if (result.error.includes('required')) {
        return errorResponse('Invalid request', {
          status: 400,
          requestId,
          details: result.error,
        });
      }
      
      return errorResponse('Failed to publish draft versions', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    const { batch_id, summary, items, links, warnings } = result.data;
    
    return jsonResponse({
      success: true,
      batch_id,
      summary,
      items,
      links,
      warnings,
      message: `Published ${summary.total} issue(s): ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed`,
    }, {
      status: 200,
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-draft/versions/publish] Error publishing draft versions:', error);
    return errorResponse('Failed to publish draft versions', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
