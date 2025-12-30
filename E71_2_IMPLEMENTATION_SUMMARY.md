# E71.2 Implementation Summary: Tool listTree

**Issue**: I712 (E71.2) - Tool listTree (branch/path, pagination, deterministic ordering)  
**Implementation Date**: 2025-12-30  
**Status**: ✅ Complete

## Overview

Successfully implemented a server-side GitHub repository tree listing tool with deterministic ordering, cursor-based pagination, and policy enforcement. The tool supports both recursive and non-recursive directory listing with robust error handling and path validation.

## Files Created

### Core Implementation

1. **`control-center/src/lib/github/list-tree.ts`** (420 lines)
   - Main `listTree()` function with policy enforcement via I711 auth wrapper
   - Zod schemas for input validation (`ListTreeParamsSchema`)
   - Path normalization and validation (rejects `..`, `\`, absolute paths)
   - Cursor encoding/decoding for opaque pagination
   - GitHub API adapters for recursive and non-recursive modes
   - Deterministic sorting (path ascending, case-sensitive)
   - Pagination logic with cursor-based continuation
   - Error classes: `InvalidPathError`, `TreeTooLargeError`, `GitHubAPIError`

### Tests

2. **`control-center/__tests__/lib/github-list-tree.test.ts`** (550 lines)
   - 33 tests covering all acceptance criteria:
     - **Path validation** (8 tests): Rejects `..`, `\`, normalizes slashes
     - **Cursor encoding/decoding** (5 tests): Opaque, base64, deterministic
     - **Sorting** (4 tests): Path ascending, case-sensitive, deterministic
     - **Pagination** (7 tests): No duplicates, no gaps, cursor continuation
     - **Integration** (9 tests): Policy enforcement, recursive/non-recursive, error handling
   - ✅ All 33 tests passing

### Documentation

3. **`docs/examples/github-list-tree-usage.ts`** (340 lines)
   - 9 comprehensive usage examples:
     1. Basic non-recursive listing
     2. Subdirectory listing
     3. Recursive tree traversal
     4. Paginated fetching
     5. Error handling
     6. API route handler
     7. Filter by extension
     8. Streaming large trees
     9. Compare branches

## Test Results

### New Tests
```
Test Suites: 1 passed, 1 total
Tests:       33 passed, 33 total

Path validation:     8/8 ✅
Cursor ops:          5/5 ✅
Sorting:             4/4 ✅
Pagination:          7/7 ✅
Integration:         9/9 ✅
```

### Full GitHub Module Tests
```
Test Suites: 4 passed, 1 failed (pre-existing), 5 total
Tests:       73 passed, 14 failed (pre-existing), 87 total

✅ github-list-tree.test.ts (33 tests)
✅ github-auth-wrapper.test.ts (13 tests)
✅ github-policy.test.ts (24 tests)
✅ github-events-extract.test.ts (3 tests)
❌ github-runner-adapter.test.ts (pre-existing Octokit import issue)
```

## Acceptance Criteria - All Met ✅

| Criteria | Status | Evidence |
|----------|--------|----------|
| ✅ Non-recursive directory listing | ✅ | `fetchNonRecursive()` uses Contents API |
| ✅ Recursive tree listing | ✅ | `fetchRecursive()` uses Git Trees API |
| ✅ Sub-path listing | ✅ | Path parameter filters tree entries |
| ✅ Deterministic ordering | ✅ | `sortByPath()` - lexicographic, case-sensitive |
| ✅ Cursor-based pagination | ✅ | Opaque base64 cursor with lastPath |
| ✅ No duplicates/gaps | ✅ | Tested with multi-page pagination |
| ✅ Policy enforcement | ✅ | Uses I711 `createAuthenticatedClient()` |
| ✅ Path validation | ✅ | Rejects `..`, `\`, absolute paths |
| ✅ Graceful large tree handling | ✅ | `TreeTooLargeError` when truncated |
| ✅ Structured error format | ✅ | `code`, `message`, `details` fields |
| ✅ Tests pass | ✅ | 33/33 tests passing |

## API Reference

### Function Signature

```typescript
async function listTree(params: ListTreeParams): Promise<ListTreeResult>
```

### Input Parameters

```typescript
interface ListTreeParams {
  owner: string;          // Repository owner
  repo: string;           // Repository name
  branch?: string;        // Branch name (default: 'main')
  path?: string;          // Path within repo (default: '')
  recursive?: boolean;    // Recursive listing (default: false)
  cursor?: string;        // Pagination cursor (optional)
  limit?: number;         // Page size (default: 200, max: 500)
}
```

### Response Format

```typescript
interface ListTreeResult {
  items: TreeEntry[];     // Sorted entries
  pageInfo: PageInfo;     // Pagination info
  meta: TreeMeta;         // Request metadata
}

interface TreeEntry {
  type: 'file' | 'dir';
  path: string;           // Full path (POSIX)
  name: string;           // File/dir name
  sha: string | null;     // Git object SHA
  size: number | null;    // Size in bytes (files only)
}

interface PageInfo {
  nextCursor: string | null;     // Opaque cursor for next page
  totalEstimate: number | null;  // Total items estimate
}

interface TreeMeta {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  recursive: boolean;
  generatedAt: string;    // ISO timestamp
  toolVersion: string;    // "1.0.0"
  contractVersion: string; // "E71.2"
  ordering: 'path_asc';   // Always path_asc
}
```

### Error Codes

```typescript
type ErrorCode =
  | 'REPO_NOT_ALLOWED'        // Policy denied access
  | 'INVALID_PATH'            // Path validation failed
  | 'TREE_TOO_LARGE'          // Recursive tree truncated
  | 'GITHUB_API_ERROR'        // GitHub API failure
  | 'AUTH_MISCONFIGURED';     // GitHub App auth issue

interface ListTreeError {
  code: ErrorCode;
  message: string;
  details: {
    owner: string;
    repo: string;
    branch?: string;
    path?: string;
    httpStatus?: number;
    requestId?: string;
  };
}
```

## Implementation Details

### 1. Path Normalization

```typescript
normalizePath('/foo/bar/') → 'foo/bar'
normalizePath('../etc')     → InvalidPathError
normalizePath('foo\\bar')   → InvalidPathError
```

### 2. Cursor Format

Opaque base64-encoded JSON:
```typescript
{
  lastPath: "src/lib/github.ts",
  lastSha: "abc123..."  // Optional
}
```

### 3. GitHub API Strategy

**Non-Recursive Mode:**
- Uses `GET /repos/{owner}/{repo}/contents/{path}`
- Returns directory listing (1 level deep)
- Fast, suitable for large repos

**Recursive Mode:**
- Uses `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`
- Resolves branch → commit → tree SHA
- Returns full tree structure
- Throws `TreeTooLargeError` if truncated

### 4. Sorting Algorithm

Deterministic lexicographic sort:
```typescript
['z.txt', 'A.txt', 'a.txt'] → ['A.txt', 'a.txt', 'z.txt']
```

- Case-sensitive (uppercase < lowercase)
- Stable sort for equal paths
- No randomness, fully reproducible

### 5. Pagination Logic

```typescript
// Page 1: cursor=undefined, limit=2
items: ['a.txt', 'b.txt']
nextCursor: base64({ lastPath: 'b.txt' })

// Page 2: cursor=<above>, limit=2
items: ['c.txt', 'd.txt']  // Starts AFTER 'b.txt'
nextCursor: base64({ lastPath: 'd.txt' }) or null
```

## Usage Examples

### Basic Listing

```typescript
import { listTree } from '@/lib/github/list-tree';

const result = await listTree({
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  branch: 'main',
  path: 'control-center/src',
  recursive: false,
});

console.log(`Found ${result.items.length} items`);
result.items.forEach(item => {
  console.log(`${item.type}: ${item.path}`);
});
```

### Paginated Listing

```typescript
let cursor: string | undefined;
let allItems: TreeEntry[] = [];

do {
  const result = await listTree({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: '',
    recursive: true,
    cursor,
    limit: 100,
  });

  allItems.push(...result.items);
  cursor = result.pageInfo.nextCursor || undefined;
} while (cursor);

console.log(`Total: ${allItems.length} items`);
```

### Error Handling

```typescript
try {
  const result = await listTree({
    owner: 'adaefler-art',
    repo: 'codefactory-control',
    branch: 'main',
    path: '../etc/passwd',  // Invalid!
  });
} catch (error: any) {
  if (error.code === 'INVALID_PATH') {
    console.error('Path validation failed:', error.message);
  } else if (error.code === 'REPO_NOT_ALLOWED') {
    console.error('Access denied by policy');
  }
}
```

## Integration with I711 Policy Enforcement

The `listTree` function enforces the I711 Repo Access Policy:

```typescript
// 1. Policy check happens BEFORE GitHub API call
const octokit = await createAuthenticatedClient({
  owner, repo, branch, path
});
// ✅ Only proceeds if policy allows

// 2. Denied access throws RepoAccessDeniedError
listTree({ owner: 'other', repo: 'private' })
// ❌ Throws: Access denied to repository other/private
```

Policy is configured via `GITHUB_REPO_ALLOWLIST` environment variable:
```json
{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "develop", "release/*"]
    }
  ]
}
```

## PowerShell Commands for Verification

```powershell
# Install dependencies
npm --prefix control-center install

