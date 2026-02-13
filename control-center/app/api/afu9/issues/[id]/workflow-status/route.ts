import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getPool } from '@/lib/db';
import {
  getS1S3IssueById,
  getS1S3IssueByGitHub,
  getS1S3IssueByCanonicalId,
  listS1S3RunsByIssue,
} from '@/lib/db/s1s3Flow';
import { S1S3RunType, S1S3RunStatus, type S1S3RunRow } from '@/lib/contracts/s1s3Flow';
import { buildGuardrailsAuditSnapshot } from '../../../guardrails/audit/route';
import { resolveIssueIdentifierOr404 } from '../../../../issues/_shared';

const HANDLER_MARKER = 'workflow.status';

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

function buildHeaders(requestId: string): Record<string, string> {
  return {
    'x-afu9-request-id': requestId,
    'x-afu9-handler': HANDLER_MARKER,
    'cache-control': 'no-store',
  };
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

function deriveStageFromStatus(status: string): string {
  // Minimal mapping for AFU9 lifecycle stages.
  switch (status) {
    case 'CREATED':
    case 'DRAFT_READY':
    case 'VERSION_COMMITTED':
    case 'CR_BOUND':
      return 'S1';
    case 'SPEC_READY':
    case 'PUBLISHING':
    case 'PUBLISHED':
      return 'S2';
    case 'IMPLEMENTING':
      return 'S3';
    case 'MERGE_READY':
      return 'S5';
    case 'VERIFIED':
      return 'S7';
    case 'DONE':
      return 'S8';
    case 'HOLD':
      return 'S4';
    case 'KILLED':
      return 'S9';
    default:
      return 'S1';
  }
}

function resolveWorkflowStage(params: { s1s3Status?: string | null; hasS1: boolean }): string | null {
  const { s1s3Status, hasS1 } = params;
  if (!s1s3Status) {
    return hasS1 ? 'S2' : 'S1';
  }
  if (s1s3Status === 'SPEC_READY') {
    return 'S3';
  }
  return 'S2';
}

function deriveLastErrorCode(run: S1S3RunRow | null): string | undefined {
  if (!run) return undefined;
  if (run.status === S1S3RunStatus.DONE) return undefined;

  const message = (run.error_message || '').toLowerCase();
  if (message.includes('github sync disabled')) {
    return 'DISPATCH_DISABLED';
  }

  if (run.status === S1S3RunStatus.FAILED) {
    return 'FAILED';
  }

  return undefined;
}

function buildTopFindings(findings: { level: string; code: string; messageSafe: string }[]) {
  const rank = (level: string) => {
    switch (level) {
      case 'critical':
        return 0;
      case 'warn':
        return 1;
      case 'info':
        return 2;
      default:
        return 3;
    }
  };

  return findings
    .slice()
    .sort((a, b) => rank(a.level) - rank(b.level))
    .slice(0, 5)
    .map((finding) => ({
      level: finding.level,
      code: finding.code,
      messageSafe: finding.messageSafe,
    }));
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);
  const headers = buildHeaders(requestId);
  const { id } = await context.params;

  const resolved = await resolveIssueIdentifierOr404(id, requestId);
  if (!resolved.ok) {
    if (resolved.status === 404) {
      return jsonResponse(
        {
          ok: false,
          code: 'ISSUE_NOT_FOUND',
          issueId: id,
          requestId,
        },
        {
          status: 404,
          requestId,
          headers,
        }
      );
    }

    return jsonResponse(
      {
        ok: false,
        code: 'ISSUE_LOOKUP_FAILED',
        issueId: id,
        requestId,
      },
      {
        status: resolved.status,
        requestId,
        headers,
      }
    );
  }

  const issueRow = (resolved.issue || {}) as Record<string, unknown>;
  const issueStatus = getStringField(issueRow, 'status') || 'CREATED';

  const pool = getPool();
  let s1s3IssueStatus: string | null = null;
  let runs: S1S3RunRow[] = [];

  const issueId = resolved.uuid;
  const githubRepo = getStringField(issueRow, 'github_repo', 'githubRepo', 'repoFullName', 'repository');
  const githubIssueNumber = getNumberField(issueRow, 'github_issue_number', 'githubIssueNumber', 'issueNumber');
  const canonicalId = getStringField(issueRow, 'canonical_id', 'canonicalId');

  let s1s3IssueId: string | null = null;

  const s1s3ById = await getS1S3IssueById(pool, issueId);
  if (s1s3ById.success && s1s3ById.data) {
    s1s3IssueId = s1s3ById.data.id;
    s1s3IssueStatus = s1s3ById.data.status;
  } else if (githubRepo && githubIssueNumber) {
    const s1s3ByGitHub = await getS1S3IssueByGitHub(pool, githubRepo, githubIssueNumber);
    if (s1s3ByGitHub.success && s1s3ByGitHub.data) {
      s1s3IssueId = s1s3ByGitHub.data.id;
      s1s3IssueStatus = s1s3ByGitHub.data.status;
    }
  } else if (canonicalId) {
    const s1s3ByCanonical = await getS1S3IssueByCanonicalId(pool, canonicalId);
    if (s1s3ByCanonical.success && s1s3ByCanonical.data) {
      s1s3IssueId = s1s3ByCanonical.data.id;
      s1s3IssueStatus = s1s3ByCanonical.data.status;
    }
  }

  if (s1s3IssueId) {
    const runsResult = await listS1S3RunsByIssue(pool, s1s3IssueId);
    if (runsResult.success && runsResult.data) {
      runs = runsResult.data;
    }
  }

  const lastRun = runs.find(
    (run) => run.type === S1S3RunType.S3_IMPLEMENT || run.type === S1S3RunType.S2_SPEC_READY
  ) || null;

  const stageFromWorkflow = resolveWorkflowStage({
    s1s3Status: s1s3IssueStatus,
    hasS1: Boolean(githubRepo && githubIssueNumber),
  });
  const stage = stageFromWorkflow || deriveStageFromStatus(issueStatus);

  const guardrailsSnapshot = buildGuardrailsAuditSnapshot();
  const topFindings = buildTopFindings(guardrailsSnapshot.findings);

  return jsonResponse(
    {
      ok: true,
      requestId,
      issueId,
      stage,
      status: issueStatus,
      lastErrorCode: deriveLastErrorCode(lastRun),
      guardrails: {
        summary: guardrailsSnapshot.summary,
        topFindings,
      },
    },
    {
      requestId,
      headers,
    }
  );
}
