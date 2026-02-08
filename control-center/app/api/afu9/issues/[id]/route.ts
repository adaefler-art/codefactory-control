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
  resolveStageExecutionState,
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

type GithubLink = {
  repo?: string;
  issueNumber?: number;
  url?: string;
};

type NormalizedStoredIssue = {
  normalizedRow: Record<string, unknown>;
  github: GithubLink | null;
  appliedFallbacks: string[];
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

function getStringCandidate(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function getNumberCandidate(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function parseGithubIssueUrl(url?: string): GithubLink {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('github.com')) return {};
    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) return {};
    const [, owner, repo, issue] = match;
    const issueNumber = Number.parseInt(issue, 10);
    if (!Number.isFinite(issueNumber)) return {};
    return {
      repo: `${owner}/${repo}`,
      issueNumber,
      url,
    };
  } catch {
    return {};
  }
}

function buildGithubUrl(repo?: string, issueNumber?: number): string | undefined {
  if (!repo || !issueNumber) return undefined;
  return `https://github.com/${repo}/issues/${issueNumber}`;
}

function normalizeStoredIssue(params: {
  issueRow: Record<string, unknown>;
  fallbackTitle: string;
}): NormalizedStoredIssue {
  const { issueRow, fallbackTitle } = params;
  const normalizedRow: Record<string, unknown> = { ...issueRow };
  const appliedFallbacks: string[] = [];

  const issueRecord =
    issueRow.issue && typeof issueRow.issue === 'object'
      ? (issueRow.issue as Record<string, unknown>)
      : issueRow;
  const metadata =
    issueRow.metadata && typeof issueRow.metadata === 'object'
      ? (issueRow.metadata as Record<string, unknown>)
      : null;

  const primaryTitle = getStringCandidate(issueRecord, ['title']);
  const fallbackTitleValue =
    getStringCandidate(issueRecord, ['summary', 'issueTitle', 'name']) ||
    getStringCandidate(issueRow, ['summary', 'issueTitle', 'name']) ||
    (metadata ? getStringCandidate(metadata, ['title']) : undefined) ||
    fallbackTitle;

  if (!primaryTitle || primaryTitle !== fallbackTitleValue) {
    appliedFallbacks.push('legacy_title');
  }

  if (!primaryTitle && fallbackTitleValue === fallbackTitle) {
    appliedFallbacks.push('missing_title');
  }

  normalizedRow.title = primaryTitle || fallbackTitleValue;

  const rawRepo =
    getStringCandidate(issueRecord, ['github_repo', 'githubRepo']) ||
    getStringCandidate(issueRow, ['github_repo', 'githubRepo']);
  const rawIssueNumber =
    getNumberCandidate(issueRecord, ['github_issue_number', 'githubIssueNumber']) ||
    getNumberCandidate(issueRow, ['github_issue_number', 'githubIssueNumber']);
  const rawUrl =
    getStringCandidate(issueRecord, ['github_url', 'githubUrl']) ||
    getStringCandidate(issueRow, ['github_url', 'githubUrl']);

  const legacyRepo = getStringCandidate(issueRow, ['repository', 'repoFullName', 'mirrorRepo']);
  const legacyIssueNumber = getNumberCandidate(issueRow, [
    'issueNumber',
    'mirrorIssue',
    'mirrorIssueNumber',
  ]);
  const legacyUrl = getStringCandidate(issueRow, ['githubIssueUrl', 'url', 'html_url']);

  let repo = rawRepo || legacyRepo;
  let issueNumber = rawIssueNumber || legacyIssueNumber;
  let url = rawUrl || legacyUrl;

  if (url && (!repo || !issueNumber)) {
    const parsed = parseGithubIssueUrl(url);
    repo = repo || parsed.repo;
    issueNumber = issueNumber || parsed.issueNumber;
    if (parsed.repo || parsed.issueNumber) {
      appliedFallbacks.push('legacy_github_fields');
    }
  }

  if (!url && repo && issueNumber) {
    url = buildGithubUrl(repo, issueNumber);
    appliedFallbacks.push('github_url_constructed');
  }

  if (!rawRepo && repo) appliedFallbacks.push('legacy_github_fields');
  if (!rawIssueNumber && issueNumber) appliedFallbacks.push('legacy_github_fields');
  if (!rawUrl && url) appliedFallbacks.push('legacy_github_fields');

  if (repo) normalizedRow.github_repo = repo;
  if (issueNumber) normalizedRow.github_issue_number = issueNumber;
  if (url) normalizedRow.github_url = url;

  const github = repo || issueNumber || url ? { repo, issueNumber, url } : null;

  return { normalizedRow, github, appliedFallbacks: Array.from(new Set(appliedFallbacks)) };
}

