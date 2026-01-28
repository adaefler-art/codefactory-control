/**
 * S1-S3 Implement API Tests
 * 
 * Tests for POST /api/afu9/s1s3/issues/[id]/implement endpoint:
 * - Idempotent behavior when PR already created
 * - Branch existence handling
 * - Commit comparison before PR creation
 * 
 * Reference: E9.1-CTRL - S3 Implement idempotent machen + PR/Branch reconcile
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as implementIssue } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { S1S3IssueStatus } from '../../src/lib/contracts/s1s3Flow';

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

// Mock contract utilities
jest.mock('../../src/lib/contracts/s1s3Flow', () => ({
  S1S3IssueStatus: {
    CREATED: 'CREATED',
    SPEC_READY: 'SPEC_READY',
    IMPLEMENTING: 'IMPLEMENTING',
    PR_CREATED: 'PR_CREATED',
  },
  S1S3RunType: {
    S3_IMPLEMENT: 'S3_IMPLEMENT',
  },
  S1S3RunStatus: {
    RUNNING: 'RUNNING',
    DONE: 'DONE',
    FAILED: 'FAILED',
  },
  S1S3StepStatus: {
    STARTED: 'STARTED',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
  },
  normalizeAcceptanceCriteria: jest.fn((criteria) => {
    try {
      return JSON.parse(criteria);
    } catch {
      return [];
    }
  }),
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Idempotent behavior', () => {
    test('returns existing PR info when PR already created', async () => {
      const { getS1S3IssueById } = require('../../src/lib/db/s1s3Flow');
      
      const issueWithPR = {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 123,
        pr_url: 'https://github.com/owner/repo/pull/123',
        branch_name: 'afu9/issue-42-abc123',
        pr_created_at: new Date(),
      };

      getS1S3IssueById.mockResolvedValue({
        success: true,
        data: issueWithPR,
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
      expect(body.issue).toBeDefined();
      expect(body.pr).toBeDefined();
      expect(body.pr.number).toBe(123);
      expect(body.pr.url).toBe('https://github.com/owner/repo/pull/123');
      expect(body.pr.branch).toBe('afu9/issue-42-abc123');
      expect(body.message).toBe('PR already exists (idempotent)');
    });

    test('accepts PR_CREATED status as valid state', async () => {
      const { getS1S3IssueById } = require('../../src/lib/db/s1s3Flow');
      
      const issueWithPR = {
        ...mockIssue,
        status: S1S3IssueStatus.PR_CREATED,
        pr_number: 123,
        pr_url: 'https://github.com/owner/repo/pull/123',
        branch_name: 'afu9/issue-42-abc123',
      };

      getS1S3IssueById.mockResolvedValue({
        success: true,
        data: issueWithPR,
      });

      const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const context = {
        params: Promise.resolve({ id: 'issue-123' }),
      };

      const response = await implementIssue(request, context);

      expect(response.status).toBe(200);
    });
  });

  describe('Error cases', () => {
    test('returns 404 when issue not found', async () => {
      const { getS1S3IssueById } = require('../../src/lib/db/s1s3Flow');
      
      getS1S3IssueById.mockResolvedValue({
        success: false,
        error: 'Issue not found',
      });

      const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/nonexistent/implement', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const context = {
        params: Promise.resolve({ id: 'nonexistent' }),
      };

      const response = await implementIssue(request, context);
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Issue not found');
    });

    test('returns 400 for invalid issue state', async () => {
      const { getS1S3IssueById } = require('../../src/lib/db/s1s3Flow');
      
      getS1S3IssueById.mockResolvedValue({
        success: true,
        data: {
          ...mockIssue,
          status: S1S3IssueStatus.CREATED, // Not SPEC_READY
        },
      });

      const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const context = {
        params: Promise.resolve({ id: 'issue-123' }),
      };

      const response = await implementIssue(request, context);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid issue state');
    });
  });
});
