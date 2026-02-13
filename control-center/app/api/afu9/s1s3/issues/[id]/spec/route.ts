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
  COMMON_AFU9_CODES,
  S2_SPEC_CODES,
  makeAfu9Error,
  type Afu9BlockedBy,
  type Afu9Phase,
} from '@/lib/afu9/workflow-errors';
import { decideS2Preflight, type PreflightDecision } from '@/lib/afu9/preflight-decisions';
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
  resolveStageMissingConfig,
} from '@/lib/stage-registry';
import { syncAfu9SpecToGitHubIssue } from '@/lib/github/issue-sync';
import { evaluateGuardrailsPreflight } from '@/lib/guardrails/preflight-evaluator';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const AUTH_PATH = 'control';
const CF_HANDLER = 's1s3-spec';

function stamp(
  response: Response,
  meta: {
    requestId: string;
    handler: string;
    phase?: string;
    blockedBy?: string;
    errorCode?: string;
  }
): Response {
  const buildStamp =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    process.env.COMMIT_SHA ??
    'unknown';
  response.headers.set('x-afu9-request-id', meta.requestId);
  response.headers.set('x-afu9-handler', meta.handler);
  if (meta.phase) response.headers.set('x-afu9-phase', meta.phase);
  if (meta.blockedBy) response.headers.set('x-afu9-blocked-by', meta.blockedBy);
  if (meta.errorCode) response.headers.set('x-afu9-error-code', meta.errorCode);
  response.headers.set('x-afu9-control-build', buildStamp);
  response.headers.set('cache-control', 'no-store');
  return response;
}

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

