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
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY_PEM: 'dummy-key',
      AFU9_GITHUB_IMPLEMENT_LABEL: 'afu9:implement',
      AFU9_STAGE: 'dev',
    };
    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: mockIssue.id,
      issue: { id: mockIssue.id },
      source: 'control',
    });
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  test('returns GITHUB_AUTH_MISSING when dispatch config is missing', async () => {
    process.env = {
      ...envSnapshot,
      AFU9_STAGE: 'dev',
    };
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });

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
    expect(body.code).toBe('GITHUB_AUTH_MISSING');
    expect(body.requiredConfig).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY_PEM',
    ]);
    expect(body.missingConfig).toEqual([
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY_PEM',
    ]);
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-stage')).toBe('S3');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
    expect(response.headers.get('x-afu9-error-code')).toBe('GITHUB_AUTH_MISSING');
  });

  test('returns IMPLEMENT_TRIGGER_CONFIG_MISSING when trigger config is missing', async () => {
    process.env = {
      ...envSnapshot,
      GITHUB_APP_ID: '12345',
      GITHUB_APP_PRIVATE_KEY_PEM: 'dummy-key',
      AFU9_STAGE: 'dev',
    };

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
    expect(body.requiredConfig).toEqual([
      'AFU9_GITHUB_IMPLEMENT_LABEL',
      'AFU9_GITHUB_IMPLEMENT_COMMENT',
    ]);
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
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
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
  });

  test('returns IMPLEMENT_FAILED on unexpected error', async () => {
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
    expect(body.code).toBe('IMPLEMENT_FAILED');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
  });
});
