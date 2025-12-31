/**
 * Tests for E72.2: GitHub Issue Ingestion API Route
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// Define error classes for testing
class IssueNotFoundError extends Error {
  code = 'ISSUE_NOT_FOUND';
  details: any;
  constructor(owner: string, repo: string, issueNumber: number) {
    super(`Issue #${issueNumber} not found in ${owner}/${repo}`);
    this.details = { owner, repo, issueNumber };
  }
}

class GitHubIngestionError extends Error {
  code: string;
  details: any;
  constructor(code: string, message: string, details: any = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

class RepoAccessDeniedError extends Error {
  code = 'REPO_NOT_ALLOWED';
  details: any;
  constructor(details: any) {
    super(`Access denied to repository ${details.owner}/${details.repo}`);
    this.details = details;
  }
}

// Mock the ingestIssue module before importing the route
const mockIngestIssue = jest.fn();

jest.mock('@/lib/github-ingestion', () => ({
  ingestIssue: mockIngestIssue,
  IssueNotFoundError,
  GitHubIngestionError,
  RepoAccessDeniedError,
}));

// Mock the database pool
const mockGetPool = jest.fn();
jest.mock('@/lib/db', () => ({
  getPool: mockGetPool,
}));

describe('E72.2: GitHub Issue Ingestion API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue({} as any); // Mock pool object
  });

  const getRoute = () => {
    return require('../../app/api/integrations/github/ingest/issue/route').POST;
  };

  describe('POST /api/integrations/github/ingest/issue - Success', () => {
    it('should ingest an issue successfully', async () => {
      const mockResult = {
        nodeId: 'node-uuid-123',
        naturalKey: 'github:issue:owner/repo/issues/123',
        isNew: true,
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        issueNumber: 123,
      };

      mockIngestIssue.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          issueNumber: 123,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data).toMatchObject({
        nodesUpserted: 1,
        edgesUpserted: 0,
        sourceRefs: 1,
        nodeId: 'node-uuid-123',
        naturalKey: 'github:issue:owner/repo/issues/123',
        isNew: true,
        issueNumber: 123,
      });
      expect(data.data.ingestedAt).toBeDefined();

      // Verify ingestIssue was called with correct params
      expect(mockIngestIssue).toHaveBeenCalledWith(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        expect.anything()
      );
    });

    it('should handle existing issue (isNew: false)', async () => {
      const mockResult = {
        nodeId: 'node-uuid-456',
        naturalKey: 'github:issue:org/project/issues/456',
        isNew: false,
        source_system: 'github',
        source_type: 'issue',
        source_id: 'org/project/issues/456',
        issueNumber: 456,
      };

      mockIngestIssue.mockResolvedValue(mockResult);

      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'org',
          repo: 'project',
          issueNumber: 456,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data.isNew).toBe(false);
      expect(data.data.nodeId).toBe('node-uuid-456');
    });
  });

  describe('POST /api/integrations/github/ingest/issue - Validation Errors', () => {
    it('should return 400 for missing owner', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          repo: 'repo',
          issueNumber: 123,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
      expect(data.error.message).toContain('Invalid request parameters');
    });

    it('should return 400 for missing repo', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          issueNumber: 123,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for missing issueNumber', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for invalid issueNumber (not a number)', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          issueNumber: 'not-a-number',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for negative issueNumber', async () => {
      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          issueNumber: -1,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('INVALID_PARAMS');
    });
  });

  describe('POST /api/integrations/github/ingest/issue - Access Denied', () => {
    it('should return 403 when repo is not allowed (I711 policy)', async () => {
      mockIngestIssue.mockRejectedValue(
        new RepoAccessDeniedError({ owner: 'owner', repo: 'denied-repo' })
      );

      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'denied-repo',
          issueNumber: 123,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('REPO_NOT_ALLOWED');
      expect(data.error.message).toContain('Access denied');
      expect(data.error.details.owner).toBe('owner');
      expect(data.error.details.repo).toBe('denied-repo');
    });
  });

  describe('POST /api/integrations/github/ingest/issue - GitHub Errors', () => {
    it('should return 502 when issue is not found', async () => {
      mockIngestIssue.mockRejectedValue(new IssueNotFoundError('owner', 'repo', 999));

      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          issueNumber: 999,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('ISSUE_NOT_FOUND');
      expect(data.error.message).toContain('not found');
      expect(data.error.details.issueNumber).toBe(999);
    });

    it('should return 502 for GitHub API errors', async () => {
      mockIngestIssue.mockRejectedValue(
        new GitHubIngestionError('GITHUB_API_ERROR', 'GitHub API rate limit exceeded', {
          status: 429,
        })
      );

      const request = new NextRequest('http://localhost:3000/api/integrations/github/ingest/issue', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'owner',
          repo: 'repo',
          issueNumber: 123,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const POST = getRoute();
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.ok).toBe(false);
      expect(data.error.code).toBe('GITHUB_API_ERROR');
      expect(data.error.message).toContain('rate limit');
    });
  });
});
