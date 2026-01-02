/**
 * API Route: POST /api/intent/sessions/[id]/github-issue
 * 
 * Create or update a GitHub issue from the latest CR in an INTENT session.
 * Issue E75.2: Create/Update Issue via GitHub App
 * 
 * NON-NEGOTIABLES:
 * - Loads latest committed CR version (I744) OR latest valid draft (I743)
 * - Calls createOrUpdateFromCR for idempotent issue creation/update
 * - Stores audit record of operation
 * - Returns structured result with mode/issueNumber/url
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getLatestCrVersion } from '@/lib/db/intentCrVersions';
import { getLatestCrDraft } from '@/lib/db/intentCrDrafts';
import { createOrUpdateFromCR, IssueCreatorError } from '@/lib/github/issue-creator';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import type { ChangeRequest } from '@/lib/schemas/changeRequest';

/**
 * Audit log entry for issue creation/update
 */
interface IssueCreationAudit {
  sessionId: string;
  userId: string;
  mode: 'created' | 'updated';
  issueNumber: number;
  issueUrl: string;
  canonicalId: string;
  renderedHash: string;
  labelsApplied: string[];
  timestamp: string;
}

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
    const cr = await loadLatestCR(pool, sessionId, userId, body.preferDraft);
    
    if (!cr) {
      return errorResponse('No CR found for session', {
        status: 404,
        requestId,
        details: 'Session has no committed CR version or valid draft',
      });
    }
    
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
    
    // Step 3: Store audit record
    await storeAuditRecord(pool, {
      sessionId,
      userId,
      ...result,
      timestamp: new Date().toISOString(),
    });
    
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
 */
async function loadLatestCR(
  pool: any,
  sessionId: string,
  userId: string,
  preferDraft?: boolean
): Promise<ChangeRequest | null> {
  // Try to get latest committed version first (unless preferDraft=true)
  if (!preferDraft) {
    const versionResult = await getLatestCrVersion(pool, sessionId, userId);
    
    if (versionResult.success && versionResult.data) {
      return versionResult.data.cr_json as ChangeRequest;
    }
  }
  
  // Fallback to latest draft
  const draftResult = await getLatestCrDraft(pool, sessionId, userId);
  
  if (draftResult.success && draftResult.data) {
    // Only use draft if it's valid
    if (draftResult.data.status === 'valid') {
      return draftResult.data.cr_json as ChangeRequest;
    }
  }
  
  // Try committed version as final fallback if preferDraft was true
  if (preferDraft) {
    const versionResult = await getLatestCrVersion(pool, sessionId, userId);
    
    if (versionResult.success && versionResult.data) {
      return versionResult.data.cr_json as ChangeRequest;
    }
  }
  
  return null;
}

/**
 * Store audit record of issue creation/update
 * 
 * For now, just log to console. In I754, we'll add proper audit table.
 */
async function storeAuditRecord(pool: any, audit: IssueCreationAudit): Promise<void> {
  console.log('[AUDIT] GitHub Issue Creation/Update:', {
    sessionId: audit.sessionId,
    userId: audit.userId,
    mode: audit.mode,
    issueNumber: audit.issueNumber,
    canonicalId: audit.canonicalId,
    timestamp: audit.timestamp,
  });
  
  // TODO (I754): Store in audit table
  // For now, we just log. Future implementation will insert into:
  // intent_github_issue_audit (session_id, user_id, mode, issue_number, ...)
}
