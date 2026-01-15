# E89.3 Implementation Summary

**Issue:** E89.3 - Evidence Tool "readFile" (line ranges + snippet-hash, size limits, bounded output)  
**Date:** 2026-01-15  
**Status:** ✅ COMPLETE

## Objective

Implement an evidence-aware `readFile` tool for the INTENT agent that enables targeted source code/docs reading with deterministic hashing, size limits, and bounded output for audit-ready evidence.

## Implementation Overview

### Files Created

1. **`control-center/src/lib/evidence/readFile.ts`** (223 lines)
   - Evidence-aware wrapper for GitHub file reading
   - Enforces stricter limits than base readFile (256KB vs 200KB)
   - Deterministic SHA-256 hashing with line ending normalization
   - Clear error code mapping (413, 415, 416, 400, 403)

2. **`control-center/__tests__/lib/evidence/readFile.test.ts`** (783 lines)
   - Comprehensive test suite with 24 test cases
   - Off-by-one range validation
   - Hash stability tests
   - Error handling verification

### Files Modified

3. **`control-center/src/lib/intent-tool-registry.ts`** (+43 lines)
   - Added `readFile` tool definition with OpenAI function calling schema
   - Parameters: owner, repo, ref, path, startLine, endLine, maxBytes

4. **`control-center/src/lib/intent-agent-tool-executor.ts`** (+53 lines)
   - Added tool executor handler for `readFile`
   - Parameter validation and error handling
   - Dynamic import of evidence tool

## Acceptance Criteria - Status

### ✅ Range Read Correctness
- **Requirement:** Range read korrekt inkl. Off-by-one tests
- **Status:** PASS
- **Evidence:** 
  - Lines 3-5 extraction test (inclusive boundaries)
  - Single line range test (startLine === endLine)
  - Edge case: range exactly at MAX_EVIDENCE_LINES (400)
  - Edge case: range exceeding MAX_EVIDENCE_LINES rejected

### ✅ Hash Stability
- **Requirement:** Hash stabil über identischen snippet
- **Status:** PASS
- **Evidence:**
  - Identical content produces identical hash
  - Line ending normalization (\r\n → \n) for deterministic hashing
  - snippetHash is first 12 chars of SHA-256

### ✅ Binary/Oversize Error Codes
- **Requirement:** Binary/oversize → 413/415 mit klaren error codes
- **Status:** PASS
- **Evidence:**
  - FILE_TOO_LARGE → FILE_TOO_LARGE_413
  - BINARY_OR_UNSUPPORTED_ENCODING → UNSUPPORTED_MEDIA_TYPE_415
  - RANGE_INVALID → RANGE_INVALID_416
  - INVALID_PATH → INVALID_PATH_400
  - NOT_A_FILE → NOT_A_FILE_400
  - REPO_NOT_ALLOWED/BRANCH_NOT_ALLOWED → REPO_ACCESS_DENIED_403

### ✅ Allowlist Enforcement
- **Requirement:** allowlist enforced
- **Status:** PASS
- **Evidence:**
  - Uses existing `createAuthenticatedClient` from auth-wrapper
  - Policy enforcement happens before GitHub API call
  - Test validates REPO_ACCESS_DENIED_403 error code

## Technical Details

### Guardrails Implemented

```typescript
// Size limits
MAX_EVIDENCE_FILE_SIZE = 256 * 1024  // 256 KB
MAX_EVIDENCE_LINES = 400              // max lines per range

// Validation
- maxBytes: cannot exceed 256KB
- Line range: cannot exceed 400 lines
- Binary detection: fails fast via underlying readFile
```

### Deterministic Output

```typescript
// Line ending normalization
normalizeLineEndings(content)
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')

// SHA-256 hashing
sha256 = createHash('sha256')
  .update(normalized, 'utf-8')
  .digest('hex')

snippetHash = sha256.substring(0, 12)
```

### Output Schema

```typescript
interface ReadFileEvidenceResult {
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
    sha256: string;           // Full SHA-256 hash
    snippetHash: string;      // First 12 chars
    encoding: 'utf-8';
    truncated: boolean;
    truncatedReason?: string;
    blobSha: string | null;
    generatedAt: string;      // ISO timestamp
  };
  error?: string;
  errorCode?: string;
}
```

## Test Results