function hasValue(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function resolveGitHubAppMissingConfig(): string[] {
  const appId = process.env.GITHUB_APP_ID || process.env.GH_APP_ID;
  const appKey = process.env.GITHUB_APP_PRIVATE_KEY_PEM || process.env.GH_APP_PRIVATE_KEY_PEM;
  const appSecretId = process.env.GITHUB_APP_SECRET_ID || process.env.GH_APP_SECRET_ID;
  const hasAppId = hasValue(appId);
  const hasAppKey = hasValue(appKey);
  const hasSecretId = hasValue(appSecretId);
  const dispatcherConfigured = (hasAppId && hasAppKey) || hasSecretId;

  if (dispatcherConfigured) {
    return [];
  }

  const missing: string[] = [];
  if (!hasAppId) {
    missing.push('GITHUB_APP_ID');
  }
  if (!hasAppKey) {
    missing.push('GITHUB_APP_PRIVATE_KEY_PEM');
  }
  if (!hasSecretId) {
    missing.push('GITHUB_APP_SECRET_ID');
  }

  return missing;
}

function isGuardrailsEnabled(): boolean {
  const raw = process.env.AFU9_GUARDRAILS_ENABLED;
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
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
    const response = makeAfu9Error({
      stage: 'S2',
      code: S2_SPEC_CODES.GUARDRAIL_CONFIG_MISSING,
      phase: 'preflight',
      blockedBy: 'CONFIG',
      nextAction: 'Set required config in runtime',
      requestId,
      handler: 'control.s1s3.spec',
      extraBody: {
        message: registryError.message,
        handler: 'control',
        route: routeHeaderValue,
        scopeRequested: requestedScope,
        scopeResolved: 's1s3',
      },
      extraHeaders: {
        ...getControlResponseHeaders(requestId, routeHeaderValue),
        ...buildAfu9ScopeHeaders({
          requestedScope,
          resolvedScope: 's1s3',
        }),
        'x-cf-handler': CF_HANDLER,
      },
    });
    return stamp(response, {
      requestId,
      handler: CF_HANDLER,
      phase: 'preflight',
      blockedBy: 'CONFIG',
      errorCode: S2_SPEC_CODES.GUARDRAIL_CONFIG_MISSING,
    });
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
  const handlerName = specRoute.handler;
  const verifiedUserSub = request.headers.get('x-afu9-sub')?.trim();
  const { token: providedServiceToken, reason: tokenReason } = extractServiceTokenFromHeaders(request.headers);
  const expectedServiceToken = normalizeServiceToken(process.env.SERVICE_READ_TOKEN || '');
  const isTestEnv = process.env.NODE_ENV === 'test';
  const shouldEnforceServiceToken = !isTestEnv || Boolean(expectedServiceToken);

  const respondWithSpecError = (params: {
    code: string;
    phase: Afu9Phase;
    blockedBy: Afu9BlockedBy;
    nextAction: string;
    missingConfig?: string[];
    detailsSafe?: string;
    upstreamStatus?: number;
    upstreamErrorCode?: string;
    extraBody?: Record<string, unknown>;
    extraHeaders?: Record<string, string>;
  }) => {
    const message = params.detailsSafe || 'Request failed';
    const response = makeAfu9Error({
      stage: 'S2',
      code: params.code,
      phase: params.phase,
      blockedBy: params.blockedBy,
      nextAction: params.nextAction,
      requestId,
      handler: handlerName,
      missingConfig: params.missingConfig,
      extraBody: {
        message,
        detailsSafe: message,
        handler: handlerName,
        route: routeHeaderValue,
        scopeRequested: requestedScope,
        scopeResolved: 's1s3',
        upstreamStatus: params.upstreamStatus,
        upstreamErrorCode: params.upstreamErrorCode,
        ...params.extraBody,
      },
      extraHeaders: {
        ...responseHeaders,
        ...(params.extraHeaders ?? {}),
      },
    });
    return stamp(response, {
      requestId,
      handler: CF_HANDLER,
      phase: params.phase,
      blockedBy: params.blockedBy,
      errorCode: params.code,
    });
  };

  const buildBlockedMessage = (missingConfig: string[]): string => {
    const primary = missingConfig[0] || 'DISPATCH_DISABLED';
    return `GitHub sync disabled (${primary})`;
  };

  const respondWithPreflightDecision = (decision: PreflightDecision) => {
    const response = makeAfu9Error({
      stage: 'S2',
      code: decision.code,
      phase: decision.phase,
      blockedBy: decision.blockedBy,
      nextAction: decision.nextAction,
      requestId,
      handler: handlerName,
      missingConfig: decision.missingConfig,
      extraBody: {
        message: decision.detailsSafe || 'Preflight blocked',
        detailsSafe: decision.detailsSafe,
        handler: handlerName,
        route: routeHeaderValue,
        scopeRequested: requestedScope,
        scopeResolved: 's1s3',
      },
      extraHeaders: responseHeaders,
    });
    return stamp(response, {
      requestId,
      handler: CF_HANDLER,
      phase: decision.phase,
      blockedBy: decision.blockedBy,
      errorCode: decision.code,
    });
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
          code: S2_SPEC_CODES.GUARDRAIL_CONFIG_MISSING,
          phase: 'preflight',
          blockedBy: 'CONFIG',
          nextAction: 'Set required config in runtime',
          missingConfig: ['SERVICE_READ_TOKEN'],
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
          code: S2_SPEC_CODES.GUARDRAIL_CONFIG_MISSING,
          phase: 'preflight',
          blockedBy: 'CONFIG',
          nextAction: 'Set required config in runtime',
          missingConfig: ['SERVICE_READ_TOKEN'],
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
            code: S2_SPEC_CODES.INTERNAL_ERROR,
            phase: 'preflight',
            blockedBy: 'INTERNAL',
            nextAction: 'Retry issue lookup',
            detailsSafe: 'Issue lookup failed',
            upstreamStatus: resolved.status,
            upstreamErrorCode: resolved.body.errorCode,
          });
        }

        if (resolved.status === 404 && resolved.body.errorCode === 'issue_not_found') {
          return respondWithSpecError({
            code: COMMON_AFU9_CODES.ISSUE_NOT_FOUND,
            phase: 'preflight',
            blockedBy: 'STATE',
            nextAction: 'Verify issue id',
            detailsSafe: 'Issue not found',
            extraBody: {
              issueId,
              lookupStore: resolved.body.lookupStore,
            },
          });
        }

        return respondWithSpecError({
          code: COMMON_AFU9_CODES.ISSUE_NOT_FOUND,
          phase: 'preflight',
          blockedBy: 'STATE',
          nextAction: 'Verify issue id',
          detailsSafe: 'Invalid issue identifier',
        });
      }
      resolvedIssueId = resolved.uuid;
      controlIssue = (resolved.issue as Record<string, unknown>) || null;
    }

    // Parse request body
    let body: Record<string, unknown> = {};
    let bodyParseFailed = false;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      bodyParseFailed = true;
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

    const hasAcceptanceCriteria = Boolean(acceptanceCriteria && acceptanceCriteria.length > 0);
    const specInputsValid = Boolean(!bodyParseFailed && scope && hasAcceptanceCriteria);

    console.log('[S2] Spec ready request:', {
      requestId,
      issue_id: issueId,
      ac_count: acceptanceCriteria?.length ?? 0,
    });

    // Get existing issue
    let foundBy: 'id' | 'canonicalId' | 'seeded' | null = null;
    let issueResult = resolvedIssueId
      ? await getS1S3IssueById(pool, resolvedIssueId)
      : await getS1S3IssueByCanonicalId(pool, issueId);
    let issue = issueResult.success ? issueResult.data : undefined;

    if (issue) {
      foundBy = resolvedIssueId ? 'id' : 'canonicalId';
    } else if (controlIssue) {
      const repoFullName = deriveRepoFullName(controlIssue);
      const issueNumber = getNumberField(controlIssue, 'github_issue_number', 'githubIssueNumber');
      const githubUrl = getStringField(controlIssue, 'github_url', 'githubUrl');
      const mirrorRepo = githubUrl ? repoFullName : null;
      const mirrorIssueNumber = githubUrl ? issueNumber : null;

      const guardrailDecision = isGuardrailsEnabled() && repoFullName
        ? evaluateGuardrailsPreflight({
            requestId,
            operation: 'repo_write',
            repo: repoFullName,
            actor: getStringField(controlIssue, 'assignee') || undefined,
            capabilities: ['repo-write'],
            requiresConfig: resolveGitHubAppMissingConfig(),
          })
        : null;
      const preflightDecision = decideS2Preflight({
        issueExists: Boolean(controlIssue),
        repoFullName: mirrorRepo,
        githubIssueNumber: mirrorIssueNumber,
        specReady: specInputsValid,
        guardrailResult: guardrailDecision
          ? {
              allowed: guardrailDecision.outcome !== 'deny',
              code: guardrailDecision.code,
              missingConfig: guardrailDecision.missingConfig,
              detailsSafe: guardrailDecision.detailsSafe,
            }
          : null,
      });

      if (preflightDecision) {
        return respondWithPreflightDecision(preflightDecision);
      }

      const seedResult = await upsertS1S3Issue(pool, {
        repo_full_name: repoFullName || '',
        github_issue_number: issueNumber || 0,
        github_issue_url: githubUrl || '',
        owner: getStringField(controlIssue, 'assignee') || 'afu9',
        canonical_id: getStringField(controlIssue, 'canonical_id', 'canonicalId') || undefined,
        status: S1S3IssueStatus.CREATED,
      });

      if (!seedResult.success || !seedResult.data) {
        return respondWithSpecError({
          code: S2_SPEC_CODES.INTERNAL_ERROR,
          phase: 'mapped',
          blockedBy: 'INTERNAL',
          nextAction: 'Retry seeding issue',
          detailsSafe: 'Failed to seed S1S3 issue',
        });
      }

      issue = seedResult.data;
      foundBy = 'seeded';
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

      const response = makeAfu9Error({
        stage: 'S2',
        code: COMMON_AFU9_CODES.ISSUE_NOT_FOUND,
        phase: 'preflight',
        blockedBy: 'STATE',
        nextAction: 'Verify issue id',
        requestId,
        handler: handlerName,
        extraBody: {
          message: 'Issue not found',
          issueId,
          lookupStore: 'control',
        },
        extraHeaders: responseHeaders,
      });
      return stamp(response, {
        requestId,
        handler: CF_HANDLER,
        phase: 'preflight',
        blockedBy: 'STATE',
        errorCode: COMMON_AFU9_CODES.ISSUE_NOT_FOUND,
      });
    }

    console.log('[S2] Spec ready issue resolved:', {
      requestId,
      issue_id: issue.id,
      foundBy,
    });

    const repoFullName = issue.repo_full_name;
    const issueNumber = issue.github_issue_number;
    const issueStatusReady =
      issue.status === S1S3IssueStatus.CREATED || issue.status === S1S3IssueStatus.SPEC_READY;
    const guardrailDecision = isGuardrailsEnabled() && repoFullName
      ? evaluateGuardrailsPreflight({
          requestId,
          operation: 'repo_write',
          repo: repoFullName,
          actor: issue.owner ?? undefined,
          capabilities: ['repo-write'],
          requiresConfig: resolveGitHubAppMissingConfig(),
        })
      : null;
    const preflightDecision = decideS2Preflight({
      issueExists: Boolean(issue),
      repoFullName,
      githubIssueNumber: issueNumber,
      specReady: Boolean(specInputsValid && issueStatusReady),
      guardrailResult: guardrailDecision
        ? {
            allowed: guardrailDecision.outcome !== 'deny',
            code: guardrailDecision.code,
            missingConfig: guardrailDecision.missingConfig,
            detailsSafe: guardrailDecision.detailsSafe,
          }
        : null,
    });

    if (preflightDecision) {
      return respondWithPreflightDecision(preflightDecision);
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
        code: S2_SPEC_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry spec update',
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
        code: S2_SPEC_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry run creation',
        detailsSafe: 'Failed to create run record',
        upstreamStatus,
      });
    }

    if (!runResult.success || !runResult.data) {
      return respondWithSpecError({
        code: S2_SPEC_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry run creation',
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
        code: S2_SPEC_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry step logging',
        detailsSafe: 'Failed to create step event',
      });
    }

    const missingConfig = resolveStageMissingConfig(stageEntry);
    if (missingConfig.length > 0) {
      const blockedReason = 'DISPATCH_DISABLED';
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
          code: S2_SPEC_CODES.INTERNAL_ERROR,
          phase: 'mapped',
          blockedBy: 'INTERNAL',
          nextAction: 'Retry step logging',
          detailsSafe: 'Failed to record blocked sync step',
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

      const response = jsonResponse(
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
          githubSync: {
            status: 'BLOCKED',
            blockedReason,
            message: blockedMessage,
            missingConfig,
            errorCode: blockedReason,
          },
        },
        {
          requestId,
          headers: responseHeaders,
        }
      );
      return stamp(response, {
        requestId,
        handler: CF_HANDLER,
        phase: 'success',
      });
    }

    let syncStatus: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' = 'SUCCEEDED';
    let syncMessage: string | undefined;
    let syncErrorCode: string | undefined;

    const syncRepoFullName = updatedIssue.repo_full_name;
    const syncIssueNumber = updatedIssue.github_issue_number;
    if (!syncRepoFullName || !syncIssueNumber || !syncRepoFullName.includes('/')) {
      syncStatus = 'FAILED';
      syncMessage = 'GitHub issue metadata missing for sync.';
      syncErrorCode = 'GITHUB_METADATA_MISSING';
    } else {
      const [owner, repo] = syncRepoFullName.split('/');
      try {
        const syncResult = await syncAfu9SpecToGitHubIssue({
          owner,
          repo,
          issueNumber: syncIssueNumber,
          problem: updatedIssue.problem,
          scope: updatedIssue.scope,
          acceptanceCriteria: acceptanceCriteria,
          notes: updatedIssue.notes,
          requestId,
        });
        syncStatus = syncResult.status;
        if (syncResult.status === 'SKIPPED') {
          syncMessage = 'GitHub issue already up to date.';
        }
      } catch (error) {
        syncStatus = 'FAILED';
        syncMessage = error instanceof Error ? error.message : 'GitHub sync failed.';
        if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
          syncErrorCode = 'GITHUB_WRITE_DENIED';
        } else {
          syncErrorCode = 'GITHUB_SYNC_FAILED';
        }
      }
    }

    const syncStepStatus = syncStatus === 'FAILED' ? S1S3StepStatus.FAILED : S1S3StepStatus.SUCCEEDED;
    const syncStepResult = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S2',
      step_name: 'sync-to-github',
      status: syncStepStatus,
      error_message: syncStatus === 'FAILED' ? syncMessage || 'GitHub sync failed.' : null,
      evidence_refs: {
        issue_id: updatedIssue.id,
        issue_url: updatedIssue.github_issue_url,
        request_id: requestId,
        sync_status: syncStatus,
      },
    });

    if (!syncStepResult.success || !syncStepResult.data) {
      return respondWithSpecError({
        code: S2_SPEC_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry step logging',
        detailsSafe: 'Failed to record sync step',
      });
    }

    const runStatus = syncStatus === 'FAILED' ? S1S3RunStatus.FAILED : S1S3RunStatus.DONE;
    const updatedRunResult = await updateS1S3RunStatus(
      pool,
      run.id,
      runStatus,
      syncStatus === 'FAILED' ? syncMessage : undefined
    );
    const runForResponse = updatedRunResult.success && updatedRunResult.data
      ? updatedRunResult.data
      : run;

    console.log('[S2] Spec ready completed successfully:', {
      requestId,
      issue_id: updatedIssue.id,
      run_id: run.id,
    });

    const response = jsonResponse(
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
        step: syncStepResult.data,
        githubSync: {
          status: syncStatus,
          message: syncMessage,
          errorCode: syncErrorCode,
        },
      },
      {
        requestId,
        headers: responseHeaders,
      }
    );
    return stamp(response, {
      requestId,
      handler: CF_HANDLER,
      phase: 'success',
    });
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]/spec] Error setting spec:', error);
    const upstreamStatus =
      typeof (error as { status?: number })?.status === 'number'
        ? (error as { status?: number }).status
        : undefined;
    return respondWithSpecError({
      code: S2_SPEC_CODES.INTERNAL_ERROR,
      phase: 'mapped',
      blockedBy: 'INTERNAL',
      nextAction: 'Retry spec request',
      detailsSafe: 'Failed to set spec',
      upstreamStatus,
    });
  }
});
