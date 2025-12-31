/**
 * GitHub Read File Tool (I713 - E71.3)
 * 
 * Server-side tool for reading file contents with:
 * - Line range support (startLine, endLine)
 * - Snippet hashing (SHA-256) for evidence/determinism
 * - Size limits with truncation
 * - Policy enforcement via I711 auth wrapper
 * - Path safety validation
 * 
 * Reference: I713 (E71.3) - Tool readFile (line ranges + snippet-hash, size limits, caching)
 */

import { z } from 'zod';
import { createAuthenticatedClient, RepoAccessDeniedError } from './auth-wrapper';
import { createHash } from 'crypto';

// ========================================
// Schemas and Types
// ========================================

/**
 * Schema for readFile parameters
 */
export const ReadFileParamsSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default('main'),
  path: z.string().min(1),
  range: z.object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
  }).optional().refine(
    (range) => !range || range.endLine >= range.startLine,
    { message: 'endLine must be >= startLine' }
  ).refine(
    (range) => !range || (range.endLine - range.startLine + 1) <= 5000,
    { message: 'Line range cannot exceed 5000 lines' }
  ),
  maxBytes: z.number().int().min(1).max(1_000_000).default(200_000),
  includeSha: z.boolean().default(true),
  includeLineNumbers: z.boolean().default(true),
}).strict();

export type ReadFileParams = z.infer<typeof ReadFileParamsSchema>;

/**
 * Line with number
 */
export interface LineWithNumber {
  n: number;
  text: string;
}

/**
 * Metadata for the response
 */
export interface ReadFileMeta {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  blobSha: string | null;
  commitSha: string | null;
  contentSha256: string;
  snippetHash: string;
  encoding: 'utf-8';
  generatedAt: string;
  truncated: boolean;
  range: { startLine: number; endLine: number } | null;
  totalLines: number | null;
}

/**
 * Content response
 */
export interface ReadFileContent {
  text: string;
  lines?: LineWithNumber[];
}

/**
 * Complete readFile response
 */
export interface ReadFileResult {
  meta: ReadFileMeta;
  content: ReadFileContent;
}

/**
 * Standard error response
 */
export interface ReadFileError {
  code: string;
  message: string;
  details: {
    owner: string;
    repo: string;
    branch?: string;
    path?: string;
    httpStatus?: number;
    maxBytes?: number;
    startLine?: number;
    endLine?: number;
    requestId?: string;
  };
}

// ========================================
// Error Classes
// ========================================

export class InvalidPathError extends Error {
  public readonly code = 'INVALID_PATH';
  public readonly details: ReadFileError['details'];

  constructor(path: string, reason: string, details: Partial<ReadFileError['details']> = {}) {
    super(`Invalid path '${path}': ${reason}`);
    this.name = 'InvalidPathError';
    this.details = {
      owner: details.owner || '',
      repo: details.repo || '',
      path,
      ...details,
    };
  }
}

export class NotAFileError extends Error {
  public readonly code = 'NOT_A_FILE';
  public readonly details: ReadFileError['details'];

  constructor(path: string, details: Partial<ReadFileError['details']> = {}) {
    super(`Path '${path}' is not a file`);
    this.name = 'NotAFileError';
    this.details = {
      owner: details.owner || '',
      repo: details.repo || '',
      path,
      ...details,
    };
  }
}

export class FileTooLargeError extends Error {
  public readonly code = 'FILE_TOO_LARGE';
  public readonly details: ReadFileError['details'];

  constructor(message: string, details: ReadFileError['details']) {
    super(message);
    this.name = 'FileTooLargeError';
    this.details = details;
  }
}

export class RangeInvalidError extends Error {
  public readonly code = 'RANGE_INVALID';
  public readonly details: ReadFileError['details'];

  constructor(message: string, details: ReadFileError['details']) {
    super(message);
    this.name = 'RangeInvalidError';
    this.details = details;
  }
}

export class BinaryOrUnsupportedEncodingError extends Error {
  public readonly code = 'BINARY_OR_UNSUPPORTED_ENCODING';
  public readonly details: ReadFileError['details'];

  constructor(path: string, details: Partial<ReadFileError['details']> = {}) {
    super(`File '${path}' is binary or has unsupported encoding (only UTF-8 supported)`);
    this.name = 'BinaryOrUnsupportedEncodingError';
    this.details = {
      owner: details.owner || '',
      repo: details.repo || '',
      path,
      ...details,
    };
  }
}

