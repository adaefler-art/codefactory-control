/**
 * Tests for GitHub List Tree Tool
 * 
 * Reference: I712 (E71.2) - Tool listTree
 */

import {
  listTree,
  normalizePath,
  encodeCursor,
  decodeCursor,
  sortByPath,
  paginateEntries,
  InvalidPathError,
  TreeTooLargeError,
  GitHubAPIError,
  ListTreeParams,
  TreeEntry,
} from '../../src/lib/github/list-tree';
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

describe('GitHub List Tree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Path Normalization and Validation
  // ========================================

  describe('normalizePath', () => {
    it('should normalize empty path to empty string', () => {
      expect(normalizePath('')).toBe('');
    });

    it('should remove leading slashes', () => {
      expect(normalizePath('/foo/bar')).toBe('foo/bar');
      expect(normalizePath('//foo/bar')).toBe('foo/bar');
    });

    it('should remove trailing slashes', () => {
      expect(normalizePath('foo/bar/')).toBe('foo/bar');
      expect(normalizePath('foo/bar//')).toBe('foo/bar');
    });

    it('should handle both leading and trailing slashes', () => {
      expect(normalizePath('/foo/bar/')).toBe('foo/bar');
    });

    it('should reject parent directory traversal (..)', () => {
      expect(() => normalizePath('../etc/passwd')).toThrow(InvalidPathError);
      expect(() => normalizePath('foo/../bar')).toThrow(InvalidPathError);
      expect(() => normalizePath('foo/bar/..')).toThrow(InvalidPathError);
    });

    it('should reject backslashes', () => {
      expect(() => normalizePath('foo\\bar')).toThrow(InvalidPathError);
      expect(() => normalizePath('C:\\Windows')).toThrow(InvalidPathError);
    });

    it('should preserve normal paths unchanged (except slash normalization)', () => {
      expect(normalizePath('src/lib/github')).toBe('src/lib/github');
      expect(normalizePath('README.md')).toBe('README.md');
    });

    it('should throw InvalidPathError with correct code', () => {
      try {
        normalizePath('..');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidPathError);
        expect((error as InvalidPathError).code).toBe('INVALID_PATH');
      }
    });
  });

  // ========================================
  // Cursor Encoding/Decoding
  // ========================================

  describe('cursor encoding/decoding', () => {
    it('should encode and decode cursor correctly', () => {
      const data = { lastPath: 'src/lib/github.ts', lastSha: 'abc123' };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });

    it('should encode cursor without sha', () => {
      const data = { lastPath: 'README.md' };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });

    it('should return null for invalid cursor', () => {
      expect(decodeCursor('invalid-base64!!!')).toBeNull();
    });

    it('should return null for cursor without lastPath', () => {
      const encoded = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('should produce opaque cursor string', () => {
      const data = { lastPath: 'test.txt' };
      const cursor = encodeCursor(data);

      // Should be base64 (only alphanumeric + / + =)
      expect(cursor).toMatch(/^[A-Za-z0-9+/]+=*$/);
      
      // Should not contain the original path in plaintext
      expect(cursor).not.toContain('test.txt');
    });
  });

  // ========================================
  // Sorting
  // ========================================

  describe('sortByPath', () => {
    it('should sort entries by path ascending', () => {
      const entries: TreeEntry[] = [
        { type: 'file', path: 'z.txt', name: 'z.txt', sha: null, size: null },
        { type: 'file', path: 'a.txt', name: 'a.txt', sha: null, size: null },
        { type: 'file', path: 'm.txt', name: 'm.txt', sha: null, size: null },
      ];

      const sorted = sortByPath(entries);

      expect(sorted.map((e) => e.path)).toEqual(['a.txt', 'm.txt', 'z.txt']);
    });

    it('should sort with case sensitivity', () => {
      const entries: TreeEntry[] = [
        { type: 'file', path: 'z.txt', name: 'z.txt', sha: null, size: null },
        { type: 'file', path: 'A.txt', name: 'A.txt', sha: null, size: null },
        { type: 'file', path: 'a.txt', name: 'a.txt', sha: null, size: null },
      ];

      const sorted = sortByPath(entries);

      // Uppercase comes before lowercase in ASCII
      expect(sorted[0].path).toBe('A.txt');
      expect(sorted[1].path).toBe('a.txt');
      expect(sorted[2].path).toBe('z.txt');
    });

    it('should be deterministic (stable sort)', () => {
      const entries: TreeEntry[] = [
        { type: 'file', path: 'b.txt', name: 'b.txt', sha: 'sha1', size: 10 },
        { type: 'file', path: 'a.txt', name: 'a.txt', sha: 'sha2', size: 20 },
        { type: 'file', path: 'b.txt', name: 'b.txt', sha: 'sha3', size: 30 },
      ];

      const sorted1 = sortByPath(entries);
      const sorted2 = sortByPath(entries);

      expect(sorted1).toEqual(sorted2);
    });

    it('should not mutate original array', () => {
      const entries: TreeEntry[] = [
        { type: 'file', path: 'z.txt', name: 'z.txt', sha: null, size: null },
        { type: 'file', path: 'a.txt', name: 'a.txt', sha: null, size: null },
      ];

      const original = [...entries];
      sortByPath(entries);

      expect(entries).toEqual(original);
    });
  });

  // ========================================
  // Pagination
  // ========================================

  describe('paginateEntries', () => {
    const mockEntries: TreeEntry[] = [
      { type: 'file', path: 'a.txt', name: 'a.txt', sha: 'sha1', size: 10 },
      { type: 'file', path: 'b.txt', name: 'b.txt', sha: 'sha2', size: 20 },
      { type: 'file', path: 'c.txt', name: 'c.txt', sha: 'sha3', size: 30 },
      { type: 'file', path: 'd.txt', name: 'd.txt', sha: 'sha4', size: 40 },
      { type: 'file', path: 'e.txt', name: 'e.txt', sha: 'sha5', size: 50 },
    ];

    it('should return first page without cursor', () => {
      const result = paginateEntries(mockEntries, undefined, 2);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].path).toBe('a.txt');
      expect(result.items[1].path).toBe('b.txt');
      expect(result.nextCursor).not.toBeNull();
    });

    it('should return second page with cursor', () => {
      // Get first page
      const page1 = paginateEntries(mockEntries, undefined, 2);
      
      // Get second page using cursor from first page
      const page2 = paginateEntries(mockEntries, page1.nextCursor!, 2);

      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].path).toBe('c.txt');
      expect(page2.items[1].path).toBe('d.txt');
    });

    it('should return null cursor on last page', () => {
      const result = paginateEntries(mockEntries, undefined, 10);

      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBeNull();
    });

    it('should handle exact page boundary', () => {
      const result = paginateEntries(mockEntries, undefined, 5);

      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBeNull();
    });

    it('should not have duplicates across pages', () => {
      const allPaths: string[] = [];
      let cursor: string | undefined;
      
      // Paginate through all entries
      while (true) {
        const result = paginateEntries(mockEntries, cursor, 2);
        allPaths.push(...result.items.map((e) => e.path));
        
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }

      // Check no duplicates
      const uniquePaths = new Set(allPaths);
      expect(uniquePaths.size).toBe(allPaths.length);
      
      // Check all items were returned
      expect(allPaths.length).toBe(mockEntries.length);
    });

    it('should not have gaps across pages', () => {
      const allPaths: string[] = [];
      let cursor: string | undefined;
      
      // Paginate through all entries
      while (true) {
        const result = paginateEntries(mockEntries, cursor, 2);
        allPaths.push(...result.items.map((e) => e.path));
        
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }

      // Verify we got all items in order
      expect(allPaths).toEqual(mockEntries.map((e) => e.path));
    });

    it('should return empty array for cursor beyond end', () => {
      const cursor = encodeCursor({ lastPath: 'z.txt' });
      const result = paginateEntries(mockEntries, cursor, 10);

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });

  // ========================================
  // Integration: listTree Function
  // ========================================

  describe('listTree', () => {
    const mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn(),
        },
        git: {
          getRef: jest.fn(),
          getCommit: jest.fn(),
          getTree: jest.fn(),
        },
      },
    };

    beforeEach(() => {
      mockCreateClient.mockResolvedValue(mockOctokit as any);
    });

    it('should enforce policy via auth wrapper', async () => {
      mockCreateClient.mockRejectedValue(
        new RepoAccessDeniedError({ owner: 'test', repo: 'repo' })
      );

      await expect(
        listTree({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: '',
          recursive: false,
        })
      ).rejects.toThrow(RepoAccessDeniedError);
    });

    it('should return sorted entries for non-recursive listing', async () => {
      // Mock GitHub API response (unsorted)
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: [
          { type: 'file', path: 'z.txt', name: 'z.txt', sha: 'sha3', size: 30 },
          { type: 'file', path: 'a.txt', name: 'a.txt', sha: 'sha1', size: 10 },
          { type: 'dir', path: 'lib', name: 'lib', sha: 'sha2', size: null },
        ],
      });

      const result = await listTree({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: '',
        recursive: false,
        limit: 10,
      });

      // Verify sorting
      expect(result.items.map((e) => e.path)).toEqual(['a.txt', 'lib', 'z.txt']);
      
      // Verify metadata
      expect(result.meta.ordering).toBe('path_asc');
      expect(result.meta.owner).toBe('test');
      expect(result.meta.repo).toBe('repo');
      expect(result.meta.branch).toBe('main');
      expect(result.meta.recursive).toBe(false);
    });

    it('should handle pagination correctly', async () => {
      // Mock large directory
      const mockFiles = Array.from({ length: 5 }, (_, i) => ({
        type: 'file',
        path: `file${i}.txt`,
        name: `file${i}.txt`,
        sha: `sha${i}`,
        size: i * 10,
      }));

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: mockFiles,
      });

      // Get first page
      const page1 = await listTree({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: '',
        recursive: false,
        limit: 2,
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.pageInfo.nextCursor).not.toBeNull();

      // Get second page
      const page2 = await listTree({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: '',
        recursive: false,
        cursor: page1.pageInfo.nextCursor!,
        limit: 2,
      });

      expect(page2.items).toHaveLength(2);
      
      // Verify no duplicates
      const page1Paths = page1.items.map((e) => e.path);
      const page2Paths = page2.items.map((e) => e.path);
      const overlap = page1Paths.filter((p) => page2Paths.includes(p));
      expect(overlap).toHaveLength(0);
    });

    it('should validate path and reject traversal', async () => {
      await expect(
        listTree({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: '../etc/passwd',
          recursive: false,
        })
      ).rejects.toThrow(InvalidPathError);

      // Verify auth wrapper was NOT called
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('should handle recursive mode', async () => {
      // Mock Git API responses
      mockOctokit.rest.git.getRef.mockResolvedValue({
        data: { object: { sha: 'commit-sha' } },
      });

      mockOctokit.rest.git.getCommit.mockResolvedValue({
        data: { tree: { sha: 'tree-sha' } },
      });

      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          truncated: false,
          tree: [
            { type: 'blob', path: 'README.md', sha: 'sha1', size: 100 },
            { type: 'tree', path: 'src', sha: 'sha2', size: null },
            { type: 'blob', path: 'src/index.ts', sha: 'sha3', size: 200 },
          ],
        },
      });

      const result = await listTree({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: '',
        recursive: true,
        limit: 10,
      });

      expect(result.items).toHaveLength(3);
      expect(result.meta.recursive).toBe(true);
      
      // Verify sorted
      expect(result.items[0].path).toBe('README.md');
      expect(result.items[1].path).toBe('src');
      expect(result.items[2].path).toBe('src/index.ts');
    });

    it('should throw TreeTooLargeError when tree is truncated', async () => {
      mockOctokit.rest.git.getRef.mockResolvedValue({
        data: { object: { sha: 'commit-sha' } },
      });

      mockOctokit.rest.git.getCommit.mockResolvedValue({
        data: { tree: { sha: 'tree-sha' } },
      });

      mockOctokit.rest.git.getTree.mockResolvedValue({
        data: {
          truncated: true,
          tree: [],
        },
      });

      await expect(
        listTree({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: '',
          recursive: true,
        })
      ).rejects.toThrow(TreeTooLargeError);
    });

    it('should throw GitHubAPIError for 404', async () => {
      mockOctokit.rest.repos.getContent.mockRejectedValue({
        status: 404,
        message: 'Not Found',
      });

      await expect(
        listTree({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'nonexistent',
          recursive: false,
        })
      ).rejects.toThrow(GitHubAPIError);
    });

    it('should include generatedAt timestamp', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: [],
      });

      const before = new Date().toISOString();
      const result = await listTree({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: '',
        recursive: false,
      });
      const after = new Date().toISOString();

      expect(result.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.meta.generatedAt >= before).toBe(true);
      expect(result.meta.generatedAt <= after).toBe(true);
    });

    it('should normalize path in request', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: [],
      });

      await listTree({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: '/src/lib/',
        recursive: false,
      });

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'test',
        repo: 'repo',
        path: 'src/lib',
        ref: 'main',
      });
    });
  });
});
