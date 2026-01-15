/**
 * Evidence Tool: readFile
 * 
 * INTENT agent tool for reading GitHub repository files with:
 * - Line range support (startLine, endLine)
 * - Size limits and truncation (max 256KB default)
 * - Binary detection (fail fast)
 * - Deterministic hashing (SHA-256 snippet hash)
 * - Line ending normalization for hash stability
 * 
 * Reference: I893 (E89.3) - Evidence Tool "readFile"
 */

import { readFile as githubReadFile, ReadFileParams } from '../github/read-file';
import { createHash } from 'crypto';

// ========================================
// Constants
// ========================================

/**
 * Maximum file size for evidence tool (256KB)
 * Smaller than GitHub read-file default (200KB) to ensure bounded output
 */
export const MAX_EVIDENCE_FILE_SIZE = 256 * 1024; // 256 KB

/**
 * Maximum lines returned in a single range request
 */
export const MAX_EVIDENCE_LINES = 400;

// ========================================
// Types
// ========================================

export interface ReadFileEvidenceParams {
  owner: string;
  repo: string;
  ref?: string; // branch/tag/commit SHA (default: 'main')
  path: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number; // Max bytes (default: 256KB, max: 256KB)
}

export interface ReadFileEvidenceResult {
  success: boolean;
  content?: string;
  meta?: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
    startLine: number | null;
    endLine: number | null;
    totalLines: number | null;
    sha256: string; // SHA-256 hash of returned content (with normalized line endings)
    snippetHash: string; // First 12 chars of SHA-256
    encoding: 'utf-8';
    truncated: boolean;
    truncatedReason?: string;
    blobSha: string | null;
    generatedAt: string;
  };
  error?: string;
  errorCode?: string;
}

// ========================================
// Helper Functions
// ========================================

/**
 * Normalize line endings to \n for deterministic hashing
 */
function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Compute SHA-256 hash of content (with normalized line endings)
 */
function computeContentHash(content: string): string {
  const normalized = normalizeLineEndings(content);
  return createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/**
 * Get snippet hash (first 12 chars of SHA-256)
 */
function getSnippetHash(sha256: string): string {
  return sha256.substring(0, 12);
}

// ========================================
// Main Evidence Tool Function
// ========================================

/**
 * Read file content from GitHub repository (evidence-aware)
 * 
 * Enforces stricter limits than base readFile for bounded evidence output.
 * Returns deterministic hashes for audit/reproducibility.
 * 
 * @param params - Read file parameters
 * @returns Evidence result with content, metadata, and hashes
 */
export async function readFileEvidence(
  params: ReadFileEvidenceParams
): Promise<ReadFileEvidenceResult> {
  // Validate and apply evidence-specific constraints
  const {
    owner,
    repo,
    ref = 'main',
    path,
    startLine,
    endLine,
    maxBytes = MAX_EVIDENCE_FILE_SIZE,
  } = params;

  // Enforce max file size limit
  if (maxBytes > MAX_EVIDENCE_FILE_SIZE) {
    return {
      success: false,
      error: `maxBytes cannot exceed ${MAX_EVIDENCE_FILE_SIZE} (got ${maxBytes})`,
      errorCode: 'MAX_BYTES_EXCEEDED',
    };
  }

  // Enforce max line range limit
  if (startLine !== undefined && endLine !== undefined) {
    // Validate that endLine >= startLine
    if (endLine < startLine) {
      return {
        success: false,
        error: `endLine must be >= startLine (got startLine=${startLine}, endLine=${endLine})`,
        errorCode: 'RANGE_INVALID_416',
      };
    }
    
    const lineCount = endLine - startLine + 1;
    if (lineCount > MAX_EVIDENCE_LINES) {
      return {
        success: false,
        error: `Line range cannot exceed ${MAX_EVIDENCE_LINES} lines (got ${lineCount})`,
        errorCode: 'MAX_LINES_EXCEEDED',
      };
    }
  }

  // Validate that both startLine and endLine are provided together
  if ((startLine !== undefined && endLine === undefined) || 
      (startLine === undefined && endLine !== undefined)) {
    return {
      success: false,
      error: 'Both startLine and endLine must be provided together for range reading',
      errorCode: 'INCOMPLETE_RANGE',
    };
  }

  try {
    // Build parameters for underlying readFile
    const readParams: ReadFileParams = {
      owner,
      repo,
      branch: ref,
      path,
      maxBytes,
      includeSha: true,
      includeLineNumbers: false, // Evidence tool returns plain text, not line objects
    };

    // Add range if specified
    if (startLine !== undefined && endLine !== undefined) {
      readParams.range = { startLine, endLine };
    }

    // Call underlying GitHub read-file
    const result = await githubReadFile(readParams);

    // Compute deterministic hash (normalized line endings)
    const contentHash = computeContentHash(result.content.text);
    const snippetHash = getSnippetHash(contentHash);

    // Determine truncation reason
    let truncatedReason: string | undefined;
    if (result.meta.truncated) {
      truncatedReason = `Content exceeds maxBytes limit (${maxBytes} bytes)`;
    }

    // Build evidence result
    return {
      success: true,
      content: result.content.text,
      meta: {
        owner: result.meta.owner,
        repo: result.meta.repo,
        ref: result.meta.branch,
        path: result.meta.path,
        startLine: result.meta.range?.startLine ?? null,
        endLine: result.meta.range?.endLine ?? null,
        totalLines: result.meta.totalLines,
        sha256: contentHash,
        snippetHash,
        encoding: 'utf-8',
        truncated: result.meta.truncated,
        truncatedReason,
        blobSha: result.meta.blobSha,
        generatedAt: result.meta.generatedAt,
      },
    };
  } catch (error: any) {
    // Map known error types to evidence error codes
    const errorCode = error.code || 'UNKNOWN_ERROR';
    const errorMessage = error.message || 'Unknown error occurred';

    // Map error codes to HTTP-like status codes for clarity
    let mappedErrorCode = errorCode;
    if (errorCode === 'FILE_TOO_LARGE') {
      mappedErrorCode = 'FILE_TOO_LARGE_413';
    } else if (errorCode === 'BINARY_OR_UNSUPPORTED_ENCODING') {
      mappedErrorCode = 'UNSUPPORTED_MEDIA_TYPE_415';
    } else if (errorCode === 'RANGE_INVALID') {
      mappedErrorCode = 'RANGE_INVALID_416';
    } else if (errorCode === 'INVALID_PATH') {
      mappedErrorCode = 'INVALID_PATH_400';
    } else if (errorCode === 'NOT_A_FILE') {
      mappedErrorCode = 'NOT_A_FILE_400';
    } else if (errorCode === 'REPO_NOT_ALLOWED' || errorCode === 'BRANCH_NOT_ALLOWED') {
      mappedErrorCode = 'REPO_ACCESS_DENIED_403';
    } else if (errorCode === 'GITHUB_API_ERROR') {
      mappedErrorCode = 'GITHUB_API_ERROR';
    }

    return {
      success: false,
      error: errorMessage,
      errorCode: mappedErrorCode,
    };
  }
}
