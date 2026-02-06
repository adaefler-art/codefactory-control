/**
 * API Route: POST /api/afu9/issues/:issueId/verdict
 * 
 * I201.7: Verdict Endpoint + State Mapping (GREEN/HOLD/RED)
 * 
 * Accepts a verdict (GREEN, RED, HOLD) and applies it to an issue,
 * transitioning the issue state according to the verdict mapping rules.
 * 
 * Request:
 * - POST /api/afu9/issues/:issueId/verdict
 * - Body: { verdict: "GREEN" | "RED" | "HOLD" }
 * 
 * Response:
 * - 200: { issueId, verdict, oldStatus, newStatus, stateChanged }
 * - 400: Invalid verdict
 * - 404: Issue not found
 * - 500: Server error
 * 
 * Side Effects:
 * - Logs VERDICT_SET timeline event (always)
 * - Updates issue status if state changed
 * - Logs STATE_CHANGED timeline event (if state changed)
 * 
 * State Mapping:
 * - GREEN: IMPLEMENTING → VERIFIED, VERIFIED → DONE
 * - RED: * → HOLD
 * - HOLD: * → HOLD
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getAfu9IssueById } from '@/lib/db/afu9Issues';
import { validateVerdictInput } from '@/lib/contracts/verdict';
import { applyVerdict } from '@/lib/services/verdictService';
import { getRequestId, jsonResponse, errorResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../../../issues/_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/afu9/issues/:issueId/verdict
 * Apply a verdict to an issue
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = getControlResponseHeaders(requestId, routeHeaderValue);
  
  try {
    const pool = getPool();
    const { id: rawIssueId } = await params;
    const resolved = await resolveIssueIdentifier(rawIssueId, requestId);
    if (!resolved.ok) {
      return jsonResponse(resolved.body, {
        status: resolved.status,
        requestId,
        headers: responseHeaders,
      });
    }
    const issueId = resolved.uuid;

    // Parse and validate request body
    const body = await request.json().catch(() => null);
    
    if (!body) {
      return errorResponse('Invalid request body', {
        status: 400,
        requestId,
        details: 'Request body must be valid JSON',
        headers: responseHeaders,
      });
    }

    const validation = validateVerdictInput(body);
    if (!validation.valid) {
      return errorResponse('Invalid verdict', {
        status: 400,
        requestId,
        details: validation.error,
        headers: responseHeaders,
      });
    }

    const { verdict } = body;

    // Verify issue exists
    const issueResult = await getAfu9IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return jsonResponse(
        {
          errorCode: 'issue_not_found',
          issueId: rawIssueId,
          requestId,
          lookupStore: 'control',
        },
        {
          status: 404,
          requestId,
          headers: responseHeaders,
        }
      );
    }

    const issue = issueResult.data;
    const oldStatus = issue.status;

    // Apply verdict and update state
    const verdictResult = await applyVerdict(pool, issueId, issue, verdict);

    if (!verdictResult.success) {
      return errorResponse('Failed to apply verdict', {
        status: 500,
        requestId,
        details: verdictResult.error || 'Unknown error',
        headers: responseHeaders,
      });
    }

    return jsonResponse({
      issueId,
      verdict,
      oldStatus,
      newStatus: verdictResult.newStatus,
      stateChanged: verdictResult.stateChanged,
    }, {
      requestId,
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[API /api/afu9/issues/:id/verdict] Error:', error);
    return errorResponse('Failed to apply verdict', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
      headers: responseHeaders,
    });
  }
}
