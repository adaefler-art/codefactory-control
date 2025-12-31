/**
 * GitHub readFile Tool - Usage Examples
 * 
 * Reference: I713 (E71.3) - Tool readFile
 * 
 * This file demonstrates various usage patterns for the readFile tool,
 * which provides server-side file reading from GitHub repositories with:
 * - Line range support
 * - Snippet hashing for evidence/determinism
 * - Size limits and truncation
 * - Policy enforcement
 */

import { readFile } from '@/lib/github/read-file';

// ========================================
// Example 1: Basic File Reading
// ========================================

async function example1_basicFileRead() {
  const result = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'README.md',
  });

  console.log('File content:', result.content.text);
  console.log('Snippet hash:', result.meta.snippetHash);
  console.log('Total lines:', result.meta.totalLines);
  console.log('Truncated:', result.meta.truncated);
}

// ========================================
// Example 2: Read Specific Line Range
// ========================================

async function example2_lineRange() {
  // Read lines 10-20 from a file
  const result = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src/lib/github/read-file.ts',
    range: {
      startLine: 10,
      endLine: 20,
    },
  });

  console.log('Lines 10-20:');
  result.content.lines?.forEach((line) => {
    console.log(`${line.n}: ${line.text}`);
  });

  console.log('\nMetadata:');
  console.log('Range:', result.meta.range);
  console.log('Total lines in file:', result.meta.totalLines);
  console.log('Content SHA-256:', result.meta.contentSha256);
  console.log('Snippet hash (12 chars):', result.meta.snippetHash);
}

// ========================================
// Example 3: Read Single Line
// ========================================

async function example3_singleLine() {
  // Read just line 5
  const result = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'package.json',
    range: {
      startLine: 5,
      endLine: 5,
    },
  });

  console.log('Line 5:', result.content.text);
}

// ========================================
// Example 4: Read with Size Limits
// ========================================

async function example4_sizeLimits() {
  // Read up to 50KB
  const result = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/package-lock.json',
    maxBytes: 50_000,
  });

  console.log('Was truncated:', result.meta.truncated);
  console.log('Content size:', Buffer.byteLength(result.content.text, 'utf-8'));
  console.log('Snippet hash:', result.meta.snippetHash);
}

// ========================================
// Example 5: Without Line Numbers
// ========================================

async function example5_noLineNumbers() {
  // Get raw text without line number metadata
  const result = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'README.md',
    includeLineNumbers: false,
  });

  console.log('Has lines array:', result.content.lines !== undefined);
  console.log('Raw text:', result.content.text);
}

// ========================================
// Example 6: Without SHA (minimal metadata)
// ========================================

async function example6_noSha() {
  // Skip blob SHA to reduce metadata size
  const result = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'README.md',
    includeSha: false,
  });

  console.log('Blob SHA:', result.meta.blobSha); // null
  console.log('Content SHA-256:', result.meta.contentSha256); // Still included
}

// ========================================
// Example 7: Error Handling
// ========================================

async function example7_errorHandling() {
  try {
    await readFile({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      path: '../etc/passwd', // Invalid path
    });
  } catch (error: any) {
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error details:', error.details);
    
    // Expected output:
    // Error code: INVALID_PATH
    // Error message: Invalid path '../etc/passwd': Parent directory traversal (..) not allowed
  }

  try {
    await readFile({
      owner: 'unauthorized',
      repo: 'private-repo',
      branch: 'main',
      path: 'secret.txt',
    });
  } catch (error: any) {
    console.error('Error code:', error.code);
    // Expected: REPO_NOT_ALLOWED
  }

  try {
    await readFile({
      owner: 'adaefler-art',
      repo: 'codefactory-control',
      branch: 'main',
      path: 'control-center/src',
    });
  } catch (error: any) {
    console.error('Error code:', error.code);
    // Expected: NOT_A_FILE
  }
}

// ========================================
// Example 8: API Route Handler
// ========================================

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch, path, startLine, endLine } = body;

    // Validate input
    if (!owner || !repo || !path) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, repo, path' },
        { status: 400 }
      );
    }

    // Read file
    const result = await readFile({
      owner,
      repo,
      branch: branch || 'main',
      path,
      range: startLine && endLine ? { startLine, endLine } : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    // Handle known error types
    if (error.code === 'REPO_NOT_ALLOWED') {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 }
      );
    }

    if (error.code === 'INVALID_PATH' || error.code === 'RANGE_INVALID') {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    if (error.code === 'NOT_A_FILE') {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    if (error.code === 'FILE_TOO_LARGE') {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 413 }
      );
    }

    if (error.code === 'GITHUB_API_ERROR') {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.details.httpStatus || 502 }
      );
    }

    // Unknown error
    console.error('[readFile API] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ========================================
// Example 9: Evidence Verification
// ========================================

async function example9_evidenceVerification() {
  // Read a file twice to verify deterministic hashing
  const result1 = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'README.md',
  });

  const result2 = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'README.md',
  });

  console.log('Hash 1:', result1.meta.snippetHash);
  console.log('Hash 2:', result2.meta.snippetHash);
  console.log('Hashes match:', result1.meta.snippetHash === result2.meta.snippetHash);
  
  // For evidence trail
  console.log('Evidence metadata:');
  console.log({
    file: `${result1.meta.owner}/${result1.meta.repo}/${result1.meta.path}@${result1.meta.branch}`,
    blobSha: result1.meta.blobSha,
    contentSha256: result1.meta.contentSha256,
    snippetHash: result1.meta.snippetHash,
    generatedAt: result1.meta.generatedAt,
    totalLines: result1.meta.totalLines,
  });
}

