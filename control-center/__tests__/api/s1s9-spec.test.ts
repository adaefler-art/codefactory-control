/**
 * Tests for POST /api/afu9/s1s9/issues/[id]/spec
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as postSpec } from '../../app/api/afu9/s1s9/issues/[id]/spec/route';
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

describe('POST /api/afu9/s1s9/issues/[id]/spec', () => {
  const mockResolveIssueIdentifierOr404 = resolveIssueIdentifierOr404 as jest.Mock;
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockCreateS1S3Run = createS1S3Run as jest.Mock;
  const mockCreateS1S3RunStep = createS1S3RunStep as jest.Mock;
  const mockUpdateS1S3RunStatus = updateS1S3RunStatus as jest.Mock;
  const mockUpdateS1S3IssueSpec = updateS1S3IssueSpec as jest.Mock;
  const originalEnv = { ...process.env };

  const setBackendReady = () => {
    process.env.AFU9_GITHUB_EVENTS_QUEUE_URL = 'https://queue.local/afu9';
    process.env.GITHUB_APP_ID = 'afu9-app';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'test-key';
  };

  const setBackendMissingQueue = () => {
    delete process.env.AFU9_GITHUB_EVENTS_QUEUE_URL;
    process.env.GITHUB_APP_ID = 'afu9-app';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'test-key';
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    setBackendReady();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('spec_saves_and_returns_200_when_backend_missing_with_blocked_run_step', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';
    setBackendMissingQueue();

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
          error_message: 'Execution backend not configured (AFU9_GITHUB_EVENTS_QUEUE_URL)',
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

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-1',
        status: 'FAILED',
        error_message: 'Execution backend not configured (AFU9_GITHUB_EVENTS_QUEUE_URL)',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}/spec`,
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
    expect(response.headers.get('x-afu9-handler')).toBe('s1s9-spec');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
    expect(response.headers.get('x-cf-handler')).toBe('s1s9-spec');
    expect(response.headers.get('x-cf-trace')).toBe('req-blocked');
    expect(response.headers.get('x-afu9-scope-requested')).toBe('s1s9');
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s9');
    expect(body.ok).toBe(true);
    expect(body.run?.status).toBe('BLOCKED');
    expect(body.run?.blockedReason).toBe('MISSING_QUEUE_URL');
    expect(body.step?.status).toBe('BLOCKED');
    expect(body.step?.step_name).toBe('sync-to-github');
    expect(body.step?.blockedReason).toBe('MISSING_QUEUE_URL');
    expect(body.workflow?.current).toBe('S2');
  });

  it('spec_returns_normal_run_step_when_backend_available', async () => {
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
        id: 'run-2',
        status: 'RUNNING',
      },
    });

    mockCreateS1S3RunStep
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-start-2',
          status: 'STARTED',
          step_name: 'Spec Ready',
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'step-spec-2',
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
        github_issue_url: 'https://github.com/octo/repo/issues/42',
        acceptance_criteria: ['AC1'],
      },
    });

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-2',
        status: 'DONE',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}/spec`,
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
    expect(response.headers.get('x-afu9-scope-requested')).toBe('s1s9');
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s9');
    expect(body.ok).toBe(true);
    expect(body.run?.status).toBe('DONE');
    expect(body.step?.status).toBe('SUCCEEDED');
    expect(body.workflow?.current).toBe('S2');
  });

  it('s1s9_spec_returns_200_blocked_when_queue_missing_even_if_lookup_fails', async () => {
    const issueId = '234fcabf-1234-4abc-9def-1234567890ab';
    setBackendMissingQueue();

    mockGetS1S9Issue.mockRejectedValueOnce(new Error('lookup failed'));

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
        id: 'run-lookup-fail',
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
          error_message: 'Execution backend not configured (AFU9_GITHUB_EVENTS_QUEUE_URL)',
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

    mockUpdateS1S3RunStatus.mockResolvedValue({
      success: true,
      data: {
        id: 'run-lookup-fail',
        status: 'FAILED',
        error_message: 'Execution backend not configured (AFU9_GITHUB_EVENTS_QUEUE_URL)',
      },
    });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}/spec`,
      {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-blocked-lookup',
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
    expect(response.headers.get('x-afu9-handler')).toBe('s1s9-spec');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-afu9-commit')).toBeTruthy();
    expect(body.ok).toBe(true);
    expect(body.run?.status).toBe('BLOCKED');
    expect(body.run?.blockedReason).toBe('MISSING_QUEUE_URL');
    expect(body.step?.status).toBe('BLOCKED');
    expect(body.step?.blockedReason).toBe('MISSING_QUEUE_URL');
    expect(body.workflow?.current).toBe('S2');
  });
});
