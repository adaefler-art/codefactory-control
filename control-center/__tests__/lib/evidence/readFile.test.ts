/**
 * Tests for Evidence Tool: readFile
 * 
 * Validates:
 * - Line range extraction (off-by-one tests)
 * - Hash stability over identical snippets
 * - Binary/oversize error handling (413/415)
 * - Allowlist enforcement
 * - Size limits and truncation
 * - Deterministic output with line ending normalization
 * 
 * Reference: I893 (E89.3) - Evidence Tool "readFile"
 */

import {
  readFileEvidence,
  MAX_EVIDENCE_FILE_SIZE,
  MAX_EVIDENCE_LINES,
} from '../../../src/lib/evidence/readFile';

// Mock the GitHub read-file module
jest.mock('../../../src/lib/github/read-file', () => {
  const actual = jest.requireActual('../../../src/lib/github/policy');
  return {
    ...jest.requireActual('../../../src/lib/github/read-file'),
    readFile: jest.fn(),
    RepoAccessDeniedError: actual.RepoAccessDeniedError,
  };
});

import { readFile as mockReadFile } from '../../../src/lib/github/read-file';
import { RepoAccessDeniedError } from '../../../src/lib/github/policy';

const mockGitHubReadFile = mockReadFile as jest.MockedFunction<typeof mockReadFile>;

