/**
 * Tests for POST /api/afu9/s1s3/issues/[id]/spec
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as postSpec } from '../../app/api/afu9/s1s3/issues/[id]/spec/route';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';
import {
  getS1S3IssueById,
  getS1S3IssueByCanonicalId,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssueSpec,
} from '../../src/lib/db/s1s3Flow';
import { syncAfu9SpecToGitHubIssue } from '../../src/lib/github/issue-sync';
import { __resetPolicyCache } from '../../src/lib/github/auth-wrapper';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('@/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: jest.fn(),
  getS1S3IssueByCanonicalId: jest.fn(),
  createS1S3Run: jest.fn(),
  createS1S3RunStep: jest.fn(),
  updateS1S3RunStatus: jest.fn(),
  updateS1S3IssueSpec: jest.fn(),
  upsertS1S3Issue: jest.fn(),
}));

jest.mock('@/lib/github/issue-sync', () => ({
  syncAfu9SpecToGitHubIssue: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('POST /api/afu9/s1s3/issues/[id]/spec', () => {
  const mockResolveIssueIdentifierOr404 = resolveIssueIdentifierOr404 as jest.Mock;
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockGetS1S3IssueByCanonicalId = getS1S3IssueByCanonicalId as jest.Mock;
  const mockCreateS1S3Run = createS1S3Run as jest.Mock;
  const mockCreateS1S3RunStep = createS1S3RunStep as jest.Mock;
  const mockUpdateS1S3RunStatus = updateS1S3RunStatus as jest.Mock;
  const mockUpdateS1S3IssueSpec = updateS1S3IssueSpec as jest.Mock;
  const mockSyncAfu9SpecToGitHubIssue = syncAfu9SpecToGitHubIssue as jest.Mock;
  const originalEnv = { ...process.env };

  const setBackendReady = () => {
    process.env.GITHUB_APP_ID = 'afu9-app';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'test-key';
  };

  const setBackendMissingGithub = () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateS1S3RunStep.mockReset();
    process.env = { ...originalEnv };
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'octo', repo: 'repo', branches: ['main'] }],
    });
    process.env.AFU9_GUARDRAILS_ENABLED = 'false';
    process.env.AFU9_GUARDRAILS_TOKEN_SCOPE = 'write';
    setBackendReady();
    __resetPolicyCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetPolicyCache();
  });

  it('accepts a minimal valid body', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-1',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-1',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-2',
          status: 'SUCCEEDED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-sync',
          status: 'SUCCEEDED',
          step_name: 'sync-to-github',
        },
      });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
            repo_full_name: 'octo/repo',
            github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-1',
        status: 'DONE',
      },
    });
    mockSyncAfu9SpecToGitHubIssue.mockResolvedValue({
      status: 'SUCCEEDED',
      issueUrl: 'https://github.com/octo/repo/issues/42',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-1',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-afu9-scope-requested')).toBe('s1s3');
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s3');
    expect(response.headers.get('x-afu9-stage')).toBe('S2');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-spec');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-1');
    expect(response.headers.get('x-afu9-control-build')).toBeTruthy();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-error-code')).toBeNull();
    expect(body.ok).toBe(true);
    expect(body.issueId).toBe(issueId);
    expect(body.issue?.status).toBe('SPEC_READY');
    expect(body.s2?.status).toBe('READY');
    expect(body.workflow?.current).toBe('S2');
    expect(body.step?.step_name).toBe('sync-to-github');
    expect(body.githubSync?.status).toBe('SUCCEEDED');
  });

  it('blocks when repo is not allowlisted before GitHub sync', async () => {
    process.env.AFU9_GUARDRAILS_ENABLED = 'true';
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'allowed', repo: 'repo', branches: ['main'] }],
    });
    __resetPolicyCache();
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-guardrail-1',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-start',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-spec',
          status: 'SUCCEEDED',
          step_name: 'Spec Ready',
        },
      });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-guardrail-1',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_REPO_NOT_ALLOWED');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('POLICY');
    expect(body.nextAction).toBe('Allowlist repo for repo-write');
    expect(body.requestId).toBe('req-guardrail-1');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-guardrail-1');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-spec');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('POLICY');
    expect(response.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_REPO_NOT_ALLOWED');
    expect(response.headers.get('x-afu9-control-build')).toBeTruthy();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-missing-config')).toBeNull();
    expect(mockSyncAfu9SpecToGitHubIssue).not.toHaveBeenCalled();
  });

  it('blocks when guardrail config is missing before GitHub sync', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';
    process.env.AFU9_GUARDRAILS_ENABLED = 'true';
    process.env.AFU9_GUARDRAILS_TOKEN_SCOPE = 'write';
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'octo', repo: 'repo', branches: ['main'] }],
    });
    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '';
    process.env.GITHUB_APP_SECRET_ID = '';
    process.env.GH_APP_ID = '';
    process.env.GH_APP_PRIVATE_KEY_PEM = '';
    process.env.GH_APP_SECRET_ID = '';
    __resetPolicyCache();

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-guardrail-2',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-start',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-spec',
          status: 'SUCCEEDED',
          step_name: 'Spec Ready',
        },
      });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-guardrail-2',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('CONFIG');
    expect(body.nextAction).toBe('Set required config in runtime');
    expect(body.requestId).toBe('req-guardrail-2');
    expect(body.missingConfig).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY_PEM',
      'GITHUB_APP_SECRET_ID',
    ]);
    expect(response.headers.get('x-afu9-request-id')).toBe('req-guardrail-2');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-spec');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('CONFIG');
    expect(response.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-missing-config')).toBe(
      'GITHUB_APP_ID,GITHUB_APP_PRIVATE_KEY_PEM,GITHUB_APP_SECRET_ID'
    );
    expect(mockSyncAfu9SpecToGitHubIssue).not.toHaveBeenCalled();
  });

  it('returns GITHUB_MIRROR_MISSING when mirror metadata is missing', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: {
        id: issueId,
        status: 'CREATED',
        github_repo: null,
        github_issue_number: null,
        github_url: null,
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({ success: false, error: 'Issue not found' });
    mockGetS1S3IssueByCanonicalId.mockResolvedValue({ success: false, error: 'Issue not found' });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-mirror-1',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_MIRROR_MISSING');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('STATE');
    expect(body.nextAction).toBe('Link GitHub issue (S1) or restore mirror metadata');
    expect(body.requestId).toBe('req-mirror-1');
    expect(response.headers.get('x-afu9-error-code')).toBe('GITHUB_MIRROR_MISSING');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('STATE');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-mirror-1');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-spec');
  });

  it('spec_saves_and_returns_200_when_github_missing_with_blocked_run_step', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';
    process.env.AFU9_GUARDRAILS_ENABLED = 'false';
    setBackendMissingGithub();

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-2',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-start',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-spec',
          status: 'SUCCEEDED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-blocked',
          status: 'FAILED',
          step_name: 'sync-to-github',
          error_message: 'GitHub sync disabled (GITHUB_APP_ID)',
        },
      });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-2',
        status: 'FAILED',
        error_message: 'GitHub sync disabled (GITHUB_APP_ID)',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-blocked',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.issue?.status).toBe('SPEC_READY');
    expect(body.run?.status).toBe('BLOCKED');
    expect(body.run?.blockedReason).toBe('DISPATCH_DISABLED');
    expect(body.run?.error_message).toBe('GitHub sync disabled (GITHUB_APP_ID)');
    expect(body.step?.status).toBe('BLOCKED');
    expect(body.step?.step_name).toBe('sync-to-github');
    expect(body.step?.blockedReason).toBe('DISPATCH_DISABLED');
    expect(body.workflow?.current).toBe('S2');
    expect(body.githubSync?.status).toBe('BLOCKED');
  });

  it('spec_saves_and_returns_200_when_github_sync_fails', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';
    process.env.AFU9_GUARDRAILS_ENABLED = 'false';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-3',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-start',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-spec',
          status: 'SUCCEEDED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-sync',
          status: 'FAILED',
          step_name: 'sync-to-github',
          error_message: 'GitHub sync failed.',
        },
      });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-3',
        status: 'FAILED',
        error_message: 'GitHub sync failed.',
      },
    });

    mockSyncAfu9SpecToGitHubIssue.mockRejectedValue(new Error('GitHub sync failed.'));

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-1',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.issue?.status).toBe('SPEC_READY');
    expect(body.run?.status).toBe('FAILED');
    expect(body.step?.status).toBe('FAILED');
    expect(body.githubSync?.status).toBe('FAILED');
  });

  it('spec_returns_normal_run_step_when_backend_available', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';
    process.env.AFU9_GUARDRAILS_ENABLED = 'false';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-3',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-3',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-4',
          status: 'SUCCEEDED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-sync',
          status: 'SUCCEEDED',
          step_name: 'sync-to-github',
        },
      });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-3',
        status: 'DONE',
      },
    });
    mockSyncAfu9SpecToGitHubIssue.mockResolvedValue({
      status: 'SUCCEEDED',
      issueUrl: 'https://github.com/octo/repo/issues/42',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-ready',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.issue?.status).toBe('SPEC_READY');
    expect(body.run?.status).toBe('DONE');
    expect(body.step?.status).toBe('SUCCEEDED');
    expect(body.step?.step_name).toBe('sync-to-github');
    expect(body.githubSync?.status).toBe('SUCCEEDED');
    expect(body.workflow?.current).toBe('S2');
  });

  it('returns a 400 errorCode for invalid body', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-2',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: '',
          acceptanceCriteria: [],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('SPEC_NOT_READY');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('STATE');
    expect(body.nextAction).toBe('Complete and save S2 spec');
    expect(body.requestId).toBe('req-2');
    expect(response.headers.get('x-afu9-error-code')).toBe('SPEC_NOT_READY');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('STATE');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-2');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-spec');
  });

  it('enforces acceptanceCriteria minItems=1', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-criteria',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: [],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('SPEC_NOT_READY');
  });

  it('returns INTERNAL_ERROR on downstream errors', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: issueId,
      issue: { id: issueId },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'CREATED',
        owner: 'afu9',
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: [],
      },
    });

    mockCreateS1S3Run.mockRejectedValue(new Error('boom'));

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-3',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(response.headers.get('x-afu9-error-code')).toBe('INTERNAL_ERROR');
  });

  it('returns INTERNAL_ERROR on unexpected handler errors', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockRejectedValue(new Error('boom'));

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-4',
          'x-afu9-sub': 'test-user',
        }),
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    );

    const response = await postSpec(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(response.headers.get('x-afu9-error-code')).toBe('INTERNAL_ERROR');
  });
});
