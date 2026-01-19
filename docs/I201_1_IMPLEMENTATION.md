# I201.1 Implementation Summary

## Canonical Issues API as Single Source of Truth

### Problem
- `/api/issues` had inconsistent filtering behavior
- Filters were not deterministic (post-query filtering)
- No canonical ID or public ID filtering at database level
- Multiple sources of truth for issue listing

### Solution
Created a canonical API endpoint `/api/afu9/issues` that serves as the single source of truth for issue listing.

## Changes Made

### 1. Database Layer (`src/lib/db/afu9Issues.ts`)
- **Updated `ListIssuesOptions` interface** to support:
  - `canonicalId`: Filter by canonical ID (e.g., I867, E81.1)
  - `publicId`: Filter by 8-hex public ID
- **Updated `listAfu9Issues` function**:
  - Added database-level filtering for `canonicalId` (exact match)
  - Added database-level filtering for `publicId` (8-hex UUID prefix match)
  - All filters now applied at SQL level for deterministic results

### 2. New Canonical API (`app/api/afu9/issues/route.ts`)
Created new endpoint: `GET /api/afu9/issues`

**Query Parameters:**
- `canonicalId` or `canonical_id`: Filter by canonical ID (exact match)
- `publicId` or `public_id`: Filter by 8-hex publicId
- `status`: Filter by issue status (CREATED, SPEC_READY, etc.)
- `handoff_state`: Filter by handoff state (NOT_SENT, SENT, etc.)
- `limit`: Results per page (default: 100, max: 100)
- `offset`: Pagination offset (default: 0)

**Response Format:**
```json
{
  "issues": [...],
  "total": number,      // Total count from DB query
  "filtered": number,   // Count after filtering (same as total)
  "limit": number,
  "offset": number
}
```

**Key Features:**
- All filtering happens at database level
- No post-query filtering for canonicalId or publicId
- Deterministic results - filters always applied or return empty
- Consistent response structure
- Both camelCase and snake_case parameter support for backward compatibility

### 3. Updated Legacy API (`app/api/issues/route.ts`)
- **Updated `GET /api/issues`** to delegate to canonical behavior:
  - Now supports `canonicalId`/`canonical_id` filters
  - Now supports `publicId`/`public_id` filters
  - Database-level filtering for these new parameters
  - Maintains backward compatibility with existing `label` and `q` filters (post-query)
  
### 4. Tests (`__tests__/api/canonical-issues-api.test.ts`)
Created comprehensive test suite with 14 tests covering:
- ✅ Filtering by canonicalId returns exactly one issue (filtered=1)
- ✅ Support for canonical_id alias
- ✅ Filtering by publicId
- ✅ Support for public_id alias
- ✅ Status filtering
- ✅ Handoff state filtering
- ✅ Pagination (limit/offset)
- ✅ Empty results when no matches (filtered=0)
- ✅ Error handling (400 for invalid status)
- ✅ No unfiltered default list when filter is set
- ✅ `/api/issues` delegates to canonical behavior
- ✅ Consistent response structure

## Acceptance Criteria ✅

All acceptance criteria from I201.1 are met:

1. ✅ `GET /api/afu9/issues?canonicalId=I867` returns exactly 1 issue (filtered=1)
2. ✅ `GET /api/issues?canonicalId=I867` returns identical result
3. ✅ No route returns unfiltered default list when filter is set
4. ✅ Filters work deterministically at database level
5. ✅ Response always contains: issues[], total, filtered, limit, offset

## Database Schema
Uses existing `canonical_id` column added in migration 080:
```sql
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS canonical_id VARCHAR(50);
CREATE UNIQUE INDEX idx_afu9_issues_canonical_id_unique 
  ON afu9_issues(canonical_id) WHERE canonical_id IS NOT NULL AND deleted_at IS NULL;
```

## API Examples

### Filter by Canonical ID
```bash
# Using canonicalId
curl "http://localhost:3000/api/afu9/issues?canonicalId=I867"

# Using canonical_id alias
curl "http://localhost:3000/api/afu9/issues?canonical_id=I867"
```

### Filter by Public ID
```bash
# Using publicId
curl "http://localhost:3000/api/afu9/issues?publicId=c300abd8"

# Using public_id alias
curl "http://localhost:3000/api/afu9/issues?public_id=c300abd8"
```

### Filter by Status
```bash
curl "http://localhost:3000/api/afu9/issues?status=SPEC_READY"
```

### Pagination
```bash
curl "http://localhost:3000/api/afu9/issues?limit=10&offset=20"
```

## Backward Compatibility

The `/api/issues` endpoint maintains full backward compatibility:
- Existing `status`, `handoff_state`, `label`, `q`, `sort`, `order` parameters still work
- New `canonicalId` and `publicId` filters added
- Response format unchanged

## Files Changed
1. `control-center/src/lib/db/afu9Issues.ts` - Database query function
2. `control-center/app/api/afu9/issues/route.ts` - New canonical API endpoint
3. `control-center/app/api/issues/route.ts` - Updated to delegate canonicalId/publicId filtering
4. `control-center/__tests__/api/canonical-issues-api.test.ts` - Comprehensive test suite

## Testing
All 14 tests pass:
```bash
npm test -- canonical-issues-api.test.ts
```

## Security
- No new security vulnerabilities introduced
- All filters properly validated before database queries
- SQL injection prevented through parameterized queries
- Input validation for status parameter

## Next Steps (if needed)
- Option B: Remove `/api/issues` entirely once UI is updated to use `/api/afu9/issues`
- Currently: `/api/issues` delegates to canonical behavior (Option A)
