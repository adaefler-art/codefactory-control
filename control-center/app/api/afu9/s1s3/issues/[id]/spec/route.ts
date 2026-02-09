/**
 * API Route: POST /api/afu9/s1s3/issues/[id]/spec
 * 
 * S2 - Spec Ready: Persists minimal spec with acceptance criteria.
 * Updates issue status to SPEC_READY.
 * Logs S2 step event for audit trail.
 * 
 * Request body:
 * {
 *   problem?: string,
 *   scope?: string,
 *   acceptanceCriteria: string[] (required, min 1),
 *   notes?: string
 * }
 * 
 * Response format:
 * {
 *   issue: S1S3IssueRow,
 *   run: S1S3RunRow,
 *   step: S1S3RunStepRow
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getS1S3IssueById,
  getS1S3IssueByCanonicalId,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssueSpec,
  upsertS1S3Issue,
} from '@/lib/db/s1s3Flow';
import {
  S1S3IssueStatus,
  S1S3RunType,
  S1S3RunStatus,
  S1S3StepStatus,
} from '@/lib/contracts/s1s3Flow';
import { getRequestId, jsonResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import {
  extractServiceTokenFromHeaders,
  getControlResponseHeaders,
  getServiceTokenDebugInfo,
  normalizeServiceToken,
  resolveIssueIdentifierOr404,
  tokensEqual,
} from '../../../../../issues/_shared';
import { parseIssueId } from '@/lib/contracts/ids';
import { buildAfu9ScopeHeaders } from '../../../../s1s9/_shared';
import { withApi } from '@/lib/http/withApi';
import {
  getStageRegistryEntry,
  getStageRegistryError,
  resolveStageExecutionState,
  resolveStageMissingConfig,
} from '@/lib/stage-registry';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const AUTH_PATH = 'control';
const CF_HANDLER = 's1s3-spec';


function getStringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function getNumberField(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function deriveRepoFullName(issue: Record<string, unknown>): string | null {
  const repoField = getStringField(issue, 'github_repo', 'githubRepo');
  if (repoField && repoField.includes('/')) {
    return repoField;
  }

  const url = getStringField(issue, 'github_url', 'githubUrl');
  if (!url) return null;

  const match = url.match(/github\.com\/([^/]+\/[^/]+)(?:\/|$)/i);
  return match?.[1] ?? null;
}

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/afu9/s1s3/issues/[id]/spec
 * Set spec ready with acceptance criteria
 */
