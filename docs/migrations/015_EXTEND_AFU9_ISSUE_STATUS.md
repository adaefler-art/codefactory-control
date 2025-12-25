# Migration Guide: Extended AFU9 Issue Status Enum

## Overview

This migration extends the AFU9 Issue Status enum to support a more granular workflow:

- **Added Statuses:**
  - `SPEC_READY` - Issue specification is complete and ready for implementation
  - `IMPLEMENTING` - Issue is currently being implemented
  - `FAILED` - Issue implementation has failed

- **Migration:** Existing `ACTIVE` issues are automatically migrated to `IMPLEMENTING`

## Database Migration

### Migration File
`database/migrations/015_extend_afu9_issue_status.sql`

### What it does:
1. Drops the existing constraint on `afu9_issues.status`
2. Creates a new constraint allowing the extended status values
3. Migrates all existing `ACTIVE` issues to `IMPLEMENTING` status

### Running the Migration

To apply this migration, run:

```bash
./scripts/deploy-migrations.sh 015_extend_afu9_issue_status.sql
```

Or execute the SQL file directly against your database:

```bash
psql -h <your-db-host> -U <username> -d <database> -f database/migrations/015_extend_afu9_issue_status.sql
```

## Code Changes

### 1. TypeScript Enum (control-center/src/lib/contracts/afu9Issue.ts)

```typescript
export enum Afu9IssueStatus {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',       // NEW
  IMPLEMENTING = 'IMPLEMENTING',   // NEW
  ACTIVE = 'ACTIVE',               // Legacy - prefer IMPLEMENTING
  BLOCKED = 'BLOCKED',
  DONE = 'DONE',
  FAILED = 'FAILED',               // NEW
}
```

### 2. Database Helper (control-center/src/lib/db/afu9Issues.ts)

Updated `countIssuesByStatus` to include the new statuses in the count map.

### 3. UI Components

**Issue Detail Page** (`control-center/app/issues/[id]/page.tsx`):
- Updated `Issue` type definition
- Added dropdown options for new statuses
- Added badge colors:
  - `SPEC_READY` - Cyan badge
  - `IMPLEMENTING` - Blue badge
  - `FAILED` - Red badge

**Issue List Page** (`control-center/app/issues/page.tsx`):
- Updated `Issue` type definition
- Added filter options for new statuses
- Added matching badge colors

## Status Transition Flow

### Recommended Workflow

```
CREATED → SPEC_READY → IMPLEMENTING → DONE
                           ↓
                        FAILED
```

### Valid Transitions

All statuses can transition to:
- `BLOCKED` (when blocked)
- `DONE` (when completed)
- `FAILED` (when failed)

From `BLOCKED`, you can transition back to any working status.

## API Changes

### PATCH /api/issues/{id}

The endpoint now accepts the new status values:

```json
{
  "status": "SPEC_READY"
}
```

```json
{
  "status": "IMPLEMENTING"
}
```

```json
{
  "status": "FAILED"
}
```

### Validation

The API validates that status values are in the enum. Invalid status values return a `400 Bad Request`:

```json
{
  "error": "Invalid status",
  "details": "Status must be one of: CREATED, SPEC_READY, IMPLEMENTING, ACTIVE, BLOCKED, DONE, FAILED"
}
```

## Testing

All tests have been updated and are passing:

- **Contract Tests**: 65 tests passing
  - Validates new status values in `isValidStatus()`
  - Ensures validation accepts all new statuses

- **API Tests**: 29 tests passing
  - Tests PATCH endpoint with new status values
  - Verifies status transitions work correctly

Run tests:
```bash
cd control-center
npx jest __tests__/lib/contracts/afu9Issue.test.ts
npx jest __tests__/api/afu9-issues-api.test.ts
```

## Breaking Changes

**None.** This is a backwards-compatible change:

- Existing `ACTIVE` status is preserved (though `IMPLEMENTING` is preferred)
- All existing statuses continue to work
- The migration automatically converts `ACTIVE` → `IMPLEMENTING` for data consistency

## Rollback

If you need to rollback this migration:

```sql
-- 1. Convert IMPLEMENTING back to ACTIVE
UPDATE afu9_issues 
SET status = 'ACTIVE' 
WHERE status = 'IMPLEMENTING';

-- 2. Convert SPEC_READY and FAILED to CREATED
UPDATE afu9_issues 
SET status = 'CREATED' 
WHERE status IN ('SPEC_READY', 'FAILED');

-- 3. Restore old constraint
ALTER TABLE afu9_issues DROP CONSTRAINT chk_afu9_issue_status;
ALTER TABLE afu9_issues ADD CONSTRAINT chk_afu9_issue_status CHECK (status IN (
  'CREATED',
  'ACTIVE',
  'BLOCKED',
  'DONE'
));
```

## Documentation Updates

- Updated `docs/issues/AFU9_ISSUE_MODEL.md` with new status values and transitions
- Added migration guide (this file)

## Related Issues

- Epic: adaefler-art/codefactory-control#316
- Issue: adaefler-art/codefactory-control#I5-1.2