export class GitHubAPIError extends Error {
  public readonly code = 'GITHUB_API_ERROR';
  public readonly details: ReadFileError['details'];

  constructor(message: string, details: ReadFileError['details']) {
    super(message);
    this.name = 'GitHubAPIError';
    this.details = details;
  }
}

export class AuthMisconfiguredError extends Error {
  public readonly code = 'AUTH_MISCONFIGURED';
  public readonly details: ReadFileError['details'];

  constructor(message: string, details: ReadFileError['details']) {
    super(message);
    this.name = 'AuthMisconfiguredError';
    this.details = details;
  }
}

// ========================================
// Path Validation & Normalization
// ========================================

/**
 * Normalize and validate a path
 * - Remove leading/trailing slashes
 * - Reject ".." traversal
 * - Reject backslashes
 * - Reject empty paths
 * - Return normalized path or throw InvalidPathError
 */
export function normalizePath(path: string, details?: Partial<ReadFileError['details']>): string {
  // Reject empty path
  if (!path || path.trim() === '') {
    throw new InvalidPathError(path, 'Path cannot be empty', details);
  }

  // Reject leading double slashes (before normalization)
  if (path.startsWith('//')) {
    throw new InvalidPathError(path, 'Paths starting with // not allowed', details);
  }

  // Reject backslashes
  if (path.includes('\\')) {
    throw new InvalidPathError(path, 'Backslashes not allowed', details);
  }

  // Reject parent directory traversal
  if (path.includes('..')) {
    throw new InvalidPathError(path, 'Parent directory traversal (..) not allowed', details);
  }

  // Normalize: remove leading/trailing slashes
  let normalized = path.trim();
  normalized = normalized.replace(/^\/+/, ''); // Remove leading slashes
  normalized = normalized.replace(/\/+$/, ''); // Remove trailing slashes

  // Reject absolute paths that weren't caught above
  if (normalized.startsWith('/')) {
    throw new InvalidPathError(path, 'Absolute paths not allowed', details);
  }

  return normalized;
}

// ========================================
// UTF-8 Validation
// ========================================

/**
 * Check if a buffer contains valid UTF-8 text
 * This is a best-effort check for binary files
 */
function isValidUtf8(buffer: Buffer): boolean {
  try {
    const text = buffer.toString('utf-8');
    // Check for null bytes (common in binary files)
    if (text.includes('\0')) {
      return false;
    }
    // Re-encode and compare to check for invalid sequences
    const reencoded = Buffer.from(text, 'utf-8');
    return buffer.equals(reencoded);
  } catch {
    return false;
  }
}

// ========================================
// Hashing
// ========================================

/**
 * Compute SHA-256 hash of content
 */
function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Get short hash (first 12 chars of SHA-256)
 */
function getSnippetHash(sha256: string): string {
  return sha256.substring(0, 12);
}

// ========================================
// Line Processing
// ========================================

/**
 * Split text into lines (normalize to \n)
 */
function splitLines(text: string): string[] {
  // Normalize line endings to \n
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split('\n');
}

/**
 * Extract line range from text
 */
function extractLineRange(
  text: string,
  startLine: number,
  endLine: number,
  owner: string,
  repo: string,
  branch: string,
  path: string
): { text: string; totalLines: number } {
  const lines = splitLines(text);
  const totalLines = lines.length;

  // Validate range
  if (startLine < 1) {
    throw new RangeInvalidError(
      `startLine must be >= 1 (got ${startLine})`,
      { owner, repo, branch, path, startLine, endLine }
    );
  }

  if (endLine < startLine) {
    throw new RangeInvalidError(
      `endLine must be >= startLine (got startLine=${startLine}, endLine=${endLine})`,
      { owner, repo, branch, path, startLine, endLine }
    );
  }

  if (endLine - startLine > 5000) {
    throw new RangeInvalidError(
      `Line range cannot exceed 5000 lines (got ${endLine - startLine + 1})`,
      { owner, repo, branch, path, startLine, endLine }
    );
  }

  if (startLine > totalLines) {
    throw new RangeInvalidError(
      `startLine ${startLine} exceeds file length (${totalLines} lines)`,
      { owner, repo, branch, path, startLine, endLine }
    );
  }

  // Extract lines (convert to 0-based index)
  const actualEndLine = Math.min(endLine, totalLines);
  const selectedLines = lines.slice(startLine - 1, actualEndLine);

  return {
    text: selectedLines.join('\n'),
    totalLines,
  };
}

