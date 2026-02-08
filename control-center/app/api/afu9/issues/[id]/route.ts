/**
 * API Route: /api/afu9/issues/[id]
 * 
 * Epic-1 v0.9: Issue Detail Endpoint
 * 
 * Returns a single AFU-9 issue by:
 * - UUID v4 (canonical identifier)
 * - publicId (8-hex prefix)
 * - canonicalId (e.g., I811, E81.1)
 * 
 * Response codes:
 * - 200: Issue found
 * - 400: Invalid identifier format
 * - 404: Issue not found
 * - 500: Internal server error
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { normalizeIssueForApi } from '../../../issues/_shared';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../issues/_shared';
import { getRequestId, jsonResponse, errorResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { getAfu9IssueByCanonicalId } from '../../../../../src/lib/db/afu9Issues';
import { parseIssueId } from '@/lib/contracts/ids';
import {
  getS1S3IssueById,
  getS1S3IssueByCanonicalId,
  listS1S3RunsByIssue,
} from '@/lib/db/s1s3Flow';
import { normalizeAcceptanceCriteria } from '@/lib/contracts/s1s3Flow';
import { computeStateFlow, getBlockersForDone } from '@/lib/state-flow';
import {
  getStageRegistryEntry,
  resolveStageMissingConfig,
  isStageEnabled,
} from '@/lib/stage-registry';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{ id: string }>;
}

type UnavailablePayload = {
  status: 'UNAVAILABLE';
  code: string;
  message: string;
  requestId?: string;
  upstreamStatus?: number;
};

function buildUnavailable(params: {
  code: string;
  message: string;
  requestId: string;
  upstreamStatus?: number;
}): UnavailablePayload {
  return {
    status: 'UNAVAILABLE',
    code: params.code,
    message: params.message,
    requestId: params.requestId,
    upstreamStatus: params.upstreamStatus,
  };
}

function resolveOptionalCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim();
    }
  }

  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('DISPATCH_DISABLED')) {
    return 'DISPATCH_DISABLED';
  }

  return fallback;
}

/**
 * GET /api/afu9/issues/[id]
 * 
 * Resolve issue by UUID, publicId, or canonicalId
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = getControlResponseHeaders(requestId, routeHeaderValue);
  const { id } = await context.params;
  const cacheHeaders = {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
  };

  if (!id || typeof id !== 'string') {
    return errorResponse('Issue identifier required', {
      status: 400,
      requestId,
      headers: responseHeaders,
    });
  }

  try {
    const pool = getPool();
    const parsedId = parseIssueId(id);

    let issueRow: Record<string, unknown> | null = null;
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

      issueRow = resolved.issue as Record<string, unknown>;
      resolvedIssueId = resolved.uuid;
    } else {
      const canonicalResult = await getAfu9IssueByCanonicalId(pool, id);

      if (!canonicalResult.success || !canonicalResult.data) {
        return errorResponse('Invalid issue identifier format', {
          status: 400,
          requestId,
          details: 'Identifier must be a valid UUID v4, 8-hex publicId, or canonicalId',
          headers: responseHeaders,
        });
      }

      issueRow = canonicalResult.data as Record<string, unknown>;
      const issueIdValue = issueRow.id;
      if (typeof issueIdValue === 'string' && issueIdValue.trim()) {
        resolvedIssueId = issueIdValue;
      }
    }

    if (!issueRow) {
      return errorResponse('Failed to get issue', {
        status: 500,
        requestId,
        details: 'Issue row could not be resolved',
        headers: responseHeaders,
      });
    }

    const normalizedIssue = normalizeIssueForApi(issueRow);

    const s1s3IssueResult = parsedId.isValid
      ? await getS1S3IssueById(pool, resolvedIssueId)
      : await getS1S3IssueByCanonicalId(pool, id);

    if (!s1s3IssueResult.success || !s1s3IssueResult.data) {
      return jsonResponse(
        {
          ok: false,
          code: 'INVALID_STORED_STATE',
          message: 'S2 data is missing for this issue',
          requestId,
        },
        {
          status: 500,
          requestId,
          headers: {
            ...responseHeaders,
            ...cacheHeaders,
            'x-afu9-error-code': 'INVALID_STORED_STATE',
          },
        }
      );
    }

    const s1s3Issue = s1s3IssueResult.data;
    const s2 = {
      status: s1s3Issue.status,
      scope: s1s3Issue.scope ?? null,
      acceptanceCriteria: normalizeAcceptanceCriteria(s1s3Issue.acceptance_criteria),
      specReadyAt: s1s3Issue.spec_ready_at ?? null,
    };

    const workflow = {
      current: s1s3Issue.status === 'SPEC_READY' ? 'S3' : 'S2',
      completed: s1s3Issue.status === 'SPEC_READY' ? ['S1', 'S2'] : ['S1'],
    };

    const issueSnapshot = issueRow as {
      id?: string;
      status?: string;
      execution_state?: string;
      handoff_state?: string;
      github_issue_number?: number;
      github_url?: string;
    };

    let partial = false;
    let runs: unknown = [];
    let stateFlow: unknown = undefined;
    let execution: unknown = undefined;

    try {
      const runsResult = await listS1S3RunsByIssue(pool, s1s3Issue.id);
      if (!runsResult.success) {
        throw new Error(runsResult.error || 'Runs unavailable');
      }
      runs = runsResult.data || [];
    } catch (error) {
      const code = resolveOptionalCode(error, 'RUNS_UNAVAILABLE');
      const message = error instanceof Error ? error.message : 'Runs unavailable';
      partial = true;
      runs = buildUnavailable({
        code,
        message,
        requestId,
      });
      console.warn('[API /api/afu9/issues/[id]] Runs unavailable:', error);
    }

    try {
      const currentStatus = issueSnapshot.status || 'CREATED';
      const prMerged = ['DONE', 'VERIFIED', 'CLOSED'].includes(currentStatus);
      const evidence = {
        hasCode: issueSnapshot.execution_state === 'DONE' || issueSnapshot.execution_state === 'RUNNING',
        testsPass: issueSnapshot.execution_state === 'DONE',
        reviewApproved: false,
        ciChecksPass: false,
        noMergeConflicts: true,
        prMerged,
        specificationComplete: currentStatus !== 'CREATED',
      };

      const computedStateFlow = computeStateFlow(currentStatus, evidence);
      const blockersForDone = getBlockersForDone(currentStatus, evidence);

      stateFlow = {
        issueId: issueSnapshot.id,
        currentStatus,
        stateFlow: computedStateFlow,
        blockersForDone,
      };
    } catch (error) {
      const code = resolveOptionalCode(error, 'STATE_FLOW_UNAVAILABLE');
      const message = error instanceof Error ? error.message : 'State flow unavailable';
      partial = true;
      stateFlow = buildUnavailable({
        code,
        message,
        requestId,
      });
      console.warn('[API /api/afu9/issues/[id]] State flow unavailable:', error);
    }

    try {
      const stageEntry = getStageRegistryEntry('S3');
      if (!stageEntry) {
        throw new Error('Stage registry missing for S3');
      }

      const missingConfig = resolveStageMissingConfig(stageEntry);
      const enabled = isStageEnabled(stageEntry) && missingConfig.length === 0;

      if (!enabled) {
        partial = true;
        execution = {
          status: 'DISABLED',
          code: 'DISPATCH_DISABLED',
          message: 'Execution disabled in this env',
          requiredConfig: missingConfig,
          requestId,
        };
      } else {
        execution = {
          status: 'ENABLED',
          requestId,
        };
      }
    } catch (error) {
      const code = resolveOptionalCode(error, 'EXECUTION_UNAVAILABLE');
      const message = error instanceof Error ? error.message : 'Execution status unavailable';
      partial = true;
      execution = buildUnavailable({
        code,
        message,
        requestId,
      });
      console.warn('[API /api/afu9/issues/[id]] Execution status unavailable:', error);
    }

    const responseBody: Record<string, unknown> = {
      ok: true,
      issue: normalizedIssue,
      s2,
      workflow,
      runs,
      stateFlow,
      execution,
      partial,
      ...normalizedIssue,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    const headers = {
      ...responseHeaders,
      ...cacheHeaders,
    };

    if (partial) {
      headers['x-afu9-partial'] = 'true';
    }

    return jsonResponse(responseBody, {
      requestId,
      headers,
    });
  } catch (error) {
    console.error('[API /api/afu9/issues/[id]] Unexpected error:', error);
    return errorResponse('Failed to get issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
      headers: responseHeaders,
    });
  }
}
