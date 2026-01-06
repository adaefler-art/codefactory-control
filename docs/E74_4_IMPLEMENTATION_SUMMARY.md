# E74.4 Implementation Summary: CR Versioning + Diff

**Issue**: E74.4 - CR Versioning + Diff (immutable versions + latest pointer)  
**Status**: ✅ Complete  
**Date**: 2026-01-01

## Overview

Implemented immutable CR versioning system with deterministic diff capabilities. CRs are now stored as immutable snapshots with hash-based deduplication, enabling precise version tracking and comparison.

## Implementation Details

### Database Schema (Migration 034)

Created two new tables:

1. **`intent_cr_versions`** - Immutable CR snapshots
   - `id` (UUID, PK)
   - `session_id` (FK to intent_sessions)
   - `created_at` (timestamp)
   - `cr_json` (JSONB)
   - `cr_hash` (text, SHA-256 of canonical JSON)
   - `cr_version` (integer, monotonically increasing per session)
   - Unique constraints: `(session_id, cr_hash)` and `(session_id, cr_version)`

2. **`intent_cr_latest`** - Latest version pointer per session
   - `session_id` (PK, FK to intent_sessions)
   - `latest_cr_version_id` (FK to intent_cr_versions)
   - `updated_at` (timestamp)

### Database Access Layer

**File**: `control-center/src/lib/db/intentCrVersions.ts`

Functions:
- `commitCrVersion()` - Create new immutable version (idempotent via hash)
- `listCrVersions()` - List versions for session (metadata only, newest first)
- `getCrVersion()` - Get specific version by ID (includes full CR JSON)
- `getLatestCrVersion()` - Get latest version via pointer

### Diff Utility

**File**: `control-center/src/lib/utils/crDiff.ts`

- Deterministic JSON diff using RFC 6901 JSON Pointer notation
- Operations: `add`, `remove`, `replace`
- Sorted keys for determinism
- Handles nested objects, arrays, primitives, and null values

### API Endpoints

#### 1. Commit CR Version
```
POST /api/intent/sessions/[id]/cr/commit
```

**Request Body**:
```json
{
  "crJson": { ... }
}
```

**Response** (201 for new, 200 for duplicate):
```json
{
  "version": {
    "id": "uuid",
    "session_id": "uuid",
    "created_at": "ISO-8601",
    "cr_json": { ... },
    "cr_hash": "sha256-hex",
    "cr_version": 1
  },
  "isNew": true
}
```

**Behavior**:
- Computes canonical hash of CR
- If hash exists, returns existing version (idempotent)
- Otherwise, creates new version with incremented version number
- Updates latest pointer atomically

#### 2. List Versions
```
GET /api/intent/sessions/[id]/cr/versions?limit=50&offset=0
```

**Response**:
```json
{
  "versions": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "created_at": "ISO-8601",
      "cr_hash": "sha256-hex",
      "cr_version": 3
    }
  ]
}
```

**Note**: Returns metadata only (no `cr_json`), newest first.

#### 3. Get Specific Version
```
GET /api/intent/cr/versions/[versionId]
```

**Response**:
```json
{
  "version": {
    "id": "uuid",
    "session_id": "uuid",
    "created_at": "ISO-8601",
    "cr_json": { ... },
    "cr_hash": "sha256-hex",
    "cr_version": 2
  }
}
```

#### 4. Compute Diff
```
GET /api/intent/cr/diff?from=<versionId>&to=<versionId>
```

**Response**:
```json
{
  "diff": {
    "from": {
      "id": "uuid",
      "version": 1,
      "hash": "sha256-hex"
    },
    "to": {
      "id": "uuid",
      "version": 2,
      "hash": "sha256-hex"
    },
    "operations": [
      {
        "op": "replace",
        "path": "/title",
        "oldValue": "Old Title",
        "newValue": "New Title"
      },
      {
        "op": "add",
        "path": "/newField",
        "value": "new value"
      }
    ]
  }
}
```

## Key Features

### 1. Immutability
- Once a CR version is committed, it never changes
- Identified by immutable version number and hash

