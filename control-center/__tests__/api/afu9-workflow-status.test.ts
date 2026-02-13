/**
 * AFU-9 Workflow Status Tests
 *
 * @jest-environment node
 */

import { GET as getWorkflowStatus } from '../../app/api/afu9/issues/[id]/workflow-status/route';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';
import {
  getS1S3IssueById,
  getS1S3IssueByGitHub,
  getS1S3IssueByCanonicalId,
  listS1S3RunsByIssue,
} from '../../src/lib/db/s1s3Flow';
import { S1S3RunStatus } from '../../src/lib/contracts/s1s3Flow';

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('@/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: jest.fn(),
  getS1S3IssueByGitHub: jest.fn(),
  getS1S3IssueByCanonicalId: jest.fn(),
  listS1S3RunsByIssue: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('GET /api/afu9/issues/[id]/workflow-status', () => {
  const mockResolveIssue = resolveIssueIdentifierOr404 as jest.Mock;
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockGetS1S3IssueByGitHub = getS1S3IssueByGitHub as jest.Mock;
  const mockGetS1S3IssueByCanonicalId = getS1S3IssueByCanonicalId as jest.Mock;
  const mockListS1S3RunsByIssue = listS1S3RunsByIssue as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns workflow status with headers and guardrails summary', async () => {
    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: 'issue-123',
      issue: {
        id: 'issue-123',
        status: 'SPEC_READY',
        github_repo: 'octo/repo',
        github_issue_number: 42,
        canonical_id: 'I-42',
      },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({ success: false, error: 'Issue not found' });
    mockGetS1S3IssueByGitHub.mockResolvedValue({
      success: true,
      data: {
        id: 's1s3-1',
        status: 'SPEC_READY',
      },
    });
    mockGetS1S3IssueByCanonicalId.mockResolvedValue({ success: false, error: 'Issue not found' });

    mockListS1S3RunsByIssue.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'run-1',
          type: 'S2_SPEC_READY',
          issue_id: 's1s3-1',
          request_id: 'req-1',
          actor: 'afu9',
          status: S1S3RunStatus.DONE,
          error_message: null,
          created_at: new Date(),
          started_at: null,
          completed_at: null,
        },
      ],
    });

    const request = new Request('http://localhost/api/afu9/issues/issue-123/workflow-status', {
      method: 'GET',
      headers: {
        'x-request-id': 'req-123',
      },
    }) as unknown as Parameters<typeof getWorkflowStatus>[0];

    const response = await getWorkflowStatus(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.issueId).toBe('issue-123');
    expect(body.stage).toBe('S3');
    expect(body.status).toBe('SPEC_READY');
    expect(body.guardrails?.summary).toEqual({
      critical: expect.any(Number),
      warn: expect.any(Number),
      info: expect.any(Number),
    });
    expect(Array.isArray(body.guardrails?.topFindings)).toBe(true);
    expect(response.headers.get('x-afu9-request-id')).toBe('req-123');
    expect(response.headers.get('x-afu9-handler')).toBe('workflow.status');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('returns 404 when issue is missing', async () => {
    mockResolveIssue.mockResolvedValue({
      ok: false,
      status: 404,
      body: {
        errorCode: 'issue_not_found',
      },
    });

    const request = new Request('http://localhost/api/afu9/issues/missing/workflow-status', {
      method: 'GET',
      headers: {
        'x-request-id': 'req-missing',
      },
    }) as unknown as Parameters<typeof getWorkflowStatus>[0];

    const response = await getWorkflowStatus(request, {
      params: Promise.resolve({ id: 'missing' }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('ISSUE_NOT_FOUND');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-missing');
    expect(response.headers.get('x-afu9-handler')).toBe('workflow.status');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