/**
 * Convert text to lines with numbers
 */
function textToLinesWithNumbers(text: string, startLine: number = 1): LineWithNumber[] {
  const lines = splitLines(text);
  return lines.map((line, index) => ({
    n: startLine + index,
    text: line,
  }));
}

// ========================================
// Size Enforcement
// ========================================

/**
 * Truncate text to fit within maxBytes
 */
function truncateToMaxBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const textBytes = Buffer.byteLength(text, 'utf-8');
  
  if (textBytes <= maxBytes) {
    return { text, truncated: false };
  }

  // Truncate by slicing the buffer
  const buffer = Buffer.from(text, 'utf-8');
  const truncatedBuffer = buffer.subarray(0, maxBytes);
  
  // Decode back to string (may cut mid-character, so handle gracefully)
  let truncatedText = truncatedBuffer.toString('utf-8');
  
  // Remove any partial character at the end
  // UTF-8 continuation bytes start with 10xxxxxx (0x80-0xBF)
  while (truncatedText.length > 0) {
    const lastCharCode = truncatedText.charCodeAt(truncatedText.length - 1);
    // Check if it's a replacement character (�) which indicates incomplete UTF-8
    if (lastCharCode === 0xFFFD) {
      truncatedText = truncatedText.substring(0, truncatedText.length - 1);
    } else {
      break;
    }
  }

  return { text: truncatedText, truncated: true };
}

// ========================================
// GitHub API Adapters
// ========================================

interface FetchedFile {
  content: string;
  blobSha: string | null;
  commitSha: string | null;
}

/**
 * Fetch file from GitHub using Contents API or Git Blob API
 */
async function fetchFile(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  maxBytes: number
): Promise<FetchedFile> {
  try {
    // Try Contents API first (works for files up to 1MB)
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    // Check if it's a file
    if (Array.isArray(response.data)) {
      throw new NotAFileError(path, { owner, repo, branch });
    }

    if (response.data.type !== 'file') {
      throw new NotAFileError(path, { owner, repo, branch });
    }

    // Check if content is available
    if (!response.data.content) {
      // File is too large for Contents API, fall back to Git Blob API
      if (response.data.size && response.data.size > 1_000_000) {
        throw new FileTooLargeError(
          `File size (${response.data.size} bytes) exceeds maximum supported size (1,000,000 bytes)`,
          { owner, repo, branch, path, maxBytes }
        );
      }

      // Try to fetch via Git Blob API if we have the sha
      if (response.data.sha) {
        return await fetchFileViaBlob(octokit, owner, repo, branch, path, response.data.sha, maxBytes);
      }

      throw new GitHubAPIError(
        'File content not available from GitHub API',
        { owner, repo, branch, path }
      );
    }

    // Decode base64 content
    const buffer = Buffer.from(response.data.content, 'base64');

    // Validate UTF-8
    if (!isValidUtf8(buffer)) {
      throw new BinaryOrUnsupportedEncodingError(path, { owner, repo, branch });
    }

    const content = buffer.toString('utf-8');

    return {
      content,
      blobSha: response.data.sha || null,
      commitSha: null, // Contents API doesn't return commit SHA directly
    };
  } catch (error: any) {
    // Re-throw our custom errors
    if (
      error instanceof NotAFileError ||
      error instanceof FileTooLargeError ||
      error instanceof BinaryOrUnsupportedEncodingError ||
      error instanceof GitHubAPIError
    ) {
      throw error;
    }

    // Handle GitHub API errors
    if (error.status === 404) {
      throw new GitHubAPIError(
        `File not found: ${path} (branch: ${branch})`,
        { owner, repo, branch, path, httpStatus: 404 }
      );
    }

    if (error.status === 403) {
      throw new GitHubAPIError(
        'GitHub API access forbidden. Check GitHub App permissions.',
        { owner, repo, branch, path, httpStatus: 403 }
      );
    }

    throw new GitHubAPIError(
      error instanceof Error ? error.message : 'Failed to fetch file from GitHub',
      { owner, repo, branch, path, httpStatus: error.status }
    );
  }
}