### 2. Idempotency
- Same CR content (same hash) → returns existing version
- No duplicate versions for identical content
- Safe to call commit multiple times

### 3. Deterministic Versioning
- Version numbers increment monotonically per session
- Computed atomically in transaction (race-safe)
- Unique constraint prevents duplicates

### 4. Deterministic Diff
- Same inputs always produce same output
- Sorted keys for consistency
- JSON Pointer paths for precision

### 5. Ownership & Security
- All operations verify session ownership via `user_id`
- Prevents unauthorized access to versions

## Test Coverage

**28 tests, 100% passing**

Test files:
1. `__tests__/api/intent-cr-versions.test.ts` (13 tests)
   - Database layer unit tests
   - Commit, list, get, latest operations
   - Idempotency and ownership checks

2. `__tests__/lib/utils/crDiff.test.ts` (12 tests)
   - Diff computation for all operation types
   - Edge cases (null, empty arrays/objects)
   - Determinism verification

3. `__tests__/api/intent-cr-versioning-integration.test.ts` (3 tests)
   - End-to-end workflow testing
   - Multi-version scenarios
   - Immutability enforcement

## Usage Example

```typescript
// 1. Commit first version
const commit1 = await fetch('/api/intent/sessions/123/cr/commit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ crJson: myCR })
});
// Response: { version: {...}, isNew: true }

// 2. Modify and commit again
const modifiedCR = { ...myCR, title: 'Updated' };
const commit2 = await fetch('/api/intent/sessions/123/cr/commit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ crJson: modifiedCR })
});
// Response: { version: {...}, isNew: true }

// 3. List all versions
const list = await fetch('/api/intent/sessions/123/cr/versions');
// Response: { versions: [{...}, {...}] }

// 4. Get specific version
const version = await fetch('/api/intent/cr/versions/<versionId>');
// Response: { version: {...} }

// 5. Compare versions
const diff = await fetch('/api/intent/cr/diff?from=v1&to=v2');
// Response: { diff: { from: {...}, to: {...}, operations: [...] } }
```

## Migration Instructions

1. **Apply migration**:
   ```bash
   npm run db:migrate
   ```

2. **Verify tables created**:
   ```sql
   SELECT * FROM intent_cr_versions LIMIT 1;
   SELECT * FROM intent_cr_latest LIMIT 1;
   ```

## Non-Negotiables Met

✅ **Immutability**: Versions never change after commit  
✅ **Idempotency**: Hash-based deduplication prevents duplicates  
✅ **Deterministic Diff**: Consistent output for same inputs  
✅ **No GitHub Issue Generation**: Kept scope strictly to versioning

## Future Enhancements (Out of Scope)

- GitHub issue generation from CR versions (E75.*)
- UI for version history visualization
- Version tagging/labeling
- Rollback to previous version
- Branch/merge operations

## Files Changed

- `database/migrations/034_intent_cr_versions.sql` (33 lines)
- `control-center/src/lib/db/intentCrVersions.ts` (333 lines)
- `control-center/src/lib/utils/crDiff.ts` (136 lines)
- `control-center/app/api/intent/sessions/[id]/cr/commit/route.ts` (97 lines)
- `control-center/app/api/intent/sessions/[id]/cr/versions/route.ts` (75 lines)
- `control-center/app/api/intent/cr/versions/[versionId]/route.ts` (70 lines)
- `control-center/app/api/intent/cr/diff/route.ts` (75 lines)
- `control-center/__tests__/api/intent-cr-versions.test.ts` (393 lines)
- `control-center/__tests__/lib/utils/crDiff.test.ts` (295 lines)
- `control-center/__tests__/api/intent-cr-versioning-integration.test.ts` (254 lines)

**Total**: 10 files, 1,761 lines added

## Validation

- ✅ All 28 tests passing
- ✅ TypeScript compilation successful
- ✅ No breaking changes to existing code
- ✅ Migration script follows repo conventions
- ✅ API routes follow existing patterns
- ✅ Ownership checks implemented
- ✅ Error handling comprehensive
