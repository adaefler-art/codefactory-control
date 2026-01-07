# Issue adaefler-art/codefactory-control#624: GitHub Mirror Status Persistierung - RESOLVED ✅

## Problem
GitHub Mirror Status blieb bei allen 67 Issues auf `UNKNOWN`, obwohl Sync erfolgreich lief.

## Root Cause
Migration 049 nicht auf Staging angewendet → CHECK Constraint erlaubte nur 6 statt 9 Werte.

**Error:**
```
violates check constraint "afu9_issues_github_mirror_status_check"
```

## Solution
Migration 049 deployed via ECS Exec: 
```sql
ALTER TABLE afu9_issues 
  ADD CONSTRAINT afu9_issues_github_mirror_status_check CHECK (
    github_mirror_status IN ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'OPEN', 'CLOSED', 'ERROR', 'UNKNOWN')
  );
```

## Verification (2026-01-07 09:06 UTC)
- ✅ Diagnosis: `CRITICAL` → `OK`
- ✅ Issue I691:  `UNKNOWN` → `CLOSED`
- ✅ 67 Issues synced (66 CLOSED, 1 ERROR)
- ✅ Sync errors: `null`

## Tools Created
1. **CLI:** `scripts/diagnose-github-mirror-status.ts`
2. **API:** `/api/admin/diagnose-mirror-status`
3. **Docs:** `MIGRATION_049_STAGING_GUIDE.md`

## Related Files
- Migration:  `database/migrations/049_fix_github_mirror_status_constraint.sql`
- Sync Route: `control-center/app/api/ops/issues/sync/route.ts`
- Contract: `control-center/src/lib/contracts/afu9Issue.ts`
