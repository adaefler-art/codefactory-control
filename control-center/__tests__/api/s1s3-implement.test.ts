/**
 * S1-S3 Implement API Tests
 *
 * Tests for POST /api/afu9/s1s3/issues/[id]/implement endpoint:
 * - Reuses existing PR when found
 * - Creates PR when none exists
 * - Handles PR exists error with reconcile
 * - Returns conflict when PR exists but not found
 *
 * @jest-environment node
 */

import { POST as implementIssue } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { S1S3IssueStatus } from '../../src/lib/contracts/s1s3Flow';
import { createAuthenticatedClient } from '../../src/lib/github/auth-wrapper';
import {
  getS1S3IssueById,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssuePR,
} from '../../src/lib/db/s1s3Flow';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock GitHub auth wrapper
jest.mock('../../src/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
}));

// Mock S1S3 DAO functions
jest.mock('../../src/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: jest.fn(),
  createS1S3Run: jest.fn(),
  createS1S3RunStep: jest.fn(),
  updateS1S3RunStatus: jest.fn(),
  updateS1S3IssuePR: jest.fn(),
}));

describe('POST /api/afu9/s1s3/issues/[id]/implement', () => {
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockCreateS1S3Run = createS1S3Run as jest.Mock;
  const mockCreateS1S3RunStep = createS1S3RunStep as jest.Mock;
  const mockUpdateS1S3RunStatus = updateS1S3RunStatus as jest.Mock;
  const mockUpdateS1S3IssuePR = updateS1S3IssuePR as jest.Mock;
  const mockCreateAuthenticatedClient = createAuthenticatedClient as jest.Mock;

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

  const setupOctokitMock = () => {
    return {
      rest: {
        git: {
          getRef: jest.fn(),
          createRef: jest.fn(),
        },
        pulls: {
          create: jest.fn(),
          list: jest.fn(),
        },
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reuses existing PR when found', async () => {
    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockRejectedValue({ status: 422, message: 'Reference already exists' });
    octokit.rest.pulls.list.mockResolvedValueOnce({
      data: [
        {
          number: 916,
          html_url: 'https://github.com/owner/repo/pull/916',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ],
    });

    mockCreateAuthenticatedClient.mockResolvedValue(octokit);
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-1' } });
    mockUpdateS1S3IssuePR.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 916,
        pr_url: 'https://github.com/owner/repo/pull/916',
        branch_name: 'afu9/issue-42-abc123',
      },
    });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pr.number).toBe(916);
    expect(body.message).toBe('PR already exists (idempotent)');
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
  });

  test('creates PR when none exists', async () => {
    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockResolvedValue({});
    octokit.rest.pulls.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });
    octokit.rest.pulls.create.mockResolvedValue({
      data: {
        number: 101,
        html_url: 'https://github.com/owner/repo/pull/101',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    });

    mockCreateAuthenticatedClient.mockResolvedValue(octokit);
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-2' } });
    mockUpdateS1S3IssuePR.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 101,
        pr_url: 'https://github.com/owner/repo/pull/101',
        branch_name: 'afu9/issue-42-abc123',
      },
    });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.pr.number).toBe(101);
    expect(octokit.rest.pulls.create).toHaveBeenCalled();
  });

  test('handles PR exists error from create', async () => {
    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockResolvedValue({});
    octokit.rest.pulls.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            number: 916,
            html_url: 'https://github.com/owner/repo/pull/916',
            created_at: '2025-01-02T00:00:00Z',
            updated_at: '2025-01-03T00:00:00Z',
          },
        ],
      });
    octokit.rest.pulls.create.mockRejectedValue({ status: 422, message: 'Validation Failed: A pull request already exists for owner:branch.' });

    mockCreateAuthenticatedClient.mockResolvedValue(octokit);
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-3' } });
    mockUpdateS1S3IssuePR.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 916,
        pr_url: 'https://github.com/owner/repo/pull/916',
        branch_name: 'afu9/issue-42-abc123',
      },
    });

    const request = new Request('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    }) as unknown as Parameters<typeof implementIssue>[0];

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pr.number).toBe(916);
    expect(body.message).toBe('PR already exists (idempotent)');
  });

  test('PR exists but not found returns conflict', async () => {
    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockResolvedValue({});
    octokit.rest.pulls.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] });
    octokit.rest.pulls.create.mockRejectedValue({ status: 422, message: 'Validation Failed: A pull request already exists for owner:branch.' });

    mockCreateAuthenticatedClient.mockResolvedValue(octokit);
    mockGetS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-4' } });
    mockUpdateS1S3RunStatus.mockResolvedValue({ success: true, data: mockRun });

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
    expect(body.code).toBe('S3_PR_EXISTS_BUT_NOT_FOUND');
  });
});
