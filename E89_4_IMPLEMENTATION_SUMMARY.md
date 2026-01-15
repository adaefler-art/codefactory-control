# E89.4 Implementation Summary

**Issue:** E89.4 - Evidence Tool "searchCode" (query constraints, rate-limit handling, deterministic ordering + result-hash)  
**Date:** 2026-01-15  
**Status:** ✅ COMPLETE

## Objective

Implement searchCode as an evidence tool for the INTENT agent that enables bounded, deterministic code searching with rate-limit safety and audit-ready evidence.

## Implementation Overview

### Files Created

1. **`control-center/src/lib/evidence/searchCode.ts`** (308 lines)
   - Evidence-aware wrapper for GitHub code search
   - Query validation (max 200 chars, no empty/wildcard-only queries)
   - maxResults clamping (default 20, max 50)
   - Deterministic sorting (path ascending, then sha ascending)
   - SHA-256 result hashing for reproducibility
   - E82.4 retry policy integration for rate-limit handling

2. **`control-center/__tests__/lib/evidence/searchCode.test.ts`** (775 lines)
   - Comprehensive test suite with 32 test cases
   - Full coverage of all acceptance criteria
   - Query validation, ordering, hashing, rate-limit, allowlist tests

### Files Modified

3. **`control-center/src/lib/intent-tool-registry.ts`** (+43 lines)
   - Added `searchCode` tool definition with OpenAI function calling schema
   - Parameters: owner, repo, ref, query, path, maxResults

4. **`control-center/src/lib/intent-agent-tool-executor.ts`** (+50 lines)
   - Added tool executor handler for `searchCode`
   - Parameter validation and error handling
   - Dynamic import of evidence tool

## Acceptance Criteria - Status

### ✅ AC1: Identical Inputs → Identical ordering + hash

**Implementation:**
- Deterministic sorting by path (ascending), then sha (ascending)
- SHA-256 hash computed from canonical result string format: `path|sha|preview\n`
- Short hash: first 12 chars of SHA-256

**Tests:**
- ✅ should generate identical hash for identical results
- ✅ should sort by path ascending
- ✅ should sort by sha when paths are equal
- ✅ should place null sha last when paths are equal

### ✅ AC2: Rate limit triggers bounded retries; fails with explicit GITHUB_RATE_LIMIT

**Implementation:**
- Uses E82.4 `withRetry` function with bounded retries (maxRetries: 3)
- Maps rate limit errors to `GITHUB_RATE_LIMIT` error code
- Detects both `RATE_LIMIT_EXCEEDED` code and "rate limit" in error message

**Tests:**
- ✅ should use withRetry for rate-limit handling
- ✅ should map rate limit error to GITHUB_RATE_LIMIT
- ✅ should map rate limit error message to GITHUB_RATE_LIMIT

### ✅ AC3: Query violations → 400 mit INVALID_QUERY

**Implementation:**
- Query length max: 200 chars (MAX_EVIDENCE_QUERY_LENGTH)
- Disallows empty queries
- Disallows wildcard-only queries (`*`, `**`)
- Disallows control characters (newline, null, etc.)
- Error code: `INVALID_QUERY_400`

**Tests:**
- ✅ should reject empty query
- ✅ should reject whitespace-only query
- ✅ should reject query exceeding max length
- ✅ should reject wildcard-only query (*)
- ✅ should reject wildcard-only query (**)
- ✅ should reject query with newline
- ✅ should reject query with control characters
- ✅ should accept valid query

### ✅ AC4: Allowlist enforced

**Implementation:**
- Uses existing `githubSearchCode` which enforces allowlist via `createAuthenticatedClient`
- Maps `REPO_NOT_ALLOWED` and `BRANCH_NOT_ALLOWED` to `REPO_ACCESS_DENIED_403`

**Tests:**
- ✅ should map REPO_NOT_ALLOWED to REPO_ACCESS_DENIED_403
- ✅ should map BRANCH_NOT_ALLOWED to REPO_ACCESS_DENIED_403

## Technical Details

### Query Constraints

```typescript
MAX_EVIDENCE_QUERY_LENGTH = 200  // Stricter than base 256
```

Validation:
- ❌ Empty queries
- ❌ Whitespace-only queries
- ❌ Queries > 200 chars
- ❌ Wildcard-only queries (`*`, `**`)
- ❌ Control characters (newline, null, etc.)

### maxResults Clamping

```typescript
DEFAULT_EVIDENCE_RESULTS = 20
MAX_EVIDENCE_RESULTS = 50
```

Behavior:
- Default: 20 if not specified
- Maximum: 50 (values > 50 clamped)
- Minimum: 1 (negative values clamped)

### Deterministic Ordering

