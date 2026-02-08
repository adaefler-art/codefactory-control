/**
 * Tests for GET /api/afu9/s1s9/issues/[id] partial aggregation
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssue } from '../../app/api/afu9/s1s9/issues/[id]/route';
import { resolveIssueIdentifierOr404, normalizeIssueForApi } from '../../app/api/issues/_shared';
import { getS1S3IssueById, listS1S3RunsByIssue } from '../../src/lib/db/s1s3Flow';

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
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockListS1S3RunsByIssue = listS1S3RunsByIssue as jest.Mock;
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
    expect(response.headers.get('x-afu9-partial')).toBe('true');
    expect(body.ok).toBe(true);
    expect(body.partial).toBe(true);
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
      errorCode: 'issue_not_found',
      issueId,
      lookupStore: 'control',
      requestId: 'req-404',
    });
  });
});
