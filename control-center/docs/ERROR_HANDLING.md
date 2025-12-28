# API Error Surface Improvement (I5-5.2)

## Problem

Users were experiencing cryptic "Unexpected JSON end" errors when API calls failed. This occurred because:

1. The UI code was calling `.json()` on error responses without checking `response.ok` first
2. Error responses often had empty bodies or non-JSON content (like HTML error pages)
3. JSON parsing would fail, hiding the actual API error message

## Solution

Created a safe API response handling utility that:

1. **Checks response status before parsing**: Validates `response.ok` before attempting JSON parsing
2. **Handles error responses gracefully**: Attempts to extract error details from JSON, but falls back to status text if parsing fails
3. **Supports non-JSON errors**: Handles HTML error pages and empty responses
4. **Provides user-friendly error messages**: Formats errors in German with clear, actionable messages

## Implementation

### Core Utility: `src/lib/api/safe-fetch.ts`

```typescript
export async function safeFetch<T = unknown>(response: Response): Promise<T>
```

**Features:**
- Checks `response.ok` before JSON parsing
- Extracts error details from JSON error responses
- Handles non-JSON error responses (HTML, plain text)
- Throws typed `ApiError` objects with status code and message
- Prevents "Unexpected JSON end" errors

**Helper Functions:**
- `isApiError(error)`: Type guard for ApiError objects
- `formatErrorMessage(error)`: Formats errors for display to users

### Updated Pages

All pages that make API calls have been updated to use `safeFetch`:

1. **Dashboard** (`app/dashboard/page.tsx`)
   - Multiple API calls (workflows, executions, agents, etc.)
   - Improved error messages for all data fetching

2. **Issues List** (`app/issues/page.tsx`)
   - Issue listing with filters
   - Clear error messages for failed queries

3. **Issue Detail** (`app/issues/[id]/page.tsx`)
   - Issue CRUD operations
   - Activation and handoff actions
   - Activity log fetching

4. **New Issue** (`app/issues/new/page.tsx`)
   - Draft issue creation
   - Issue submission

5. **Workflows** (`app/workflows/page.tsx`)
   - Workflow listing and execution
   - Improved error handling for workflow operations

6. **Login** (`app/login/page.tsx`)
   - Authentication errors now show meaningful messages

### Test Page

Created `/test-errors` page to demonstrate and test error handling:
- Tests 404, 500, network errors, and empty responses
- Shows before/after comparison
- Useful for validating the fix

## Benefits

### Before
```typescript
// Old code - prone to "Unexpected JSON end" errors
const response = await fetch("/api/issues");
const data = await response.json(); // ❌ Fails if response is not OK
```

**Error:** `SyntaxError: Unexpected end of JSON input`

### After
```typescript
// New code - safe error handling
const response = await fetch("/api/issues");
const data = await safeFetch(response); // ✅ Checks status first
```

**Error:** `HTTP 404: Resource not found` (or actual API error message)

## Testing

### Unit Tests
- Created `src/lib/api/safe-fetch.test.ts` with comprehensive test coverage
- Tests successful responses, error responses, empty bodies, and malformed JSON

### Manual Testing
1. Visit `/test-errors` to test different error scenarios
2. Try operations that trigger API errors (e.g., invalid form submissions)
3. Verify error messages are clear and helpful

## Migration Guide

To update existing code:

```typescript
// 1. Import the utility
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

// 2. Replace response.json() with safeFetch()
// Old:
const data = await response.json();

// New:
const data = await safeFetch(response);

// 3. Update error handling
// Old:
catch (err) {
  setError(err instanceof Error ? err.message : "Unknown error");
}

// New:
catch (err) {
  setError(formatErrorMessage(err));
}
```

## Error Message Examples

### Before (unhelpful)
- "Unexpected end of JSON input"
- "Failed to fetch"
- "Network request failed"

### After (clear and actionable)
- "HTTP 404: Issue not found"
- "HTTP 400: Invalid input - Title is required"
- "HTTP 500: Database connection failed"
- "HTTP 503: Service Unavailable"

## Future Improvements

1. **Retry Logic**: Add automatic retry for transient errors (5xx)
2. **Offline Detection**: Better handling of offline/network errors
3. **Error Analytics**: Track and analyze common error patterns
4. **I18n**: Support multiple languages for error messages
5. **Toast Notifications**: Show errors in toast notifications instead of inline

## Related Issues

- Issue #320 (Epic): Error Surface in UI
- Issue I5-5.2: API-Fehler sichtbar & erklärend
