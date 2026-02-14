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
import { createAuthenticatedClient, __resetPolicyCache } from '../../src/lib/github/auth-wrapper';

const mockGetS1S3IssueById = jest.fn();
const mockUpsertS1S3Issue = jest.fn();
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
  upsertS1S3Issue: (...args: unknown[]) => mockUpsertS1S3Issue(...args),
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
    process.env.AFU9_GUARDRAILS_ENABLED = 'true';
    process.env.AFU9_GUARDRAILS_TOKEN_SCOPE = 'write';
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'org', repo: 'repo', branches: ['main'] }],
    });
    process.env.GITHUB_APP_ID = 'afu9-app';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'test-key';
    delete process.env.GITHUB_APP_SECRET_ID;
    delete process.env.GH_APP_ID;
    delete process.env.GH_APP_PRIVATE_KEY_PEM;
    delete process.env.GH_APP_SECRET_ID;
    __resetPolicyCache();

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

  afterEach(() => {
    __resetPolicyCache();
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
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('STATE');
    expect(body.nextAction).toBe('Complete and save S2 spec');
    expect(body.requestId).toBeTruthy();
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('STATE');
    expect(response.headers.get('x-afu9-error-code')).toBe('SPEC_NOT_READY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-missing-config')).toBe('');
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('returns 409 + handler headers when guardrail config missing', async () => {
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
    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '';
    process.env.GITHUB_APP_SECRET_ID = '';
    process.env.GH_APP_ID = '';
    process.env.GH_APP_PRIVATE_KEY_PEM = '';
    process.env.GH_APP_SECRET_ID = '';
    __resetPolicyCache();

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
    expect(body.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('CONFIG');
    expect(body.nextAction).toBe('Set required config in runtime');
    expect(body.requestId).toBe('req-123');
    expect(Array.isArray(body.missingConfig)).toBe(true);
    expect(body.missingConfig).toContain('GITHUB_APP_ID');
    expect(body.missingConfig).toContain('GITHUB_APP_PRIVATE_KEY_PEM');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-123');
    expect(response.headers.get('x-afu9-auth-path')).toBe('unknown');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('CONFIG');
    expect(response.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-afu9-missing-config')).toBe(
      'GITHUB_APP_ID,GITHUB_APP_PRIVATE_KEY_PEM,GITHUB_APP_SECRET_ID'
    );
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
    expect(body.code).toBe('INTERNAL_ERROR');
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

  test('resolves publicId (8-hex) to UUID and includes ID diagnostic headers on success', async () => {
    const publicId = '12abcdef';
    const uuid = '12abcdef-1234-5678-9abc-def123456789';
    
    // Mock resolveIssueIdentifierOr404 to return UUID from publicId
    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId: publicId,
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: { id: 'run-123', created_at: new Date().toISOString() },
    });
    mockCreateS1S3RunStep.mockResolvedValue({
      success: true,
      data: { id: 'step-123' },
    });
    mockUpdateS1S3IssueStatus.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: S1S3IssueStatus.IMPLEMENTING,
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    (triggerAfu9Implementation as jest.Mock).mockResolvedValue({
      labelApplied: true,
      commentPosted: false,
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${publicId}/implement`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'x-request-id': 'req-publicid' },
      }
    );
    const params = Promise.resolve({ id: publicId });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(mockResolveIssue).toHaveBeenCalledWith(publicId, 'req-publicid');
    // ID diagnostic headers should NOT appear on success
    // They are only added to error responses
    expect(response.headers.get('x-afu9-id-input')).toBeNull();
    expect(response.headers.get('x-afu9-id-kind')).toBeNull();
    expect(response.headers.get('x-afu9-id-resolved')).toBeNull();
    expect(response.headers.get('x-afu9-store')).toBeNull();
  });

  test('returns 404 with ID diagnostic headers when issue not found', async () => {
    const nonExistentId = 'deadbeef';
    
    mockResolveIssue.mockResolvedValue({
      ok: false,
      status: 404,
      body: {
        errorCode: 'issue_not_found',
        issueId: nonExistentId,
        lookupStore: 'control',
        requestId: 'req-404',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${nonExistentId}/implement`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'x-request-id': 'req-404' },
      }
    );
    const params = Promise.resolve({ id: nonExistentId });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe('ISSUE_NOT_FOUND');
    expect(body.stage).toBe('S3');
    expect(body.phase).toBe('preflight');
    expect(body.blockedBy).toBe('STATE');
    
    // Validate ID diagnostic headers
    expect(response.headers.get('x-afu9-id-input')).toBe(nonExistentId);
    expect(response.headers.get('x-afu9-id-kind')).toBe('publicId'); // 8-hex
    expect(response.headers.get('x-afu9-store')).toBe('control');
    expect(response.headers.get('x-afu9-id-resolved')).toBeNull(); // Not resolved on 404
    
    // Validate enhanced detailsSafe message
    expect(body.detailsSafe).toContain(nonExistentId);
    expect(body.detailsSafe).toContain('publicId');
    expect(body.detailsSafe).toContain('control');
    
    expect(mockGetS1S3IssueById).not.toHaveBeenCalled();
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('auto-creates S1S3 state from canonical issue and proceeds to next preflight gate', async () => {
    const canonicalId = 'aaaa1111';
    const canonicalUuid = 'aaaa1111-1111-4111-8111-aaaaaaaaaaaa';

    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '';
    process.env.GITHUB_APP_SECRET_ID = '';
    process.env.GH_APP_ID = '';
    process.env.GH_APP_PRIVATE_KEY_PEM = '';
    process.env.GH_APP_SECRET_ID = '';
    __resetPolicyCache();

    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid: canonicalUuid,
      shortId: canonicalId,
      source: 'control',
      issue: {
        id: canonicalUuid,
        status: 'SPEC_READY',
        github_repo: 'org/repo',
        github_issue_number: 42,
        github_url: 'https://github.com/org/repo/issues/42',
        assignee: 'afu9',
        canonical_id: 'I811',
      },
    });

    mockGetS1S3IssueById.mockResolvedValueOnce({
      success: false,
      error: 'Issue not found',
    });

    mockUpsertS1S3Issue.mockResolvedValue({
      success: true,
      data: {
        id: 's1s3-seeded-1',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${canonicalId}/implement`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'x-request-id': 'req-seed' },
      }
    );
    const params = Promise.resolve({ id: canonicalId });
    const response = await implementIssue(request, { params });
    const body = (await response.json()) as Record<string, unknown>;

    expect(mockUpsertS1S3Issue).toHaveBeenCalledTimes(1);
    expect(mockUpsertS1S3Issue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        github_issue_url: 'https://github.com/org/repo/issues/42',
        status: S1S3IssueStatus.SPEC_READY,
      })
    );

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(body.blockedBy).toBe('CONFIG');
    expect(body.phase).toBe('preflight');
    expect(body.code).not.toBe('ISSUE_NOT_FOUND');

    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-blocked-by')).toBe('CONFIG');
    expect(response.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-seed');
    expect(response.headers.get('x-afu9-control-build')).toBeDefined();

    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });
});
