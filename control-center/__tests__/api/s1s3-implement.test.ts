/**
 * S1-S3 Implement API Tests
 * 
 * Tests for POST /api/afu9/s1s3/issues/[id]/implement endpoint:
 * - S3 first run creates PR
 * - S3 second run is idempotent
 * - Manual PR exists is reconciled
 * - PR exists but not found returns conflict
 * 
 * @jest-environment node
 */

const { NextRequest } = require('next/server');
const { POST: implementIssue } = require('../../app/api/afu9/s1s3/issues/[id]/implement/route');
const { S1S3IssueStatus } = require('../../src/lib/contracts/s1s3Flow');

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
    } as any;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('S3 first run creates branch and PR', async () => {
    const { getS1S3IssueById, createS1S3Run, createS1S3RunStep, updateS1S3IssuePR } = require('../../src/lib/db/s1s3Flow');
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');

    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockResolvedValue({});
    octokit.rest.pulls.create.mockResolvedValue({
      data: {
        number: 101,
        html_url: 'https://github.com/owner/repo/pull/101',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      },
    });

    createAuthenticatedClient.mockResolvedValue(octokit);
    getS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    createS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    createS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-1' } });
    updateS1S3IssuePR.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 101,
        pr_url: 'https://github.com/owner/repo/pull/101',
        branch_name: 'afu9/issue-42-abc123',
      },
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    });

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.pr.number).toBe(101);
    expect(body.pr.url).toBe('https://github.com/owner/repo/pull/101');
    expect(octokit.rest.pulls.create).toHaveBeenCalled();
  });

  test('S3 second run returns existing PR without duplication', async () => {
    const { getS1S3IssueById, createS1S3Run, createS1S3RunStep, updateS1S3IssuePR } = require('../../src/lib/db/s1s3Flow');
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');

    const octokit = setupOctokitMock();
    createAuthenticatedClient.mockResolvedValue(octokit);

    const issueWithPr = {
      ...mockIssue,
      status: S1S3IssueStatus.PR_CREATED,
      pr_number: 123,
      pr_url: 'https://github.com/owner/repo/pull/123',
      branch_name: 'afu9/issue-42-abc123',
      pr_created_at: new Date(),
    };

    getS1S3IssueById.mockResolvedValue({ success: true, data: issueWithPr });
    createS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    createS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-2' } });
    updateS1S3IssuePR.mockResolvedValue({ success: true, data: issueWithPr });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    });

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('PR already exists (idempotent)');
    expect(body.pr.number).toBe(123);
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
    expect(octokit.rest.git.createRef).not.toHaveBeenCalled();
  });

  test('Manual PR exists is reconciled after create error', async () => {
    const { getS1S3IssueById, createS1S3Run, createS1S3RunStep, updateS1S3IssuePR } = require('../../src/lib/db/s1s3Flow');
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');

    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockRejectedValue({ status: 422, message: 'Reference already exists' });
    octokit.rest.pulls.create.mockRejectedValue({ status: 422, message: 'A pull request already exists for owner:branch.' });
    octokit.rest.pulls.list
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

    createAuthenticatedClient.mockResolvedValue(octokit);
    getS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    createS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    createS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-3' } });
    updateS1S3IssuePR.mockResolvedValue({
      success: true,
      data: {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 916,
        pr_url: 'https://github.com/owner/repo/pull/916',
        branch_name: 'afu9/issue-42-abc123',
      },
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    });

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
    const { getS1S3IssueById, createS1S3Run, createS1S3RunStep, updateS1S3RunStatus } = require('../../src/lib/db/s1s3Flow');
    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');

    const octokit = setupOctokitMock();
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'base-sha' } } });
    octokit.rest.git.createRef.mockResolvedValue({});
    octokit.rest.pulls.create.mockRejectedValue({ status: 422, message: 'A pull request already exists for owner:branch.' });
    octokit.rest.pulls.list.mockResolvedValue({ data: [] });

    createAuthenticatedClient.mockResolvedValue(octokit);
    getS1S3IssueById.mockResolvedValue({ success: true, data: mockIssue });
    createS1S3Run.mockResolvedValue({ success: true, data: mockRun });
    createS1S3RunStep.mockResolvedValue({ success: true, data: { id: 'step-4' } });
    updateS1S3RunStatus.mockResolvedValue({ success: true, data: mockRun });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({ baseBranch: 'main' }),
    });

    const context = {
      params: Promise.resolve({ id: 'issue-123' }),
    };

    const response = await implementIssue(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('S3_PR_EXISTS_BUT_NOT_FOUND');
  });
});
