# E7_extra: Verification Commands

This document provides the complete set of commands to verify the E7_extra implementation.

## Prerequisites

```bash
# Navigate to repository root
cd /home/runner/work/codefactory-control/codefactory-control

# Ensure dependencies are installed (if needed)
npm install
npm --prefix control-center install
```

## 1. Repository Verification

Verifies repository structure and consistency.

### PowerShell
```powershell
npm run repo:verify
```

### Bash
```bash
npm run repo:verify
```

**Expected Output:** ✅ All checks pass

## 2. Unit Tests

Runs all control-center unit tests including new status mapping tests.

### PowerShell
```powershell
npm --prefix control-center test
```

### Bash
```bash
cd control-center && npm test
```

**Expected Output:** 
- All existing tests pass
- New tests in `__tests__/lib/status-mapping.test.ts` pass:
  - `mapGitHubStatusToAfu9` tests (70+ cases)
  - `extractGitHubStatus` tests (50+ cases)

## 3. Build Verification

Verifies TypeScript compilation and Next.js build.

### PowerShell
```powershell
npm --prefix control-center run build
```

### Bash
```bash
cd control-center && npm run build
```

**Expected Output:** ✅ Build successful, no TypeScript errors

## 4. Database Migration

Applies the new migration for GitHub status parity.

### PowerShell
```powershell
npm --prefix control-center run db:migrate
```

### Bash
```bash
cd control-center && npm run db:migrate
```

**Expected Output:** 
```
Applied migration 041_github_status_parity.sql
```

**Verification Query:**
```sql
-- Check new columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'afu9_issues' 
  AND column_name IN ('github_status_raw', 'github_status_updated_at', 'status_source');

-- Expected: 3 rows returned
```

## 5. Manual API Testing

### 5.1 Create Test Issue

```bash
curl -X POST http://localhost:3000/api/issues/new \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "E7_extra Test Issue",
    "body": "Testing GitHub status sync",
    "priority": "P1"
  }'
```

**Expected:** Returns issue with ID and status `CREATED`

### 5.2 Handoff to GitHub

```bash
curl -X POST http://localhost:3000/api/issues/{ISSUE_ID}/handoff \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:** 
- GitHub issue created
- AFU9 issue linked with `github_issue_number`
- `handoff_state` = `SYNCED`

### 5.3 Add GitHub Status Label

In GitHub UI:
1. Navigate to the created issue
2. Add label: `status: implementing`

### 5.4 Run Sync

```bash
curl -X POST http://localhost:3000/api/issues/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "ok": true,
  "total": 1,
  "upserted": 1,
  "statusSynced": 1,
  "syncedAt": "2026-01-04T12:00:00.000Z"
}
```

### 5.5 Verify Issue Status

```bash
curl http://localhost:3000/api/issues/{ISSUE_ID} \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**
```json
{
  "id": "...",
  "status": "IMPLEMENTING",
  "github_status_raw": "implementing",
  "github_status_updated_at": "2026-01-04T12:00:00.000Z",
  "status_source": "github_label",
  "handoff_state": "SYNCED",
  ...
}
```

## 6. UI Verification

### 6.1 Issue Detail Page

1. Navigate to: `http://localhost:3000/issues/{ISSUE_ID}`
2. Verify display shows:
   - **AFU9 Status:** `IMPLEMENTING` (or mapped status)
   - **GitHub Status:** Raw value with source badge (e.g., "implementing 🏷️ Label")
   - **Last synced:** Recent timestamp

### 6.2 Issue List Page

1. Navigate to: `http://localhost:3000/issues`
2. Verify issue appears in list
3. Status shows canonical AFU9 status

## 7. Idempotency Test

Run sync twice with no changes to GitHub issue:

```bash
# First sync
curl -X POST http://localhost:3000/api/issues/sync \
  -H "Authorization: Bearer YOUR_TOKEN"

# Second sync (immediately after)
curl -X POST http://localhost:3000/api/issues/sync \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:**
- Both return same `statusSynced` count
- No status changes in database
- `github_status_updated_at` updated but `status` unchanged

**Verification Query:**
```sql
SELECT 
  id,
  status,
  github_status_raw,
  github_status_updated_at,
  status_source
FROM afu9_issues
WHERE github_issue_number = YOUR_ISSUE_NUMBER;

