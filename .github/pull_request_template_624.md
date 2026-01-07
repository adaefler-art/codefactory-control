## 🎯 Issue
Fixes adaefler-art/codefactory-control#624 

## 📊 Problem
GitHub Mirror Status (`github_mirror_status`) blieb bei **allen 67 Issues** auf `UNKNOWN`, obwohl der Sync erfolgreich GitHub-Daten abrief.

**Symptom:**
```json
{
  "github_sync_error": "violates check constraint \"afu9_issues_github_mirror_status_check\""
}
```

**Root Cause:**  
Migration 049 wurde nicht auf Staging-DB angewendet.  Der CHECK Constraint erlaubte nur 6 Werte (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED`, `UNKNOWN`) statt 9 (`+ OPEN`, `CLOSED`, `ERROR`).

---

## ✅ Solution

### 1. Migration 049 deployed
```sql
ALTER TABLE afu9_issues 
  DROP CONSTRAINT afu9_issues_github_mirror_status_check;

ALTER TABLE afu9_issues
  ADD CONSTRAINT afu9_issues_github_mirror_status_check CHECK (
    github_mirror_status IN (
      'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED',
      'OPEN', 'CLOSED', 'ERROR', 'UNKNOWN'
    )
  );
```

### 2. Diagnose-Tools erstellt
- **CLI:** `scripts/diagnose-github-mirror-status.ts`  
  Lokale DB-Diagnose mit 4 SQL-Queries
  
- **API:** `/api/admin/diagnose-mirror-status`  
  Server-side Diagnose (läuft im VPC, hat direkten DB-Zugriff)

- **Docs:** `MIGRATION_049_STAGING_GUIDE.md`  
  Step-by-step Guide für zukünftige Migrations-Probleme

---

## 🧪 Verification

**Before (2026-01-06):**
```json
{
  "diagnosis": { "status": "CRITICAL", "problem": "ALL_UNKNOWN" },
  "results": { "issueI691": { "github_mirror_status": "UNKNOWN" } },
  "statusDistribution": [{ "github_mirror_status": "UNKNOWN", "count": "67" }]
}
```

**After (2026-01-07 09:06 UTC):**
```json
{
  "diagnosis": { "status": "OK" },
  "results": { "issueI691": { "github_mirror_status": "CLOSED", "github_sync_error": null } },
  "statusDistribution": [
    { "github_mirror_status": "CLOSED", "count":  "66" },
    { "github_mirror_status": "ERROR", "count": "1" }
  ]
}
```

**Test Endpoint:**  
`https://stage.afu-9.com/api/admin/diagnose-mirror-status`

---

## 📁 Files Changed

### Added
- `scripts/diagnose-github-mirror-status.ts` - CLI diagnostic tool
- `control-center/app/api/admin/diagnose-mirror-status/route.ts` - Admin API endpoint
- `docs/issues/ISSUE_624_RESOLUTION.md` - Resolution docs
- `MIGRATION_049_STAGING_GUIDE.md` - Migration guide
- `ADMIN_DIAGNOSE_ENDPOINT_TESTING.md` - API testing guide

### Modified
- None (Migration was applied directly to DB via ECS Exec)

### Removed
- Test endpoint artifacts (cleaned up after verification)

---

## 🎓 Lessons Learned

1. ✅ **Migration verification is critical**  
   Always verify migrations were applied:  `SELECT * FROM schema_migrations`

2. ✅ **Server-side diagnostics > Client-side**  
   Admin endpoint in VPC → direct DB access, no port forwards needed

3. ✅ **Type-safety ≠ DB constraint compatibility**  
   TypeScript types don't prevent runtime DB constraint violations

---

## 🚀 Deployment Notes

### Required Actions
- ✅ Migration 049 already applied to Staging via ECS Exec (2026-01-07)
- ⚠️ **Production:** Apply migration before deploying this PR

### Production Deployment Checklist
- [ ] Verify migration 049 exists:  `SELECT * FROM schema_migrations WHERE filename LIKE '%049%'`
- [ ] If missing: Run `bash scripts/db-migrate.sh` in production ECS task
- [ ] Trigger sync: `POST /api/ops/issues/sync`
- [ ] Verify:  `GET /api/admin/diagnose-mirror-status`

---

## 📊 Metrics

| Metric | Before | After |
|--------|--------|-------|
| **UNKNOWN Issues** | 67 ❌ | 0 ✅ |
| **Sync Persist Failed** | 67 ❌ | 0 ✅ |
| **Sync Persist OK** | 0 ❌ | 67 ✅ |
| **Last Successful Sync** | 2026-01-05 ⚠️ | 2026-01-07 ✅ |

---

## ✅ Checklist

- [x] Issue fixed and verified on Staging
- [x] Diagnostic tools created
- [x] Documentation updated
- [x] Test endpoint removed
- [ ] Reviewed by:  @adaefler-art
- [ ] Migration verified on Production
