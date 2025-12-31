# Unified API Contract for GitHub Evidence Tools

## Overview

All GitHub Evidence Tool routes (searchCode, listTree, readFile) now use a unified response envelope format for consistent error handling and success responses.

**Reference:** Implementation per @adaefler-art request in PR#<comment_id>3701516449</comment_id>

## Response Envelope Format

### Success Response

```typescript
{
  success: true,
  data: <ToolResult>,
  meta?: {
    generatedAt: string,  // ISO 8601 timestamp
    [key: string]: any    // Additional metadata
  }
}
```

**Example:**
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pageInfo": { "nextCursor": null },
    "meta": { ... }
  }
}
```

### Error Response

```typescript
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: object
  }
}
```

**Example:**
```json
{
  "success": false,
  "error": {
    "code": "REPO_NOT_ALLOWED",
    "message": "Access denied to repository test/forbidden",
    "details": {
      "owner": "test",
      "repo": "forbidden"
    }
  }
}
```

## Standardized Error Codes

All routes use identical error codes with consistent HTTP status mapping:

| Error Code | HTTP Status | Description | Routes |
|------------|-------------|-------------|--------|
| `QUERY_INVALID` | 400 | Query validation failed (length, control chars) | searchCode |
| `INVALID_PARAMS` | 400 | Missing or invalid query parameters | All |
| `INVALID_PATH` | 400 | Invalid file/directory path | listTree, readFile |
| `RANGE_INVALID` | 400 | Invalid line range specification | readFile |
| `NOT_A_FILE` | 400 | Path is a directory, not a file | readFile |
| `REPO_NOT_ALLOWED` | 403 | Repository not in I711 allowlist | All |
| `RATE_LIMIT_EXCEEDED` | 403 | GitHub API rate limit exceeded | searchCode |
| `FILE_TOO_LARGE` | 413 | File exceeds size limit | readFile |
| `TREE_TOO_LARGE` | 413 | Tree too large for recursive listing | listTree |
| `BINARY_OR_UNSUPPORTED_ENCODING` | 415 | File is binary or non-UTF-8 | readFile |
| `GITHUB_API_ERROR` | 404/422/500 | GitHub API returned an error | All |
| `AUTH_MISCONFIGURED` | 500 | GitHub App auth not configured | readFile |
| `INTERNAL_ERROR` | 500 | Unexpected server error | All |

## Tool-Specific Data Formats

### searchCode (E71.4)

**Success Data:**
```typescript
{
  items: Array<{
    path: string,
    sha: string | null,
    repository: { owner: string, repo: string },
    url: string | null,
    score: number | null,
    match: {
      preview: string,          // Max 300 chars, sanitized
      previewSha256: string,    // Full SHA-256 hash
      previewHash: string       // First 12 chars of SHA-256
    }
  }>,
  pageInfo: {
    nextCursor: string | null
  },
  meta: {
    owner: string,
    repo: string,
    branch: string,
    branchEffective?: string,
    branchWarning?: string,
    query: string,
    pathPrefix?: string,
    limit: number,
    generatedAt: string,
    ordering: 'path_asc' | 'github_default_then_path_asc'
  }
}
```

### listTree (E71.2)

**Success Data:**
```typescript
{
  items: Array<{
    type: 'file' | 'dir',
    path: string,
    name: string,
    sha: string | null,
    size: number | null
  }>,
  pageInfo: {
    nextCursor: string | null,
    totalEstimate: number | null
  },
  meta: {
    owner: string,
    repo: string,
    branch: string,
    path: string,
    recursive: boolean,
    generatedAt: string,
    toolVersion: string,
    contractVersion: string,
    ordering: 'path_asc'
  }
}
```

### readFile (E71.3)

**Success Data:**
```typescript
{
  meta: {
    owner: string,
    repo: string,
    branch: string,
    path: string,
    blobSha: string | null,
    commitSha: string | null,
    contentSha256: string,
    snippetHash: string,
    encoding: 'utf-8',
    generatedAt: string,
    truncated: boolean,
    range: { startLine: number, endLine: number } | null,
    totalLines: number
  },
  content: {
    text: string,
    lines: Array<{ lineNumber: number, text: string }> | null
  }
}
```

## Helper Functions

Located in `src/lib/api/tool-response.ts`:

### Success Response

```typescript
ok<T>(data: T, meta?: Record<string, any>): NextResponse<ToolSuccessResponse<T>>
```

**Usage:**
```typescript
const result = await searchCode(params);
return ok(result);
```

### Error Responses

```typescript
// Generic error
fail(code: string, message: string, details?: any, httpStatus?: number): NextResponse<ToolErrorResponse>