describe('Evidence Tool: readFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Basic Functionality
  // ========================================

  describe('basic file reading', () => {
    it('should read file content successfully', async () => {
      const mockContent = 'Hello World\nLine 2\nLine 3';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 3,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe(mockContent);
      expect(result.meta?.owner).toBe('test');
      expect(result.meta?.repo).toBe('repo');
      expect(result.meta?.path).toBe('test.txt');
      expect(result.meta?.ref).toBe('main');
    });

    it('should use default ref "main" when not specified', async () => {
      const mockContent = 'Test content';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.ref).toBe('main');
      expect(mockGitHubReadFile).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'main' })
      );
    });

    it('should use custom ref when specified', async () => {
      const mockContent = 'Test content';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'feature-branch',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        ref: 'feature-branch',
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.ref).toBe('feature-branch');
      expect(mockGitHubReadFile).toHaveBeenCalledWith(
        expect.objectContaining({ branch: 'feature-branch' })
      );
    });
  });

  // ========================================
  // Line Range Extraction (Off-by-One Tests)
  // ========================================

  describe('line range extraction', () => {
    it('should extract lines 3-5 correctly (inclusive)', async () => {
      const mockContent = 'Line 3\nLine 4\nLine 5';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: { startLine: 3, endLine: 5 },
          totalLines: 10,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        startLine: 3,
        endLine: 5,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe(mockContent);
      expect(result.meta?.startLine).toBe(3);
      expect(result.meta?.endLine).toBe(5);
      expect(result.meta?.totalLines).toBe(10);
    });

    it('should handle single line range (startLine === endLine)', async () => {
      const mockContent = 'Line 5';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: { startLine: 5, endLine: 5 },
          totalLines: 10,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        startLine: 5,
        endLine: 5,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe(mockContent);
      expect(result.meta?.startLine).toBe(5);
      expect(result.meta?.endLine).toBe(5);
    });

    it('should reject range exceeding MAX_EVIDENCE_LINES (400)', async () => {
      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        startLine: 1,
        endLine: MAX_EVIDENCE_LINES + 1,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MAX_LINES_EXCEEDED');
      expect(result.error).toContain('400');
    });

    it('should accept range exactly at MAX_EVIDENCE_LINES (400)', async () => {
      const mockContent = 'A'.repeat(MAX_EVIDENCE_LINES);
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: { startLine: 1, endLine: MAX_EVIDENCE_LINES },
          totalLines: MAX_EVIDENCE_LINES,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        startLine: 1,
        endLine: MAX_EVIDENCE_LINES,
      });

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // Deterministic Hashing
  // ========================================

  describe('deterministic hashing', () => {
    it('should compute same hash for identical content', async () => {
      const mockContent = 'Hello World\nLine 2\nLine 3';
      mockGitHubReadFile.mockResolvedValue({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 3,
        },
        content: {
          text: mockContent,
        },
      });

      const result1 = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      const result2 = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result1.meta?.sha256).toBe(result2.meta?.sha256);
      expect(result1.meta?.snippetHash).toBe(result2.meta?.snippetHash);
    });

    it('should normalize line endings for hash stability', async () => {
      // Test with \r\n
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 2,
        },
        content: {
          text: 'Line 1\r\nLine 2',
        },
      });

      const resultCRLF = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      // Test with \n
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 2,
        },
        content: {
          text: 'Line 1\nLine 2',
        },
      });

      const resultLF = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      // Hashes should be identical due to normalization
      expect(resultCRLF.meta?.sha256).toBe(resultLF.meta?.sha256);
      expect(resultCRLF.meta?.snippetHash).toBe(resultLF.meta?.snippetHash);
    });

    it('should return snippetHash as first 12 chars of sha256', async () => {
      const mockContent = 'Test content';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.meta?.snippetHash).toBe(result.meta?.sha256.substring(0, 12));
      expect(result.meta?.snippetHash).toHaveLength(12);
    });
  });

  // ========================================
  // Size Limits and Truncation
  // ========================================

  describe('size limits and truncation', () => {
    it('should enforce MAX_EVIDENCE_FILE_SIZE (256KB)', async () => {
      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        maxBytes: MAX_EVIDENCE_FILE_SIZE + 1,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('MAX_BYTES_EXCEEDED');
      expect(result.error).toContain('262144'); // MAX_EVIDENCE_FILE_SIZE in bytes
    });

    it('should accept maxBytes exactly at MAX_EVIDENCE_FILE_SIZE', async () => {
      const mockContent = 'A'.repeat(1000);
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        maxBytes: MAX_EVIDENCE_FILE_SIZE,
      });

      expect(result.success).toBe(true);
    });

    it('should report truncation when content exceeds maxBytes', async () => {
      const mockContent = 'A'.repeat(100);
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: true,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        maxBytes: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.meta?.truncated).toBe(true);
      expect(result.meta?.truncatedReason).toContain('maxBytes');
    });

    it('should not report truncation when content fits within maxBytes', async () => {
      const mockContent = 'Small content';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.meta?.truncated).toBe(false);
      expect(result.meta?.truncatedReason).toBeUndefined();
    });
  });

  // ========================================
  // Error Handling (413/415)
  // ========================================

  describe('error handling', () => {
    it('should map FILE_TOO_LARGE to 413 error code', async () => {
      const error = new Error('File too large');
      (error as any).code = 'FILE_TOO_LARGE';
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'huge.txt',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FILE_TOO_LARGE_413');
    });

    it('should map BINARY_OR_UNSUPPORTED_ENCODING to 415 error code', async () => {
      const error = new Error('Binary file detected');
      (error as any).code = 'BINARY_OR_UNSUPPORTED_ENCODING';
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'binary.dat',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE_415');
    });

    it('should map RANGE_INVALID to 416 error code', async () => {
      const error = new Error('Invalid range');
      (error as any).code = 'RANGE_INVALID';
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        startLine: 100,
        endLine: 50,
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('RANGE_INVALID_416');
    });

    it('should map INVALID_PATH to 400 error code', async () => {
      const error = new Error('Invalid path');
      (error as any).code = 'INVALID_PATH';
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: '../etc/passwd',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH_400');
    });

    it('should map NOT_A_FILE to 400 error code', async () => {
      const error = new Error('Not a file');
      (error as any).code = 'NOT_A_FILE';
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'src/',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NOT_A_FILE_400');
    });

    it('should map REPO_ACCESS_DENIED to 403 error code', async () => {
      const error = new RepoAccessDeniedError({
        owner: 'unauthorized',
        repo: 'repo',
        branch: 'main',
        path: 'test.txt',
      });
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'unauthorized',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('REPO_ACCESS_DENIED_403');
    });

    it('should handle unknown errors gracefully', async () => {
      const error = new Error('Unknown error');
      mockGitHubReadFile.mockRejectedValueOnce(error);

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
      expect(result.errorCode).toBe('UNKNOWN_ERROR');
    });
  });

  // ========================================
  // Metadata Fields
  // ========================================

  describe('metadata fields', () => {
    it('should include all required metadata fields', async () => {
      const mockContent = 'Test content';
      const mockTimestamp = new Date().toISOString();
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123def456',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: mockTimestamp,
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.success).toBe(true);
      expect(result.meta).toHaveProperty('owner', 'test');
      expect(result.meta).toHaveProperty('repo', 'repo');
      expect(result.meta).toHaveProperty('ref', 'main');
      expect(result.meta).toHaveProperty('path', 'test.txt');
      expect(result.meta).toHaveProperty('startLine', null);
      expect(result.meta).toHaveProperty('endLine', null);
      expect(result.meta).toHaveProperty('totalLines', 1);
      expect(result.meta).toHaveProperty('sha256');
      expect(result.meta).toHaveProperty('snippetHash');
      expect(result.meta).toHaveProperty('encoding', 'utf-8');
      expect(result.meta).toHaveProperty('truncated', false);
      expect(result.meta).toHaveProperty('blobSha', 'abc123def456');
      expect(result.meta).toHaveProperty('generatedAt', mockTimestamp);
    });

    it('should set startLine/endLine to null when no range specified', async () => {
      const mockContent = 'Test content';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: null,
          totalLines: 1,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
      });

      expect(result.meta?.startLine).toBeNull();
      expect(result.meta?.endLine).toBeNull();
    });

    it('should include startLine/endLine when range specified', async () => {
      const mockContent = 'Line 3\nLine 4';
      mockGitHubReadFile.mockResolvedValueOnce({
        meta: {
          owner: 'test',
          repo: 'repo',
          branch: 'main',
          path: 'test.txt',
          blobSha: 'abc123',
          commitSha: null,
          contentSha256: 'stub',
          snippetHash: 'stub',
          encoding: 'utf-8',
          generatedAt: new Date().toISOString(),
          truncated: false,
          range: { startLine: 3, endLine: 4 },
          totalLines: 10,
        },
        content: {
          text: mockContent,
        },
      });

      const result = await readFileEvidence({
        owner: 'test',
        repo: 'repo',
        path: 'test.txt',
        startLine: 3,
        endLine: 4,
      });

      expect(result.meta?.startLine).toBe(3);
      expect(result.meta?.endLine).toBe(4);
    });
  });
});
