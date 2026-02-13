/**
 * API Route: POST /api/afu9/s1s3/issues/[id]/implement
 * 
 * S3 - Implement: Triggers GitHub implementation via label/comment.
 * Updates issue status to IMPLEMENTING.
 * Logs S3 step event for audit trail.
 * 
 * Idempotent behavior:
 * - Repeated calls re-apply label/comment
 * 
 * Request body:
 * {
 *   baseBranch?: string,
 *   prTitle?: string,
 *   prBody?: string
 * }
 * 
 * Response format:
 * {
 *   issue: S1S3IssueRow,
 *   run: S1S3RunRow,
 *   step: S1S3RunStepRow,
 *   githubTrigger: { status, labelApplied, commentPosted }
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getS1S3IssueById,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssueStatus,
} from '@/lib/db/s1s3Flow';
import {
  S1S3IssueStatus,
  S1S3RunType,
  S1S3RunStatus,
  S1S3StepStatus,
} from '@/lib/contracts/s1s3Flow';
import { getRequestId, getRouteHeaderValue } from '@/lib/api/response-helpers';
import {
  COMMON_AFU9_CODES,
  S3_IMPLEMENT_CODES,
  makeAfu9Error,
  type Afu9BlockedBy,
  type Afu9Phase,
} from '@/lib/afu9/workflow-errors';
import { decideS3Preflight, type PreflightDecision } from '@/lib/afu9/preflight-decisions';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../../../issues/_shared';
import { buildAfu9ScopeHeaders } from '../../../../s1s9/_shared';
import { getStageRegistryEntry, getStageRegistryError } from '@/lib/stage-registry';
import { createAuthenticatedClient } from '@/lib/github/auth-wrapper';
import { GitHubAppConfigError, GitHubAppKeyFormatError } from '@/lib/github-app-auth';
import { triggerAfu9Implementation } from '@/lib/github/issue-sync';
import { evaluateGuardrailsPreflight } from '@/lib/guardrails/preflight-evaluator';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HANDLER_MARKER = 's1s3-implement';
const HANDLER_VERSION = 'v1';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

type S3SuccessResponse = {
  ok: true;
  stage: 'S3';
  runId: string;
  mutationId: string;
  issueId: string;
  startedAt: string;
};

type Afu9AuthPath = 'token' | 'app' | 'unknown';
type Afu9Phase = 'preflight' | 'trigger' | 'mapped' | 'success';

function hasValue(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function resolveCommitSha(): string {
  const raw =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA;
  if (!raw) return 'unknown';
  return raw.slice(0, 7);
}

function applyHandlerHeaders(response: Response): Response {
  response.headers.set('x-afu9-handler', HANDLER_MARKER);
  response.headers.set('x-afu9-handler-ver', HANDLER_VERSION);
  response.headers.set('x-afu9-commit', resolveCommitSha());
  response.headers.set('x-cf-handler', HANDLER_MARKER);
  return response;
}

function setAfu9Headers(
  response: Response,
  requestId: string,
  handlerName: string,
  authPath: Afu9AuthPath,
  phase: Afu9Phase,
  missingConfig?: string[]
): Response {
  const buildStamp =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    'unknown';
  response.headers.set('x-afu9-request-id', requestId);
  response.headers.set('x-afu9-handler', handlerName);
  response.headers.set('x-afu9-control-build', buildStamp);
  response.headers.set('x-afu9-auth-path', authPath);
  response.headers.set('x-afu9-phase', phase);
  response.headers.set('x-afu9-missing-config', missingConfig?.length ? missingConfig.join(',') : '');
  return response;
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

function trimDetails(value?: string, maxLength = 200): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function getGithubErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof record.status === 'number') return record.status;
  if (typeof record.response?.status === 'number') return record.response.status;
  return undefined;
}

function getGithubRequestId(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { response?: { headers?: Record<string, string> } };
  const headers = record.response?.headers;
  if (!headers) return undefined;
  return headers['x-github-request-id'] || headers['X-GitHub-Request-Id'] || headers['X-GITHUB-REQUEST-ID'];
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return String(error ?? '');
}

function isProxyTypeError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  return error.message.toLowerCase().includes('proxy');
}

/**
 * POST /api/afu9/s1s3/issues/[id]/implement
 * Create branch and PR for implementation
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);
  const routeHeaderValue = getRouteHeaderValue(request);
  const stageEntry = getStageRegistryEntry('S3');
  const implementRoute = stageEntry?.routes.implement;

  if (!stageEntry || !implementRoute?.handler) {
    const registryError = getStageRegistryError('S3');
    const response = applyHandlerHeaders(
      makeAfu9Error({
        stage: 'S3',
        code: S3_IMPLEMENT_CODES.GUARDRAIL_CONFIG_MISSING,
        phase: 'preflight',
        blockedBy: 'CONFIG',
        nextAction: 'Set required config in runtime',
        requestId,
        handler: HANDLER_MARKER,
        extraBody: {
          stage: 'S3',
          message: registryError.message,
        },
        extraHeaders: {
          ...getControlResponseHeaders(requestId, routeHeaderValue),
          ...buildAfu9ScopeHeaders({
            requestedScope: 's1s3',
            resolvedScope: 's1s3',
          }),
        },
      })
    );
    return setAfu9Headers(response, requestId, HANDLER_MARKER);
  }

  const stageId = stageEntry.stageId;
  const handlerName = HANDLER_MARKER;
  let authPath: Afu9AuthPath = 'unknown';
  let phase: Afu9Phase = 'preflight';
  let missingConfig: string[] = [];
  const responseHeaders = {
    ...getControlResponseHeaders(requestId, routeHeaderValue),
    ...buildAfu9ScopeHeaders({
      requestedScope: 's1s3',
      resolvedScope: 's1s3',
    }),
    'x-afu9-stage': stageId,
    'x-afu9-handler': handlerName,
    'x-afu9-handler-ver': HANDLER_VERSION,
    'x-afu9-commit': resolveCommitSha(),
    'x-cf-handler': HANDLER_MARKER,
  };
  const pool = getPool();

  const respondS3Error = (params: {
    code: string;
    message: string;
    phase: Afu9Phase;
    blockedBy: Afu9BlockedBy;
    nextAction: string;
    requiredConfig?: string[];
    missingConfig?: string[];
    preconditionFailed?: string | null;
    upstreamStatus?: number;
    githubRequestId?: string;
    detailsSafe?: string;
  }) => {
    const response = applyHandlerHeaders(
      makeAfu9Error({
        stage: 'S3',
        code: params.code,
        phase: params.phase,
        blockedBy: params.blockedBy,
        nextAction: params.nextAction,
        requestId,
        handler: HANDLER_MARKER,
        missingConfig: params.missingConfig,
        extraBody: {
          stage: stageId,
          message: params.message,
          requiredConfig: params.requiredConfig,
          missingConfig: params.missingConfig,
          preconditionFailed: params.preconditionFailed ?? null,
          upstreamStatus: params.upstreamStatus,
          githubRequestId: params.githubRequestId,
          detailsSafe: params.detailsSafe,
        },
        extraHeaders: responseHeaders,
      })
    );
    return setAfu9Headers(
      response,
      requestId,
      HANDLER_MARKER,
      authPath,
      params.phase,
      params.missingConfig ?? missingConfig
    );
  };

  const respondS3Success = (body: S3SuccessResponse & Record<string, unknown>) => {
    const response = applyHandlerHeaders(
      NextResponse.json(body, {
        status: 202,
        headers: responseHeaders,
      })
    );
    return setAfu9Headers(response, requestId, HANDLER_MARKER, authPath, phase, missingConfig);
  };

  const respondWithPreflightDecision = (decision: PreflightDecision) => {
    return respondS3Error({
      code: decision.code,
      phase: decision.phase,
      blockedBy: decision.blockedBy,
      nextAction: decision.nextAction,
      message: decision.detailsSafe || 'Preflight blocked',
      requiredConfig: decision.missingConfig,
      missingConfig: decision.missingConfig,
      detailsSafe: decision.detailsSafe,
    });
  };

  try {
    const stageValue =
      process.env.AFU9_STAGE || process.env.DEPLOY_ENV || process.env.ENVIRONMENT;
    const stageMissingConfig = hasValue(stageValue)
      ? []
      : ['AFU9_STAGE', 'DEPLOY_ENV', 'ENVIRONMENT'];

    const { id } = await context.params;
    const resolved = await resolveIssueIdentifierOr404(id, requestId);
    if (!resolved.ok) {
      if (resolved.status === 404) {
        return respondS3Error({
          code: COMMON_AFU9_CODES.ISSUE_NOT_FOUND,
          phase: 'preflight',
          blockedBy: 'STATE',
          nextAction: 'Verify issue id',
          message: 'Issue not found',
          detailsSafe: 'Issue not found',
        });
      }
      return respondS3Error({
        code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
        phase: 'preflight',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry issue lookup',
        message: resolved.body.errorCode || 'Invalid issue identifier',
      });
    }
    const issueId = resolved.uuid;

    // Parse request body
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return respondS3Error({
        code: S3_IMPLEMENT_CODES.SPEC_NOT_READY,
        phase: 'preflight',
        blockedBy: 'STATE',
        nextAction: 'Provide implement payload',
        message: 'Invalid request body',
        preconditionFailed: 'INVALID_PAYLOAD',
        detailsSafe: 'Invalid request body',
      });
    }
    const hasCustomInputs = Boolean(
      (body as Record<string, unknown>).baseBranch ||
      (body as Record<string, unknown>).prTitle ||
      (body as Record<string, unknown>).prBody
    );

    // Get existing issue
    const issueResult = await getS1S3IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return respondS3Error({
        code: COMMON_AFU9_CODES.ISSUE_NOT_FOUND,
        phase: 'preflight',
        blockedBy: 'STATE',
        nextAction: 'Verify issue id',
        message: 'Issue not found',
        detailsSafe: 'Issue not found',
      });
    }

    const issue = issueResult.data;

    const repoFullName = issue.repo_full_name;
    const issueNumber = issue.github_issue_number;
    const issueSpecReady =
      issue.status === S1S3IssueStatus.SPEC_READY ||
      issue.status === S1S3IssueStatus.IMPLEMENTING ||
      issue.status === S1S3IssueStatus.PR_CREATED;

    const triggerLabel = process.env.AFU9_GITHUB_IMPLEMENT_LABEL?.trim();
    const triggerComment = process.env.AFU9_GITHUB_IMPLEMENT_COMMENT?.trim();
    const missingTriggerConfig: string[] = [];

    if (!hasValue(triggerLabel)) {
      missingTriggerConfig.push('AFU9_GITHUB_IMPLEMENT_LABEL');
    }
    if (!hasValue(triggerComment)) {
      missingTriggerConfig.push('AFU9_GITHUB_IMPLEMENT_COMMENT');
    }

    const guardrailDecision = stageMissingConfig.length === 0 && repoFullName
      ? evaluateGuardrailsPreflight({
          requestId,
          operation: 'repo_write',
          repo: repoFullName,
          actor: issue.owner ?? undefined,
          capabilities: ['repo-write'],
          requiresConfig: resolveGitHubAppMissingConfig(),
        })
      : null;
    const guardrailResult = stageMissingConfig.length > 0
      ? {
          allowed: false,
          code: S3_IMPLEMENT_CODES.GUARDRAIL_CONFIG_MISSING,
          missingConfig: stageMissingConfig,
          detailsSafe: 'AFU9 stage/env gate missing',
        }
      : guardrailDecision
        ? {
            allowed: guardrailDecision.outcome !== 'deny',
            code: guardrailDecision.code,
            missingConfig: guardrailDecision.missingConfig,
            detailsSafe: guardrailDecision.detailsSafe,
          }
        : null;
    const authMissingConfig = resolveGitHubAppMissingConfig();
    const preflightContext = {
      repoFullName,
      githubIssueNumber: issueNumber,
      specReady: issueSpecReady,
      triggerConfigMissing: missingTriggerConfig,
      guardrailResult,
      authMissingConfig,
    };
    const preflightDecision = decideS3Preflight(preflightContext);

    if (preflightDecision) {
      return respondWithPreflightDecision(preflightDecision);
    }

    const [repoOwner, repoName] = repoFullName.split('/');

    // Canonical GitHub client for AFU9 write paths: auth-wrapper createAuthenticatedClient (S1/S2).
    let authClient;
    try {
      authClient = await createAuthenticatedClient({ owner: repoOwner, repo: repoName, requestId });
      authPath = 'app';
    } catch (error) {
      if (error instanceof GitHubAppConfigError || error instanceof GitHubAppKeyFormatError) {
        missingConfig = resolveGitHubAppMissingConfig();
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.GITHUB_AUTH_MISSING,
          phase: 'preflight',
          blockedBy: 'CONFIG',
          nextAction: 'Configure GitHub app',
          message: 'GitHub auth not configured',
          requiredConfig: missingConfig.length > 0 ? missingConfig : undefined,
          missingConfig: missingConfig.length > 0 ? missingConfig : undefined,
          preconditionFailed: 'GITHUB_AUTH_MISSING',
          detailsSafe: 'GitHub auth config missing',
        });
      }

      if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
        authPath = 'app';
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.GITHUB_AUTH_INVALID,
          phase: 'preflight',
          blockedBy: 'UPSTREAM',
          nextAction: 'Fix GitHub auth',
          message: 'Repository access denied',
          preconditionFailed: 'GITHUB_AUTH_INVALID',
          detailsSafe: trimDetails(getErrorMessage(error)),
        });
      }

      throw error;
    }

    // Create run record
    const runResult = await createS1S3Run(pool, {
      type: S1S3RunType.S3_IMPLEMENT,
      issue_id: issue.id,
      request_id: requestId,
      actor: issue.owner,
      status: S1S3RunStatus.RUNNING,
    });

    if (!runResult.success || !runResult.data) {
      return respondS3Error({
        code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry run creation',
        message: 'Failed to create run record',
        detailsSafe: 'Failed to create run record',
      });
    }

    const run = runResult.data;
    const startedAt = new Date(run.created_at || Date.now()).toISOString();

    // Create step event - STARTED
    const startStep = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S3',
      step_name: 'Trigger GitHub Implementation',
      status: S1S3StepStatus.STARTED,
      evidence_refs: {
        issue_id: issue.id,
        issue_url: issue.github_issue_url,
        request_id: requestId,
      },
    });

    if (!startStep.success || !startStep.data) {
      return respondS3Error({
        code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry step logging',
        message: 'Failed to create step event',
        detailsSafe: 'Failed to create step event',
      });
    }

    let triggerResult;
    try {
      phase = 'trigger';
      triggerResult = await triggerAfu9Implementation({
        owner: repoOwner,
        repo: repoName,
        issueNumber: issueNumber,
        label: triggerLabel,
        comment: triggerComment,
        requestId,
        octokit: authClient,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error) || 'GitHub trigger failed.';
      const upstreamStatus = getGithubErrorStatus(error);
      const githubRequestId = getGithubRequestId(error);

      await createS1S3RunStep(pool, {
        run_id: run.id,
        step_id: 'S3',
        step_name: 'Trigger GitHub Implementation',
        status: S1S3StepStatus.FAILED,
        error_message: errorMessage,
        evidence_refs: {
          issue_id: issue.id,
          issue_url: issue.github_issue_url,
          request_id: requestId,
          label: triggerLabel,
          comment: Boolean(triggerComment),
        },
      });

      await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.FAILED, errorMessage);

      if (isProxyTypeError(error)) {
        const fallbackDecision = decideS3Preflight(preflightContext);
        if (fallbackDecision) {
          return respondWithPreflightDecision(fallbackDecision);
        }
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.SPEC_NOT_READY,
          phase: 'preflight',
          blockedBy: 'STATE',
          nextAction: 'Complete and save S2 spec',
          message: 'Implement precondition failed',
          preconditionFailed: 'IMPLEMENT_PRECONDITION_FAILED',
          detailsSafe: 'Implement precondition failed',
        });
      }

      if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.GITHUB_AUTH_INVALID,
          phase: 'mapped',
          blockedBy: 'UPSTREAM',
          nextAction: 'Fix GitHub auth',
          message: 'Repository access denied',
          preconditionFailed: 'GITHUB_AUTH_INVALID',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      if (upstreamStatus === 401 || upstreamStatus === 403) {
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.GITHUB_AUTH_INVALID,
          phase: 'mapped',
          blockedBy: 'UPSTREAM',
          nextAction: 'Fix GitHub auth',
          message: 'GitHub auth invalid',
          preconditionFailed: 'GITHUB_AUTH_INVALID',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      if (upstreamStatus === 404) {
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.GITHUB_TARGET_NOT_FOUND,
          phase: 'mapped',
          blockedBy: 'UPSTREAM',
          nextAction: 'Verify GitHub target',
          message: 'GitHub target not found',
          preconditionFailed: 'GITHUB_TARGET_NOT_FOUND',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      if (upstreamStatus === 422) {
        return respondS3Error({
          code: S3_IMPLEMENT_CODES.GITHUB_VALIDATION_FAILED,
          phase: 'mapped',
          blockedBy: 'UPSTREAM',
          nextAction: 'Fix GitHub payload',
          message: 'GitHub validation failed',
          preconditionFailed: 'GITHUB_VALIDATION_FAILED',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      return respondS3Error({
        code: S3_IMPLEMENT_CODES.GITHUB_UPSTREAM_UNREACHABLE,
        phase: 'mapped',
        blockedBy: 'UPSTREAM',
        nextAction: 'Retry GitHub request',
        message: 'GitHub upstream unreachable',
        upstreamStatus,
        githubRequestId,
        detailsSafe: trimDetails(errorMessage),
      });
    }

    const updateResult = await updateS1S3IssueStatus(
      pool,
      issue.id,
      S1S3IssueStatus.IMPLEMENTING
    );

    if (!updateResult.success || !updateResult.data) {
      return respondS3Error({
        code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry status update',
        message: 'Failed to update issue status',
        detailsSafe: 'Failed to update issue status',
      });
    }

    const updatedIssue = updateResult.data;
    const stepResult = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S3',
      step_name: 'Trigger GitHub Implementation',
      status: S1S3StepStatus.SUCCEEDED,
      evidence_refs: {
        issue_id: updatedIssue.id,
        issue_url: updatedIssue.github_issue_url,
        request_id: requestId,
        label_applied: triggerResult.labelApplied,
        comment_posted: triggerResult.commentPosted,
      },
    });

    if (!stepResult.success || !stepResult.data) {
      return respondS3Error({
        code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
        phase: 'mapped',
        blockedBy: 'INTERNAL',
        nextAction: 'Retry step logging',
        message: 'Failed to create step event',
        detailsSafe: 'Failed to create step event',
      });
    }

    await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

    phase = 'success';
    return respondS3Success({
      ok: true,
      stage: stageId,
      runId: run.id,
      mutationId: stepResult.data.id,
      issueId: updatedIssue.id,
      startedAt,
      issue: updatedIssue,
      run: run,
      step: stepResult.data,
      githubTrigger: {
        status: 'TRIGGERED',
        labelApplied: triggerResult.labelApplied,
        commentPosted: triggerResult.commentPosted,
        message: 'GitHub trigger sent',
      },
    });
  } catch (error) {
    return respondS3Error({
      code: S3_IMPLEMENT_CODES.INTERNAL_ERROR,
      phase: 'mapped',
      blockedBy: 'INTERNAL',
      nextAction: 'Retry implement request',
      message: 'Implementation failed',
      detailsSafe: trimDetails(getErrorMessage(error)) || 'Implementation failed',
    });
  }
}