function buildWorkflow(params: {
  s1s3Issue?: { status?: string } | null;
  hasS1: boolean;
}): { current: string; completed: string[]; nextStep: string } {
  const { s1s3Issue, hasS1 } = params;
  const completed: string[] = [];

  if (hasS1) {
    completed.push('S1');
  }

  if (!s1s3Issue) {
    const current = hasS1 ? 'S2' : 'S1';
    return {
      current,
      completed,
      nextStep: current,
    };
  }

  const status = s1s3Issue.status || 'CREATED';
  if (status === 'SPEC_READY') {
    completed.push('S2');
    return {
      current: 'S3',
      completed,
      nextStep: 'S3',
    };
  }

  return {
    current: 'S2',
    completed,
    nextStep: 'S2',
  };
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
    let resolvedShortId: string | undefined;

    if (parsedId.isValid) {
      const resolved = await resolveIssueIdentifierOr404(id, requestId);
      if (!resolved.ok) {
        if (resolved.status === 404) {
          return jsonResponse(
            {
              errorCode: 'NOT_FOUND',
              id,
              requestId,
            },
            {
              status: 404,
              requestId,
              headers: responseHeaders,
            }
          );
        }

        return jsonResponse(resolved.body, {
          status: resolved.status,
          requestId,
          headers: responseHeaders,
        });
      }

      issueRow = resolved.issue as Record<string, unknown>;
      resolvedIssueId = resolved.uuid;
      resolvedShortId = resolved.shortId;
    } else {
      const canonicalResult = await getAfu9IssueByCanonicalId(pool, id);

      if (!canonicalResult.success) {
        return jsonResponse(
          {
            errorCode: 'DB_READ_FAILED',
            requestId,
          },
          {
            status: 500,
            requestId,
            headers: responseHeaders,
          }
        );
      }

      if (!canonicalResult.data) {
        return jsonResponse(
          {
            errorCode: 'NOT_FOUND',
            id,
            requestId,
          },
          {
            status: 404,
            requestId,
            headers: responseHeaders,
          }
        );
      }

      issueRow = canonicalResult.data as Record<string, unknown>;
      const issueIdValue = issueRow.id;
      if (typeof issueIdValue === 'string' && issueIdValue.trim()) {
        resolvedIssueId = issueIdValue;
      }
    }

    if (!issueRow) {
      return jsonResponse(
        {
          errorCode: 'DB_READ_FAILED',
          requestId,
        },
        {
          status: 500,
          requestId,
          headers: responseHeaders,
        }
      );
    }

    const shortIdFallback =
      resolvedShortId ||
      (typeof issueRow.public_id === 'string' ? issueRow.public_id : undefined) ||
      (typeof issueRow.publicId === 'string' ? issueRow.publicId : undefined) ||
      (typeof resolvedIssueId === 'string' ? resolvedIssueId.slice(0, 8) : undefined) ||
      id;
    const normalizedStored = normalizeStoredIssue({
      issueRow,
      fallbackTitle: `Issue ${shortIdFallback}`,
    });
    let normalizedIssue: Record<string, unknown>;
    try {
      normalizedIssue = normalizeIssueForApi(normalizedStored.normalizedRow);
    } catch (error) {
      normalizedIssue = normalizeIssueForApi({
        id: issueRow.id || resolvedIssueId,
        title: normalizedStored.normalizedRow.title || `Issue ${shortIdFallback}`,
        status: issueRow.status || 'CREATED',
        labels: Array.isArray(issueRow.labels) ? issueRow.labels : [],
        priority: issueRow.priority || null,
        created_at: issueRow.created_at || issueRow.createdAt || null,
        updated_at: issueRow.updated_at || issueRow.updatedAt || null,
      });
      normalizedStored.appliedFallbacks.push('output_contract_recovery');
      console.warn('[API /api/afu9/issues/[id]] Normalization fallback applied:', error);
    }

    const s1s3IssueResult = parsedId.isValid
      ? await getS1S3IssueById(pool, resolvedIssueId)
      : await getS1S3IssueByCanonicalId(pool, id);

    const s1s3Issue = s1s3IssueResult.success ? s1s3IssueResult.data : null;
    const s2Stage = getStageRegistryEntry('S2');
    const s2Execution = s2Stage
      ? resolveStageExecutionState(s2Stage)
      : { executionState: 'blocked', missingConfig: ['STAGE_REGISTRY_MISSING'] };
    const s2 = s1s3Issue
      ? {
          status: s1s3Issue.status,
          scope: s1s3Issue.scope ?? null,
          acceptanceCriteria: normalizeAcceptanceCriteria(s1s3Issue.acceptance_criteria),
          specReadyAt: s1s3Issue.spec_ready_at ?? null,
          executionState: s2Execution.executionState,
          missingConfig: s2Execution.missingConfig,
          blockedReason: s2Execution.blockedReason,
        }
      : {
          status: 'UNAVAILABLE',
          scope: null,
          acceptanceCriteria: [],
          specReadyAt: null,
          executionState: s2Execution.executionState,
          missingConfig: s2Execution.missingConfig,
          blockedReason: s2Execution.blockedReason,
        };

    const workflow = buildWorkflow({
      s1s3Issue,
      hasS1: Boolean(normalizedStored.github?.url || (normalizedStored.github?.repo && normalizedStored.github?.issueNumber)),
    });

    const issueSnapshot = issueRow as {
      id?: string;
      status?: string;
      execution_state?: string;
      handoff_state?: string;
      github_issue_number?: number;
      github_url?: string;
    };

    let runs: unknown = [];
    let stateFlow: unknown = undefined;
    let execution: unknown = undefined;

    try {
      if (!s1s3Issue) {
        throw new Error('Runs unavailable');
      }
      const runsResult = await listS1S3RunsByIssue(pool, s1s3Issue.id);
      if (!runsResult.success) {
        throw new Error(runsResult.error || 'Runs unavailable');
      }
      runs = runsResult.data || [];
    } catch (error) {
      const code = resolveOptionalCode(error, 'RUNS_UNAVAILABLE');
      const message = error instanceof Error ? error.message : 'Runs unavailable';
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
      execution = buildUnavailable({
        code,
        message,
        requestId,
      });
      console.warn('[API /api/afu9/issues/[id]] Execution status unavailable:', error);
    }

    const stateQuality = normalizedStored.appliedFallbacks.length > 0
      ? 'partial'
      : 'complete';

    const responseBody: Record<string, unknown> = {
      ok: true,
      issue: normalizedIssue,
      s2,
      workflow,
      runs,
      stateFlow,
      execution,
      stateQuality,
      github: normalizedStored.github,
      diagnostics:
        normalizedStored.appliedFallbacks.length > 0
          ? { migrationApplied: normalizedStored.appliedFallbacks }
          : undefined,
      ...normalizedIssue,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    const headers = {
      ...responseHeaders,
      ...cacheHeaders,
    };


    return jsonResponse(responseBody, {
      requestId,
      headers,
    });
  } catch (error) {
    console.error('[API /api/afu9/issues/[id]] Unexpected error:', error);
    return jsonResponse(
      {
        errorCode: 'DB_READ_FAILED',
        requestId,
      },
      {
        status: 500,
        requestId,
        headers: responseHeaders,
      }
    );
  }
}
