/**
 * S3 Implement Route Contract Tests
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as implementIssue } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { S1S3IssueStatus } from '../../src/lib/contracts/s1s3Flow';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';
import { triggerAfu9Implementation } from '../../src/lib/github/issue-sync';
import { createAuthenticatedClient } from '../../src/lib/github/auth-wrapper';
import { GitHubAppConfigError } from '../../src/lib/github-app-auth';

const mockGetS1S3IssueById = jest.fn();
const mockCreateS1S3Run = jest.fn();
const mockCreateS1S3RunStep = jest.fn();
const mockUpdateS1S3RunStatus = jest.fn();
const mockUpdateS1S3IssueStatus = jest.fn();

const mockGetStageRegistryEntry = jest.fn();

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('@/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: (...args: unknown[]) => mockGetS1S3IssueById(...args),
  createS1S3Run: (...args: unknown[]) => mockCreateS1S3Run(...args),
  createS1S3RunStep: (...args: unknown[]) => mockCreateS1S3RunStep(...args),
  updateS1S3RunStatus: (...args: unknown[]) => mockUpdateS1S3RunStatus(...args),
  updateS1S3IssueStatus: (...args: unknown[]) => mockUpdateS1S3IssueStatus(...args),
}));

jest.mock('@/lib/stage-registry', () => ({
  getStageRegistryEntry: (...args: unknown[]) => mockGetStageRegistryEntry(...args),
  getStageRegistryError: jest.fn(() => ({
    code: 'STAGE_MISSING',
    message: 'Stage missing',
  })),
}));

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

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('POST /api/afu9/s1s3/issues/[id]/implement', () => {
  const mockResolveIssue = resolveIssueIdentifierOr404 as jest.Mock;
  const mockCreateAuthenticatedClient = createAuthenticatedClient as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_STAGE = 'local';
    process.env.AFU9_GITHUB_IMPLEMENT_LABEL = 'implement';
    process.env.AFU9_GITHUB_IMPLEMENT_COMMENT = 'go';

    mockGetStageRegistryEntry.mockReturnValue({
      stageId: 'S3',
      routes: {
        implement: {
          handler: 's1s3-implement',
        },
      },
    });
    mockCreateAuthenticatedClient.mockResolvedValue({});

    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: 'issue-123',
      source: 'control',
    });
  });

  test('returns 409 + handler headers when mirror missing', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: null,
        github_issue_number: null,
      },
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_MIRROR_MISSING');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-afu9-commit')).toBeDefined();
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('returns 409 when spec not ready', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.CREATED,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
      },
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SPEC_NOT_READY');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('returns 409 + handler headers when github auth missing', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    mockCreateAuthenticatedClient.mockRejectedValue(
      new GitHubAppConfigError('Missing GITHUB_APP_ID')
    );

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'x-request-id': 'req-123',
      },
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_AUTH_MISSING');
    expect(Array.isArray(body.missingConfig)).toBe(true);
    expect(body.missingConfig).toContain('GITHUB_APP_ID');
    expect(body.missingConfig).toContain('GITHUB_APP_PRIVATE_KEY_PEM');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-123');
    expect(response.headers.get('x-afu9-auth-path')).toBe('unknown');
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('returns 500 + handler headers on unexpected throw', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    mockCreateS1S3Run.mockImplementation(() => {
      throw new Error('boom');
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('IMPLEMENT_FAILED');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
  });

  test('returns 409 when repo access is denied', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    mockCreateAuthenticatedClient.mockRejectedValue(
      Object.assign(new Error('Repo access denied'), { name: 'RepoAccessDeniedError' })
    );
    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-123',
        created_at: new Date().toISOString(),
      },
    });
    mockCreateS1S3RunStep.mockResolvedValue({
      success: true,
      data: { id: 'step-123' },
    });
    mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_AUTH_INVALID');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('returns 202 on success with headers', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-123',
        created_at: new Date().toISOString(),
      },
    });
    mockCreateS1S3RunStep.mockResolvedValue({
      success: true,
      data: { id: 'step-123' },
    });
    mockUpdateS1S3IssueStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.IMPLEMENTING,
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    (triggerAfu9Implementation as jest.Mock).mockResolvedValue({
      labelApplied: true,
      commentPosted: false,
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'x-request-id': 'req-202',
      },
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-202');
    expect(response.headers.get('x-afu9-auth-path')).toBe('app');
    expect(triggerAfu9Implementation).toHaveBeenCalled();
  });
});
