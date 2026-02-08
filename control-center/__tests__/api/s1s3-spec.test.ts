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
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssueSpec,
} from '../../src/lib/db/s1s3Flow';

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
  const mockCreateS1S3Run = createS1S3Run as jest.Mock;
  const mockCreateS1S3RunStep = createS1S3RunStep as jest.Mock;
  const mockUpdateS1S3RunStatus = updateS1S3RunStatus as jest.Mock;
  const mockUpdateS1S3IssueSpec = updateS1S3IssueSpec as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
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
      },
    });

    mockCreateS1S3RunStep.mockResolvedValue({
      success: true,
      data: {
        id: 'step-1',
      },
    });

    mockUpdateS1S3IssueSpec.mockResolvedValue({
      success: true,
      data: {
        id: issueId,
        status: 'SPEC_READY',
        spec_ready_at: '2024-01-01T00:00:00Z',
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

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
    expect(response.headers.get('x-afu9-handler')).toBe('control.s1s3.spec');
    expect(response.headers.get('x-afu9-error-code')).toBeNull();
    expect(body.ok).toBe(true);
    expect(body.issueId).toBe(issueId);
    expect(body.s2?.status).toBe('READY');
    expect(body.workflow?.current).toBe('S3');
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

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('spec_invalid_payload');
    expect(body.errorCode).toBe('spec_invalid_payload');
    expect(response.headers.get('x-afu9-error-code')).toBe('spec_invalid_payload');
  });

  it('returns 502 with spec_upstream_failed on downstream errors', async () => {
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

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('spec_upstream_failed');
    expect(body.errorCode).toBe('spec_upstream_failed');
    expect(response.headers.get('x-afu9-error-code')).toBe('spec_upstream_failed');
  });

  it('returns spec_ready_failed on unexpected handler errors', async () => {
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
    expect(body.code).toBe('spec_ready_failed');
    expect(body.errorCode).toBe('spec_ready_failed');
    expect(response.headers.get('x-afu9-error-code')).toBe('spec_ready_failed');
  });
});
