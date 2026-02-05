/**
 * API Route: /api/issues/[id]/activate
 * 
 * E61.2: Activates an AFU9 issue (sets it to SPEC_READY)
 * Only one issue can be SPEC_READY (active) at a time.
 * Returns 409 CONFLICT if another issue is already active.
 * 
 * **Identifier Handling:**
 * - Accepts both UUID (canonical) and 8-hex publicId (display)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import {
  updateAfu9Issue,
  getActiveIssue,
  transitionIssue,
} from '../../../../../src/lib/db/afu9Issues';
import {
  Afu9IssueStatus,
} from '../../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { getRequestId } from '@/lib/api/response-helpers';
import { ensureIssueInControl, normalizeIssueForApi } from '../../_shared';

const AUTH_PATH = 'control';

function buildResponse(requestId: string, status: number, body: Record<string, unknown>): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-afu9-auth-path', AUTH_PATH);
  return response;
}

/**
 * POST /api/issues/[id]/activate
 * 
 * E61.2: Activate-Semantik (maxActive=1)
 * - Sets status to SPEC_READY (active)
 * - Sets activated_at and activated_by
 * - Returns 409 if another issue is already active
 * - No automatic deactivation of other issues
 * 
 * **Identifier Formats:**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  try {
    const pool = getPool();
    const { id } = await params;

    const ensured = await ensureIssueInControl(id, requestId);
    if (!ensured.ok) {
      const fallbackBody = ensured.body ?? { error: 'Issue lookup failed' };
      return buildResponse(requestId, ensured.status, {
        ...fallbackBody,
        requestId,
      });
    }

    const issue = ensured.issue as any;
    const internalId = String(issue.id);

    // Invariant: Require title for activation
    if (!issue.title || issue.title.trim().length === 0) {
      return buildResponse(
        requestId,
        400,
        { 
          error: 'Cannot activate issue without a title',
          details: 'Activation requires a non-empty title. Please set a title before activating.',
          requestId,
        },
      );
    }

    // E61.2: Check if already SPEC_READY (active)
    if (issue?.status === Afu9IssueStatus.SPEC_READY) {
      const responseBody: any = {
        message: 'Issue is already active (SPEC_READY)',
        issue: normalizeIssueForApi(issue),
      };
      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }
      return buildResponse(requestId, 200, responseBody);
    }

    // E61.2: Check if another issue is already active
    const activeIssueResult = await getActiveIssue(pool);
    if (!activeIssueResult.success) {
      return buildResponse(
        requestId,
        500,
        {
          error: 'Failed to check active issue',
          details: activeIssueResult.error,
          requestId,
        },
      );
    }

    const currentActiveIssue = activeIssueResult.data;

    // E61.2: Return 409 CONFLICT if another issue is already active
    if (currentActiveIssue && currentActiveIssue.id !== internalId) {
      return buildResponse(
        requestId,
        409,
        {
          error: 'Another issue is already active',
          details: `Issue ${currentActiveIssue.id.substring(0, 8)} ("${currentActiveIssue.title}") is already active (SPEC_READY). Only one issue can be active at a time.`,
          activeIssue: {
            id: currentActiveIssue.id,
            publicId: String(currentActiveIssue.id).substring(0, 8),
            title: currentActiveIssue.title,
            status: currentActiveIssue.status,
          },
          requestId,
        },
      );
    }

    // E61.2: Activate the target issue with SPEC_READY status
    // Use transitionIssue for atomic state change with event logging
    const transitionResult = await transitionIssue(
      pool,
      internalId,
      Afu9IssueStatus.SPEC_READY,
      'api-user',
      { via: 'POST /api/issues/[id]/activate' }
    );

    if (!transitionResult.success) {
      // Check for invalid transition
      if (transitionResult.error && transitionResult.error.includes('Invalid transition')) {
        return buildResponse(requestId, 400, { error: transitionResult.error, requestId });
      }
      
      return buildResponse(requestId, 500, {
        error: 'Failed to activate issue',
        details: transitionResult.error,
        requestId,
      });
    }

    // E61.2: Update activated_at and activated_by fields (non-status fields)
    const activateResult = await updateAfu9Issue(pool, internalId, {
      activated_at: new Date().toISOString(),
      activated_by: 'api-user',
    });

    if (!activateResult.success) {
      return buildResponse(requestId, 500, {
        error: 'Failed to set activation metadata',
        details: activateResult.error,
        requestId,
      });
    }

    const responseBody: any = {
      message: 'Issue activated successfully',
      issue: normalizeIssueForApi(activateResult.data),
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return buildResponse(requestId, 200, responseBody);
  } catch (error) {
    console.error('[API /api/issues/[id]/activate] Error activating issue:', error);
    return buildResponse(requestId, 500, {
      error: 'Failed to activate issue',
      details: error instanceof Error ? error.message : 'Unknown error',
      requestId,
    });
  }
}
