import { Octokit } from 'octokit';
import { createAuthenticatedClient } from './auth-wrapper';
import { DEFAULT_RETRY_CONFIG, withRetry } from './retry-policy';

const SPEC_START_MARKER = '<!-- afu9:s2:spec:start -->';
const SPEC_END_MARKER = '<!-- afu9:s2:spec:end -->';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLines(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function renderSpecSection(params: {
  problem?: string | null;
  scope?: string | null;
  acceptanceCriteria: string[];
  notes?: string | null;
}): string {
  const problem = normalizeLines(params.problem);
  const scope = normalizeLines(params.scope);
  const notes = normalizeLines(params.notes);
  const criteria = params.acceptanceCriteria
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const lines: string[] = [SPEC_START_MARKER, '## AFU9 Specification'];

  if (problem) {
    lines.push('', '### Problem', problem);
  }

  if (scope) {
    lines.push('', '### Scope', scope);
  }

  lines.push('', '### Acceptance Criteria');
  if (criteria.length > 0) {
    criteria.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry}`);
    });
  } else {
    lines.push('- (none)');
  }

  if (notes) {
    lines.push('', '### Notes', notes);
  }

  lines.push('', SPEC_END_MARKER);
  return lines.join('\n');
}

function upsertSpecSection(body: string | null | undefined, section: string): string {
  const existing = body || '';
  const pattern = new RegExp(
    `${escapeRegExp(SPEC_START_MARKER)}[\\s\\S]*?${escapeRegExp(SPEC_END_MARKER)}`,
    'm'
  );

  if (pattern.test(existing)) {
    return existing.replace(pattern, section).trim();
  }

  const trimmed = existing.trim();
  if (!trimmed) {
    return section;
  }

  return `${trimmed}\n\n${section}`;
}

export type GithubSpecSyncResult = {
  status: 'SUCCEEDED' | 'SKIPPED';
  issueUrl?: string;
};

export async function syncAfu9SpecToGitHubIssue(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  problem?: string | null;
  scope?: string | null;
  acceptanceCriteria: string[];
  notes?: string | null;
  requestId?: string;
}): Promise<GithubSpecSyncResult> {
  const octokit = await createAuthenticatedClient({
    owner: params.owner,
    repo: params.repo,
    requestId: params.requestId,
  });

  const getConfig = {
    ...DEFAULT_RETRY_CONFIG,
    httpMethod: 'GET' as const,
    requestId: params.requestId,
    endpoint: 'issues.get',
  };

  const issueResponse = await withRetry(
    async () =>
      octokit.rest.issues.get({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issueNumber,
      }),
    getConfig,
    (decision) => {
      console.log(`[GitHub Issue] ${decision.reason}`);
    }
  );

  const existingBody = issueResponse.data.body || '';
  const specSection = renderSpecSection({
    problem: params.problem,
    scope: params.scope,
    acceptanceCriteria: params.acceptanceCriteria,
    notes: params.notes,
  });
  const nextBody = upsertSpecSection(existingBody, specSection);

  if (nextBody.trim() === existingBody.trim()) {
    return {
      status: 'SKIPPED',
      issueUrl: issueResponse.data.html_url,
    };
  }

  const updateConfig = {
    ...DEFAULT_RETRY_CONFIG,
    httpMethod: 'PATCH' as const,
    allowNonIdempotentRetry: true,
    requestId: params.requestId,
    endpoint: 'issues.update',
  };

  await withRetry(
    async () =>
      octokit.rest.issues.update({
        owner: params.owner,
        repo: params.repo,
        issue_number: params.issueNumber,
        body: nextBody,
      }),
    updateConfig,
    (decision) => {
      console.log(`[GitHub Issue] ${decision.reason}`);
    }
  );

  return {
    status: 'SUCCEEDED',
    issueUrl: issueResponse.data.html_url,
  };
}

export type GithubTriggerResult = {
  labelApplied: boolean;
  commentPosted: boolean;
  issueUrl?: string;
};

export class CopilotAssignUnsupportedError extends Error {
  constructor(message = 'Copilot assignment is not supported for this repository') {
    super(message);
    this.name = 'CopilotAssignUnsupportedError';
  }
}

export class CopilotAssignFailedError extends Error {
  constructor(message = 'Copilot assignment failed') {
    super(message);
    this.name = 'CopilotAssignFailedError';
  }
}

export type CopilotAssignResult = {
  assigned: boolean;
  assignee: string;
};

export async function triggerAfu9Implementation(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  label?: string;
  comment?: string;
  requestId?: string;
  octokit?: Octokit;
}): Promise<GithubTriggerResult> {
  const octokit =
    params.octokit ??
    (await createAuthenticatedClient({
      owner: params.owner,
      repo: params.repo,
      requestId: params.requestId,
    }));

  const label = normalizeLines(params.label);
  const comment = normalizeLines(params.comment);

  let labelApplied = false;
  let commentPosted = false;

  if (label) {
    const labelConfig = {
      ...DEFAULT_RETRY_CONFIG,
      httpMethod: 'POST' as const,
      allowNonIdempotentRetry: true,
      requestId: params.requestId,
      endpoint: 'issues.addLabels',
    };

    await withRetry(
      async () =>
        octokit.rest.issues.addLabels({
          owner: params.owner,
          repo: params.repo,
          issue_number: params.issueNumber,
          labels: [label],
        }),
      labelConfig,
      (decision) => {
        console.log(`[GitHub Issue] ${decision.reason}`);
      }
    );
    labelApplied = true;
  }

  if (comment) {
    const commentConfig = {
      ...DEFAULT_RETRY_CONFIG,
      httpMethod: 'POST' as const,
      allowNonIdempotentRetry: true,
      requestId: params.requestId,
      endpoint: 'issues.createComment',
    };

    await withRetry(
      async () =>
        octokit.rest.issues.createComment({
          owner: params.owner,
          repo: params.repo,
          issue_number: params.issueNumber,
          body: comment,
        }),
      commentConfig,
      (decision) => {
        console.log(`[GitHub Issue] ${decision.reason}`);
      }
    );
    commentPosted = true;
  }

  return {
    labelApplied,
    commentPosted,
  };
}

export async function assignAfu9Copilot(params: {
  owner: string;
  repo: string;
  issueNumber: number;
  requestId?: string;
  octokit?: Octokit;
  assignee?: string;
}): Promise<CopilotAssignResult> {
  const octokit =
    params.octokit ??
    (await createAuthenticatedClient({
      owner: params.owner,
      repo: params.repo,
      requestId: params.requestId,
    }));

  const assignee = normalizeLines(params.assignee) || 'copilot-swe-agent';

  const config = {
    ...DEFAULT_RETRY_CONFIG,
    httpMethod: 'POST' as const,
    allowNonIdempotentRetry: true,
    requestId: params.requestId,
    endpoint: 'issues.addAssignees',
  };

  try {
    await withRetry(
      async () =>
        octokit.rest.issues.addAssignees({
          owner: params.owner,
          repo: params.repo,
          issue_number: params.issueNumber,
          assignees: [assignee],
        }),
      config,
      (decision) => {
        console.log(`[GitHub Issue] ${decision.reason}`);
      }
    );

    return {
      assigned: true,
      assignee,
    };
  } catch (error) {
    const status =
      typeof (error as { status?: unknown })?.status === 'number'
        ? ((error as { status?: number }).status as number)
        : undefined;
    if (status === 404 || status === 422) {
      throw new CopilotAssignUnsupportedError(
        `Copilot assignment unsupported (${status})`
      );
    }
    throw new CopilotAssignFailedError(
      error instanceof Error ? error.message : 'Copilot assignment failed'
    );
  }
}
