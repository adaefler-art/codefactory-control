/**
 * S3 Implement Route Contract Tests
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { POST as implementIssue } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { S1S3IssueStatus } from '../../src/lib/contracts/s1s3Flow';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';
import { assignAfu9Copilot, triggerAfu9Implementation } from '../../src/lib/github/issue-sync';
import { createAuthenticatedClient, __resetPolicyCache } from '../../src/lib/github/auth-wrapper';

const mockGetS1S3IssueById = jest.fn();
const mockGetS1S3IssueByCanonicalId = jest.fn();
const mockGetS1S3IssueByGitHub = jest.fn();
const mockListS1S3RunsByIssue = jest.fn();
const mockListS1S3RunSteps = jest.fn();
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
  getS1S3IssueByCanonicalId: (...args: unknown[]) => mockGetS1S3IssueByCanonicalId(...args),
  getS1S3IssueByGitHub: (...args: unknown[]) => mockGetS1S3IssueByGitHub(...args),
  listS1S3RunsByIssue: (...args: unknown[]) => mockListS1S3RunsByIssue(...args),
  listS1S3RunSteps: (...args: unknown[]) => mockListS1S3RunSteps(...args),
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
  assignAfu9Copilot: jest.fn(),
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
    mockGetS1S3IssueByCanonicalId.mockResolvedValue({
      success: false,
      error: 'Issue not found',
    });
    mockGetS1S3IssueByGitHub.mockResolvedValue({
      success: false,
      error: 'Issue not found',
    });
    mockListS1S3RunsByIssue.mockResolvedValue({ success: true, data: [] });
    mockListS1S3RunSteps.mockResolvedValue({ success: true, data: [] });
    (assignAfu9Copilot as jest.Mock).mockResolvedValue({
      assigned: true,
      assignee: 'copilot-swe-agent',
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
    expect(assignAfu9Copilot).toHaveBeenCalled();
  });

  test('persists IMPLEMENTING status after successful trigger', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-persist-1',
        created_at: new Date().toISOString(),
      },
    });

    mockCreateS1S3RunStep.mockResolvedValue({
      success: true,
      data: { id: 'step-persist-1' },
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
      commentPosted: true,
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-persist-1' },
    });

    const response = await implementIssue(request, { params: Promise.resolve({ id: 'issue-123' }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.issue.status).toBe('IMPLEMENTING');
    expect(mockUpdateS1S3IssueStatus).toHaveBeenCalledWith(
      expect.anything(),
      'issue-123',
      S1S3IssueStatus.IMPLEMENTING
    );
    expect(body.runId).toBe('run-persist-1');
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

  test('regression: once status becomes SPEC_READY, S3 no longer returns SPEC_NOT_READY', async () => {
    const issueId = 'issue-flow-1';
    let currentStatus: S1S3IssueStatus = S1S3IssueStatus.CREATED;

    mockGetS1S3IssueById.mockImplementation(async () => ({
      success: true,
      data: {
        id: issueId,
        status: currentStatus,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
        acceptance_criteria: ['AC1'],
        spec_ready_at: currentStatus === S1S3IssueStatus.CREATED ? null : new Date().toISOString(),
      },
    }));

    const firstRequest = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/implement`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'x-request-id': 'req-flow-1' },
      }
    );

    const firstResponse = await implementIssue(firstRequest, { params: Promise.resolve({ id: issueId }) });
    const firstBody = await firstResponse.json();

    expect(firstResponse.status).toBe(409);
    expect(firstBody.code).toBe('SPEC_NOT_READY');

    currentStatus = S1S3IssueStatus.SPEC_READY;
    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '';
    process.env.GITHUB_APP_SECRET_ID = '';
    process.env.GH_APP_ID = '';
    process.env.GH_APP_PRIVATE_KEY_PEM = '';
    process.env.GH_APP_SECRET_ID = '';
    __resetPolicyCache();

    const secondRequest = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${issueId}/implement`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'x-request-id': 'req-flow-2' },
      }
    );

    const secondResponse = await implementIssue(secondRequest, { params: Promise.resolve({ id: issueId }) });
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(409);
    expect(secondBody.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(secondBody.code).not.toBe('SPEC_NOT_READY');
    expect(secondResponse.headers.get('x-afu9-error-code')).toBe('GUARDRAIL_CONFIG_MISSING');
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

  test('regression: existing s1s3 row from github mirror is reused and not downgraded to SPEC_NOT_READY', async () => {
    const canonicalUuid = 'bbbb1111-1111-4111-8111-bbbbbbbbbbbb';

    process.env.GITHUB_APP_ID = '';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '';
    process.env.GITHUB_APP_SECRET_ID = '';
    process.env.GH_APP_ID = '';
    process.env.GH_APP_PRIVATE_KEY_PEM = '';
    process.env.GH_APP_SECRET_ID = '';
    __resetPolicyCache();

    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: canonicalUuid,
      source: 'control',
      issue: {
        id: canonicalUuid,
        status: 'CREATED',
        github_repo: 'org/repo',
        github_issue_number: 42,
        github_url: 'https://github.com/org/repo/issues/42',
        assignee: 'afu9',
        canonical_id: 'I900',
      },
    });

    mockGetS1S3IssueById.mockResolvedValueOnce({
      success: false,
      error: 'Issue not found',
    });

    mockGetS1S3IssueByCanonicalId.mockResolvedValueOnce({
      success: false,
      error: 'Issue not found',
    });

    mockGetS1S3IssueByGitHub.mockResolvedValueOnce({
      success: true,
      data: {
        id: 's1s3-existing-1',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s3/issues/${canonicalUuid}/implement`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'x-request-id': 'req-reuse' },
      }
    );

    const response = await implementIssue(request, { params: Promise.resolve({ id: canonicalUuid }) });
    const body = await response.json();

    expect(mockGetS1S3IssueByGitHub).toHaveBeenCalledWith(expect.anything(), 'org/repo', 42);
    expect(mockUpsertS1S3Issue).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(body.code).not.toBe('SPEC_NOT_READY');
  });

  test('uses request trigger label/comment when env config is missing', async () => {
    process.env.AFU9_GITHUB_IMPLEMENT_LABEL = '';
    process.env.AFU9_GITHUB_IMPLEMENT_COMMENT = '';

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
      commentPosted: true,
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({
        triggerLabel: 'afu9:implement',
        triggerComment: 'Please implement this issue.',
      }),
      headers: {
        'x-request-id': 'req-trigger-fallback',
      },
    });

    const response = await implementIssue(request, { params: Promise.resolve({ id: 'issue-123' }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(triggerAfu9Implementation).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'afu9:implement',
        comment: 'Please implement this issue.',
      })
    );
  });

  test('S3 implement is idempotent and does not re-post comment', async () => {
    const canonicalUuid = '234fcabf-1215-4c0f-915b-c32a84332360';
    const issueState = {
      id: 'issue-123',
      status: S1S3IssueStatus.IMPLEMENTING,
      repo_full_name: 'org/repo',
      github_issue_number: 42,
      owner: 'afu9',
      github_issue_url: 'https://github.com/org/repo/issues/42',
      canonical_id: canonicalUuid,
      problem: 'p',
      scope: 's',
      acceptance_criteria: ['AC1'],
      notes: 'n',
    };

    const specHash = createHash('sha256')
      .update(
        JSON.stringify({
          problem: 'p',
          scope: 's',
          acceptanceCriteria: ['AC1'],
          notes: 'n',
        })
      )
      .digest('hex');
    const idempotencyKey = `${canonicalUuid}:implement:${specHash}:`;

    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: canonicalUuid,
      source: 'control',
      issue: {
        id: canonicalUuid,
      },
    });

    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: issueState });
    mockListS1S3RunsByIssue.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'run-existing-1',
          type: 'S3_IMPLEMENT',
          issue_id: 'issue-123',
          request_id: 'req-existing',
          actor: 'afu9',
          status: 'DONE',
          created_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        },
      ],
    });
    mockListS1S3RunSteps.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'step-match',
          run_id: 'run-existing-1',
          step_id: 'S3',
          step_name: 'Trigger GitHub Implementation',
          status: 'SUCCEEDED',
          evidence_refs: {
            idempotency_key: idempotencyKey,
            label_applied: true,
            comment_posted: true,
          },
        },
        {
          id: 'step-assign',
          run_id: 'run-existing-1',
          step_id: 'S3_ASSIGN_COPILOT',
          step_name: 'Assign to Copilot',
          status: 'SUCCEEDED',
          evidence_refs: {
            idempotency_key: idempotencyKey,
            copilot_assigned: true,
          },
        },
      ],
    });

    const request = new NextRequest(`http://localhost/api/afu9/s1s3/issues/${canonicalUuid}/implement`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-idempotent-1' },
    });

    const response = await implementIssue(request, { params: Promise.resolve({ id: canonicalUuid }) });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.runId).toBe('run-existing-1');
    expect(body.idempotent).toBe(true);
    expect(body.githubTrigger.status).toBe('ALREADY_TRIGGERED');
    expect(triggerAfu9Implementation).not.toHaveBeenCalled();
  });

  test('assign-to-copilot step recorded', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockCreateS1S3Run.mockResolvedValue({
      success: true,
      data: {
        id: 'run-assign-1',
        created_at: new Date().toISOString(),
      },
    });

    mockCreateS1S3RunStep.mockResolvedValue({
      success: true,
      data: { id: 'step-any' },
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
      commentPosted: true,
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'x-request-id': 'req-assign-1' },
    });

    const response = await implementIssue(request, { params: Promise.resolve({ id: 'issue-123' }) });
    await response.json();

    expect(response.status).toBe(202);
    expect(mockCreateS1S3RunStep).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        step_id: 'S3_ASSIGN_COPILOT',
        status: 'SUCCEEDED',
      })
    );
  });
});