// Auto-detect from error object
failFromError(error: any): NextResponse<ToolErrorResponse>

// Specific helpers
invalidParamsError(message?: string, details?: any): NextResponse<ToolErrorResponse>
queryInvalidError(message: string, details?: any): NextResponse<ToolErrorResponse>
repoNotAllowedError(owner: string, repo: string, details?: any): NextResponse<ToolErrorResponse>
rateLimitError(message: string, retryAfter?: number): NextResponse<ToolErrorResponse>
githubApiError(message: string, httpStatus?: number, details?: any): NextResponse<ToolErrorResponse>
```

**Usage:**
```typescript
// Automatic error handling
try {
  const result = await searchCode(params);
  return ok(result);
} catch (error) {
  return failFromError(error);  // Handles all error types automatically
}

// Manual parameter validation error
if (!validation.success) {
  return invalidParamsError('Invalid query parameters', {
    errors: validation.error.errors
  });
}
```

## Client Usage Examples

### PowerShell

```powershell
$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/search-code" `
    -Method GET `
    -Body @{
        owner = "test"
        repo = "repo"
        query = "searchTerm"
    }

if ($response.success) {
    Write-Host "Found $($response.data.items.Count) results"
    $response.data.items | ForEach-Object {
        Write-Host "- $($_.path)"
    }
} else {
    Write-Host "Error: $($response.error.code) - $($response.error.message)" -ForegroundColor Red
    if ($response.error.details) {
        Write-Host "Details: $($response.error.details | ConvertTo-Json)"
    }
}
```

### TypeScript

```typescript
interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: any;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

type ToolResponse<T> = ApiResponse<T> | ApiError;

async function searchCode(params: SearchParams): Promise<SearchResult> {
  const url = new URL('/api/integrations/github/search-code', baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url);
  const data: ToolResponse<SearchResult> = await response.json();

  if (!data.success) {
    throw new Error(`${data.error.code}: ${data.error.message}`);
  }

  return data.data;
}
```

### JavaScript (Fetch API)

```javascript
const response = await fetch('/api/integrations/github/search-code?owner=test&repo=repo&query=test');
const result = await response.json();

if (result.success) {
  console.log('Items:', result.data.items);
  console.log('Next cursor:', result.data.pageInfo.nextCursor);
} else {
  console.error('Error:', result.error.code, result.error.message);
  if (result.error.details) {
    console.error('Details:', result.error.details);
  }
}
```

## Migration Guide

For existing code using the old format:

### Before (old format)
```javascript
const response = await fetch(...);
const data = await response.json();

// Direct access to items
console.log(data.items);
console.log(data.pageInfo);

// Error handling
if (response.status !== 200) {
  console.error(data.code, data.error);
}
```

### After (unified format)
```javascript
const response = await fetch(...);
const data = await response.json();

// Check success flag
if (data.success) {
  console.log(data.data.items);
  console.log(data.data.pageInfo);
} else {
  console.error(data.error.code, data.error.message);
}
```

## Benefits

1. **Consistency**: All tools use the same response structure
2. **Type Safety**: Clear distinction between success and error states
3. **Error Handling**: Standardized error codes across all routes
4. **Client-Friendly**: Easy to parse with `if (response.success)` pattern
5. **Extensibility**: `meta` field allows additional metadata without breaking changes
6. **Backwards Compatibility**: Old tests updated, new code follows same pattern

## Testing

All routes include integration tests for:
1. ✅ Success response with unified envelope
2. ✅ Policy denial (REPO_NOT_ALLOWED) with unified error envelope  
3. ✅ Validation error (INVALID_PARAMS) with unified error envelope

Test file: `__tests__/api/github-tools-integration.test.ts`
