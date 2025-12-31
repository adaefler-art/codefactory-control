/**
 * Tests for E71.3: GitHub Read File API Route
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

class NotAFileError extends Error {
  code = 'NOT_A_FILE';
  details: any;
  constructor(path: string, details: any = {}) {
    super(`Path '${path}' is not a file`);
    this.details = details;
  }
}

class FileTooLargeError extends Error {
  code = 'FILE_TOO_LARGE';
  details: any;
  constructor(message: string, details: any) {
    super(message);
    this.details = details;
  }
}

class RangeInvalidError extends Error {
  code = 'RANGE_INVALID';
  details: any;
  constructor(message: string, details: any) {
    super(message);
    this.details = details;
  }
}

class BinaryOrUnsupportedEncodingError extends Error {
  code = 'BINARY_OR_UNSUPPORTED_ENCODING';
  details: any;
  constructor(path: string, details: any = {}) {
    super(`File '${path}' is binary or has unsupported encoding (only UTF-8 supported)`);
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

class AuthMisconfiguredError extends Error {
  code = 'AUTH_MISCONFIGURED';
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

// Mock the readFile module before importing the route
const mockReadFile = jest.fn();

jest.mock('@/lib/github/read-file', () => ({
  readFile: mockReadFile,
  InvalidPathError,
  NotAFileError,
  FileTooLargeError,
  RangeInvalidError,
  BinaryOrUnsupportedEncodingError,
  GitHubAPIError,
  AuthMisconfiguredError,
  RepoAccessDeniedError,
}));

describe('E71.3: GitHub Read File API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getRoute = () => {
    return require('../../app/api/integrations/github/read-file/route').GET;
  };

  describe('GET /api/integrations/github/read-file - Success Cases', () => {
    it('should read file successfully (basic)', async () => {
      const mockResult = {
        meta: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: 'README.md',
          blobSha: 'abc123def456',
          commitSha: null,
          contentSha256: '8d83ed816445f98ae63fb6bf2886d869bd16075a41cfffdc27d8a3d225224802',
          snippetHash: '8d83ed816445',
          encoding: 'utf-8' as const,
          generatedAt: '2025-12-30T21:00:00.000Z',
          truncated: false,
          range: null,
          totalLines: 50,
        },
        content: {
          text: '# CodeFactory Control\n\nWelcome to CodeFactory...',
          lines: [
            { n: 1, text: '# CodeFactory Control' },
            { n: 2, text: '' },
            { n: 3, text: 'Welcome to CodeFactory...' },
          ],
        },
      };

      mockReadFile.mockResolvedValue(mockResult);

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=README.md'
      );

      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.meta.path).toBe('README.md');
      expect(body.data.meta.snippetHash).toBe('8d83ed816445');
      expect(body.data.meta.truncated).toBe(false);
      expect(body.data.content.text).toContain('CodeFactory');
      expect(body.data.content.lines).toHaveLength(3);
    });

    it('should read file with line range successfully', async () => {
      const mockResult = {
        meta: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: 'src/lib/github/read-file.ts',
          blobSha: 'xyz789',
          commitSha: null,
          contentSha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          snippetHash: 'abcdef123456',
          encoding: 'utf-8' as const,
          generatedAt: '2025-12-30T21:00:00.000Z',
          truncated: false,
          range: { startLine: 10, endLine: 15 },
          totalLines: 680,
        },
        content: {
          text: 'import { z } from \'zod\';\nimport { createAuthenticatedClient } from \'./auth-wrapper\';',
          lines: [
            { n: 10, text: 'import { z } from \'zod\';' },
            { n: 11, text: 'import { createAuthenticatedClient } from \'./auth-wrapper\';' },
          ],
        },
      };

      mockReadFile.mockResolvedValue(mockResult);

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=src/lib/github/read-file.ts&startLine=10&endLine=15'
      );

      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.meta.range).toEqual({ startLine: 10, endLine: 15 });
      expect(body.data.content.lines[0].n).toBe(10);
      expect(body.data.meta.totalLines).toBe(680);
    });
  });

  describe('GET /api/integrations/github/read-file - Error Cases', () => {
    it('should return 403 for denied repository access', async () => {
      mockReadFile.mockRejectedValue(
        new RepoAccessDeniedError({
          owner: 'unauthorized',
          repo: 'private-repo',
          branch: 'main',
          path: 'secret.txt',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=unauthorized&repo=private-repo&path=secret.txt'
      );

      const response = await GET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('REPO_NOT_ALLOWED');
      expect(body.error.message).toContain('Access denied');
      expect(body.error.details.owner).toBe('unauthorized');
    });

    it('should return 400 for invalid path', async () => {
      mockReadFile.mockRejectedValue(
        new InvalidPathError('../etc/passwd', 'Parent directory traversal (..) not allowed', {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=../etc/passwd'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_PATH');
      expect(body.error.message).toContain('Parent directory traversal');
    });

    it('should return 400 for invalid range', async () => {
      mockReadFile.mockRejectedValue(
        new RangeInvalidError('endLine must be >= startLine (got startLine=10, endLine=5)', {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: 'README.md',
          startLine: 10,
          endLine: 5,
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=README.md&startLine=10&endLine=5'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RANGE_INVALID');
      expect(body.error.message).toContain('endLine must be >= startLine');
    });

    it('should return 415 for binary files', async () => {
      mockReadFile.mockRejectedValue(
        new BinaryOrUnsupportedEncodingError('image.png', {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=image.png'
      );

      const response = await GET(request);
      expect(response.status).toBe(415);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('BINARY_OR_UNSUPPORTED_ENCODING');
      expect(body.error.message).toContain('binary or has unsupported encoding');
    });

    it('should return 413 for files too large', async () => {
      mockReadFile.mockRejectedValue(
        new FileTooLargeError('File size (2000000 bytes) exceeds maximum supported size (1,000,000 bytes)', {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          branch: 'main',
          path: 'huge-file.txt',
          maxBytes: 200000,
        })
      );

      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=huge-file.txt'
      );

      const response = await GET(request);
      expect(response.status).toBe(413);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FILE_TOO_LARGE');
      expect(body.error.message).toContain('exceeds maximum');
    });

    it('should return 400 when only startLine is provided', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control&path=README.md&startLine=10'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_PARAMS');
      expect(body.error.message).toContain('Both startLine and endLine must be provided');
    });
  });

  describe('GET /api/integrations/github/read-file - Parameter Validation', () => {
    it('should return 400 when missing required owner parameter', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?repo=codefactory-control&path=README.md'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 when missing required repo parameter', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&path=README.md'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_PARAMS');
    });

    it('should return 400 when missing required path parameter', async () => {
      const GET = getRoute();
      const request = new NextRequest(
        'http://localhost/api/integrations/github/read-file?owner=adaefler-art&repo=codefactory-control'
      );

      const response = await GET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_PARAMS');
    });
  });
});