# Run listTree tests only
npm --prefix control-center test -- __tests__/lib/github-list-tree.test.ts

# Run all GitHub lib tests
npm --prefix control-center test -- __tests__/lib/github

# Build control-center (requires packages built first)
npm --prefix packages/deploy-memory run build
npm --prefix packages/verdict-engine run build
npm --prefix control-center run build
```

## Non-Negotiables - All Met ✅

- ✅ **GitHub App auth only**: Uses `createAuthenticatedClient()` from I711
- ✅ **Policy enforcement**: Repo access validated before API calls
- ✅ **Determinism**: Stable ordering (path_asc), opaque cursors
- ✅ **Evidence-friendly**: SHA hashes, timestamps, metadata
- ✅ **Server-side only**: No token exposure, no client-side calls
- ✅ **Idempotency**: Same params → same results (given same repo state)
- ✅ **PowerShell snippets**: Test commands documented

## Future Enhancements (Optional)

While not required for this issue, potential future improvements:

1. **Caching**: In-memory cache with 30-120s TTL
2. **Glob filtering**: Filter entries by pattern (e.g., `*.ts`)
3. **Size limits**: Configurable max tree size
4. **Parallel fetching**: Fetch multiple pages concurrently
5. **Delta updates**: Only fetch changes since last call

## Conclusion

Successfully implemented I712 (E71.2) with:
- ✅ **Core functionality**: Tree listing with recursive/non-recursive modes
- ✅ **Determinism**: Stable ordering + cursor-based pagination
- ✅ **Security**: Policy enforcement, path validation
- ✅ **Testing**: 33 new tests, all passing
- ✅ **Documentation**: Comprehensive guides + 9 usage examples
- ✅ **Quality**: All acceptance criteria met

The implementation is production-ready and fully satisfies all requirements specified in the issue.
