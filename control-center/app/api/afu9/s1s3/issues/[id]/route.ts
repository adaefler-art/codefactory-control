/**
 * API Route: GET /api/afu9/s1s3/issues/[id]
 * 
 * Get S1-S3 issue details with runs and timeline.
 * 
 * Response format:
 * {
 *   issue: S1S3IssueRow,
 *   runs: S1S3RunRow[],
 *   steps: S1S3RunStepRow[]
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getS1S3IssueById,
  getS1S3IssueByCanonicalId,
  listS1S3RunsByIssue,
  listS1S3RunSteps,
} from '@/lib/db/s1s3Flow';
import { normalizeAcceptanceCriteria, normalizeEvidenceRefs } from '@/lib/contracts/s1s3Flow';
import { getRequestId, jsonResponse, errorResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { parseIssueId } from '@/lib/contracts/ids';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../../issues/_shared';
import { buildAfu9ScopeHeaders } from '../../../s1s9/_shared';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * GET /api/afu9/s1s3/issues/[id]
 * Get issue details with runs and timeline
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = {
    ...getControlResponseHeaders(requestId, routeHeaderValue),
    ...buildAfu9ScopeHeaders({
      requestedScope: 's1s3',
      resolvedScope: 's1s3',
    }),
  };
  const pool = getPool();

  try {
    const { id } = await context.params;
    const parsedId = parseIssueId(id);
    let resolvedIssueId = id;

    if (parsedId.isValid) {
      const resolved = await resolveIssueIdentifierOr404(id, requestId);
      if (!resolved.ok) {
        return jsonResponse(resolved.body, {
          status: resolved.status,
          requestId,
          headers: responseHeaders,
        });
      }
      resolvedIssueId = resolved.uuid;
    }

    console.log('[S1-S3] Get issue:', {
      requestId,
      issue_id: resolvedIssueId,
    });

    // Get issue
    const issueResult = parsedId.isValid
      ? await getS1S3IssueById(pool, resolvedIssueId)
      : await getS1S3IssueByCanonicalId(pool, id);
    if (!issueResult.success || !issueResult.data) {
      return jsonResponse(
        {
          errorCode: 'issue_not_found',
          issueId: id,
          requestId,
          lookupStore: 'control',
        },
        {
          status: 404,
          requestId,
          headers: {
            ...responseHeaders,
            'x-afu9-error-code': 'issue_not_found',
          },
        }
      );
    }

    const issue = issueResult.data;
    const issueId = issue.id;

    // Get runs for this issue
    const runsResult = await listS1S3RunsByIssue(pool, issueId);
    const runs = runsResult.success ? runsResult.data || [] : [];

    // Get steps for all runs
    const stepsPromises = runs.map((run) => listS1S3RunSteps(pool, run.id));
    const stepsResults = await Promise.all(stepsPromises);

    const allSteps = stepsResults.flatMap((result) => (result.success ? result.data || [] : []));

    // Normalize data
    const normalizedIssue = {
      ...issue,
      acceptance_criteria: normalizeAcceptanceCriteria(issue.acceptance_criteria),
    };

    const normalizedSteps = allSteps.map((step) => ({
      ...step,
      evidence_refs: normalizeEvidenceRefs(step.evidence_refs),
    }));

    console.log('[S1-S3] Issue fetched:', {
      requestId,
      issue_id: issueId,
      runs_count: runs.length,
      steps_count: normalizedSteps.length,
    });

    return jsonResponse(
      {
        issue: normalizedIssue,
        runs,
        steps: normalizedSteps,
      },
      {
        requestId,
        headers: {
          ...responseHeaders,
          'Cache-Control': 'no-store, max-age=0',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]] Error getting issue:', error);
    return errorResponse('Failed to get issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
      headers: responseHeaders,
    });
  }
}