```typescript
function sortItemsDeterministic(items: SearchCodeItem[]): SearchCodeItem[] {
  return [...items].sort((a, b) => {
    // Primary: path (ascending)
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    
    // Secondary: sha (ascending, null comes last)
    if (a.sha === null && b.sha === null) return 0;
    if (a.sha === null) return 1;
    if (b.sha === null) return -1;
    if (a.sha < b.sha) return -1;
    if (a.sha > b.sha) return 1;
    
    return 0;
  });
}
```

### Result Hash

```typescript
// Canonical format: path|sha|preview\n
function createCanonicalResultString(items: SearchCodeEvidenceItem[]): string {
  return items
    .map((item) => `${item.path}|${item.sha || 'null'}|${item.preview}`)
    .join('\n');
}

// SHA-256 hash
const resultHash = createHash('sha256')
  .update(canonical, 'utf-8')
  .digest('hex');

// Short hash (first 12 chars)
const resultHashShort = resultHash.substring(0, 12);
```

### Rate-Limit Handling

```typescript
const result = await withRetry(searchFn, {
  ...DEFAULT_RETRY_CONFIG,
  maxRetries: 3,
  httpMethod: 'GET',
  requestId: `searchCode-${owner}-${repo}-${Date.now()}`,
  endpoint: '/search/code',
});
```

Uses E82.4 retry policy with:
- Exponential backoff
- Deterministic jitter
- Secondary rate limit detection
- Bounded retries (max 3)

### Error Codes

| Error Code | HTTP | Description |
|------------|------|-------------|
| INVALID_QUERY_400 | 400 | Query validation failed |
| GITHUB_RATE_LIMIT | 429 | Rate limit exceeded |
| REPO_ACCESS_DENIED_403 | 403 | Repository/branch not allowed |
| GITHUB_API_ERROR | 500 | Generic GitHub API error |
| UNKNOWN_ERROR | 500 | Unknown/unexpected error |

## Test Results

```
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
Snapshots:   0 total
Time:        0.649 s
```

### Test Coverage Breakdown
- Query validation: 8 tests ✅
- maxResults clamping: 4 tests ✅
- Deterministic ordering: 3 tests ✅
- Result hash stability: 4 tests ✅
- Rate limit handling: 3 tests ✅
- Allowlist enforcement: 2 tests ✅
- Error handling: 3 tests ✅
- Path prefix: 2 tests ✅
- Metadata: 2 tests ✅

## Integration Points

### INTENT Tool Registry
```typescript
{
  name: 'searchCode',
  description: 'Search code in a GitHub repository with evidence tracking...',
  parameters: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Repository owner' },
      repo: { type: 'string', description: 'Repository name' },
      ref: { type: 'string', description: 'Branch, tag, or commit SHA', default: 'main' },
      query: { type: 'string', description: 'Search query (max 200 chars)' },
      path: { type: 'string', description: 'Optional path prefix filter' },
      maxResults: { type: 'number', description: 'Max results (default: 20, max: 50)', default: 20 },
    },
    required: ['owner', 'repo', 'query'],
  },
}
```

### INTENT Tool Executor
```typescript
case 'searchCode': {
  // Parameter validation
  if (!owner || typeof owner !== 'string') {
    return JSON.stringify({ success: false, error: 'owner required', code: 'MISSING_OWNER' });
  }
  // ... validate repo, query
  
  // Execute tool
  const { searchCodeEvidence } = await import('@/lib/evidence/searchCode');
  const result = await searchCodeEvidence({ owner, repo, ref, query, path, maxResults });
  
  return JSON.stringify(result);
}
```

## Security Summary

**CodeQL Analysis:** ✅ PASSED (0 alerts)
- No security vulnerabilities detected
- No SQL injection risks (no database queries)
- No XSS risks (server-side only)
- No secrets in code
- Allowlist enforcement via existing auth wrapper
- Input validation for all parameters
- Bounded resource usage (max query length, max results)

## Compliance

✅ **Repository Rules:**
- Only modified files in: `control-center/**`
- No changes to: `.next/**`, `.worktrees/**`, `standalone/**`, `lib/**`
- Minimal diff (only necessary changes)
- All changes in focused commits

✅ **Code Quality:**
- TypeScript linting clean (no errors, no warnings)
- All tests passing (32/32)
- Consistent with existing evidence tool patterns (readFile)
- Follows AFU-9 architecture

✅ **Documentation:**
- Clear inline comments
- JSDoc documentation for all exported functions
- README-style verification report
- Implementation summary

## Conclusion

**Status:** ✅ COMPLETE AND PRODUCTION-READY

All acceptance criteria from E89.4 have been successfully implemented and verified:
1. ✅ Identical inputs → identical ordering + hash
2. ✅ Rate limit triggers bounded retries with GITHUB_RATE_LIMIT error
3. ✅ Query violations → 400 with INVALID_QUERY
4. ✅ Allowlist enforced

The searchCode evidence tool is fully tested, secure, and ready for production use in the INTENT agent.
