/**
 * S1 Pick API Integration Tests
 * 
 * E9.2-CONTROL-01: Canonical S1 Pick Endpoint Wiring
 * 
 * Tests for POST /api/afu9/s1s3/issues/pick endpoint:
 * - Creates AFU-9 issue from GitHub issue
 * - Idempotent behavior (same repo/issue returns existing AFU-9 issue)
 * - Validates repo format and GitHub issue existence
 * - Handles errors (repo not in allowlist, issue not found, PR instead of issue)
 * - Creates run and step records
 * 
 * @jest-environment node
 */

import { POST as pickIssue } from '../../app/api/afu9/s1s3/issues/pick/route';
import { createAuthenticatedClient } from '../../src/lib/github/auth-wrapper';
import {
  upsertS1S3Issue,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
} from '../../src/lib/db/s1s3Flow';
import { S1S3IssueStatus, S1S3RunType, S1S3RunStatus, S1S3StepStatus } from '../../src/lib/contracts/s1s3Flow';

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
  upsertS1S3Issue: jest.fn(),
  createS1S3Run: jest.fn(),
  createS1S3RunStep: jest.fn(),
  updateS1S3RunStatus: jest.fn(),
}));

describe('POST /api/afu9/s1s3/issues/pick - E9.2-CONTROL-01', () => {
  const mockUpsertS1S3Issue = upsertS1S3Issue as jest.Mock;
  const mockCreateS1S3Run = createS1S3Run as jest.Mock;
  const mockCreateS1S3RunStep = createS1S3RunStep as jest.Mock;
  const mockUpdateS1S3RunStatus = updateS1S3RunStatus as jest.Mock;
  const mockCreateAuthenticatedClient = createAuthenticatedClient as jest.Mock;

  const mockIssue = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    public_id: 'AFU9-001',
    repo_full_name: 'owner/repo',
    github_issue_number: 42,
    github_issue_url: 'https://github.com/owner/repo/issues/42',
    owner: 'afu9',
    canonical_id: 'E92.1',
    status: S1S3IssueStatus.CREATED,
    created_at: new Date('2026-02-03T16:52:44.676Z').toISOString(),
    updated_at: new Date('2026-02-03T16:52:44.676Z').toISOString(),
  };

  const mockRun = {
    id: '223e4567-e89b-12d3-a456-426614174001',
    type: S1S3RunType.S1_PICK_ISSUE,
    issue_id: mockIssue.id,
    request_id: 'req-123',
    actor: 'afu9',
    status: S1S3RunStatus.RUNNING,
    created_at: '2026-02-03T16:52:44.676Z',
    updated_at: '2026-02-03T16:52:44.676Z',
  };

  const mockStep = {
    id: '323e4567-e89b-12d3-a456-426614174002',
    run_id: mockRun.id,
    step_id: 'S1',
    step_name: 'Pick GitHub Issue',
    status: S1S3StepStatus.SUCCEEDED,
    evidence_refs: {
      issue_url: 'https://github.com/owner/repo/issues/42',
      issue_number: 42,
      repo_full_name: 'owner/repo',
      afu9_issue_id: mockIssue.id,
      afu9_public_id: 'AFU9-001',
      request_id: 'req-123',
    },
    created_at: '2026-02-03T16:52:44.676Z',
  };

  const mockGithubIssue = {
    number: 42,
    title: 'Test Issue',
    state: 'open',
    html_url: 'https://github.com/owner/repo/issues/42',
    pull_request: undefined,
  };

  const setupOctokitMock = () => {
    return {
      rest: {
        issues: {
          get: jest.fn().mockResolvedValue({ data: mockGithubIssue }),
        },
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Success Cases', () => {
    test('creates AFU-9 issue from GitHub issue (first time)', async () => {
      // Setup
      const octokit = setupOctokitMock();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({ success: true, data: mockIssue });
      mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
      mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: mockStep });
      mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

      // Execute
      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
          canonicalId: 'E92.1',
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      // Verify
      expect(response.status).toBe(201);
      expect(data.issue).toEqual(mockIssue);
      expect(data.run).toEqual(mockRun);
      expect(data.step).toEqual(mockStep);

      // Verify GitHub client was created
      expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        requestId: expect.any(String),
      });

      // Verify GitHub issue was fetched
      expect(octokit.rest.issues.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });

      // Verify AFU-9 issue was created
      expect(mockUpsertS1S3Issue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          repo_full_name: 'owner/repo',
          github_issue_number: 42,
          github_issue_url: 'https://github.com/owner/repo/issues/42',
          owner: 'afu9',
          canonical_id: 'E92.1',
          status: S1S3IssueStatus.CREATED,
        })
      );

      // Verify run was created
      expect(mockCreateS1S3Run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: S1S3RunType.S1_PICK_ISSUE,
          issue_id: mockIssue.id,
          actor: 'afu9',
          status: S1S3RunStatus.RUNNING,
        })
      );

      // Verify step events were created
      expect(mockCreateS1S3RunStep).toHaveBeenCalledTimes(2); // STARTED + SUCCEEDED

      // Verify run was completed
      expect(mockUpdateS1S3RunStatus).toHaveBeenCalledWith(
        expect.anything(),
        mockRun.id,
        S1S3RunStatus.DONE
      );
    });

    test('is idempotent - returns existing issue on second pick', async () => {
      // Setup - simulate existing issue
      const octokit = setupOctokitMock();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({ success: true, data: mockIssue });
      mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
      mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: mockStep });
      mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

      // Execute - pick same issue twice
      const request1 = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      const response1 = await pickIssue(request1);
      const data1 = await response1.json();

      // Clear mocks
      jest.clearAllMocks();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({ success: true, data: mockIssue });
      mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
      mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: mockStep });
      mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

      const request2 = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      const response2 = await pickIssue(request2);
      const data2 = await response2.json();

      // Verify - same issue returned
      expect(response2.status).toBe(201);
      expect(data2.issue.id).toBe(data1.issue.id);
      expect(data2.issue.public_id).toBe(data1.issue.public_id);
    });

    test('defaults owner to "afu9" when not provided', async () => {
      // Setup
      const octokit = setupOctokitMock();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({ success: true, data: mockIssue });
      mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
      mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: mockStep });
      mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

      // Execute - no owner specified
      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      await pickIssue(request);

      // Verify - defaults to "afu9"
      expect(mockUpsertS1S3Issue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          owner: 'afu9',
        })
      );
    });
  });

  describe('Error Cases', () => {
    test('returns 400 when repo is missing', async () => {
      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields');
    });

    test('returns 400 when issueNumber is missing', async () => {
      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields');
    });

    test('returns 400 when repo format is invalid', async () => {
      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'invalidrepo',
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid repo format');
    });

    test('returns 403 when repo is not in allowlist', async () => {
      mockCreateAuthenticatedClient.mockRejectedValue(
        new Error('Repository not in allowlist')
      );

      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'forbidden/repo',
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe('Repository access denied');
    });

    test('returns 404 when GitHub issue not found', async () => {
      const octokit = {
        rest: {
          issues: {
            get: jest.fn().mockRejectedValue(new Error('Not Found')),
          },
        },
      };
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);

      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 9999,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('GitHub issue not found');
    });

    test('returns 400 when GitHub issue is a pull request', async () => {
      const prIssue = {
        ...mockGithubIssue,
        pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/42' },
      };

      const octokit = {
        rest: {
          issues: {
            get: jest.fn().mockResolvedValue({ data: prIssue }),
          },
        },
      };
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);

      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Cannot pick pull request');
    });

    test('returns 500 when database upsert fails', async () => {
      const octokit = setupOctokitMock();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({
        success: false,
        error: 'Database constraint violation',
      });

      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create AFU9 issue record');
    });
  });

  describe('Contract Compliance', () => {
    test('response includes schemaVersion-equivalent fields', async () => {
      const octokit = setupOctokitMock();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({ success: true, data: mockIssue });
      mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
      mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: mockStep });
      mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      // Verify response structure matches contract
      expect(data).toHaveProperty('issue');
      expect(data).toHaveProperty('run');
      expect(data).toHaveProperty('step');

      // Issue fields
      expect(data.issue).toHaveProperty('id');
      expect(data.issue).toHaveProperty('public_id');
      expect(data.issue).toHaveProperty('repo_full_name');
      expect(data.issue).toHaveProperty('github_issue_number');
      expect(data.issue).toHaveProperty('github_issue_url');
      expect(data.issue).toHaveProperty('owner');
      expect(data.issue).toHaveProperty('status');
      expect(data.issue.status).toBe(S1S3IssueStatus.CREATED);

      // Run fields
      expect(data.run).toHaveProperty('id');
      expect(data.run).toHaveProperty('type');
      expect(data.run.type).toBe(S1S3RunType.S1_PICK_ISSUE);
      expect(data.run).toHaveProperty('issue_id');
      expect(data.run).toHaveProperty('request_id');
      expect(data.run).toHaveProperty('actor');
      expect(data.run).toHaveProperty('status');

      // Step fields
      expect(data.step).toHaveProperty('id');
      expect(data.step).toHaveProperty('run_id');
      expect(data.step).toHaveProperty('step_id');
      expect(data.step.step_id).toBe('S1');
      expect(data.step).toHaveProperty('step_name');
      expect(data.step.step_name).toBe('Pick GitHub Issue');
      expect(data.step).toHaveProperty('status');
      expect(data.step.status).toBe(S1S3StepStatus.SUCCEEDED);
      expect(data.step).toHaveProperty('evidence_refs');
    });

    test('evidence_refs contains all required fields', async () => {
      const octokit = setupOctokitMock();
      mockCreateAuthenticatedClient.mockResolvedValue(octokit);
      mockUpsertS1S3Issue.mockResolvedValue({ success: true, data: mockIssue });
      mockCreateS1S3Run.mockResolvedValue({ success: true, data: mockRun });
      mockCreateS1S3RunStep.mockResolvedValue({ success: true, data: mockStep });
      mockUpdateS1S3RunStatus.mockResolvedValue({ success: true });

      const request = new Request('http://localhost:3000/api/afu9/s1s3/issues/pick', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'owner/repo',
          issueNumber: 42,
        }),
      });

      const response = await pickIssue(request);
      const data = await response.json();

      const evidenceRefs = data.step.evidence_refs;
      expect(evidenceRefs).toHaveProperty('issue_url');
      expect(evidenceRefs).toHaveProperty('issue_number');
      expect(evidenceRefs).toHaveProperty('repo_full_name');
      expect(evidenceRefs).toHaveProperty('afu9_issue_id');
      expect(evidenceRefs).toHaveProperty('afu9_public_id');
      expect(evidenceRefs).toHaveProperty('request_id');
    });
  });
});
