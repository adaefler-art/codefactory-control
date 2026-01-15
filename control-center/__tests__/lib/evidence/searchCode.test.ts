/**
 * Tests for Evidence Tool: searchCode
 * 
 * Reference: E89.4 - Evidence Tool "searchCode"
 */

import {
  searchCodeEvidence,
  MAX_EVIDENCE_QUERY_LENGTH,
  MAX_EVIDENCE_RESULTS,
  DEFAULT_EVIDENCE_RESULTS,
} from '../../../src/lib/evidence/searchCode';

// Mock dependencies
jest.mock('../../../src/lib/github/search-code', () => ({
  searchCode: jest.fn(),
}));

jest.mock('../../../src/lib/github/retry-policy', () => ({
  ...jest.requireActual('../../../src/lib/github/retry-policy'),
  withRetry: jest.fn((fn) => fn()),
}));

import { searchCode } from '../../../src/lib/github/search-code';
import { withRetry } from '../../../src/lib/github/retry-policy';

const mockSearchCode = searchCode as jest.MockedFunction<typeof searchCode>;
const mockWithRetry = withRetry as jest.MockedFunction<typeof withRetry>;

describe('Evidence Tool: searchCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: withRetry just executes the function
    mockWithRetry.mockImplementation((fn) => fn());
  });

  // ========================================
  // Query Validation
  // ========================================

  describe('query validation', () => {
    it('should reject empty query', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: '',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('cannot be empty');
      expect(mockSearchCode).not.toHaveBeenCalled();
    });

    it('should reject whitespace-only query', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: '   ',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('cannot be empty');
    });

    it('should reject query exceeding max length', async () => {
      const longQuery = 'a'.repeat(MAX_EVIDENCE_QUERY_LENGTH + 1);
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: longQuery,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('exceeds maximum length');
      expect(result.error).toContain(`${MAX_EVIDENCE_QUERY_LENGTH}`);
    });

    it('should accept query at max length', async () => {
      const maxQuery = 'a'.repeat(MAX_EVIDENCE_QUERY_LENGTH);
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: maxQuery,
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: maxQuery,
      });

      expect(result.success).toBe(true);
      expect(mockSearchCode).toHaveBeenCalled();
    });

    it('should reject wildcard-only query (*)', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: '*',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('wildcard-only');
    });

    it('should reject wildcard-only query (**)', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: '**',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('wildcard-only');
    });

    it('should reject query with newline', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test\nquery',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('control characters');
    });

    it('should reject query with control characters', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test\x00query',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
      expect(result.error).toContain('control characters');
    });

    it('should accept valid query', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'valid query',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'valid query',
      });

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // maxResults Clamping
  // ========================================

  describe('maxResults clamping', () => {
    beforeEach(() => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });
    });

    it('should use default maxResults when not specified', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.maxResults).toBe(DEFAULT_EVIDENCE_RESULTS);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({ limit: DEFAULT_EVIDENCE_RESULTS })
      );
    });

    it('should clamp maxResults to maximum', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
        maxResults: 100,
      });

      expect(result.success).toBe(true);
      expect(result.meta?.maxResults).toBe(MAX_EVIDENCE_RESULTS);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({ limit: MAX_EVIDENCE_RESULTS })
      );
    });

    it('should clamp negative maxResults to 1', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
        maxResults: -5,
      });

      expect(result.success).toBe(true);
      expect(result.meta?.maxResults).toBe(1);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 })
      );
    });

    it('should accept maxResults within bounds', async () => {
      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
        maxResults: 25,
      });

      expect(result.success).toBe(true);
      expect(result.meta?.maxResults).toBe(25);
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 })
      );
    });
  });

  // ========================================
  // Deterministic Ordering
  // ========================================

  describe('deterministic ordering', () => {
    it('should sort by path ascending', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/z.ts',
            sha: 'sha3',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview3',
              previewSha256: 'hash3',
              previewHash: 'hash3',
            },
          },
          {
            path: 'src/a.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
          {
            path: 'src/m.ts',
            sha: 'sha2',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview2',
              previewSha256: 'hash2',
              previewHash: 'hash2',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(result.items![0].path).toBe('src/a.ts');
      expect(result.items![1].path).toBe('src/m.ts');
      expect(result.items![2].path).toBe('src/z.ts');
      expect(result.meta?.ordering).toBe('deterministic_path_sha');
    });

    it('should sort by sha when paths are equal', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/file.ts',
            sha: 'sha3',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview3',
              previewSha256: 'hash3',
              previewHash: 'hash3',
            },
          },
          {
            path: 'src/file.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
          {
            path: 'src/file.ts',
            sha: 'sha2',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview2',
              previewSha256: 'hash2',
              previewHash: 'hash2',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(result.items![0].sha).toBe('sha1');
      expect(result.items![1].sha).toBe('sha2');
      expect(result.items![2].sha).toBe('sha3');
    });

    it('should place null sha last when paths are equal', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/file.ts',
            sha: null,
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
          {
            path: 'src/file.ts',
            sha: 'sha2',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview2',
              previewSha256: 'hash2',
              previewHash: 'hash2',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items![0].sha).toBe('sha2');
      expect(result.items![1].sha).toBeNull();
    });
  });

  // ========================================
  // Result Hash Stability
  // ========================================

  describe('result hash stability', () => {
    it('should generate identical hash for identical results', async () => {
      const mockResults = {
        items: [
          {
            path: 'src/a.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
          {
            path: 'src/b.ts',
            sha: 'sha2',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview2',
              previewSha256: 'hash2',
              previewHash: 'hash2',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      };

      mockSearchCode.mockResolvedValue(mockResults);

      const result1 = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      mockSearchCode.mockResolvedValue(mockResults);

      const result2 = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.meta?.resultHash).toBe(result2.meta?.resultHash);
      expect(result1.meta?.resultHashShort).toBe(result2.meta?.resultHashShort);
    });

    it('should generate different hash for different results', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/a.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result1 = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/b.ts',
            sha: 'sha2',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview2',
              previewSha256: 'hash2',
              previewHash: 'hash2',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result2 = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.meta?.resultHash).not.toBe(result2.meta?.resultHash);
    });

    it('should generate 12-char short hash', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/a.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: null,
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.resultHashShort).toHaveLength(12);
      expect(result.meta?.resultHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.meta?.resultHashShort).toBe(
        result.meta?.resultHash.substring(0, 12)
      );
    });

    it('should generate hash for empty results', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(0);
      expect(result.meta?.resultHash).toBeTruthy();
      expect(result.meta?.resultHashShort).toBeTruthy();
    });
  });

  // ========================================
  // Rate Limit Handling
  // ========================================

  describe('rate limit handling', () => {
    it('should use withRetry for rate-limit handling', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxRetries: 3,
          httpMethod: 'GET',
          endpoint: '/search/code',
        })
      );
    });

    it('should map rate limit error to GITHUB_RATE_LIMIT', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'GitHub API rate limit exceeded',
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('GITHUB_RATE_LIMIT');
      expect(result.error).toContain('rate limit');
    });

    it('should map rate limit error message to GITHUB_RATE_LIMIT', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue({
        message: 'API rate limit exceeded. Please try again later.',
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('GITHUB_RATE_LIMIT');
    });
  });

  // ========================================
  // Allowlist Enforcement
  // ========================================

  describe('allowlist enforcement', () => {
    it('should map REPO_NOT_ALLOWED to REPO_ACCESS_DENIED_403', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue({
        code: 'REPO_NOT_ALLOWED',
        message: 'Repository not allowed',
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('REPO_ACCESS_DENIED_403');
    });

    it('should map BRANCH_NOT_ALLOWED to REPO_ACCESS_DENIED_403', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue({
        code: 'BRANCH_NOT_ALLOWED',
        message: 'Branch not allowed',
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('REPO_ACCESS_DENIED_403');
    });
  });

  // ========================================
  // Error Handling
  // ========================================

  describe('error handling', () => {
    it('should map QUERY_INVALID to INVALID_QUERY_400', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue({
        code: 'QUERY_INVALID',
        message: 'Invalid query',
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_QUERY_400');
    });

    it('should preserve GITHUB_API_ERROR code', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue({
        code: 'GITHUB_API_ERROR',
        message: 'GitHub API error',
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('GITHUB_API_ERROR');
    });

    it('should handle unknown errors', async () => {
      mockWithRetry.mockImplementation((fn) => fn());
      mockSearchCode.mockRejectedValue(new Error('Unexpected error'));

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected error');
      expect(result.errorCode).toBeDefined();
    });
  });

  // ========================================
  // Path Prefix
  // ========================================

  describe('path prefix', () => {
    it('should pass path prefix to underlying searchCode', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          pathPrefix: 'src/lib',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
        path: 'src/lib',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.path).toBe('src/lib');
      expect(mockSearchCode).toHaveBeenCalledWith(
        expect.objectContaining({
          pathPrefix: 'src/lib',
        })
      );
    });

    it('should work without path prefix', async () => {
      mockSearchCode.mockResolvedValue({
        items: [],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.path).toBeUndefined();
    });
  });

  // ========================================
  // Metadata
  // ========================================

  describe('metadata', () => {
    it('should include complete metadata in response', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/a.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: 'https://github.com/test/repo/blob/main/src/a.ts',
            score: null,
            match: {
              preview: 'preview1',
              previewSha256: 'hash1',
              previewHash: 'hash1',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        ref: 'main',
        query: 'test',
        maxResults: 20,
      });

      expect(result.success).toBe(true);
      expect(result.meta).toMatchObject({
        owner: 'test',
        repo: 'repo',
        ref: 'main',
        query: 'test',
        maxResults: 20,
        totalReturned: 1,
        ordering: 'deterministic_path_sha',
      });
      expect(result.meta?.resultHash).toBeTruthy();
      expect(result.meta?.resultHashShort).toBeTruthy();
      expect(result.meta?.generatedAt).toBeTruthy();
    });

    it('should convert items to evidence format', async () => {
      mockSearchCode.mockResolvedValue({
        items: [
          {
            path: 'src/a.ts',
            sha: 'sha1',
            repository: { owner: 'test', repo: 'repo' },
            url: 'https://github.com/test/repo/blob/main/src/a.ts',
            score: 0.95,
            match: {
              preview: 'function test() { return true; }',
              previewSha256: 'abc123def456',
              previewHash: 'abc123def456',
            },
          },
        ],
        pageInfo: { nextCursor: null },
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
          limit: 20,
          generatedAt: new Date().toISOString(),
          ordering: 'path_asc',
        },
      });

      const result = await searchCodeEvidence({
        owner: 'test',
        repo: 'repo',
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items![0]).toEqual({
        path: 'src/a.ts',
        sha: 'sha1',
        url: 'https://github.com/test/repo/blob/main/src/a.ts',
        preview: 'function test() { return true; }',
        previewHash: 'abc123def456',
      });
    });
  });
});
