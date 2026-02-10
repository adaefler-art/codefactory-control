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
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../../../issues/_shared';
import {
  buildStageHeaders,
  stageErrorResponse,
  assertPrecondition,
  getStageRouteHeaderValue,
} from '../../_stageAction';

const HANDLER_MARKER = 's4-verdict';
const HANDLER_VERSION = 'v1';

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
  const routeHeaderValue = getStageRouteHeaderValue(request);
  const responseHeaders = buildStageHeaders({
    requestId,
    routeHeaderValue,
    handler: HANDLER_MARKER,
    version: HANDLER_VERSION,
  });
  
  try {
    const pool = getPool();
    const { id: rawIssueId } = await params;
    const resolved = await resolveIssueIdentifier(rawIssueId, requestId);
    if (!resolved.ok) {
      return stageErrorResponse(
        {
          ok: false,
          errorCode: resolved.body.errorCode || 'ISSUE_NOT_FOUND',
          code: resolved.body.errorCode || 'ISSUE_NOT_FOUND',
          message: 'Issue lookup failed',
          requestId,
          detailsSafe: resolved.body.errorCode || 'Issue lookup failed',
        },
        {
          status: resolved.status,
          requestId,
          headers: responseHeaders,
        }
      );
    }
    const issueId = resolved.uuid;

    // Parse and validate request body
    const body = await request.json().catch(() => null);
    
    if (!body) {
      return stageErrorResponse(
        {
          ok: false,
          errorCode: 'VERDICT_INVALID',
          code: 'VERDICT_INVALID',
          message: 'Invalid request body',
          requestId,
          detailsSafe: 'Request body must be valid JSON',
        },
        {
          status: 422,
          requestId,
          headers: responseHeaders,
        }
      );
    }

    const validation = validateVerdictInput(body);
    if (!validation.valid) {
      return stageErrorResponse(
        {
          ok: false,
          errorCode: 'VERDICT_INVALID',
          code: 'VERDICT_INVALID',
          message: 'Invalid verdict',
          requestId,
          detailsSafe: validation.error,
        },
        {
          status: 422,
          requestId,
          headers: responseHeaders,
        }
      );
    }

    const { verdict } = body;

    // Verify issue exists
    const issueResult = await getAfu9IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return stageErrorResponse(
        {
          ok: false,
          errorCode: 'ISSUE_NOT_FOUND',
          code: 'ISSUE_NOT_FOUND',
          message: 'Issue not found',
          requestId,
          detailsSafe: 'Issue not found',
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
    const allowedStatuses = new Set([
      Afu9IssueStatus.IMPLEMENTING,
      Afu9IssueStatus.VERIFIED,
    ]);
    const preconditionResponse = assertPrecondition(
      allowedStatuses.has(issue.status),
      {
        ok: false,
        errorCode: 'VERDICT_PRECONDITION_FAILED',
        code: 'VERDICT_PRECONDITION_FAILED',
        message: 'Verdict precondition failed',
        requestId,
        preconditionFailed: 'STATUS_INVALID',
        detailsSafe: `Issue status ${issue.status}`,
      },
      {
        status: 409,
        requestId,
        headers: responseHeaders,
      }
    );
    if (preconditionResponse) {
      return preconditionResponse;
    }

    // Apply verdict and update state
    const verdictResult = await applyVerdict(pool, issueId, issue, verdict);

    if (!verdictResult.success) {
      return stageErrorResponse(
        {
          ok: false,
          errorCode: 'VERDICT_FAILED',
          code: 'VERDICT_FAILED',
          message: 'Failed to apply verdict',
          requestId,
          detailsSafe: verdictResult.error || 'Unknown error',
        },
        {
          status: 500,
          requestId,
          headers: responseHeaders,
        }
      );
    }

    return jsonResponse(
      {
        issueId,
        verdict,
        oldStatus,
        newStatus: verdictResult.newStatus,
        stateChanged: verdictResult.stateChanged,
      },
      {
        requestId,
        status: 200,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    return stageErrorResponse(
      {
        ok: false,
        errorCode: 'VERDICT_FAILED',
        code: 'VERDICT_FAILED',
        message: 'Failed to apply verdict',
        requestId,
        detailsSafe: error instanceof Error ? error.message.slice(0, 200) : 'Unknown error',
      },
      {
        status: 500,
        requestId,
        headers: responseHeaders,
      }
    );
  }
}