export const POST = withApi(async (request: NextRequest, context: RouteContext) => {
  const requestId = getRequestId(request);
  const pool = getPool();
  const routeHeaderValue = getRouteHeaderValue(request);
  const requestedScope = request.nextUrl?.pathname?.includes('/afu9/s1s9/') ? 's1s9' : 's1s3';
  const stageEntry = getStageRegistryEntry('S2');
  const specRoute = stageEntry?.routes.spec;

  if (!stageEntry || !specRoute?.handler) {
    const registryError = getStageRegistryError('S2');
    return jsonResponse(
      {
        ok: false,
        code: registryError.code,
        message: registryError.message,
        errorCode: registryError.code,
        requestId,
        handler: 'control',
        route: routeHeaderValue,
        scopeRequested: requestedScope,
        scopeResolved: 's1s3',
      },
      {
        status: 500,
        requestId,
        headers: {
          ...getControlResponseHeaders(requestId, routeHeaderValue),
          ...buildAfu9ScopeHeaders({
            requestedScope,
            resolvedScope: 's1s3',
          }),
          'x-afu9-error-code': registryError.code,
          'x-cf-handler': CF_HANDLER,
        },
      }
    );
  }

  const responseHeaders = {
    ...getControlResponseHeaders(requestId, routeHeaderValue),
    ...buildAfu9ScopeHeaders({
      requestedScope,
      resolvedScope: 's1s3',
    }),
    'x-afu9-stage': stageEntry.stageId,
    'x-afu9-handler': specRoute.handler,
    'x-cf-handler': CF_HANDLER,
  };
  const handlerName = 'control';
  const verifiedUserSub = request.headers.get('x-afu9-sub')?.trim();
  const { token: providedServiceToken, reason: tokenReason } = extractServiceTokenFromHeaders(request.headers);
  const expectedServiceToken = normalizeServiceToken(process.env.SERVICE_READ_TOKEN || '');
  const isTestEnv = process.env.NODE_ENV === 'test';
  const shouldEnforceServiceToken = !isTestEnv || Boolean(expectedServiceToken);

  const respondWithSpecError = (params: {
    status: number;
    errorCode: string;
    detailsSafe?: string;
    upstreamStatus?: number;
    upstreamErrorCode?: string;
    extraBody?: Record<string, unknown>;
  }) => {
    const message = params.detailsSafe || 'Request failed';
    return jsonResponse(
      {
        ok: false,
        code: params.errorCode,
        message,
        errorCode: params.errorCode,
        requestId,
        detailsSafe: message,
        handler: handlerName,
        route: routeHeaderValue,
        scopeRequested: requestedScope,
        scopeResolved: 's1s3',
        upstreamStatus: params.upstreamStatus,
        upstreamErrorCode: params.upstreamErrorCode,
        ...params.extraBody,
      },
      {
        status: params.status,
        requestId,
        headers: {
          ...responseHeaders,
          'x-afu9-error-code': params.errorCode,
        },
      }
    );
  };

  const buildBlockedMessage = (missingConfig: string[]): string => {
    if (missingConfig.includes('AFU9_GITHUB_EVENTS_QUEUE_URL')) {
      return 'Execution backend not configured (AFU9_GITHUB_EVENTS_QUEUE_URL)';
    }
    const primary = missingConfig[0] || 'DISPATCH_DISABLED';
    return `Execution backend not configured (${primary})`;
  };

  try {
    if (!verifiedUserSub && shouldEnforceServiceToken) {
      if (!providedServiceToken) {
        if (process.env.DEBUG_SERVICE_AUTH === 'true' && expectedServiceToken) {
          console.warn('[S2] service token missing', {
            requestId,
            reason: tokenReason,
          });
        }
        return respondWithSpecError({
          status: 401,
          errorCode: 'spec_unauthorized',
          detailsSafe: tokenReason === 'malformed' ? 'Malformed Authorization header' : 'Missing service token',
        });
      }
      if (!expectedServiceToken || !tokensEqual(providedServiceToken, expectedServiceToken)) {
        if (process.env.DEBUG_SERVICE_AUTH === 'true' && expectedServiceToken) {
          console.warn('[S2] service token rejected', {
            requestId,
            ...getServiceTokenDebugInfo(providedServiceToken, expectedServiceToken),
          });
        }
        return respondWithSpecError({
          status: 401,
          errorCode: 'spec_unauthorized',
          detailsSafe: expectedServiceToken ? 'Service token mismatch' : 'Service token not configured',
        });
      }
    }

    const { id } = await context.params;
    const issueId = id;
    const parsedId = parseIssueId(issueId);
    let resolvedIssueId: string | null = null;
    let controlIssue: Record<string, unknown> | null = null;

    if (parsedId.isValid) {
      const resolved = await resolveIssueIdentifierOr404(issueId, requestId);
      if (!resolved.ok) {
        if (resolved.status >= 500) {
          return respondWithSpecError({
            status: 502,
            errorCode: 'spec_upstream_failed',
            detailsSafe: 'Issue lookup failed',
            upstreamStatus: resolved.status,
            upstreamErrorCode: resolved.body.errorCode,
          });
        }

        if (resolved.status === 404 && resolved.body.errorCode === 'issue_not_found') {
          return respondWithSpecError({
            status: 404,
            errorCode: 'issue_not_found',
            detailsSafe: 'Issue not found',
            extraBody: {
              issueId,
              lookupStore: resolved.body.lookupStore,
            },
          });
        }

        return respondWithSpecError({
          status: resolved.status,
          errorCode: 'spec_invalid_payload',
          detailsSafe: 'Invalid issue identifier',
        });
      }
      resolvedIssueId = resolved.uuid;
      controlIssue = (resolved.issue as Record<string, unknown>) || null;
    }

    // Parse request body
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return respondWithSpecError({
        status: 400,
        errorCode: 'spec_invalid_payload',
        detailsSafe: 'Invalid request body',
      });
    }

    const problem = typeof body.problem === 'string' ? body.problem : undefined;
    const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes : undefined;
    const acceptanceCriteriaRaw = body.acceptanceCriteria;
    let acceptanceCriteria: string[] | null = null;

    if (typeof acceptanceCriteriaRaw === 'string') {
      const trimmed = acceptanceCriteriaRaw.trim();
      acceptanceCriteria = trimmed ? [trimmed] : null;
    } else if (Array.isArray(acceptanceCriteriaRaw)) {
      acceptanceCriteria = acceptanceCriteriaRaw.filter(
        (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
      );
    }

    if (!scope) {
      return respondWithSpecError({
        status: 400,
        errorCode: 'spec_invalid_payload',
        detailsSafe: 'Scope is required',
      });
    }

    // Validate acceptance criteria (required for SPEC_READY)
    if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
      return respondWithSpecError({
        status: 400,
        errorCode: 'spec_invalid_payload',
        detailsSafe: 'Acceptance criteria required',
      });
    }

    console.log('[S2] Spec ready request:', {
      requestId,
      issue_id: issueId,
      ac_count: acceptanceCriteria.length,
    });

    // Get existing issue
    let foundBy: 'id' | 'canonicalId' | 'seeded' | null = null;
    let issueResult = resolvedIssueId
      ? await getS1S3IssueById(pool, resolvedIssueId)
      : await getS1S3IssueByCanonicalId(pool, issueId);
    let issue = issueResult.success ? issueResult.data : undefined;

    if (issue) {
      foundBy = resolvedIssueId ? 'id' : 'canonicalId';
    } else {
      if (controlIssue) {
        const repoFullName = deriveRepoFullName(controlIssue);
        const issueNumber = getNumberField(controlIssue, 'github_issue_number', 'githubIssueNumber');
        const githubUrl = getStringField(controlIssue, 'github_url', 'githubUrl');

        if (!repoFullName || !issueNumber || !githubUrl) {
          return respondWithSpecError({
            status: 409,
            errorCode: 'spec_invalid_payload',
            detailsSafe: 'Issue missing GitHub metadata for spec',
          });
        }

        const seedResult = await upsertS1S3Issue(pool, {
          repo_full_name: repoFullName,
          github_issue_number: issueNumber,
          github_issue_url: githubUrl,
          owner: getStringField(controlIssue, 'assignee') || 'afu9',
          canonical_id: getStringField(controlIssue, 'canonical_id', 'canonicalId') || undefined,
          status: S1S3IssueStatus.CREATED,
        });

        if (!seedResult.success || !seedResult.data) {
          return respondWithSpecError({
            status: 502,
            errorCode: 'spec_upstream_failed',
            detailsSafe: 'Failed to seed S1S3 issue',
          });
        }

        issue = seedResult.data;
        foundBy = 'seeded';
      }
    }

    if (!issue) {
      const pathMatch = request.nextUrl.pathname.match(/\/issues\/([^/]+)\/spec$/);
      const pathIssueId = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
      console.warn('[S2] Spec ready issue lookup failed:', {
        requestId,
        issue_id: issueId,
        path_issue_id: pathIssueId,
        foundBy,
      });

      return jsonResponse(
        {
          ok: false,
          code: 'issue_not_found',
          message: 'Issue not found',
          errorCode: 'issue_not_found',
          issueId,
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

    console.log('[S2] Spec ready issue resolved:', {
      requestId,
      issue_id: issue.id,
      foundBy,
    });

    // Check if issue is in valid state for spec
    if (issue.status !== S1S3IssueStatus.CREATED && issue.status !== S1S3IssueStatus.SPEC_READY) {
      return respondWithSpecError({
        status: 409,
        errorCode: 'spec_invalid_payload',
        detailsSafe: `Issue must be in CREATED or SPEC_READY state. Current: ${issue.status}`,
      });
    }

    // Update issue with spec data
    const updateResult = await updateS1S3IssueSpec(pool, issue.id, {
      problem: problem?.trim() || null,
      scope: scope?.trim() || null,
      acceptance_criteria: acceptanceCriteria,
      notes: notes?.trim() || null,
    });

    if (!updateResult.success || !updateResult.data) {
      return respondWithSpecError({
        status: 502,
        errorCode: 'spec_upstream_failed',
        detailsSafe: 'Failed to update issue',
      });
    }

    const updatedIssue = updateResult.data;

    console.log('[S2] Spec persisted:', {
      requestId,
      issue_id: updatedIssue.id,
      status: updatedIssue.status,
      ac_count: acceptanceCriteria.length,
    });

    // Create run record
    let runResult;
    try {
      runResult = await createS1S3Run(pool, {
        type: S1S3RunType.S2_SPEC_READY,
        issue_id: updatedIssue.id,
        request_id: requestId,
        actor: updatedIssue.owner,
        status: S1S3RunStatus.RUNNING,
      });
    } catch (error) {
      const upstreamStatus =
        typeof (error as { status?: number })?.status === 'number'
          ? (error as { status?: number }).status
          : undefined;
      return respondWithSpecError({
        status: 502,
        errorCode: 'spec_upstream_failed',
        detailsSafe: 'Failed to create run record',
        upstreamStatus,
      });
    }

    if (!runResult.success || !runResult.data) {
      return respondWithSpecError({
        status: 502,
        errorCode: 'spec_upstream_failed',
        detailsSafe: 'Failed to create run record',
      });
    }

    const run = runResult.data;

    // Create step event - STARTED
    await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S2',
      step_name: 'Spec Ready',
      status: S1S3StepStatus.STARTED,
      evidence_refs: {
        issue_id: updatedIssue.id,
        issue_url: updatedIssue.github_issue_url,
        request_id: requestId,
      },
    });

    // Create step event - SUCCEEDED
    const stepResult = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S2',
      step_name: 'Spec Ready',
      status: S1S3StepStatus.SUCCEEDED,
      evidence_refs: {
        issue_id: updatedIssue.id,
        issue_url: updatedIssue.github_issue_url,
        status: updatedIssue.status,
        spec_ready_at: updatedIssue.spec_ready_at,
        acceptance_criteria_count: acceptanceCriteria.length,
        request_id: requestId,
      },
    });

    if (!stepResult.success || !stepResult.data) {
      return respondWithSpecError({
        status: 502,
        errorCode: 'spec_upstream_failed',
        detailsSafe: 'Failed to create step event',
      });
    }

    const executionState = resolveStageExecutionState(stageEntry);
    const missingConfig = executionState.missingConfig;
    const backendBlocked = missingConfig.length > 0;

    if (backendBlocked) {
      const blockedReason = executionState.blockedReason || 'DISPATCH_DISABLED';
      const blockedMessage = buildBlockedMessage(missingConfig);
      const blockedStepResult = await createS1S3RunStep(pool, {
        run_id: run.id,
        step_id: 'S2',
        step_name: 'sync-to-github',
        status: S1S3StepStatus.FAILED,
        error_message: blockedMessage,
        evidence_refs: {
          issue_id: updatedIssue.id,
          issue_url: updatedIssue.github_issue_url,
          request_id: requestId,
          missing_config: missingConfig,
        },
      });

      if (!blockedStepResult.success || !blockedStepResult.data) {
        return respondWithSpecError({
          status: 502,
          errorCode: 'spec_upstream_failed',
          detailsSafe: 'Failed to record blocked dispatch step',
        });
      }

      const blockedRunResult = await updateS1S3RunStatus(
        pool,
        run.id,
        S1S3RunStatus.FAILED,
        blockedMessage
      );

      const runForResponse = blockedRunResult.success && blockedRunResult.data
        ? blockedRunResult.data
        : run;
      const runWithBlock = {
        ...runForResponse,
        status: 'BLOCKED',
        error_message: blockedMessage,
        blockedReason,
      };
      const stepWithBlock = {
        ...blockedStepResult.data,
        status: 'BLOCKED',
        error_message: blockedMessage,
        blockedReason,
      };

      return jsonResponse(
        {
          ok: true,
          issueId: updatedIssue.id,
          updatedAt: updatedIssue.updated_at ?? updatedIssue.updatedAt ?? null,
          s2: {
            status: 'READY',
            scope: updatedIssue.scope ?? null,
            acceptanceCriteria: updatedIssue.acceptance_criteria ?? [],
            specReadyAt: updatedIssue.spec_ready_at ?? null,
          },
          workflow: {
            current: 'S2',
          },
          issue: updatedIssue,
          run: runWithBlock,
          step: stepWithBlock,
        },
        {
          requestId,
          headers: responseHeaders,
        }
      );
    }

    const updatedRunResult = await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);
    const runForResponse = updatedRunResult.success && updatedRunResult.data
      ? updatedRunResult.data
      : run;

    console.log('[S2] Spec ready completed successfully:', {
      requestId,
      issue_id: updatedIssue.id,
      run_id: run.id,
    });

    return jsonResponse(
      {
        ok: true,
        issueId: updatedIssue.id,
        updatedAt: updatedIssue.updated_at ?? updatedIssue.updatedAt ?? null,
        s2: {
          status: 'READY',
          scope: updatedIssue.scope ?? null,
          acceptanceCriteria: updatedIssue.acceptance_criteria ?? [],
          specReadyAt: updatedIssue.spec_ready_at ?? null,
        },
        workflow: {
          current: 'S2',
        },
        issue: updatedIssue,
        run: runForResponse,
        step: stepResult.data,
      },
      {
        requestId,
        headers: responseHeaders,
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]/spec] Error setting spec:', error);
    const upstreamStatus =
      typeof (error as { status?: number })?.status === 'number'
        ? (error as { status?: number }).status
        : undefined;
    const status = upstreamStatus ? 502 : 500;
    return respondWithSpecError({
      status,
      errorCode: 'spec_ready_failed',
      detailsSafe: 'Failed to set spec',
      upstreamStatus,
    });
  }
});
