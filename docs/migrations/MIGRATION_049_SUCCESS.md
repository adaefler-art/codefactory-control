# Migration 049 - Erfolgreich Angewendet

**Datum:** 2026-01-07  
**Issue:** #624 - GitHub Mirror Status Persistence Failures  
**Status:** ✅ ERFOLGREICH

## Problem

GitHub Issues Sync schlug mit Constraint Violation fehl:
- 67 Issues konnten nicht persistiert werden
- `github_mirror_status` Werte `OPEN`, `CLOSED`, `ERROR` wurden von der CHECK Constraint abgelehnt
- Alte Constraint: nur `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `BLOCKED`, `UNKNOWN`

## Lösung

Migration 049 erweiterte die CHECK Constraint um die fehlenden Werte.

### Ausgeführte SQL-Befehle

```sql
-- 1. Alte Constraint entfernen
ALTER TABLE afu9_issues 
DROP CONSTRAINT IF EXISTS afu9_issues_github_mirror_status_check;

-- 2. Neue Constraint mit allen Werten hinzufügen
ALTER TABLE afu9_issues 
ADD CONSTRAINT afu9_issues_github_mirror_status_check 
CHECK (github_mirror_status IN (
  'TODO', 
  'IN_PROGRESS', 
  'IN_REVIEW', 
  'DONE', 
  'BLOCKED', 
  'OPEN',      -- NEU
  'CLOSED',    -- NEU
  'ERROR',     -- NEU
  'UNKNOWN'
));

-- 3. Kommentar aktualisieren
COMMENT ON COLUMN afu9_issues.github_mirror_status IS 
  'Mapped GitHub status: TODO, IN_PROGRESS, IN_REVIEW, DONE, BLOCKED, OPEN, CLOSED, ERROR, or UNKNOWN (State Model v1)';
```

## Verifikation

### Vor Migration
```json
{
  "statusSynced": 0,
  "statusSyncAttempted": 67,
  "statusPersistOk": 0,
  "statusPersistFailed": 67
}
```

### Nach Migration
```json
{
  "statusSynced": 67,
  "statusSyncAttempted": 67,
  "statusPersistOk": 67,
  "statusPersistFailed": 0
}
```

## Deployment-Methode

Angewendet via ECS Exec auf Staging:

```powershell
.\scripts\apply-migration-staging-final.ps1
```

**Technische Details:**
- Container: `control-center` im Task der ECS Service `afu9-control-center-staging`
- Methode: `psql` via ECS Exec mit `DATABASE_HOST/PORT/USER/PASSWORD` Env-Vars
- Region: `eu-central-1`
- Cluster: `afu9-cluster`

## Lessons Learned

1. **DATABASE_URL vs. DATABASE_HOST**: Die Anwendung verwendet NICHT `DATABASE_URL`, sondern einzelne Env-Vars (`DATABASE_HOST`, `DATABASE_PORT`, etc.)
2. **ECS Task Definition Secrets**: Secrets werden via Secrets Manager ARNs injiziert (z.B. `arn:...secret:afu9/database:host::`)
3. **PowerShell Escaping**: Bei komplexen SQL-Statements ist `printf` mit `'\''` Escaping für single quotes notwendig
4. **Schema Migrations Table**: Unsere `schema_migrations` Tabelle hat `version` und `checksum` Spalten, nicht `filename`

## Nächste Schritte

- [x] Migration 049 angewendet
- [x] GitHub Sync erfolgreich (67/67 Issues)
- [ ] Scripts committen und dokumentieren
- [ ] Issue #624 schließen
- [ ] PR für `fix/issue-624-migration-scripts` erstellen
