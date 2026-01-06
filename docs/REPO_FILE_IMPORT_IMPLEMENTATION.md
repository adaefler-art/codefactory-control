# Repo File Import Feature - Implementation Summary

## Overview
This implementation adds a new feature to import Epics and Issues from a backlog file stored in the GitHub repository.

## Components Implemented

### 1. Database Schema (`database/migrations/020_import_runs_and_epics.sql`)
- **afu9_epics** table: Stores epics with stable external IDs for upsert logic
- **import_runs** table: Tracks import operations with statistics and errors
- Extended **afu9_issues** table: Added `epic_id` and `external_id` columns for relationships and upsert logic

### 2. Backlog Parser (`control-center/src/lib/parsers/backlog-parser.ts`)
Parses AFU-9 backlog markdown files with format:
```markdown
## EPIC E1 — Epic Title
- I1 (E1.1): Issue Title
```

**Features:**
- Parses epics and issues from structured markdown
- Validates structure and relationships
- Returns detailed parse errors with line numbers

**Test Results:**
- ✅ Parser correctly identifies 1 Epic and 5 Issues from actual backlog file
- ✅ All validation logic tests pass

### 3. Database Helpers
- **afu9Epics.ts**: CRUD operations for epics with upsert support
- **importRuns.ts**: Tracks import operations with detailed statistics
- **fetch-file.ts**: Fetches files from GitHub using GitHub App authentication

### 4. API Endpoint (`/api/import/backlog-file`)
**Request:**
```json
{
  "path": "docs/roadmaps/afu9_v0_6_backlog.md",
  "ref": "main"
}
```

**Response:**
```json
{
  "success": true,
  "runId": "uuid",
  "status": "COMPLETED",
  "epics": {
    "created": 1,
    "updated": 0,
    "skipped": 0,
    "total": 1
  },
  "issues": {
    "created": 5,
    "updated": 0,
    "skipped": 0,
    "total": 5
  }
}
```

**Features:**
- Fetches file from GitHub using GitHub App auth
- Parses and validates backlog structure
- Upserts epics and issues with stable IDs (no duplicates on re-import)
- Tracks import run with detailed statistics
- Error handling for file not found, parse errors, etc.

### 5. UI Component (`control-center/app/issues/page.tsx`)
Enhanced the Issues page with a new import mode:

**Features:**
- Two import modes: "Text Import" (existing) and "Import from Repo File" (new)
- Input fields for file path and Git ref
- Displays detailed import results (created/updated/skipped counts for epics and issues)
- Shows errors with line numbers when parsing fails
- Auto-refreshes issues list after successful import

## Acceptance Criteria Status

✅ **1 Epic + 5 Issues are created**
- Parser correctly identifies structure from `docs/roadmaps/afu9_v0_6_backlog.md`
- Upsert logic creates epics and issues on first import

✅ **Re-Import without changes: created=0, updated=0, skipped=6**
- Upsert logic compares existing data
- No duplicate records created

✅ **Re-Import after title change: updated>=1, no new DB-ID**
- Upsert uses `external_id` as stable identifier
- Updates existing record instead of creating new one

✅ **File not found → 404 + clear message**
- GitHub API 404 errors are caught and returned with clear message
- Example: "File not found: path/to/file (ref: main)"

✅ **Parser error → 400 + line hint**
- Parse errors include line numbers
- Validation errors are detailed in response
- Example: "Line 5: Issue found before any Epic declaration"

## Testing

### Parser Tests
```bash
cd /home/runner/work/codefactory-control/codefactory-control
npx tsx test/test-backlog-parser.ts
```
✅ All tests pass (1 Epic, 5 Issues correctly parsed)

### API Logic Tests
```bash
npx tsx test/test-api-logic.ts
```
✅ All 4 test cases pass

## Deployment Steps

1. **Run database migration:**
   ```bash
   cd control-center
   npm run db:migrate
   ```

2. **Build and deploy:**
   ```bash
   npm run build
   npm run deploy
   ```

3. **Verify GitHub App permissions:**
   - Ensure the GitHub App has `contents: read` permission

## Usage

1. Navigate to Issues page
2. Click "Import Issues" button
3. Select "Import from Repo File" tab
4. Enter file path: `docs/roadmaps/afu9_v0_6_backlog.md`
5. Enter Git ref: `main` (or any branch/tag)
6. Click "Import"
7. View detailed results showing created/updated/skipped counts

## Error Handling

The implementation handles all required error cases:
- ✅ File not found (404)
- ✅ Invalid file path (400)
- ✅ Parser errors with line hints (400)
- ✅ Validation errors (400)
- ✅ GitHub API errors (403, 500)
- ✅ Database errors (500)

## Re-Import Behavior

The upsert logic ensures stable behavior:
- **First import**: Creates all records
- **Re-import (no changes)**: Skips all records
- **Re-import (with changes)**: Updates only changed records
- **Stable IDs**: Uses `external_id` for matching, preserves database UUIDs

## Notes

- Import runs are tracked in `import_runs` table for audit trail
- Epic-Issue relationships are maintained via foreign key
- All operations are transactional (import run tracks status)
- UI auto-refreshes to show newly imported items
