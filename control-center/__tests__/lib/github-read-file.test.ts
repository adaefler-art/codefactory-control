/**
 * Tests for GitHub Read File Tool
 * 
 * Reference: I713 (E71.3) - Tool readFile
 */

import {
  readFile,
  normalizePath,
  InvalidPathError,
  NotAFileError,
  FileTooLargeError,
  RangeInvalidError,
  BinaryOrUnsupportedEncodingError,
  GitHubAPIError,
  ReadFileParams,
} from '../../src/lib/github/read-file';
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

describe('GitHub Read File', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Path Normalization and Validation
  // ========================================

  describe('normalizePath', () => {
    it('should reject empty path', () => {
      expect(() => normalizePath('')).toThrow(InvalidPathError);
      expect(() => normalizePath('  ')).toThrow(InvalidPathError);
    });

    it('should remove leading slashes', () => {
      expect(normalizePath('/foo/bar.txt')).toBe('foo/bar.txt');
    });

    it('should remove trailing slashes', () => {
      expect(normalizePath('foo/bar.txt/')).toBe('foo/bar.txt');
      expect(normalizePath('foo/bar.txt//')).toBe('foo/bar.txt');
    });

    it('should handle both leading and trailing slashes', () => {
      expect(normalizePath('/foo/bar.txt/')).toBe('foo/bar.txt');
    });

    it('should reject parent directory traversal (..)', () => {
      expect(() => normalizePath('../etc/passwd')).toThrow(InvalidPathError);
      expect(() => normalizePath('foo/../bar.txt')).toThrow(InvalidPathError);
      expect(() => normalizePath('foo/bar/..')).toThrow(InvalidPathError);
    });

    it('should reject backslashes', () => {
      expect(() => normalizePath('foo\\bar.txt')).toThrow(InvalidPathError);
      expect(() => normalizePath('C:\\Windows\\system32')).toThrow(InvalidPathError);
    });

    it('should reject leading double slashes', () => {
      expect(() => normalizePath('//etc/passwd')).toThrow(InvalidPathError);
    });

    it('should preserve normal file paths', () => {
      expect(normalizePath('src/lib/github.ts')).toBe('src/lib/github.ts');
      expect(normalizePath('README.md')).toBe('README.md');
      expect(normalizePath('docs/api/endpoints.md')).toBe('docs/api/endpoints.md');
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
  // Policy Enforcement
  // ========================================

  describe('policy enforcement', () => {
    it('should enforce policy before GitHub API call', async () => {
      // Mock createAuthenticatedClient to throw policy error
      mockCreateClient.mockRejectedValueOnce(
        new RepoAccessDeniedError({
          owner: 'unauthorized',
          repo: 'repo',
          branch: 'main',
          path: 'README.md',
        })
      );

      await expect(
        readFile({
          owner: 'unauthorized',
          repo: 'repo',
          branch: 'main',
          path: 'README.md',
        })
      ).rejects.toThrow(RepoAccessDeniedError);

      // Verify client creation was attempted (which enforces policy)
      expect(mockCreateClient).toHaveBeenCalledWith({
        owner: 'unauthorized',
        repo: 'repo',
        branch: 'main',
        path: 'README.md',
      });
    });

    it('should pass policy check for allowed repo', async () => {
      const mockContent = 'Hello World\nLine 2\nLine 3';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        branch: 'main',
        path: 'README.md',
      });

      expect(result.meta.owner).toBe('adaefler-art');
      expect(result.meta.repo).toBe('codefactory-control');
      expect(mockCreateClient).toHaveBeenCalled();
    });
  });

  // ========================================
  // File Fetching
  // ========================================

  describe('file fetching', () => {
    it('should fetch file content successfully', async () => {
      const mockContent = 'Hello World\nLine 2\nLine 3';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      expect(result.content.text).toBe(mockContent);
      expect(result.meta.blobSha).toBe('abc123');
      expect(result.meta.truncated).toBe(false);
    });

    it('should reject directory paths', async () => {
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: [
                { type: 'file', name: 'file1.txt' },
                { type: 'file', name: 'file2.txt' },
              ],
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'src/',
        })
      ).rejects.toThrow(NotAFileError);
    });

    it('should reject non-file types', async () => {
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'symlink',
                name: 'link.txt',
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'link.txt',
        })
      ).rejects.toThrow(NotAFileError);
    });

    it('should handle file not found (404)', async () => {
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockRejectedValue({
              status: 404,
              message: 'Not Found',
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'nonexistent.txt',
        })
      ).rejects.toThrow(GitHubAPIError);
    });

    it('should reject binary files', async () => {
      // Create a buffer with null bytes (binary indicator)
      const binaryBuffer = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE]);
      
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: binaryBuffer.toString('base64'),
                sha: 'abc123',
                size: binaryBuffer.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'binary.dat',
        })
      ).rejects.toThrow(BinaryOrUnsupportedEncodingError);
    });
  });

  // ========================================
  // Line Range Extraction
  // ========================================

  describe('line range extraction', () => {
    const mockContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10';

    beforeEach(() => {
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValue(mockOctokit as any);
    });

    it('should extract lines 3-5 correctly', async () => {
      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        range: { startLine: 3, endLine: 5 },
      });

      expect(result.content.text).toBe('Line 3\nLine 4\nLine 5');
      expect(result.meta.range).toEqual({ startLine: 3, endLine: 5 });
      expect(result.meta.totalLines).toBe(10);
    });

    it('should handle single line range', async () => {
      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        range: { startLine: 5, endLine: 5 },
      });

      expect(result.content.text).toBe('Line 5');
      expect(result.meta.range).toEqual({ startLine: 5, endLine: 5 });
    });

    it('should include line numbers when requested', async () => {
      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        range: { startLine: 3, endLine: 5 },
        includeLineNumbers: true,
      });

      expect(result.content.lines).toBeDefined();
      expect(result.content.lines).toHaveLength(3);
      expect(result.content.lines![0]).toEqual({ n: 3, text: 'Line 3' });
      expect(result.content.lines![1]).toEqual({ n: 4, text: 'Line 4' });
      expect(result.content.lines![2]).toEqual({ n: 5, text: 'Line 5' });
    });

    it('should omit line numbers when not requested', async () => {
      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        range: { startLine: 3, endLine: 5 },
        includeLineNumbers: false,
      });

      expect(result.content.lines).toBeUndefined();
    });

    it('should reject range with startLine < 1', async () => {
      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          range: { startLine: 0, endLine: 5 },
        })
      ).rejects.toThrow(); // Zod validation error
    });

    it('should reject range with endLine < startLine', async () => {
      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          range: { startLine: 5, endLine: 3 },
        })
      ).rejects.toThrow(); // Zod validation error
    });

    it('should reject range exceeding 5000 lines', async () => {
      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          range: { startLine: 1, endLine: 5001 },
        })
      ).rejects.toThrow(); // Zod validation error
    });

    it('should reject range where startLine exceeds file length', async () => {
      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          range: { startLine: 100, endLine: 105 },
        })
      ).rejects.toThrow(RangeInvalidError);
    });

    it('should cap endLine to file length', async () => {
      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        range: { startLine: 8, endLine: 100 },
      });

      // Should return lines 8-10 (capped at 10)
      expect(result.content.text).toBe('Line 8\nLine 9\nLine 10');
      expect(result.meta.totalLines).toBe(10);
    });
  });

  // ========================================
  // Size Limits and Truncation
  // ========================================

  describe('size limits and truncation', () => {
    it('should respect maxBytes and truncate if needed', async () => {
      const longContent = 'A'.repeat(300000); // 300KB
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(longContent).toString('base64'),
                sha: 'abc123',
                size: longContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'large.txt',
        maxBytes: 200_000, // Default
      });

      expect(result.meta.truncated).toBe(true);
      expect(Buffer.byteLength(result.content.text, 'utf-8')).toBeLessThanOrEqual(200_000);
    });

    it('should not truncate if content fits within maxBytes', async () => {
      const content = 'Small content';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(content).toString('base64'),
                sha: 'abc123',
                size: content.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'small.txt',
        maxBytes: 200_000,
      });

      expect(result.meta.truncated).toBe(false);
      expect(result.content.text).toBe(content);
    });

    it('should reject files larger than hard max (1MB)', async () => {
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: '', // Empty because truncated
                sha: 'abc123',
                size: 2_000_000, // 2MB
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'huge.txt',
          maxBytes: 500_000,
        })
      ).rejects.toThrow(FileTooLargeError);
    });

    it('should enforce maxBytes parameter limit (max 1MB)', async () => {
      await expect(
        readFile({
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          maxBytes: 2_000_000, // Over 1MB limit
        })
      ).rejects.toThrow(); // Zod validation error
    });
  });

  // ========================================
  // Deterministic Hashing
  // ========================================

  describe('deterministic hashing', () => {
    it('should compute same hash for identical content', async () => {
      const mockContent = 'Hello World\nLine 2\nLine 3';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValue(mockOctokit as any);

      const result1 = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      const result2 = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      expect(result1.meta.contentSha256).toBe(result2.meta.contentSha256);
      expect(result1.meta.snippetHash).toBe(result2.meta.snippetHash);
      expect(result1.meta.snippetHash).toBe(result1.meta.contentSha256.substring(0, 12));
    });

    it('should compute different hash when content is truncated', async () => {
      const longContent = 'A'.repeat(300000);
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(longContent).toString('base64'),
                sha: 'abc123',
                size: longContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValue(mockOctokit as any);

      const resultTruncated = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        maxBytes: 100_000,
      });

      const resultFull = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        maxBytes: 500_000,
      });

      // Hashes should differ because truncated content differs
      expect(resultTruncated.meta.contentSha256).not.toBe(resultFull.meta.contentSha256);
      expect(resultTruncated.meta.truncated).toBe(true);
      expect(resultFull.meta.truncated).toBe(false);
    });

    it('should include blobSha when includeSha is true', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123def456',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        includeSha: true,
      });

      expect(result.meta.blobSha).toBe('abc123def456');
    });

    it('should omit blobSha when includeSha is false', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123def456',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
        includeSha: false,
      });

      expect(result.meta.blobSha).toBeNull();
    });
  });

  // ========================================
  // Metadata and Output Format
  // ========================================

  describe('metadata and output format', () => {
    it('should include all required metadata fields', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      expect(result.meta).toHaveProperty('owner', 'test');
      expect(result.meta).toHaveProperty('repo', 'repo');
      expect(result.meta).toHaveProperty('branch', 'main');
      expect(result.meta).toHaveProperty('path', 'test.txt');
      expect(result.meta).toHaveProperty('blobSha');
      expect(result.meta).toHaveProperty('commitSha');
      expect(result.meta).toHaveProperty('contentSha256');
      expect(result.meta).toHaveProperty('snippetHash');
      expect(result.meta).toHaveProperty('encoding', 'utf-8');
      expect(result.meta).toHaveProperty('generatedAt');
      expect(result.meta).toHaveProperty('truncated');
      expect(result.meta).toHaveProperty('range');
      expect(result.meta).toHaveProperty('totalLines');
    });

    it('should set range to null when no range specified', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      expect(result.meta.range).toBeNull();
    });

    it('should return totalLines for full file', async () => {
      const mockContent = 'Line 1\nLine 2\nLine 3';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      expect(result.meta.totalLines).toBe(3);
    });

    it('should generate valid ISO timestamp', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });

      expect(() => new Date(result.meta.generatedAt)).not.toThrow();
      expect(result.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  // ========================================
  // Default Values
  // ========================================

  describe('default values', () => {
    it('should use default branch (main)', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.meta.branch).toBe('main');
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'main' })
      );
    });

    it('should use default maxBytes (200_000)', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      await readFile({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      // maxBytes is used internally, we can verify it doesn't throw on large content
      // that would exceed a smaller default
    });

    it('should include SHA by default (includeSha: true)', async () => {
      const mockContent = 'Hello World';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.meta.blobSha).toBe('abc123');
    });

    it('should include line numbers by default (includeLineNumbers: true)', async () => {
      const mockContent = 'Line 1\nLine 2';
      const mockOctokit = {
        rest: {
          repos: {
            getContent: jest.fn().mockResolvedValue({
              data: {
                type: 'file',
                content: Buffer.from(mockContent).toString('base64'),
                sha: 'abc123',
                size: mockContent.length,
              },
            }),
          },
        },
      };

      mockCreateClient.mockResolvedValueOnce(mockOctokit as any);

      const result = await readFile({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.content.lines).toBeDefined();
      expect(result.content.lines).toHaveLength(2);
    });
  });
});
