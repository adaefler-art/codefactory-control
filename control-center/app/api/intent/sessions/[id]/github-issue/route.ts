/**
 * API Route: POST /api/intent/sessions/[id]/github-issue
 * 
 * Create or update a GitHub issue from the latest CR in an INTENT session.
 * Issue E75.2: Create/Update Issue via GitHub App
 * Issue E75.4: Audit Trail for CR → GitHub Issue generation
 * 
 * NON-NEGOTIABLES:
 * - Loads latest committed CR version (I744) OR latest valid draft (I743)
 * - Calls createOrUpdateFromCR for idempotent issue creation/update
 * - Stores audit record of operation (I754)
 * - Returns structured result with mode/issueNumber/url
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getLatestCrVersion } from '@/lib/db/intentCrVersions';
import { getLatestCrDraft } from '@/lib/db/intentCrDrafts';
import { createOrUpdateFromCR, IssueCreatorError } from '@/lib/github/issue-creator';
import { insertAuditRecord } from '@/lib/db/crGithubIssueAudit';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import type { ChangeRequest } from '@/lib/schemas/changeRequest';

/**
 * POST /api/intent/sessions/[id]/github-issue
 * 
 * Create or update GitHub issue from latest CR
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const sessionId = params.id;
    
    // Get authenticated user ID from middleware
    // Middleware validates JWT and sets x-afu9-sub header with verified user sub
    // If header is missing, middleware didn't authenticate (fail-closed)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'Authentication required - no verified user context',
      });
    }
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
        details: 'sessionId path parameter is required',
      });
    }
    
    // Parse request body (optional parameters)
    let body: { preferDraft?: boolean } = {};
    try {
      const text = await request.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch (parseError) {
      return errorResponse('Invalid JSON in request body', {
        status: 400,
        requestId,
        details: parseError instanceof Error ? parseError.message : 'JSON parse error',
      });
    }
    
    // Step 1: Load latest CR (prefer committed version, fallback to draft)
    const crResult = await loadLatestCR(pool, sessionId, userId, body.preferDraft);
    
    if (!crResult) {
      return errorResponse('No CR found for session', {
        status: 404,
        requestId,
        details: 'Session has no committed CR version or valid draft',
      });
    }
    
    const { cr, versionId } = crResult;
    
    // Step 2: Create or update issue
    let result;
    try {
      result = await createOrUpdateFromCR(cr);
    } catch (error) {
      if (error instanceof IssueCreatorError) {
        // Map error codes to HTTP status codes
        let status: number;
        switch (error.code) {
          case 'CR_INVALID':
            status = 422; // Unprocessable Entity for validation errors
            break;
          case 'REPO_ACCESS_DENIED':
            status = 403; // Forbidden
            break;
          case 'GITHUB_API_ERROR':
            status = 502; // Bad Gateway - upstream GitHub API error
            break;
          case 'ISSUE_CREATE_FAILED':
          case 'ISSUE_UPDATE_FAILED':
            status = 502; // Bad Gateway - upstream GitHub API error
            break;
          default:
            status = 500; // Internal Server Error
        }
        
        return errorResponse(error.message, {
          status,
          requestId,
          details: {
            code: error.code,
            ...error.details,
          },
        });
      }
      
      // Unknown error
      throw error;
    }
    
    // Step 3: Store audit record (fail-safe: errors are logged but don't block response)
    const warnings: string[] = [];
    const auditResult = await insertAuditRecord(pool, {
      canonical_id: result.canonicalId,
      session_id: sessionId,
      cr_version_id: versionId, // Populated from loadLatestCR
      cr_hash: result.crHash,
      lawbook_version: result.lawbookVersion,
      owner: cr.targets.repo.owner,
      repo: cr.targets.repo.repo,
      issue_number: result.issueNumber,
      action: result.mode,
      rendered_issue_hash: result.renderedHash,
      used_sources_hash: result.usedSourcesHash,
      result_json: {
        url: result.url,
        labelsApplied: result.labelsApplied,
      },
    });
    
    if (!auditResult.success) {
      // Log error but don't fail the request
      console.error('[API] Failed to insert audit record:', auditResult.error);
      warnings.push('Audit record insertion failed - operation succeeded but may not be auditable');
    }
    
    // Step 4: Return result
    return jsonResponse(
      {
        success: true,
        result: {
          mode: result.mode,
          issueNumber: result.issueNumber,
          url: result.url,
          canonicalId: result.canonicalId,
          renderedHash: result.renderedHash,
          labelsApplied: result.labelsApplied,
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      { requestId }
    );
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/github-issue] Error creating/updating issue:', error);
    return errorResponse('Failed to create/update issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Load latest CR from session
 * 
 * Priority:
 * 1. Latest committed version (if exists)
 * 2. Latest valid draft (if preferDraft=true or no committed version)
 * 
 * Returns both the CR and the version ID (if from a committed version)
 */
async function loadLatestCR(
  pool: any,
  sessionId: string,
  userId: string,
  preferDraft?: boolean
): Promise<{ cr: ChangeRequest; versionId: string | null } | null> {
  // Try to get latest committed version first (unless preferDraft=true)
  if (!preferDraft) {
    const versionResult = await getLatestCrVersion(pool, sessionId, userId);
    
    if (versionResult.success && versionResult.data) {
      return {
        cr: versionResult.data.cr_json as ChangeRequest,
        versionId: versionResult.data.id,
      };
    }
  }
  
  // Fallback to latest draft
  const draftResult = await getLatestCrDraft(pool, sessionId, userId);
  
  if (draftResult.success && draftResult.data) {
    // Only use draft if it's valid
    if (draftResult.data.status === 'valid') {
      return {
        cr: draftResult.data.cr_json as ChangeRequest,
        versionId: null, // Drafts don't have version IDs
      };
    }
  }
  
  // Try committed version as final fallback if preferDraft was true
  if (preferDraft) {
    const versionResult = await getLatestCrVersion(pool, sessionId, userId);
    
    if (versionResult.success && versionResult.data) {
      return {
        cr: versionResult.data.cr_json as ChangeRequest,
        versionId: versionResult.data.id,
      };
    }
  }
  
  return null;
}
