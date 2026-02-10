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

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

type S3ErrorCode =
  | 'ENGINE_MISCONFIGURED'
  | 'GITHUB_WRITE_DENIED'
  | 'VALIDATION_FAILED'
  | 'DISPATCH_DISABLED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

type S3ErrorResponse = {
  ok: false;
  stage: 'S3';
  code: S3ErrorCode;
  message: string;
  requestId: string;
  errorCode?: string;
  requiredConfig?: string[];
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
    return jsonResponse(
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
    );
  }

  const stageId = stageEntry.stageId;
  const handlerName = implementRoute.handler;
  const responseHeaders = {
    ...getControlResponseHeaders(requestId, routeHeaderValue),
    ...buildAfu9ScopeHeaders({
      requestedScope: 's1s3',
      resolvedScope: 's1s3',
    }),
    'x-afu9-stage': stageId,
    'x-afu9-handler': handlerName,
  };
  const pool = getPool();

  const respondS3Error = (params: {
    status: number;
    code: S3ErrorCode;
    message: string;
    requiredConfig?: string[];
  }) => {
    const body: S3ErrorResponse = {
      ok: false,
      stage: stageId,
      code: params.code,
      message: params.message,
      requestId,
      errorCode: params.code,
      requiredConfig: params.requiredConfig,
    };

    return jsonResponse(body, {
      status: params.status,
      requestId,
      headers: {
        ...responseHeaders,
        'x-afu9-error-code': params.code,
      },
    });
  };

  const respondS3Success = (body: S3SuccessResponse & Record<string, unknown>) =>
    jsonResponse(body, {
      status: 202,
      requestId,
      headers: responseHeaders,
    });

  try {
    const stageValue =
      process.env.AFU9_STAGE || process.env.DEPLOY_ENV || process.env.ENVIRONMENT;
    if (!hasValue(stageValue)) {
      return respondS3Error({
        status: 500,
        code: 'ENGINE_MISCONFIGURED',
        message: 'Missing AFU9_STAGE',
      });
    }

    const missingDispatchConfig = resolveStageMissingConfig(stageEntry);
    if (missingDispatchConfig.length > 0) {
      return respondS3Error({
        status: 503,
        code: 'DISPATCH_DISABLED',
        message: 'Execution disabled in this env',
        requiredConfig: missingDispatchConfig,
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
    const body = await request.json().catch(() => ({}));
    const hasCustomInputs = Boolean(
      (body as Record<string, unknown>).baseBranch ||
      (body as Record<string, unknown>).prTitle ||
      (body as Record<string, unknown>).prBody
    );

    console.log('[S3] Implement request:', {
      requestId,
      issue_id: issueId,
      hasCustomInputs,
    });

    // Get existing issue
    const issueResult = await getS1S3IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return respondS3Error({
        status: 404,
        code: 'VALIDATION_FAILED',
        message: 'Issue not found',
      });
    }

    const issue = issueResult.data;

    // Check if issue has spec ready
    if (
      issue.status !== S1S3IssueStatus.SPEC_READY &&
      issue.status !== S1S3IssueStatus.IMPLEMENTING &&
      issue.status !== S1S3IssueStatus.PR_CREATED
    ) {
      return respondS3Error({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: `Issue must be in SPEC_READY, IMPLEMENTING, or PR_CREATED state. Current: ${issue.status}`,
      });
    }

    const repoFullName = issue.repo_full_name;
    const issueNumber = issue.github_issue_number;
    if (!repoFullName || !repoFullName.includes('/')) {
      return respondS3Error({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Missing repository metadata for issue',
      });
    }

    if (!issueNumber) {
      return respondS3Error({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Missing GitHub issue number',
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
        status: 503,
        code: 'DISPATCH_DISABLED',
        message: 'GitHub trigger not configured',
        requiredConfig: missingTriggerConfig,
      });
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

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

      if (error instanceof Error && error.name === 'RepoAccessDeniedError') {
        return respondS3Error({
          status: 403,
          code: 'GITHUB_WRITE_DENIED',
          message: 'Repository is not in the allowlist',
        });
      }

      return respondS3Error({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: errorMessage,
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
      });
    }

    await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

    console.log('[S3] GitHub trigger sent:', {
      requestId,
      issue_id: updatedIssue.id,
      run_id: run.id,
      label_applied: triggerResult.labelApplied,
      comment_posted: triggerResult.commentPosted,
    });

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
    console.error('[API /api/afu9/s1s3/issues/[id]/implement] Error implementing:', error);
    return respondS3Error({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
