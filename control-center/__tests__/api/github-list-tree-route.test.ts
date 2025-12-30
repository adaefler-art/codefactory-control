/**
 * Tests for E71.2: GitHub List Tree API Route
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// Define error classes for testing
class InvalidPathError extends Error {
  code = 'INVALID_PATH';
  details: any;
  constructor(path: string, reason: string, details: any = {}) {
    super(`Invalid path '${path}': ${reason}`);
    this.details = details;
  }
}

class TreeTooLargeError extends Error {
  code = 'TREE_TOO_LARGE';
  details: any;
  constructor(message: string, details: any) {
    super(message);
    this.details = details;
  }
}

class GitHubAPIError extends Error {
  code = 'GITHUB_API_ERROR';
  details: any;
  constructor(message: string, details: any) {
    super(message);
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

// Mock the listTree module before importing the route
const mockListTree = jest.fn();

jest.mock('../../src/lib/github/list-tree', () => ({
  listTree: mockListTree,
  InvalidPathError,
  TreeTooLargeError,
  GitHubAPIError,
  RepoAccessDeniedError,
}));

describe('E71.2: GitHub List Tree API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoute = () => {
    return require('../../app/api/integrations/github/list-tree/route').GET;
  };

  describe('GET /api/integrations/github/list-tree - Success Cases', () => {
    it('should list repository root successfully', async () => {
      const mockResult = {
        items: [
          { type: 'dir' as const, path: '.github', name: '.github', sha: 'abc123', size: null },
          { type: 'file' as const, path: 'README.md', name: 'README.md', sha: 'def456', size: 1234 },
        ],
        pageInfo: {
          nextCursor: null,
          totalEstimate: 2,
        },
        meta: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: '',
          recursive: false,
          generatedAt: '2025-12-30T21:00:00.000Z',
          toolVersion: '1.0.0',
          contractVersion: 'E71.2',
          ordering: 'path_asc' as const,
        },
      };

      mockListTree.mockResolvedValue(mockResult);

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main'
      );

      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.items).toHaveLength(2);
      expect(body.items[0].path).toBe('.github');
      expect(body.pageInfo.nextCursor).toBeNull();
      expect(body.meta.ordering).toBe('path_asc');
    });

    it('should list subdirectory successfully', async () => {
      const mockResult = {
        items: [
          { type: 'file' as const, path: 'src/index.ts', name: 'index.ts', sha: 'abc123', size: 500 },
        ],
        pageInfo: {
          nextCursor: null,
          totalEstimate: 1,
        },
        meta: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: 'src',
          recursive: false,
          generatedAt: '2025-12-30T21:00:00.000Z',
          toolVersion: '1.0.0',
          contractVersion: 'E71.2',
          ordering: 'path_asc' as const,
        },
      };

      mockListTree.mockResolvedValue(mockResult);

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main&path=src'
      );

      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.items).toHaveLength(1);
      expect(body.meta.path).toBe('src');
    });

    it('should handle cursor pagination correctly', async () => {
      const cursor = 'eyJsYXN0UGF0aCI6ImEudHh0In0='; // base64 of {lastPath:"a.txt"}
      
      const mockResult = {
        items: [
          { type: 'file' as const, path: 'b.txt', name: 'b.txt', sha: 'abc123', size: 100 },
          { type: 'file' as const, path: 'c.txt', name: 'c.txt', sha: 'def456', size: 200 },
        ],
        pageInfo: {
          nextCursor: 'eyJsYXN0UGF0aCI6ImMudHh0In0=',
          totalEstimate: 10,
        },
        meta: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: '',
          recursive: false,
          generatedAt: '2025-12-30T21:00:00.000Z',
          toolVersion: '1.0.0',
          contractVersion: 'E71.2',
          ordering: 'path_asc' as const,
        },
      };

      mockListTree.mockResolvedValue(mockResult);

      const GET = getRoute();
      const request = new NextRequest(
        `http://localhost/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main&cursor=${cursor}&limit=2`
      );

      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.items).toHaveLength(2);
      expect(body.items[0].path).toBe('b.txt');
      expect(body.pageInfo.nextCursor).toBe('eyJsYXN0UGF0aCI6ImMudHh0In0=');
      
      // Verify listTree was called with cursor
      expect(mockListTree).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor,
          limit: 2,
        })
      );
    });
  });

  describe('GET /api/integrations/github/list-tree - Error Cases', () => {
    it('should return 403 when repository not allowed by policy', async () => {
      mockListTree.mockRejectedValue(
        new RepoAccessDeniedError({
          owner: 'other-org',
          repo: 'private-repo',
          branch: 'main',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=other-org&repo=private-repo&branch=main'
      );

      const response = await GET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.code).toBe('REPO_NOT_ALLOWED');
      expect(body.error).toContain('Access denied');
      expect(body.details.owner).toBe('other-org');
      expect(body.details.repo).toBe('private-repo');
    });

    it('should return 400 for invalid path', async () => {
      mockListTree.mockRejectedValue(
        new InvalidPathError('../etc/passwd', 'Parent directory traversal (..) not allowed', {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main&path=../etc/passwd'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.code).toBe('INVALID_PATH');
      expect(body.error).toContain('Invalid path');
    });

    it('should return 413 for tree too large', async () => {
      mockListTree.mockRejectedValue(
        new TreeTooLargeError(
          'Repository tree is too large for recursive listing. Use non-recursive mode or specify a narrower path.',
          {
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            branch: 'main',
            path: '',
          }
        )
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=main&recursive=true'
      );

      const response = await GET(request);
      expect(response.status).toBe(413);

      const body = await response.json();
      expect(body.code).toBe('TREE_TOO_LARGE');
      expect(body.error).toContain('too large');
    });

    it('should return 400 for missing required parameters', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=adaefler-art'
        // Missing 'repo' parameter
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.code).toBe('INVALID_PARAMS');
      // Zod validation errors are in details.errors
      expect(body.details).toBeDefined();
    });

    it('should return 404 for GitHub API not found error', async () => {
      mockListTree.mockRejectedValue(
        new GitHubAPIError('Repository, branch, or path not found', {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'nonexistent',
          path: '',
          httpStatus: 404,
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/list-tree?owner=adaefler-art&repo=codefactory-control&branch=nonexistent'
      );

      const response = await GET(request);
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.code).toBe('GITHUB_API_ERROR');
      expect(body.error).toContain('not found');
    });
  });
});