```
PASS __tests__/lib/evidence/readFile.test.ts
  Evidence Tool: readFile
    basic file reading
      ✓ should read file content successfully
      ✓ should use default ref "main" when not specified
      ✓ should use custom ref when specified
    line range extraction
      ✓ should extract lines 3-5 correctly (inclusive)
      ✓ should handle single line range (startLine === endLine)
      ✓ should reject range exceeding MAX_EVIDENCE_LINES (400)
      ✓ should accept range exactly at MAX_EVIDENCE_LINES (400)
    deterministic hashing
      ✓ should compute same hash for identical content
      ✓ should normalize line endings for hash stability
      ✓ should return snippetHash as first 12 chars of sha256
    size limits and truncation
      ✓ should enforce MAX_EVIDENCE_FILE_SIZE (256KB)
      ✓ should accept maxBytes exactly at MAX_EVIDENCE_FILE_SIZE
      ✓ should report truncation when content exceeds maxBytes
      ✓ should not report truncation when content fits within maxBytes
    error handling
      ✓ should map FILE_TOO_LARGE to 413 error code
      ✓ should map BINARY_OR_UNSUPPORTED_ENCODING to 415 error code
      ✓ should map RANGE_INVALID to 416 error code
      ✓ should map INVALID_PATH to 400 error code
      ✓ should map NOT_A_FILE to 400 error code
      ✓ should map REPO_ACCESS_DENIED to 403 error code
      ✓ should handle unknown errors gracefully
    metadata fields
      ✓ should include all required metadata fields
      ✓ should set startLine/endLine to null when no range specified
      ✓ should include startLine/endLine when range specified

Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
Time:        0.73s
```

## Verification Commands

As specified in the issue, the tool can be verified with:

```powershell
npm --prefix control-center test -- readFile.test.ts --runInBand --watchAll=false
```

**Result:** ✅ All 24 tests passing

## Security Summary

### Vulnerabilities Addressed
- ✅ **Path traversal:** Inherited from base readFile (normalizePath validation)
- ✅ **Unbounded output:** Max 256KB file size, max 400 lines per range
- ✅ **Binary injection:** Fast-fail on binary detection
- ✅ **Repository access:** Enforced via existing allowlist policy

### No New Vulnerabilities Introduced
- All error messages are sanitized
- No secrets in output
- No additional attack surface beyond base readFile
- Uses existing auth wrapper for policy enforcement

## Integration Points

### INTENT Agent
- Tool name: `readFile`
- Registered in `intent-tool-registry.ts`
- Executed via `intent-agent-tool-executor.ts`
- Available to INTENT LLM via OpenAI function calling

### Dependencies
- `src/lib/github/read-file.ts` - Base GitHub file reading
- `src/lib/github/auth-wrapper.ts` - Policy enforcement
- `src/lib/github/policy.ts` - Allowlist and error types

### Usage Example

```typescript
// INTENT agent call
{
  "name": "readFile",
  "arguments": {
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "ref": "main",
    "path": "src/lib/utils.ts",
    "startLine": 10,
    "endLine": 20
  }
}

// Response
{
  "success": true,
  "content": "...",
  "meta": {
    "sha256": "abc123...",
    "snippetHash": "abc123def456",
    "startLine": 10,
    "endLine": 20,
    "totalLines": 100,
    "truncated": false
  }
}
```

## Future Considerations

### Potential Enhancements (Out of Scope for E89.3)
1. **Caching:** Response caching by (repo, ref, path, range) + hash
2. **Total lines optimization:** Cheaper method to get totalLines without reading full file
3. **Syntax highlighting:** Optional syntax highlighting in output
4. **Multiple ranges:** Support for multiple non-contiguous ranges in single call

### Follow-up Issues
- E89.4: Evidence Tool "searchCode" (depends on E89.3)
- E89.5: INTENT "Sources" Integration (depends on E89.3)

## Conclusion

The E89.3 Evidence Tool "readFile" has been successfully implemented with:
- ✅ All acceptance criteria met
- ✅ 24/24 tests passing
- ✅ No linting errors in new files
- ✅ Full integration with INTENT tool registry and executor
- ✅ Proper error handling and security guardrails
- ✅ Deterministic, audit-ready output

The tool is ready for use by the INTENT agent for reading GitHub repository files with evidence tracking.
