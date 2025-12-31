/**
 * Tests for Tool Response Helpers
 * @jest-environment node
 */

import { NextResponse } from 'next/server';
import {
  ok,
  fail,
  failFromError,
  queryInvalidError,
  invalidParamsError,
  repoNotAllowedError,
  rateLimitError,
  githubApiError,
  GitHubToolErrorCode,
  ToolSuccessResponse,
  ToolErrorResponse,
} from '../../src/lib/api/tool-response';

describe('Tool Response Helpers', () => {
  // ========================================
  // Success Response
  // ========================================

  describe('ok', () => {
    it('should create success response without meta', async () => {
      const data = { result: 'test' };
      const response = ok(data);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({
        success: true,
        data: { result: 'test' },
      });
    });

    it('should create success response with meta', async () => {
      const data = { result: 'test' };
      const meta = { requestId: 'abc123', custom: 'value' };
      const response = ok(data, meta);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toEqual({ result: 'test' });
      expect(json.meta).toBeDefined();
      expect(json.meta?.requestId).toBe('abc123');
      expect(json.meta?.custom).toBe('value');
      expect(json.meta?.generatedAt).toBeTruthy();
    });
  });

  // ========================================
  // Error Response
  // ========================================

  describe('fail', () => {
    it('should create error response with code mapping', async () => {
      const response = fail(
        GitHubToolErrorCode.QUERY_INVALID,
        'Query too short'
      );
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json).toEqual({
        success: false,
        error: {
          code: 'QUERY_INVALID',
          message: 'Query too short',
        },
      });
    });

    it('should create error response with details', async () => {
      const response = fail(
        GitHubToolErrorCode.INVALID_PARAMS,
        'Missing parameter',
        { param: 'owner' }
      );
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INVALID_PARAMS');
      expect(json.error.details).toEqual({ param: 'owner' });
    });

    it('should use explicit httpStatus when provided', async () => {
      const response = fail(
        GitHubToolErrorCode.GITHUB_API_ERROR,
        'Not found',
        { httpStatus: 404 },
        404
      );
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.error.code).toBe('GITHUB_API_ERROR');
    });

    it('should extract httpStatus from details for GITHUB_API_ERROR', async () => {
      const response = fail(
        GitHubToolErrorCode.GITHUB_API_ERROR,
        'Not found',
        { httpStatus: 404 }
      );
      const json = await response.json();

      expect(response.status).toBe(404);
    });

    it('should fallback to 500 for unknown code', async () => {
      const response = fail('UNKNOWN_CODE', 'Unknown error');
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error.code).toBe('UNKNOWN_CODE');
    });
  });

  // ========================================
  // Error from Object
  // ========================================

  describe('failFromError', () => {
    it('should handle error with code and details', async () => {
      const error = {
        code: 'QUERY_INVALID',
        message: 'Query too short',
        details: { query: 'a' },
      };
      const response = failFromError(error);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe('QUERY_INVALID');
      expect(json.error.details).toEqual({ query: 'a' });
    });

    it('should handle ZodError', async () => {
      const zodError = {
        name: 'ZodError',
        errors: [{ message: 'Required', path: ['owner'] }],
      };
      const response = failFromError(zodError);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe('INVALID_PARAMS');
      expect(json.error.message).toBe('Validation failed');
      expect(json.error.details.errors).toBeDefined();
    });

    it('should handle generic Error', async () => {
      const error = new Error('Something went wrong');
      const response = failFromError(error);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toBe('Something went wrong');
    });

    it('should handle unknown error', async () => {
      const error = 'string error';
      const response = failFromError(error);
      const json = await response.json();

      expect(response.status).toBe(500);
      expect(json.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Specific Error Helpers
  // ========================================

  describe('queryInvalidError', () => {
    it('should create query invalid error', async () => {
      const response = queryInvalidError('Query too short', { query: 'a' });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe('QUERY_INVALID');
      expect(json.error.message).toBe('Query too short');
      expect(json.error.details).toEqual({ query: 'a' });
    });
  });

  describe('invalidParamsError', () => {
    it('should create invalid params error', async () => {
      const response = invalidParamsError('Missing owner', { param: 'owner' });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error.code).toBe('INVALID_PARAMS');
      expect(json.error.message).toBe('Missing owner');
    });

    it('should use default message', async () => {
      const response = invalidParamsError();
      const json = await response.json();

      expect(json.error.message).toBe('Invalid query parameters');
    });
  });

  describe('repoNotAllowedError', () => {
    it('should create repo not allowed error', async () => {
      const response = repoNotAllowedError('test', 'repo');
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error.code).toBe('REPO_NOT_ALLOWED');
      expect(json.error.message).toBe('Access denied to repository test/repo');
      expect(json.error.details).toEqual({ owner: 'test', repo: 'repo' });
    });

    it('should merge additional details', async () => {
      const response = repoNotAllowedError('test', 'repo', { branch: 'main' });
      const json = await response.json();

      expect(json.error.details).toEqual({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
      });
    });
  });

  describe('rateLimitError', () => {
    it('should create rate limit error without retryAfter', async () => {
      const response = rateLimitError('Rate limit exceeded');
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(json.error.message).toBe('Rate limit exceeded');
      expect(json.error.details).toBeUndefined();
    });

    it('should create rate limit error with retryAfter', async () => {
      const response = rateLimitError('Rate limit exceeded', 60);
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error.details).toEqual({ retryAfter: 60 });
    });
  });

  describe('githubApiError', () => {
    it('should create GitHub API error with httpStatus', async () => {
      const response = githubApiError('Not found', 404);
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.error.code).toBe('GITHUB_API_ERROR');
      expect(json.error.message).toBe('Not found');
      expect(json.error.details).toEqual({ httpStatus: 404 });
    });

    it('should create GitHub API error with details', async () => {
      const response = githubApiError('Forbidden', 403, { reason: 'permissions' });
      const json = await response.json();

      expect(response.status).toBe(403);
      expect(json.error.details).toEqual({
        reason: 'permissions',
        httpStatus: 403,
      });
    });

    it('should default to 500 without httpStatus', async () => {
      const response = githubApiError('Unknown error');
      const json = await response.json();

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // HTTP Status Code Mapping
  // ========================================

  describe('HTTP status code mapping', () => {
    const testCases = [
      { code: 'QUERY_INVALID', expectedStatus: 400 },
      { code: 'INVALID_PARAMS', expectedStatus: 400 },
      { code: 'INVALID_PATH', expectedStatus: 400 },
      { code: 'RANGE_INVALID', expectedStatus: 400 },
      { code: 'NOT_A_FILE', expectedStatus: 400 },
      { code: 'REPO_NOT_ALLOWED', expectedStatus: 403 },
      { code: 'RATE_LIMIT_EXCEEDED', expectedStatus: 403 },
      { code: 'FILE_TOO_LARGE', expectedStatus: 413 },
      { code: 'TREE_TOO_LARGE', expectedStatus: 413 },
      { code: 'BINARY_OR_UNSUPPORTED_ENCODING', expectedStatus: 415 },
      { code: 'GITHUB_API_ERROR', expectedStatus: 500 },
      { code: 'AUTH_MISCONFIGURED', expectedStatus: 500 },
      { code: 'INTERNAL_ERROR', expectedStatus: 500 },
    ];

    testCases.forEach(({ code, expectedStatus }) => {
      it(`should map ${code} to HTTP ${expectedStatus}`, async () => {
        const response = fail(code, 'Test message');
        expect(response.status).toBe(expectedStatus);
      });
    });
  });
});
