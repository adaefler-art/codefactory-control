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

import { NextRequest } from 'next/server';
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
import { getRequestId, jsonResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../../../issues/_shared';
import { buildAfu9ScopeHeaders } from '../../../../s1s9/_shared';
import { getStageRegistryEntry, getStageRegistryError, resolveStageMissingConfig } from '@/lib/stage-registry';
import { triggerAfu9Implementation } from '@/lib/github/issue-sync';

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

type S3ErrorCode =
  | 'ENGINE_MISCONFIGURED'
  | 'GITHUB_WRITE_DENIED'
  | 'GITHUB_MIRROR_MISSING'
  | 'SPEC_NOT_READY'
  | 'GITHUB_AUTH_MISSING'
  | 'GITHUB_AUTH_INVALID'
  | 'GITHUB_TARGET_NOT_FOUND'
  | 'GITHUB_VALIDATION_FAILED'
  | 'GITHUB_UPSTREAM_UNREACHABLE'
  | 'IMPLEMENT_PRECONDITION_FAILED'
  | 'IMPLEMENT_TRIGGER_CONFIG_MISSING'
  | 'VALIDATION_FAILED'
  | 'NOT_IMPLEMENTED'
  | 'IMPLEMENT_INVALID_PAYLOAD'
  | 'IMPLEMENT_FAILED'
  | 'INTERNAL_ERROR';

type S3ErrorResponse = {
  ok: false;
  stage: 'S3';
  code: S3ErrorCode;
  errorCode?: string;
  message: string;
  requestId: string;
  requiredConfig?: string[];
  missingConfig?: string[];
  preconditionFailed?: string | null;
  upstreamStatus?: number;
  githubRequestId?: string;
  detailsSafe?: string;
};

type S3SuccessResponse = {
  ok: true;
  stage: 'S3';
  runId: string;
  mutationId: string;
  issueId: string;
  startedAt: string;
};

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
    return applyHandlerHeaders(
      jsonResponse(
        {
          ok: false,
          stage: 'S3',
          code: registryError.code,
          message: registryError.message,
          requestId,
          errorCode: registryError.code,
        },
        {
          status: 500,
          requestId,
          headers: {
            ...getControlResponseHeaders(requestId, routeHeaderValue),
            ...buildAfu9ScopeHeaders({
              requestedScope: 's1s3',
              resolvedScope: 's1s3',
            }),
            'x-afu9-error-code': registryError.code,
          },
        }
      )
    );
  }

  const stageId = stageEntry.stageId;
  const handlerName = HANDLER_MARKER;
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
    status: number;
    code: S3ErrorCode;
    message: string;
    requiredConfig?: string[];
    missingConfig?: string[];
    preconditionFailed?: string | null;
    upstreamStatus?: number;
    githubRequestId?: string;
    detailsSafe?: string;
  }) => {
    const body: S3ErrorResponse = {
      ok: false,
      stage: stageId,
      code: params.code,
      errorCode: params.code,
      message: params.message,
      requestId,
      requiredConfig: params.requiredConfig,
      missingConfig: params.missingConfig,
      preconditionFailed: params.preconditionFailed ?? null,
      upstreamStatus: params.upstreamStatus,
      githubRequestId: params.githubRequestId,
      detailsSafe: params.detailsSafe,
    };

    return applyHandlerHeaders(
      jsonResponse(body, {
        status: params.status,
        requestId,
        headers: {
          ...responseHeaders,
          'x-afu9-error-code': params.code,
        },
      })
    );
  };

  const respondS3Success = (body: S3SuccessResponse & Record<string, unknown>) =>
    applyHandlerHeaders(
      jsonResponse(body, {
        status: 202,
        requestId,
        headers: responseHeaders,
      })
    );

  try {
    const stageValue =
      process.env.AFU9_STAGE || process.env.DEPLOY_ENV || process.env.ENVIRONMENT;
    if (!hasValue(stageValue)) {
      return respondS3Error({
        status: 500,
        code: 'ENGINE_MISCONFIGURED',
        message: 'Missing AFU9_STAGE',
        detailsSafe: 'Missing AFU9_STAGE',
      });
    }

    const { id } = await context.params;
    const resolved = await resolveIssueIdentifierOr404(id, requestId);
    if (!resolved.ok) {
      return respondS3Error({
        status: resolved.status,
        code: 'VALIDATION_FAILED',
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
        status: 422,
        code: 'IMPLEMENT_INVALID_PAYLOAD',
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
        status: 404,
        code: 'VALIDATION_FAILED',
        message: 'Issue not found',
        detailsSafe: 'Issue not found',
      });
    }

    const issue = issueResult.data;

    const repoFullName = issue.repo_full_name;
    const issueNumber = issue.github_issue_number;
    if (!repoFullName || !repoFullName.includes('/')) {
      return respondS3Error({
        status: 409,
        code: 'GITHUB_MIRROR_MISSING',
        message: 'GitHub mirror missing',
        preconditionFailed: 'GITHUB_MIRROR_MISSING',
        detailsSafe: 'Missing repository metadata for issue',
      });
    }

    if (!issueNumber) {
      return respondS3Error({
        status: 409,
        code: 'GITHUB_MIRROR_MISSING',
        message: 'GitHub mirror missing',
        preconditionFailed: 'GITHUB_MIRROR_MISSING',
        detailsSafe: 'Missing GitHub issue number',
      });
    }

    // Check if issue has spec ready
    if (
      issue.status !== S1S3IssueStatus.SPEC_READY &&
      issue.status !== S1S3IssueStatus.IMPLEMENTING &&
      issue.status !== S1S3IssueStatus.PR_CREATED
    ) {
      return respondS3Error({
        status: 409,
        code: 'SPEC_NOT_READY',
        message: 'Spec not ready',
        preconditionFailed: 'SPEC_NOT_READY',
        detailsSafe: `Issue status ${issue.status}`,
      });
    }

    const missingDispatchConfig = resolveStageMissingConfig(stageEntry);
    if (missingDispatchConfig.length > 0) {
      return respondS3Error({
        status: 409,
        code: 'GITHUB_AUTH_MISSING',
        message: 'GitHub auth not configured',
        requiredConfig: missingDispatchConfig,
        missingConfig: missingDispatchConfig,
        preconditionFailed: 'GITHUB_AUTH_MISSING',
        detailsSafe: 'Missing GitHub auth configuration',
      });
    }

    const triggerLabel = process.env.AFU9_GITHUB_IMPLEMENT_LABEL?.trim();
    const triggerComment = process.env.AFU9_GITHUB_IMPLEMENT_COMMENT?.trim();
    const missingTriggerConfig: string[] = [];

    if (!hasValue(triggerLabel)) {
      missingTriggerConfig.push('AFU9_GITHUB_IMPLEMENT_LABEL');
    }
    if (!hasValue(triggerComment)) {
      missingTriggerConfig.push('AFU9_GITHUB_IMPLEMENT_COMMENT');
    }

    if (missingTriggerConfig.length === 2) {
      return respondS3Error({
        status: 409,
        code: 'IMPLEMENT_TRIGGER_CONFIG_MISSING',
        message: 'GitHub trigger not configured',
        requiredConfig: missingTriggerConfig,
        missingConfig: missingTriggerConfig,
        preconditionFailed: 'IMPLEMENT_TRIGGER_CONFIG_MISSING',
        detailsSafe: 'Missing GitHub trigger configuration',
      });
    }

    try {
      const proxyTarget = (globalThis as { fetch?: unknown }).fetch as object | undefined;
      const proxyHandler = {};
      new Proxy(proxyTarget as object, proxyHandler);
    } catch (error) {
      if (isProxyTypeError(error)) {
        return respondS3Error({
          status: 409,
          code: 'IMPLEMENT_PRECONDITION_FAILED',
          message: 'Implement not available: missing GitHub client/config',
          preconditionFailed: 'IMPLEMENT_PRECONDITION_FAILED',
          requiredConfig: missingDispatchConfig.length > 0 ? missingDispatchConfig : undefined,
          missingConfig: missingDispatchConfig.length > 0 ? missingDispatchConfig : undefined,
          detailsSafe: 'Implement not available: missing GitHub client/config',
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
        status: 500,
        code: 'INTERNAL_ERROR',
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
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Failed to create step event',
        detailsSafe: 'Failed to create step event',
      });
    }

    const [repoOwner, repoName] = repoFullName.split('/');

    let triggerResult;
    try {
      triggerResult = await triggerAfu9Implementation({
        owner: repoOwner,
        repo: repoName,
        issueNumber: issueNumber,
        label: triggerLabel,
        comment: triggerComment,
        requestId,
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
        return respondS3Error({
          status: 409,
          code: 'IMPLEMENT_PRECONDITION_FAILED',
          message: 'Implement not available: missing GitHub client/config',
          preconditionFailed: 'IMPLEMENT_PRECONDITION_FAILED',
          requiredConfig: missingDispatchConfig.length > 0 ? missingDispatchConfig : undefined,
          missingConfig: missingDispatchConfig.length > 0 ? missingDispatchConfig : undefined,
          detailsSafe: 'Implement not available: missing GitHub client/config',
        });
      }

      if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
        return respondS3Error({
          status: 409,
          code: 'GITHUB_AUTH_INVALID',
          message: 'Repository access denied',
          preconditionFailed: 'GITHUB_AUTH_INVALID',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      if (upstreamStatus === 401 || upstreamStatus === 403) {
        return respondS3Error({
          status: 409,
          code: 'GITHUB_AUTH_INVALID',
          message: 'GitHub auth invalid',
          preconditionFailed: 'GITHUB_AUTH_INVALID',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      if (upstreamStatus === 404) {
        return respondS3Error({
          status: 409,
          code: 'GITHUB_TARGET_NOT_FOUND',
          message: 'GitHub target not found',
          preconditionFailed: 'GITHUB_TARGET_NOT_FOUND',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      if (upstreamStatus === 422) {
        return respondS3Error({
          status: 409,
          code: 'GITHUB_VALIDATION_FAILED',
          message: 'GitHub validation failed',
          preconditionFailed: 'GITHUB_VALIDATION_FAILED',
          upstreamStatus,
          githubRequestId,
          detailsSafe: trimDetails(errorMessage),
        });
      }

      return respondS3Error({
        status: 502,
        code: 'GITHUB_UPSTREAM_UNREACHABLE',
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
        status: 500,
        code: 'INTERNAL_ERROR',
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
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Failed to create step event',
        detailsSafe: 'Failed to create step event',
      });
    }

    await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

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
      status: 500,
      code: 'IMPLEMENT_FAILED',
      message: 'Implementation failed',
      detailsSafe: trimDetails(getErrorMessage(error)) || 'Implementation failed',
    });
  }
}