// ========================================
// Example 10: Compare File Snippets
// ========================================

async function example10_compareSnippets() {
  // Read same line range from two different files
  const file1 = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src/lib/github/read-file.ts',
    range: { startLine: 1, endLine: 50 },
  });

  const file2 = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src/lib/github/list-tree.ts',
    range: { startLine: 1, endLine: 50 },
  });

  console.log('File 1 snippet hash:', file1.meta.snippetHash);
  console.log('File 2 snippet hash:', file2.meta.snippetHash);
  console.log('Files identical:', file1.meta.snippetHash === file2.meta.snippetHash);
}

// ========================================
// Example 11: Batch Reading with Evidence
// ========================================

async function example11_batchReading() {
  const files = [
    'README.md',
    'package.json',
    'tsconfig.json',
  ];

  const results = await Promise.all(
    files.map((path) =>
      readFile({
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        branch: 'main',
        path,
      })
    )
  );

  // Create evidence manifest
  const manifest = results.map((r) => ({
    path: r.meta.path,
    snippetHash: r.meta.snippetHash,
    contentSha256: r.meta.contentSha256,
    blobSha: r.meta.blobSha,
    totalLines: r.meta.totalLines,
    generatedAt: r.meta.generatedAt,
  }));

  console.log('Evidence manifest:');
  console.log(JSON.stringify(manifest, null, 2));
}

// ========================================
// Example 12: Extract Function from File
// ========================================

async function example12_extractFunction() {
  // Find and extract a specific function from a file
  const fullFile = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src/lib/github/read-file.ts',
  });

  // Find the readFile function definition
  const lines = fullFile.content.lines || [];
  const startIdx = lines.findIndex((l) => l.text.includes('export async function readFile'));
  
  if (startIdx === -1) {
    console.log('Function not found');
    return;
  }

  // Find the closing brace (simplified - assumes it's at same indentation level)
  let braceCount = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].text;
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;
    if (braceCount === 0 && i > startIdx) {
      endIdx = i;
      break;
    }
  }

  // Read just that range
  const functionCode = await readFile({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: 'control-center/src/lib/github/read-file.ts',
    range: {
      startLine: lines[startIdx].n,
      endLine: lines[endIdx].n,
    },
  });

  console.log('Extracted function:');
  console.log(functionCode.content.text);
  console.log('\nFunction snippet hash:', functionCode.meta.snippetHash);
}

// ========================================
// Usage Notes
// ========================================

/*
DETERMINISM & EVIDENCE:
- snippetHash is first 12 chars of contentSha256
- Same content always produces same hash
- Use for evidence trails, caching keys, change detection

SIZE LIMITS:
- Default maxBytes: 200,000 (200KB)
- Hard max: 1,000,000 (1MB)
- Files larger than 1MB are rejected with FILE_TOO_LARGE

LINE RANGES:
- 1-based indexing (line 1 is first line)
- Inclusive (startLine=3, endLine=5 returns 3 lines)
- Max range: 5000 lines
- If endLine exceeds file length, capped automatically

PATH SAFETY:
- Rejects: "..", backslashes, leading "//", empty paths
- Normalizes: removes leading/trailing slashes
- Always validates before GitHub API call

POLICY ENFORCEMENT:
- Uses I711 auth wrapper
- Checks GITHUB_REPO_ALLOWLIST before every call
- Throws RepoAccessDeniedError if not allowed

ERROR CODES:
- REPO_NOT_ALLOWED: Policy denied access
- INVALID_PATH: Path validation failed
- NOT_A_FILE: Path points to directory or non-file
- FILE_TOO_LARGE: File exceeds size limits
- RANGE_INVALID: Line range validation failed
- BINARY_OR_UNSUPPORTED_ENCODING: Not valid UTF-8
- GITHUB_API_ERROR: GitHub API failure
- AUTH_MISCONFIGURED: GitHub App auth issue

PERFORMANCE:
- Uses GitHub Contents API for files up to 1MB
- Falls back to Git Blob API if needed
- No caching in initial implementation (can be added)

TESTING:
Run tests: npm --prefix control-center test -- __tests__/lib/github-read-file.test.ts
*/