/**
 * Fetch file via Git Blob API
 */
async function fetchFileViaBlob(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  blobSha: string,
  maxBytes: number
): Promise<FetchedFile> {
  try {
    const response = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: blobSha,
    });

    // Check size
    if (response.data.size > 1_000_000) {
      throw new FileTooLargeError(
        `File size (${response.data.size} bytes) exceeds maximum supported size (1,000,000 bytes)`,
        { owner, repo, branch, path, maxBytes }
      );
    }

    // Decode base64 content
    const buffer = Buffer.from(response.data.content, 'base64');

    // Validate UTF-8
    if (!isValidUtf8(buffer)) {
      throw new BinaryOrUnsupportedEncodingError(path, { owner, repo, branch });
    }

    const content = buffer.toString('utf-8');

    return {
      content,
      blobSha: response.data.sha || null,
      commitSha: null,
    };
  } catch (error: any) {
    // Re-throw our custom errors
    if (
      error instanceof FileTooLargeError ||
      error instanceof BinaryOrUnsupportedEncodingError
    ) {
      throw error;
    }

    throw new GitHubAPIError(
      error instanceof Error ? error.message : 'Failed to fetch file blob from GitHub',
      { owner, repo, branch, path, httpStatus: error.status }
    );
  }
}

// ========================================
// Main readFile Function
// ========================================

/**
 * Read file content from GitHub repository with policy enforcement
 * 
 * @param params - Read file parameters
 * @returns File content with metadata, hashes, and optional line numbers
 * @throws InvalidPathError, NotAFileError, FileTooLargeError, RangeInvalidError, 
 *         BinaryOrUnsupportedEncodingError, GitHubAPIError, RepoAccessDeniedError
 */
export async function readFile(params: ReadFileParams): Promise<ReadFileResult> {
  // Validate and normalize input
  const validated = ReadFileParamsSchema.parse(params);
  const { owner, repo, branch, path, range, maxBytes, includeSha, includeLineNumbers } = validated;

  // Normalize and validate path
  const normalizedPath = normalizePath(path, { owner, repo, branch });

  // Get authenticated client (enforces I711 policy)
  const octokit = await createAuthenticatedClient({
    owner,
    repo,
    branch,
    path: normalizedPath,
  });

  // Fetch file from GitHub
  const { content: fullContent, blobSha, commitSha } = await fetchFile(
    octokit,
    owner,
    repo,
    branch,
    normalizedPath,
    maxBytes
  );

  // Extract range if specified
  let finalContent: string;
  let totalLines: number | null = null;
  let actualRange: { startLine: number; endLine: number } | null = null;

  if (range) {
    const { text, totalLines: total } = extractLineRange(
      fullContent,
      range.startLine,
      range.endLine,
      owner,
      repo,
      branch,
      normalizedPath
    );
    finalContent = text;
    totalLines = total;
    actualRange = { startLine: range.startLine, endLine: range.endLine };
  } else {
    finalContent = fullContent;
    totalLines = splitLines(fullContent).length;
    actualRange = null;
  }

  // Apply size limits with truncation
  const { text: truncatedContent, truncated } = truncateToMaxBytes(finalContent, maxBytes);

  // Compute hashes for evidence
  const contentSha256 = computeSha256(truncatedContent);
  const snippetHash = getSnippetHash(contentSha256);

  // Prepare content response
  const content: ReadFileContent = {
    text: truncatedContent,
  };

  if (includeLineNumbers) {
    const startLineNum = actualRange ? actualRange.startLine : 1;
    content.lines = textToLinesWithNumbers(truncatedContent, startLineNum);
  }

  // Build metadata
  const meta: ReadFileMeta = {
    owner,
    repo,
    branch,
    path: normalizedPath,
    blobSha: includeSha ? blobSha : null,
    commitSha: includeSha ? commitSha : null,
    contentSha256,
    snippetHash,
    encoding: 'utf-8',
    generatedAt: new Date().toISOString(),
    truncated,
    range: actualRange,
    totalLines,
  };

  return {
    meta,
    content,
  };
}

// ========================================
// Exports
// ========================================

export {
  RepoAccessDeniedError,
} from './auth-wrapper';
