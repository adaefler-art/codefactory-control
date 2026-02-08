/**
 * Tests for GET /api/afu9/s1s9/issues/[id] partial aggregation
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssue } from '../../app/api/afu9/s1s9/issues/[id]/route';
import { resolveIssueIdentifierOr404, normalizeIssueForApi } from '../../app/api/issues/_shared';
import { getAfu9IssueByCanonicalId } from '../../src/lib/db/afu9Issues';
import { getS1S3IssueById, listS1S3RunsByIssue } from '../../src/lib/db/s1s3Flow';
import { computeStateFlow, getBlockersForDone } from '../../src/lib/state-flow';

jest.mock('../../app/api/afu9/s1s3/issues/[id]/route', () => ({
  GET: jest.fn(),
}));

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: jest.fn(),
  getS1S3IssueByCanonicalId: jest.fn(),
  listS1S3RunsByIssue: jest.fn(),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  getAfu9IssueByCanonicalId: jest.fn(),
}));

jest.mock('../../src/lib/state-flow', () => ({
  computeStateFlow: jest.fn(() => {
    throw new Error('boom');
  }),
  getBlockersForDone: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
    normalizeIssueForApi: jest.fn(),
  };
});

describe('GET /api/afu9/s1s9/issues/[id] partial aggregation', () => {
  const mockResolveIssueIdentifierOr404 = resolveIssueIdentifierOr404 as jest.Mock;
  const mockNormalizeIssueForApi = normalizeIssueForApi as jest.Mock;
  const mockGetAfu9IssueByCanonicalId = getAfu9IssueByCanonicalId as jest.Mock;
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockListS1S3RunsByIssue = listS1S3RunsByIssue as jest.Mock;
  const mockComputeStateFlow = computeStateFlow as jest.Mock;
  const mockGetBlockersForDone = getBlockersForDone as jest.Mock;
  const actualIssueShared = jest.requireActual('../../app/api/issues/_shared');
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;
    delete process.env.MCP_RUNNER_URL;
    delete process.env.MCP_RUNNER_ENDPOINT;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GITHUB_APP_SECRET_ID;
    delete process.env.AFU9_STAGE_S3_ENABLED;
    mockNormalizeIssueForApi.mockImplementation(actualIssueShared.normalizeIssueForApi);
    mockComputeStateFlow.mockImplementation(() => {
      throw new Error('boom');
    });
    mockGetBlockersForDone.mockReturnValue([]);
    mockGetAfu9IssueByCanonicalId.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns 200 with partial data when runs/state-flow fail', async () => {
    const shortId = '234fcabf';
    const uuid = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        title: 'Core issue',
        status: 'CREATED',
        execution_state: 'RUNNING',
        handoff_state: null,
        github_issue_number: 42,
        github_url: 'https://github.com/octo/repo/issues/42',
      },
      source: 'control',
    });

    mockNormalizeIssueForApi.mockReturnValue({
      id: uuid,
      status: 'CREATED',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: 'SPEC_READY',
        scope: 'scope',
        acceptance_criteria: [],
        spec_ready_at: '2024-01-01T00:00:00Z',
      },
    });

    mockListS1S3RunsByIssue.mockResolvedValue({
      success: false,
      error: 'db down',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-partial' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.stateQuality).toBe('partial');
    expect(body.s2.status).toBe('SPEC_READY');
    expect(body.runs).toMatchObject({
      status: 'UNAVAILABLE',
      code: 'RUNS_UNAVAILABLE',
      requestId: 'req-partial',
    });
    expect(body.stateFlow).toMatchObject({
      status: 'UNAVAILABLE',
      code: 'STATE_FLOW_UNAVAILABLE',
      requestId: 'req-partial',
    });
    expect(body.execution).toMatchObject({
      status: 'DISABLED',
      code: 'DISPATCH_DISABLED',
      requestId: 'req-partial',
    });
    expect(body.execution.requiredConfig).toEqual(
      expect.arrayContaining(['AFU9_GITHUB_EVENTS_QUEUE_URL'])
    );
  });

  it('returns 404 when mandatory issue lookup fails', async () => {
    const issueId = 'ISS-404';

    mockGetAfu9IssueByCanonicalId.mockResolvedValue({
      success: false,
      error: `Issue not found with canonical ID: ${issueId}`,
    });

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: false,
      status: 404,
      body: {
        errorCode: 'issue_not_found',
        issueId,
        lookupStore: 'control',
        requestId: 'req-404',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-404' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      errorCode: 'NOT_FOUND',
      id: issueId,
      requestId: 'req-404',
    });
  });

  it('normalizes legacy record with githubUrl and missing title', async () => {
    const shortId = '234fcabf';
    const uuid = '234fcabf-1234-4abc-9def-1234567890ab';

    process.env.AFU9_GITHUB_EVENTS_QUEUE_URL = 'https://example.com/queue';
    process.env.MCP_RUNNER_URL = 'https://example.com/runner';
    process.env.MCP_RUNNER_ENDPOINT = 'https://example.com/runner';
    process.env.GITHUB_APP_ID = '123';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '---KEY---';
    process.env.GITHUB_APP_SECRET_ID = 'secret';
    process.env.AFU9_STAGE_S3_ENABLED = '1';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        status: 'CREATED',
        github_url: 'https://github.com/octo/repo/issues/7',
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: 'CREATED',
        scope: null,
        acceptance_criteria: [],
        spec_ready_at: null,
      },
    });

    mockListS1S3RunsByIssue.mockResolvedValue({
      success: true,
      data: [],
    });

    mockComputeStateFlow.mockReturnValue({});
    mockGetBlockersForDone.mockReturnValue([]);

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-legacy-1' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stateQuality).toBe('partial');
    expect(body.title).toBe(`Issue ${shortId}`);
    expect(body.githubUrl).toBe('https://github.com/octo/repo/issues/7');
    expect(body.githubRepo).toBe('octo/repo');
    expect(body.githubIssueNumber).toBe(7);
    expect(body.workflow.completed).toContain('S1');
  });

  it('fills github url from repo and issue number', async () => {
    const shortId = '1234abcd';
    const uuid = '1234abcd-1234-4abc-9def-1234567890ab';

    process.env.AFU9_GITHUB_EVENTS_QUEUE_URL = 'https://example.com/queue';
    process.env.MCP_RUNNER_URL = 'https://example.com/runner';
    process.env.MCP_RUNNER_ENDPOINT = 'https://example.com/runner';
    process.env.GITHUB_APP_ID = '123';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '---KEY---';
    process.env.GITHUB_APP_SECRET_ID = 'secret';
    process.env.AFU9_STAGE_S3_ENABLED = '1';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        title: 'Legacy repo fields',
        github_repo: 'octo/repo',
        github_issue_number: 55,
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: 'CREATED',
        scope: null,
        acceptance_criteria: [],
        spec_ready_at: null,
      },
    });

    mockListS1S3RunsByIssue.mockResolvedValue({
      success: true,
      data: [],
    });

    mockComputeStateFlow.mockReturnValue({});
    mockGetBlockersForDone.mockReturnValue([]);

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-legacy-2' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stateQuality).toBe('partial');
    expect(body.githubUrl).toBe('https://github.com/octo/repo/issues/55');
    expect(body.githubRepo).toBe('octo/repo');
    expect(body.githubIssueNumber).toBe(55);
    expect(body.workflow.completed).toContain('S1');
  });

  it('uses legacy title field when title is missing', async () => {
    const shortId = '9abc3210';
    const uuid = '9abc3210-1234-4abc-9def-1234567890ab';

    process.env.AFU9_GITHUB_EVENTS_QUEUE_URL = 'https://example.com/queue';
    process.env.MCP_RUNNER_URL = 'https://example.com/runner';
    process.env.MCP_RUNNER_ENDPOINT = 'https://example.com/runner';
    process.env.GITHUB_APP_ID = '123';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = '---KEY---';
    process.env.GITHUB_APP_SECRET_ID = 'secret';
    process.env.AFU9_STAGE_S3_ENABLED = '1';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        issueTitle: 'Legacy title field',
        github_repo: 'octo/repo',
        github_issue_number: 88,
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: 'CREATED',
        scope: null,
        acceptance_criteria: [],
        spec_ready_at: null,
      },
    });

    mockListS1S3RunsByIssue.mockResolvedValue({
      success: true,
      data: [],
    });

    mockComputeStateFlow.mockReturnValue({});
    mockGetBlockersForDone.mockReturnValue([]);

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-legacy-3' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stateQuality).toBe('partial');
    expect(body.title).toBe('Legacy title field');
  });

  it('partial_state_sets_stateQuality_partial', async () => {
    const shortId = 'a1b2c3d4';
    const uuid = 'a1b2c3d4-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        github_url: 'https://github.com/octo/repo/issues/7',
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        status: 'CREATED',
        scope: null,
        acceptance_criteria: [],
        spec_ready_at: null,
      },
    });

    mockListS1S3RunsByIssue.mockResolvedValue({
      success: true,
      data: [],
    });

    mockComputeStateFlow.mockReturnValue({});
    mockGetBlockersForDone.mockReturnValue([]);

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-partial-2' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stateQuality).toBe('partial');
  });

  it('github_url_marks_s1_complete_and_next_is_s2', async () => {
    const shortId = 'b1c2d3e4';
    const uuid = 'b1c2d3e4-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        title: 'Has mirror',
        github_url: 'https://github.com/octo/repo/issues/9',
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: false,
      error: 'missing',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-s1-1' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.completed).toContain('S1');
    expect(body.workflow.current).toBe('S2');
  });

  it('repo_and_issueNumber_marks_s1_complete_and_next_is_s2', async () => {
    const shortId = 'c1d2e3f4';
    const uuid = 'c1d2e3f4-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        title: 'Repo mirror',
        github_repo: 'octo/repo',
        github_issue_number: 11,
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: false,
      error: 'missing',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-s1-2' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.completed).toContain('S1');
    expect(body.workflow.current).toBe('S2');
  });

  it('nextStep_is_s2_even_when_s2_sync_blocked', async () => {
    const shortId = 'd1e2f3a4';
    const uuid = 'd1e2f3a4-1234-4abc-9def-1234567890ab';

    delete process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        title: 'Mirror present',
        github_url: 'https://github.com/octo/repo/issues/9',
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: false,
      error: 'missing',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-s1-3' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workflow.nextStep).toBe('S2');
  });

  it('stages_include_s2_actions_with_sync_blocked_when_missing_queue', async () => {
    const shortId = 'e1f2a3b4';
    const uuid = 'e1f2a3b4-1234-4abc-9def-1234567890ab';

    delete process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: {
        id: uuid,
        title: 'Mirror present',
        github_url: 'https://github.com/octo/repo/issues/9',
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: false,
      error: 'missing',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-s1-4' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    const body = await response.json();
    const s2Stage = body.stages.find((stage: { stageId?: string }) => stage.stageId === 'S2');

    expect(response.status).toBe(200);
    expect(s2Stage).toBeTruthy();
    expect(s2Stage.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: 'edit', state: 'ready' }),
        expect.objectContaining({ actionId: 'save', state: 'ready' }),
        expect.objectContaining({
          actionId: 'sync',
          state: 'blocked',
          blockedReason: 'MISSING_QUEUE_URL',
        }),
      ])
    );
  });

  it('returns 500 with DB_READ_FAILED when lookup throws', async () => {
    const issueId = 'ISS-500';
    mockResolveIssueIdentifierOr404.mockRejectedValue(new Error('db down'));
    mockGetAfu9IssueByCanonicalId.mockResolvedValue({
      success: false,
      error: 'Database operation failed',
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-db-1' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: issueId }),
    });

    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      errorCode: 'DB_READ_FAILED',
      requestId: 'req-db-1',
    });
  });
});