-- Expected: Same values after both syncs
```

## 8. Edge Cases Testing

### 8.1 Unknown GitHub Status

1. Add GitHub label: `status: unknown_value`
2. Run sync
3. Verify: AFU9 status unchanged (fail-closed behavior)

### 8.2 Multiple Status Sources

1. Add both:
   - GitHub Project status: "In Progress"
   - GitHub label: "status: done"
2. Run sync
3. Verify: Project status takes priority (status = `IMPLEMENTING`)

### 8.3 Issue State Fallback

1. Close GitHub issue (no project status, no labels)
2. Run sync
3. Verify: 
   - `status` = `DONE`
   - `github_status_raw` = `closed`
   - `status_source` = `github_state`

## 9. Performance Testing

### 9.1 Bulk Sync

```bash
# Sync with max issues
curl -X POST http://localhost:3000/api/issues/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "maxIssues": 200
  }'
```

**Expected:**
- Completes within reasonable time (< 30s for 200 issues)
- Returns accurate counts
- No timeout errors

### 9.2 Database Query Performance

```sql
-- Should use index on status_source
EXPLAIN ANALYZE
SELECT * FROM afu9_issues
WHERE status_source = 'github_label';

-- Should use index on github_status_updated_at
EXPLAIN ANALYZE
SELECT * FROM afu9_issues
WHERE github_status_updated_at > NOW() - INTERVAL '1 hour';
```

**Expected:** Both use indexes (Index Scan, not Seq Scan)

## 10. Regression Testing

Run existing test suites to ensure no breaking changes:

```bash
# All control-center tests
npm --prefix control-center test

# Specific regression test suites
npm --prefix control-center test -- __tests__/api/issue-sync-route.test.ts
npm --prefix control-center test -- __tests__/lib/afu9-ingestion.test.ts
npm --prefix control-center test -- __tests__/app/issues/
```

**Expected:** All existing tests continue to pass

## 11. Type Safety Verification

```bash
# TypeScript compilation
cd control-center && npx tsc --noEmit

# ESLint
cd control-center && npm run lint
```

**Expected:** 
- No TypeScript errors
- No ESLint errors in changed files

## 12. Security Verification

### 12.1 SQL Injection Check

Verify parameterized queries in:
- `src/lib/db/afu9Issues.ts` (createAfu9Issue, updateAfu9Issue)
- `app/api/ops/issues/sync/route.ts`

**Expected:** All queries use parameterized placeholders ($1, $2, etc.)

### 12.2 XSS Check

Verify UI properly escapes values:
- `app/issues/[id]/page.tsx` (GitHub status display)
- `app/issues/page.tsx` (Issue list)

**Expected:** All dynamic values wrapped in JSX expressions (auto-escaped)

### 12.3 Auth Check

```bash
# Attempt sync without auth
curl -X POST http://localhost:3000/api/issues/sync

# Expected: 401 Unauthorized
```

## 13. Documentation Verification

Verify all documentation is up to date:

- ✅ `E7_EXTRA_IMPLEMENTATION_SUMMARY.md` created
- ✅ `E7_EXTRA_VERIFICATION_COMMANDS.md` created (this file)
- ✅ Code comments explain GitHub status mapping
- ✅ Function JSDoc comments complete

## Success Criteria

All of the following must pass:

- [ ] `npm run repo:verify` ✅
- [ ] `npm --prefix control-center test` ✅
- [ ] `npm --prefix control-center run build` ✅
- [ ] Database migration applies successfully ✅
- [ ] Manual API tests pass ✅
- [ ] UI displays GitHub status correctly ✅
- [ ] Idempotency test passes ✅
- [ ] Edge cases handled correctly ✅
- [ ] No regressions in existing tests ✅
- [ ] Type safety verified ✅
- [ ] Security checks pass ✅

---

## Troubleshooting

### Dependencies Not Installed

```bash
npm install
npm --prefix control-center install
npm --prefix packages/deploy-memory install
npm --prefix packages/verdict-engine install
```

### Database Connection Issues

```bash
# Check database is running
docker ps | grep postgres

# Check environment variables
cat control-center/.env.local | grep DATABASE_URL
```

### Test Failures

```bash
# Run specific test file
npm --prefix control-center test -- __tests__/lib/status-mapping.test.ts

# Run with verbose output
npm --prefix control-center test -- --verbose

# Run with coverage
npm --prefix control-center test -- --coverage
```

### Build Failures

```bash
# Clean and rebuild
cd control-center
rm -rf .next
rm -rf node_modules
npm install
npm run build
```

---

**Last Updated:** 2026-01-04
**Issue:** E7_extra
**Status:** ✅ COMPLETE
