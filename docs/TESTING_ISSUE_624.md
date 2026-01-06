# Testing Guide: Issue #624 - GitHub Mirror Status Persistence

**Issue:** [#624](https://github.com/adaefler-art/codefactory-control/issues/624) - GitHub Mirror Status Persistierung schlägt fehl

**Problem:** `github_mirror_status` bleibt immer `UNKNOWN` trotz erfolgreicher GitHub API Calls (67 Issues betroffen)

**Root Cause:** Type-Safety-Bypass in `control-center/app/api/ops/issues/sync/route.ts` (lines 604-624):
```typescript
// ❌ BEFORE (Bug):
const persistPayload: Record<string, unknown> = { github_mirror_status: ... };
updateResult = await updateAfu9Issue(pool, afu9Id, persistPayload as any);

// ✅ AFTER (Fixed):
const persistPayload: Partial<Afu9IssueInput> = { github_mirror_status: ... };
updateResult = await updateAfu9Issue(pool, afu9Id, persistPayload);
```

---

## 🧪 Test Endpoint (Temporary - No Auth)

**⚠️ WARNING:** This test endpoint has NO authentication and should only be used for local development. DELETE after testing!

### File Location
```
control-center/app/api/admin/diagnose-mirror-status-test/route.ts
```

### Purpose
- Local testing without Cognito authentication
- Quick diagnostic feedback loop
- Verify type safety fix before staging deployment

---

## 🚀 How to Test

### Prerequisites
1. Control Center running locally:
   ```powershell
   cd c:\dev\codefactory\control-center
   npm run dev
   ```

2. PostgreSQL database accessible (local Docker or staging via VPN)

3. Environment variable `DATABASE_URL` configured in `.env.local`:
   ```
   DATABASE_URL=postgresql://afu9_user:password@localhost:5432/afu9_db
   ```

### Option 1: npm Script (Recommended)
```powershell
npm --prefix control-center run diagnose:mirror-status
```

### Option 2: curl
```bash
curl http://localhost:3000/api/admin/diagnose-mirror-status-test
```

### Option 3: PowerShell Invoke-RestMethod
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/admin/diagnose-mirror-status-test" -Method GET | ConvertTo-Json -Depth 10
```

---

## 📊 Expected Responses

### Scenario 1: CRITICAL - All Issues UNKNOWN (Bug Present)
```json
{
  "ok": true,
  "timestamp": "2025-01-02T14:30:00.000Z",
  "results": {
    "issueI691": {
      "public_id": "a1b2c3d4",
      "title": "E71.1: I691 - GitHub Mirror Status Enforcement",
      "github_issue_number": 477,
      "github_mirror_status": "UNKNOWN",
      "github_url": "https://github.com/adaefler-art/codefactory-control/issues/477",
      "github_repo": "adaefler-art/codefactory-control",
      "handoff_state": "deployed",
      "github_issue_last_sync_at": null,
      "github_sync_error": null
    },
    "statusDistribution": [
      { "github_mirror_status": "UNKNOWN", "count": "67" }
    ],
    "neverSyncedCount": 67,
    "lastSync": {
      "last_sync_time": null,
      "synced_issues_count": "0"
    }
  },
  "diagnosis": {
    "status": "CRITICAL",
    "problem": "ALL_UNKNOWN",
    "message": "Alle 67 Issues haben github_mirror_status = UNKNOWN",
    "recommendation": "Sync wurde nie erfolgreich ausgeführt oder Persist schlägt fehl. Prüfe Server-Logs nach \"Persist failed\" Fehlern. Verifiziere Type-Safety in control-center/app/api/ops/issues/sync/route.ts",
    "databaseConnection": "OK",
    "issuesFound": 67
  }
}
```

**Action Required:**
1. ✅ Verify type safety fix is applied in `sync/route.ts`
2. ✅ Run sync endpoint to trigger update
3. ✅ Re-run diagnostic to verify status changes

---

### Scenario 2: OK - All Issues Have Correct Status (Bug Fixed)
```json
{
  "ok": true,
  "timestamp": "2025-01-02T15:00:00.000Z",
  "results": {
    "issueI691": {
      "public_id": "a1b2c3d4",
      "title": "E71.1: I691 - GitHub Mirror Status Enforcement",
      "github_issue_number": 477,
      "github_mirror_status": "OPEN",
      "github_url": "https://github.com/adaefler-art/codefactory-control/issues/477",
      "github_repo": "adaefler-art/codefactory-control",
      "handoff_state": "deployed",
      "github_issue_last_sync_at": "2025-01-02T14:55:00.000Z",
      "github_sync_error": null
    },
    "statusDistribution": [
      { "github_mirror_status": "OPEN", "count": "45" },
      { "github_mirror_status": "CLOSED", "count": "22" }
    ],
    "neverSyncedCount": 0,
    "lastSync": {
      "last_sync_time": "2025-01-02T14:55:00.000Z",
      "synced_issues_count": "67"
    }
  },
  "diagnosis": {
    "status": "OK",
    "message": "Alle 67 Issues haben korrekten Status",
    "databaseConnection": "OK",
    "issuesFound": 67
  }
}
```

**Action Required:**
1. ✅ Bug fixed successfully!
2. ✅ DELETE test endpoint
3. ✅ Deploy to staging

---

### Scenario 3: WARNING - Partial UNKNOWN (Intermittent Failure)
```json
{
  "ok": true,
  "timestamp": "2025-01-02T14:45:00.000Z",
  "results": {
    "statusDistribution": [
      { "github_mirror_status": "OPEN", "count": "50" },
      { "github_mirror_status": "UNKNOWN", "count": "17" }
    ],
    "neverSyncedCount": 17
  },
  "diagnosis": {
    "status": "WARNING",
    "problem": "PARTIAL_UNKNOWN",
    "message": "17 von 67 Issues haben UNKNOWN Status",
    "recommendation": "Einige Issues konnten nicht gesynct werden. Prüfe github_sync_error Spalte für Details.",
    "databaseConnection": "OK",
    "issuesFound": 67
  }
}
```

**Action Required:**
1. ✅ Check `github_sync_error` column for failed issues
2. ✅ Investigate GitHub API rate limits or network errors
3. ✅ Re-run sync for affected issues

---

### Scenario 4: INFO - No Issues Found (Empty Database)
```json
{
  "ok": true,
  "timestamp": "2025-01-02T14:00:00.000Z",
  "results": {
    "issueI691": null,
    "statusDistribution": [],
    "neverSyncedCount": 0,
    "lastSync": {
      "last_sync_time": null,
      "synced_issues_count": "0"
    }
  },
  "diagnosis": {
    "status": "INFO",
    "message": "Keine Issues mit GitHub-Links gefunden",
    "databaseConnection": "OK",
    "issuesFound": 0
  }
}
```

**Action Required:**
1. ⚠️ Seed test data into local database
2. ⚠️ Or switch to staging database (requires VPN)

---

## 🔍 Diagnostic Queries Explained

The endpoint runs 4 SQL queries:

### Query 1: Issue I691 Spot Check
```sql
SELECT 
  LEFT(id::text, 8) as public_id,
  title,
  github_issue_number,
  github_mirror_status,
  github_url,
  github_repo,
  handoff_state,
  github_issue_last_sync_at,
  github_sync_error
FROM afu9_issues
WHERE title LIKE '%I691%' OR github_issue_number = 477
LIMIT 1;
```
**Purpose:** Check specific issue mentioned in #624 (I691 = GitHub #477)

### Query 2: Status Distribution
```sql
SELECT 
  github_mirror_status,
  COUNT(*) as count
FROM afu9_issues
WHERE github_issue_number IS NOT NULL
GROUP BY github_mirror_status
ORDER BY count DESC;
```
**Purpose:** See ratio of UNKNOWN vs OPEN/CLOSED/ERROR

### Query 3: Never-Synced Count
```sql
SELECT COUNT(*) as never_synced_count
FROM afu9_issues
WHERE github_issue_number IS NOT NULL
  AND github_issue_last_sync_at IS NULL;
```
**Purpose:** Identify issues that never got a successful sync

### Query 4: Last Successful Sync
```sql
SELECT 
  MAX(github_issue_last_sync_at) as last_sync_time,
  COUNT(*) as synced_issues_count
FROM afu9_issues
WHERE github_issue_last_sync_at IS NOT NULL;
```
**Purpose:** When was last time ANY issue synced successfully?

---

## 🧹 Cleanup Checklist

**⚠️ BEFORE MERGING TO MAIN:**

- [ ] Verify bug is fixed (diagnosis.status = "OK")
- [ ] DELETE `control-center/app/api/admin/diagnose-mirror-status-test/route.ts`
- [ ] REMOVE npm script `"diagnose:mirror-status"` from `package.json`
- [ ] ARCHIVE this testing doc to `docs/archive/TESTING_ISSUE_624.md`
- [ ] Update Issue #624 with fix verification results
- [ ] Run `npm run repo:verify` to ensure no test artifacts remain

---

## 🛠️ Troubleshooting

### Error: `fetch is not defined`
**Solution:** Use Node.js 18+ (fetch is built-in) or use curl/Invoke-RestMethod instead

### Error: `Database connection failed`
**Check:**
1. PostgreSQL running? `docker ps | grep postgres`
2. `DATABASE_URL` correct in `.env.local`?
3. Database migrations applied? `npm --prefix control-center run db:migrate`

### Error: `Cannot GET /api/admin/diagnose-mirror-status-test`
**Check:**
1. Control Center running? `npm run dev`
2. File exists? `ls control-center/app/api/admin/diagnose-mirror-status-test/route.ts`
3. Next.js router cache? Restart dev server

### Response: `"issuesFound": 0`
**Cause:** Database empty or no issues with `github_issue_number`
**Solution:** 
- Seed test data OR
- Switch to staging database (requires VPN + updated `DATABASE_URL`)

---

## 📚 Related Documentation

- **Issue #624:** [GitHub Mirror Status Persistierung schlägt fehl](https://github.com/adaefler-art/codefactory-control/issues/624)
- **Production Endpoint:** `docs/ADMIN_DIAGNOSE_ENDPOINT_TESTING.md` (requires Cognito auth)
- **CLI Script:** `docs/GITHUB_MIRROR_STATUS_DIAGNOSTIC.md` (requires DATABASE_URL)
- **Type Safety Fix:** Commit 6c8bb67d on branch `e80-1-admin-subs-secret-injection`

---

## ⏱️ Testing Timeline

1. **Local Testing:** 5 minutes (this guide)
2. **Type Safety Fix Verification:** 10 minutes (apply fix, run sync, re-diagnose)
3. **Staging Deployment:** 20 minutes (CDK deploy + verification)
4. **Production Rollout:** After 24h staging soak test

---

**Last Updated:** 2025-01-02  
**Maintainer:** AFU-9 Control Center Team  
**Status:** ⚠️ TEMPORARY TEST ENDPOINT - DELETE AFTER TESTING
