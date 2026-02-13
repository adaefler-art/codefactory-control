/**
 * S1-S3 Implement API Tests
 *
 * Tests for POST /api/afu9/s1s3/issues/[id]/implement endpoint:
 * - Blocks when GitHub dispatch config is missing
 * - Blocks when trigger config is missing
 * - Triggers GitHub implementation
 *
 * @jest-environment node
 */

import { POST as implementIssue } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { S1S3IssueStatus } from '../../src/lib/contracts/s1s3Flow';
import { triggerAfu9Implementation } from '../../src/lib/github/issue-sync';
import { createAuthenticatedClient, __resetPolicyCache } from '../../src/lib/github/auth-wrapper';
import { GitHubAppConfigError } from '../../src/lib/github-app-auth';
import {
  getS1S3IssueById,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssueStatus,
} from '../../src/lib/db/s1s3Flow';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';

// Mock the database module
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock GitHub issue sync helper
jest.mock('@/lib/github/issue-sync', () => ({
  triggerAfu9Implementation: jest.fn(),
}));

jest.mock('@/lib/github/auth-wrapper', () => {
  const actual = jest.requireActual('@/lib/github/auth-wrapper');
  return {
    ...actual,
    createAuthenticatedClient: jest.fn(),
  };
});

// Mock S1S3 DAO functions
jest.mock('@/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: jest.fn(),
  createS1S3Run: jest.fn(),
  createS1S3RunStep: jest.fn(),
  updateS1S3RunStatus: jest.fn(),
  updateS1S3IssueStatus: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('POST /api/afu9/s1s3/issues/[id]/implement', () => {
  const envSnapshot = { ...process.env };
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockCreateS1S3Run = createS1S3Run as jest.Mock;
  const mockCreateS1S3RunStep = createS1S3RunStep as jest.Mock;
  const mockUpdateS1S3RunStatus = updateS1S3RunStatus as jest.Mock;
  const mockUpdateS1S3IssueStatus = updateS1S3IssueStatus as jest.Mock;
  const mockTriggerAfu9Implementation = triggerAfu9Implementation as jest.Mock;
  const mockCreateAuthenticatedClient = createAuthenticatedClient as jest.Mock;
  const mockResolveIssueIdentifierOr404 = resolveIssueIdentifierOr404 as jest.Mock;

  const mockIssue = {
    id: 'issue-123',
    public_id: 'abc123',
    canonical_id: 'I42',
    repo_full_name: 'owner/repo',
    github_issue_number: 42,
    github_issue_url: 'https://github.com/owner/repo/issues/42',
    owner: 'afu9',
    status: S1S3IssueStatus.SPEC_READY,
    problem: 'Test problem',
    scope: 'Test scope',
    acceptance_criteria: '["AC1", "AC2"]',
    notes: null,
    pr_number: null,
    pr_url: null,
    branch_name: null,
    created_at: new Date(),
    updated_at: new Date(),
    spec_ready_at: new Date(),
    pr_created_at: null,
  };

  const mockRun = {
    id: 'run-123',
    type: 'S3_IMPLEMENT',
    issue_id: 'issue-123',
    request_id: 'req-123',
    actor: 'afu9',
    status: 'RUNNING',
    created_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...envSnapshot,
      GITHUB_REPO_ALLOWLIST: JSON.stringify({
        allowlist: [{ owner: 'owner', repo: 'repo', branches: ['main'] }],
      }),
      AFU9_GUARDRAILS_TOKEN_SCOPE: 'write',
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY_PEM: 'dummy-key',
      AFU9_GITHUB_IMPLEMENT_LABEL: 'afu9:implement',
      AFU9_GITHUB_IMPLEMENT_COMMENT: 'Please implement this issue.',
      AFU9_STAGE: 'dev',
    };
    __resetPolicyCache();
    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: mockIssue.id,
      issue: { id: mockIssue.id },
      source: 'control',
    });
    mockCreateAuthenticatedClient.mockResolvedValue({});
  });

  const setupTriggerRunMocks = () => {
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-start' } });
    mockUpdateS1S3RunStatus.mockResolvedValue({ success: true, data: mockRun });
  };

  afterEach(() => {
    process.env = { ...envSnapshot };
    __resetPolicyCache();
  });

  test('returns GUARDRAIL_CONFIG_MISSING when guardrail config is missing', async () => {
    process.env = {
      ...envSnapshot,
      AFU9_GUARDRAILS_ENABLED: 'true',
      AFU9_STAGE: 'dev',
      GITHUB_REPO_ALLOWLIST: JSON.stringify({
        allowlist: [{ owner: 'owner', repo: 'repo', branches: ['main'] }],
      }),
      AFU9_GUARDRAILS_TOKEN_SCOPE: 'write',
    };
    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '';
    process.env.GITHUB_APP_SECRET_ID = '';
    process.env.GH_APP_ID = '';
    process.env.GH_APP_PRIVATE_KEY_PEM = '';
    process.env.GH_APP_SECRET_ID = '';
    __resetPolicyCache();
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateAuthenticatedClient.mockRejectedValue(
      new GitHubAppConfigError('Missing GITHUB_APP_ID')
    );

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('CONFIG');
    expect(body.nextAction).toBe('Set required config in runtime');
    expect(body.requestId).toBeTruthy();
    expect(body.requiredConfig).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY_PEM',
      'GITHUB_APP_SECRET_ID',
    ]);
    expect(body.missingConfig).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY_PEM',
      'GITHUB_APP_SECRET_ID',
    ]);
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-stage')).toBe('S3');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler')).toBeTruthy();
    expect(response.headers.get('x-afu9-control-build')).toBeTruthy();
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
    expect(response.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('CONFIG');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-auth-path')).toBe('unknown');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-missing-config')).toBe(
      'GITHUB_APP_ID,GITHUB_APP_PRIVATE_KEY_PEM,GITHUB_APP_SECRET_ID'
    );
    expect(mockCreateAuthenticatedClient).not.toHaveBeenCalled();
    expect(mockTriggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('blocks when repo is not allowlisted', async () => {
    process.env = {
      ...envSnapshot,
      AFU9_GUARDRAILS_ENABLED: 'true',
      GITHUB_REPO_ALLOWLIST: JSON.stringify({
        allowlist: [{ owner: 'allowed', repo: 'repo', branches: ['main'] }],
      }),
      AFU9_GUARDRAILS_TOKEN_SCOPE: 'write',
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY_PEM: 'dummy-key',
      AFU9_GITHUB_IMPLEMENT_LABEL: 'afu9:implement',
      AFU9_STAGE: 'dev',
    };
    __resetPolicyCache();
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_REPO_NOT_ALLOWED');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('POLICY');
    expect(body.nextAction).toBe('Allowlist repo for repo-write');
    expect(body.requestId).toBeTruthy();
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('POLICY');
    expect(response.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_REPO_NOT_ALLOWED');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-missing-config')).toBe('');
    expect(mockCreateAuthenticatedClient).not.toHaveBeenCalled();
    expect(mockTriggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('maps 401 from GitHub to GITHUB_AUTH_INVALID', async () => {
    setupTriggerRunMocks();
    mockTriggerAfu9Implementation.mockRejectedValue({ response: { status: 401 } });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-401' },
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_AUTH_INVALID');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-401');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
  });

  test('maps 403 from GitHub to GITHUB_AUTH_INVALID', async () => {
    setupTriggerRunMocks();
    mockTriggerAfu9Implementation.mockRejectedValue({ response: { status: 403 } });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-403' },
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_AUTH_INVALID');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-403');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
  });

  test('maps 404 from GitHub to GITHUB_TARGET_NOT_FOUND', async () => {
    setupTriggerRunMocks();
    mockTriggerAfu9Implementation.mockRejectedValue({ response: { status: 404 } });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-404' },
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_TARGET_NOT_FOUND');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-404');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
  });

  test('maps 422 from GitHub to GITHUB_VALIDATION_FAILED', async () => {
    setupTriggerRunMocks();
    mockTriggerAfu9Implementation.mockRejectedValue({ response: { status: 422 } });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-422' },
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_VALIDATION_FAILED');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-422');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
  });

  test('maps network failures to GITHUB_UPSTREAM_UNREACHABLE', async () => {
    setupTriggerRunMocks();
    mockTriggerAfu9Implementation.mockRejectedValue(new Error('timeout'));

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-502' },
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe('GITHUB_UPSTREAM_UNREACHABLE');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-502');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
  });

  test('returns IMPLEMENT_TRIGGER_CONFIG_MISSING when trigger config is missing', async () => {
    process.env = {
      ...envSnapshot,
      AFU9_GUARDRAILS_ENABLED: 'true',
      AFU9_GUARDRAILS_TOKEN_SCOPE: 'write',
      GITHUB_REPO_ALLOWLIST: JSON.stringify({
        allowlist: [{ owner: 'owner', repo: 'repo', branches: ['main'] }],
      }),
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY_PEM: 'dummy-key',
      AFU9_STAGE: 'dev',
    };
    __resetPolicyCache();

    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('IMPLEMENT_TRIGGER_CONFIG_MISSING');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('CONFIG');
    expect(body.nextAction).toBe('Configure implement trigger label/comment');
    expect(body.requestId).toBeTruthy();
    expect(body.requiredConfig).toEqual([
      'AFU9_GITHUB_IMPLEMENT_LABEL',
      'AFU9_GITHUB_IMPLEMENT_COMMENT',
    ]);
    expect(response.headers.get('x-afu9-error-code')).toBe('IMPLEMENT_TRIGGER_CONFIG_MISSING');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('CONFIG');
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-error-code')).toBe('IMPLEMENT_TRIGGER_CONFIG_MISSING');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('CONFIG');
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('unknown');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-missing-config')).toBe(
      'AFU9_GITHUB_IMPLEMENT_LABEL,AFU9_GITHUB_IMPLEMENT_COMMENT'
    );
  });

  test('returns GITHUB_MIRROR_MISSING when repo metadata missing', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        repo_full_name: null,
      },
    });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('GITHUB_MIRROR_MISSING');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('STATE');
    expect(body.nextAction).toBe('Link GitHub issue (S1) or restore mirror metadata');
    expect(body.requestId).toBeTruthy();
    expect(response.headers.get('x-afu9-error-code')).toBe('GITHUB_MIRROR_MISSING');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('STATE');
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
    expect(response.headers.get('x-afu9-auth-path')).toBe('unknown');
  });

  test('maps proxy TypeError to SPEC_NOT_READY preflight', async () => {
    setupTriggerRunMocks();
    mockTriggerAfu9Implementation.mockRejectedValue(
      new TypeError('Cannot create proxy with a non-object as target or handler')
    );

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-proxy' },
    }) as unknown as Parameters<typeof implementIssue>[0];

    const response = await implementIssue(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SPEC_NOT_READY');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('STATE');
    expect(body.nextAction).toBe('Complete and save S2 spec');
    expect(body.requestId).toBe('req-proxy');
    expect(response.headers.get('x-afu9-error-code')).toBe('SPEC_NOT_READY');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('STATE');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-proxy');
  });

  test('triggers GitHub implementation and returns 202', async () => {
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    mockCreateS1S3RunStep
      .mockResolvedValueOnce({ success: true, data: { id: 'step-start' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'step-trigger' } });
    mockUpdateS1S3RunStatus.mockResolvedValue({ success: true, data: mockRun });
    mockUpdateS1S3IssueStatus.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        status: S1S3IssueStatus.IMPLEMENTING,
      },
    });
    mockTriggerAfu9Implementation.mockResolvedValue({
      labelApplied: true,
      commentPosted: false,
    });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.stage).toBe('S3');
    expect(body.runId).toBe(mockRun.id);
    expect(body.mutationId).toBe('step-trigger');
    expect(body.githubTrigger?.status).toBe('TRIGGERED');
    expect(body.githubTrigger?.labelApplied).toBe(true);
    expect(body.githubTrigger?.commentPosted).toBe(false);
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
    expect(mockCreateAuthenticatedClient).toHaveBeenCalled();
    expect(mockTriggerAfu9Implementation).toHaveBeenCalled();
  });

  test('returns INTERNAL_ERROR on unexpected error', async () => {
    mockGetS1S3IssueById.mockImplementation(() => {
      throw new Error('boom');
    });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
    expect(response.headers.get('x-afu9-auth-path')).toBe('unknown');
  });
});
