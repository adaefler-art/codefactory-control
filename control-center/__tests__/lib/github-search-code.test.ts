/**
 * Tests for GitHub Search Code Tool
 * 
 * Reference: I714 (E71.4) - Tool searchCode
 */

import {
  searchCode,
  encodeCursor,
  decodeCursor,
  sortByPath,
  paginateItems,
  QueryInvalidError,
  RateLimitError,
  GitHubAPIError,
  SearchCodeParams,
  SearchCodeItem,
} from '../../src/lib/github/search-code';
import { RepoAccessDeniedError } from '../../src/lib/github/policy';

// Mock dependencies
jest.mock('../../src/lib/github/auth-wrapper', () => {
  const actual = jest.requireActual('../../src/lib/github/policy');
  return {
    ...actual,
    createAuthenticatedClient: jest.fn(),
    RepoAccessDeniedError: actual.RepoAccessDeniedError,
  };
});

import { createAuthenticatedClient } from '../../src/lib/github/auth-wrapper';

const mockCreateClient = createAuthenticatedClient as jest.MockedFunction<typeof createAuthenticatedClient>;

describe('GitHub Search Code', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Cursor Encoding/Decoding
  // ========================================

  describe('cursor encoding/decoding', () => {
    it('should encode and decode cursor correctly', () => {
      const data = { lastPath: 'src/lib/github.ts', offset: 20 };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });

    it('should return null for invalid cursor', () => {
      expect(decodeCursor('invalid-base64!!!')).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });

    it('should return null for cursor with missing fields', () => {
      const invalidJson = Buffer.from('{"offset": 20}', 'utf-8').toString('base64');
      expect(decodeCursor(invalidJson)).toBeNull();
    });

    it('should produce different cursors for different data', () => {
      const cursor1 = encodeCursor({ lastPath: 'a.ts', offset: 10 });
      const cursor2 = encodeCursor({ lastPath: 'b.ts', offset: 20 });
      expect(cursor1).not.toBe(cursor2);
    });
  });

  // ========================================
  // Sorting
  // ========================================

  describe('sortByPath', () => {
    it('should sort items by path ascending', () => {
      const items: SearchCodeItem[] = [
        {
          path: 'src/z.ts',
          sha: 'sha3',
          repository: { owner: 'test', repo: 'repo' },
          url: null,
          score: null,
          match: {
            preview: 'test',
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
            preview: 'test',
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
            preview: 'test',
            previewSha256: 'hash2',
            previewHash: 'hash2',
          },
        },
      ];

      const sorted = sortByPath(items);

      expect(sorted[0].path).toBe('src/a.ts');
      expect(sorted[1].path).toBe('src/m.ts');
      expect(sorted[2].path).toBe('src/z.ts');
    });

    it('should not mutate original array', () => {
      const items: SearchCodeItem[] = [
        {
          path: 'z.ts',
          sha: 'sha1',
          repository: { owner: 'test', repo: 'repo' },
          url: null,
          score: null,
          match: {
            preview: 'test',
            previewSha256: 'hash1',
            previewHash: 'hash1',
          },
        },
        {
          path: 'a.ts',
          sha: 'sha2',
          repository: { owner: 'test', repo: 'repo' },
          url: null,
          score: null,
          match: {
            preview: 'test',
            previewSha256: 'hash2',
            previewHash: 'hash2',
          },
        },
      ];

      const original = [...items];
      sortByPath(items);

      expect(items).toEqual(original);
    });
  });

  // ========================================
  // Pagination
  // ========================================

  describe('paginateItems', () => {
    const createTestItems = (count: number): SearchCodeItem[] => {
      return Array.from({ length: count }, (_, i) => ({
        path: `file${i}.ts`,
        sha: `sha${i}`,
        repository: { owner: 'test', repo: 'repo' },
        url: null,
        score: null,
        match: {
          preview: `preview ${i}`,
          previewSha256: `hash${i}`,
          previewHash: `hash${i}`,
        },
      }));
    };

    it('should return first page without cursor', () => {
      const items = createTestItems(50);
      const { items: pageItems, nextCursor } = paginateItems(items, undefined, 20);

      expect(pageItems).toHaveLength(20);
      expect(pageItems[0].path).toBe('file0.ts');
      expect(pageItems[19].path).toBe('file19.ts');
      expect(nextCursor).not.toBeNull();
    });

    it('should return second page with cursor', () => {
      const items = createTestItems(50);
      const { nextCursor: cursor1 } = paginateItems(items, undefined, 20);
      const { items: pageItems, nextCursor: cursor2 } = paginateItems(items, cursor1!, 20);

      expect(pageItems).toHaveLength(20);
      expect(pageItems[0].path).toBe('file20.ts');
      expect(pageItems[19].path).toBe('file39.ts');
      expect(cursor2).not.toBeNull();
    });

    it('should return last page with no next cursor', () => {
      const items = createTestItems(50);
      const { nextCursor: cursor1 } = paginateItems(items, undefined, 20);
      const { nextCursor: cursor2 } = paginateItems(items, cursor1!, 20);
      const { items: pageItems, nextCursor: cursor3 } = paginateItems(items, cursor2!, 20);

      expect(pageItems).toHaveLength(10);
      expect(pageItems[0].path).toBe('file40.ts');
      expect(pageItems[9].path).toBe('file49.ts');
      expect(cursor3).toBeNull();
    });

    it('should handle exact page boundary', () => {
      const items = createTestItems(40);
      const { nextCursor: cursor1 } = paginateItems(items, undefined, 20);
      const { items: pageItems, nextCursor: cursor2 } = paginateItems(items, cursor1!, 20);

      expect(pageItems).toHaveLength(20);
      expect(cursor2).toBeNull();
    });

    it('should return empty array for invalid cursor', () => {
      const items = createTestItems(10);
      const invalidCursor = 'invalid-cursor';
      const { items: pageItems, nextCursor } = paginateItems(items, invalidCursor, 20);

      // Invalid cursor is ignored, so it returns from the start
      expect(pageItems).toHaveLength(10);
    });
  });

  // ========================================
  // Query Validation
  // ========================================

  describe('query validation', () => {
    const mockOctokit = {
      rest: {
        search: {
          code: jest.fn(),
        },
      },
    };

    beforeEach(() => {
      mockCreateClient.mockResolvedValue(mockOctokit as any);
    });

    it('should reject query shorter than 2 characters', async () => {
      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'a',
        })
      ).rejects.toThrow();
    });

    it('should reject query longer than 256 characters', async () => {
      const longQuery = 'a'.repeat(257);
      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: longQuery,
        })
      ).rejects.toThrow();
    });

    it('should reject query with newline', async () => {
      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test\nquery',
        })
      ).rejects.toThrow();
    });

    it('should reject query with control characters', async () => {
      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test\x00query',
        })
      ).rejects.toThrow();
    });

    it('should accept valid query', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 0,
          incomplete_results: false,
          items: [],
        },
      });

      const result = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'valid query',
      });

      expect(result.items).toEqual([]);
    });
  });

  // ========================================
  // GitHub API Integration
  // ========================================

  describe('GitHub API integration', () => {
    const mockOctokit = {
      rest: {
        search: {
          code: jest.fn(),
        },
      },
    };

    beforeEach(() => {
      mockCreateClient.mockResolvedValue(mockOctokit as any);
    });

    it('should call GitHub API with correct parameters', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 0,
          incomplete_results: false,
          items: [],
        },
      });

      await searchCode({
        owner: 'test-owner',
        repo: 'test-repo',
        branch: 'main',
        query: 'searchTerm',
      });

      expect(mockOctokit.rest.search.code).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('searchTerm'),
          q: expect.stringContaining('repo:test-owner/test-repo'),
        })
      );
    });

    it('should include pathPrefix in query', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 0,
          incomplete_results: false,
          items: [],
        },
      });

      await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
        pathPrefix: 'src/lib',
      });

      expect(mockOctokit.rest.search.code).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('path:src/lib'),
        })
      );
    });

    it('should convert file globs to extensions', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 0,
          incomplete_results: false,
          items: [],
        },
      });

      await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
        fileGlobs: ['*.ts', '**/*.md'],
      });

      expect(mockOctokit.rest.search.code).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining('extension:ts'),
          q: expect.stringContaining('extension:md'),
        })
      );
    });

    it('should handle API results correctly', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 2,
          incomplete_results: false,
          items: [
            {
              name: 'file1.ts',
              path: 'src/file1.ts',
              sha: 'abc123',
              url: 'https://api.github.com/repos/test/repo/contents/src/file1.ts',
              html_url: 'https://github.com/test/repo/blob/main/src/file1.ts',
              repository: {
                id: 1,
                name: 'repo',
                full_name: 'test/repo',
                owner: { login: 'test' },
              },
              score: 1.0,
              text_matches: [
                {
                  object_url: '',
                  object_type: 'FileContent',
                  property: 'content',
                  fragment: 'function test() { return true; }',
                  matches: [],
                },
              ],
            },
            {
              name: 'file2.ts',
              path: 'lib/file2.ts',
              sha: 'def456',
              url: 'https://api.github.com/repos/test/repo/contents/lib/file2.ts',
              html_url: 'https://github.com/test/repo/blob/main/lib/file2.ts',
              repository: {
                id: 1,
                name: 'repo',
                full_name: 'test/repo',
                owner: { login: 'test' },
              },
              score: 0.8,
              text_matches: [
                {
                  object_url: '',
                  object_type: 'FileContent',
                  property: 'content',
                  fragment: 'const test = 123;',
                  matches: [],
                },
              ],
            },
          ],
        },
      });

      const result = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
      });

      expect(result.items).toHaveLength(2);
      // Results should be sorted by path
      expect(result.items[0].path).toBe('lib/file2.ts');
      expect(result.items[1].path).toBe('src/file1.ts');
      expect(result.items[0].sha).toBe('def456');
      expect(result.items[0].match.preview).toBeTruthy();
      expect(result.items[0].match.previewSha256).toBeTruthy();
      expect(result.items[0].match.previewHash).toBeTruthy();
    });

    it('should include metadata in response', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 0,
          incomplete_results: false,
          items: [],
        },
      });

      const result = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
        pathPrefix: 'src',
        limit: 10,
      });

      expect(result.meta).toMatchObject({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
        pathPrefix: 'src',
        limit: 10,
        ordering: 'path_asc',
      });
      expect(result.meta.generatedAt).toBeTruthy();
      expect(result.meta.branchWarning).toBeTruthy();
    });
  });

  // ========================================
  // Error Handling
  // ========================================

  describe('error handling', () => {
    const mockOctokit = {
      rest: {
        search: {
          code: jest.fn(),
        },
      },
    };

    beforeEach(() => {
      mockCreateClient.mockResolvedValue(mockOctokit as any);
    });

    it('should handle 404 error', async () => {
      mockOctokit.rest.search.code.mockRejectedValue({
        status: 404,
        message: 'Not Found',
      });

      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
        })
      ).rejects.toThrow(GitHubAPIError);
    });

    it('should handle 403 error', async () => {
      mockOctokit.rest.search.code.mockRejectedValue({
        status: 403,
        message: 'Forbidden',
      });

      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
        })
      ).rejects.toThrow(GitHubAPIError);
    });

    it('should handle 422 error (invalid query)', async () => {
      mockOctokit.rest.search.code.mockRejectedValue({
        status: 422,
        message: 'Validation Failed',
      });

      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
        })
      ).rejects.toThrow(QueryInvalidError);
    });

    it('should handle rate limit error', async () => {
      mockOctokit.rest.search.code.mockRejectedValue({
        status: 403,
        message: 'rate limit exceeded',
        response: {
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        },
      });

      await expect(
        searchCode({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          query: 'test',
        })
      ).rejects.toThrow(RateLimitError);
    });
  });

  // ========================================
  // Preview Hashing
  // ========================================

  describe('preview hashing', () => {
    const mockOctokit = {
      rest: {
        search: {
          code: jest.fn(),
        },
      },
    };

    beforeEach(() => {
      mockCreateClient.mockResolvedValue(mockOctokit as any);
    });

    it('should generate consistent hashes for same preview', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              name: 'file.ts',
              path: 'file.ts',
              sha: 'abc',
              url: '',
              html_url: '',
              repository: {
                id: 1,
                name: 'repo',
                full_name: 'test/repo',
                owner: { login: 'test' },
              },
              score: 1.0,
              text_matches: [
                {
                  object_url: '',
                  object_type: 'FileContent',
                  property: 'content',
                  fragment: 'test content',
                  matches: [],
                },
              ],
            },
          ],
        },
      });

      const result1 = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
      });

      const result2 = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
      });

      expect(result1.items[0].match.previewSha256).toBe(result2.items[0].match.previewSha256);
      expect(result1.items[0].match.previewHash).toBe(result2.items[0].match.previewHash);
    });

    it('should truncate preview to max 300 chars', async () => {
      const longFragment = 'a'.repeat(500);
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              name: 'file.ts',
              path: 'file.ts',
              sha: 'abc',
              url: '',
              html_url: '',
              repository: {
                id: 1,
                name: 'repo',
                full_name: 'test/repo',
                owner: { login: 'test' },
              },
              score: 1.0,
              text_matches: [
                {
                  object_url: '',
                  object_type: 'FileContent',
                  property: 'content',
                  fragment: longFragment,
                  matches: [],
                },
              ],
            },
          ],
        },
      });

      const result = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
      });

      expect(result.items[0].match.preview.length).toBe(300);
    });

    it('should generate 12-char short hash', async () => {
      mockOctokit.rest.search.code.mockResolvedValue({
        data: {
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              name: 'file.ts',
              path: 'file.ts',
              sha: 'abc',
              url: '',
              html_url: '',
              repository: {
                id: 1,
                name: 'repo',
                full_name: 'test/repo',
                owner: { login: 'test' },
              },
              score: 1.0,
              text_matches: [
                {
                  object_url: '',
                  object_type: 'FileContent',
                  property: 'content',
                  fragment: 'test',
                  matches: [],
                },
              ],
            },
          ],
        },
      });

      const result = await searchCode({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        query: 'test',
      });

      expect(result.items[0].match.previewHash).toHaveLength(12);
      expect(result.items[0].match.previewSha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
