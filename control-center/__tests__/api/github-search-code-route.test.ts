/**
 * Tests for E71.4: GitHub Search Code API Route
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// Define error classes for testing
class QueryInvalidError extends Error {
  code = 'QUERY_INVALID';
  details: any;
  constructor(message: string, details: any = {}) {
    super(message);
    this.details = details;
  }
}

class RateLimitError extends Error {
  code = 'RATE_LIMIT_EXCEEDED';
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

// Mock the searchCode function
const mockSearchCode = jest.fn();

jest.mock('../../src/lib/github/search-code', () => ({
  searchCode: mockSearchCode,
  QueryInvalidError,
  RateLimitError,
  GitHubAPIError,
  RepoAccessDeniedError,
}));

describe('GitHub Search Code API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoute = () => {
    return require('../../app/api/integrations/github/search-code/route').GET;
  };

  // ========================================
  // Parameter Validation
  // ========================================

  describe('parameter validation', () => {
    it('should return 400 for missing owner', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for missing repo', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 for missing query', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_PARAMS');
    });

    it('should accept valid parameters', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'test',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test',
          repo: 'test',
          query: 'test',
        })
      );
    });

    it('should parse optional parameters correctly', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'test',
          branch: 'develop',
          query: 'test',
          pathPrefix: 'src',
          limit: 10,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const GET = getRoute();
      const request = new NextRequest(
        new URL(
          'http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test&branch=develop&pathPrefix=src&limit=10&caseSensitive=true'
        )
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test',
          repo: 'test',
          query: 'test',
          branch: 'develop',
          pathPrefix: 'src',
          limit: 10,
          caseSensitive: true,
        })
      );
    });

    it('should parse fileGlobs from comma-separated string', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'test',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const GET = getRoute();
      const request = new NextRequest(
        new URL(
          'http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test&fileGlobs=*.ts,*.md'
        )
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({
          fileGlobs: ['*.ts', '*.md'],
        })
      );
    });
  });

  // ========================================
  // Successful Responses
  // ========================================

  describe('successful responses', () => {
    it('should return search results with 200 status', async () => {
      const mockResult = {
        items: [
          {
            path: 'src/file.ts',
            sha: 'abc123',
            repository: { owner: 'test', repo: 'test' },
            url: 'https://github.com/test/test/blob/main/src/file.ts',
            score: 1.0,
            match: {
              preview: 'function test() {}',
              previewSha256: 'hash123',
              previewHash: 'hash123abc',
            },
          },
        ],
        pageInfo: { nextCursor: 'cursor123' },
        meta: {
          owner: 'test',
          repo: 'test',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      };

      mockSearchCode.mockResolvedValue(mockResult);

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(mockResult);
    });

    it('should handle pagination cursor', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'test',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const GET = getRoute();
      const request = new NextRequest(
        new URL(
          'http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test&cursor=abc123'
        )
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: 'abc123',
        })
      );
    });
  });

  // ========================================
  // Error Handling
  // ========================================

  describe('error handling', () => {
    it('should return 400 for QueryInvalidError', async () => {
      mockSearchCode.mockRejectedValue(
        new QueryInvalidError('Query too short', {
          owner: 'test',
          repo: 'test',
          query: 'a',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=a')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('QUERY_INVALID');
      expect(data.error).toBeTruthy();
    });

    it('should return 403 for RepoAccessDeniedError', async () => {
      mockSearchCode.mockRejectedValue(
        new RepoAccessDeniedError({
          owner: 'test',
          repo: 'forbidden',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=forbidden&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('REPO_NOT_ALLOWED');
    });

    it('should return 403 for RateLimitError', async () => {
      mockSearchCode.mockRejectedValue(
        new RateLimitError('Rate limit exceeded', {
          owner: 'test',
          repo: 'test',
          retryAfter: 60,
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(data.details.retryAfter).toBe(60);
    });

    it('should return appropriate status for GitHubAPIError', async () => {
      mockSearchCode.mockRejectedValue(
        new GitHubAPIError('Not found', {
          owner: 'test',
          repo: 'test',
          httpStatus: 404,
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('GITHUB_API_ERROR');
    });

    it('should return 500 for GitHubAPIError without httpStatus', async () => {
      mockSearchCode.mockRejectedValue(
        new GitHubAPIError('Unknown error', {
          owner: 'test',
          repo: 'test',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('GITHUB_API_ERROR');
    });

    it('should return 500 for unexpected errors', async () => {
      mockSearchCode.mockRejectedValue(new Error('Unexpected error'));

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('INTERNAL_ERROR');
    });

    it('should handle Zod validation errors', async () => {
      const zodError = new Error('Validation failed');
      zodError.name = 'ZodError';
      (zodError as any).errors = [{ message: 'Invalid input' }];

      mockSearchCode.mockRejectedValue(zodError);

      const GET = getRoute();
      const request = new NextRequest(
        new URL('http://localhost/api/integrations/github/search-code?owner=test&repo=test&query=test')
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('INVALID_PARAMS');
    });
  });

  // ========================================
  // Integration with searchCode
  // ========================================

  describe('integration with searchCode', () => {
    it('should pass all parameters correctly to searchCode', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'owner',
          repo: 'repo',
          branch: 'feature',
          query: 'search term',
          pathPrefix: 'src/lib',
          limit: 30,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const GET = getRoute();
      const request = new NextRequest(
        new URL(
          'http://localhost/api/integrations/github/search-code?owner=owner&repo=repo&query=search%20term&branch=feature&pathPrefix=src/lib&fileGlobs=*.ts,*.js&caseSensitive=true&cursor=cur123&limit=30'
        )
      );

      await GET(request);

      expect(mockSearchCode).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        query: 'search term',
        branch: 'feature',
        pathPrefix: 'src/lib',
        fileGlobs: ['*.ts', '*.js'],
        caseSensitive: true,
        cursor: 'cur123',
        limit: 30,
      });
    });
  });
});
