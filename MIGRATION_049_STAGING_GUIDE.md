# Migration 049 auf Staging anwenden

## Problem
Migration 049 fehlt auf Staging-Datenbank → CHECK Constraint lehnt OPEN/CLOSED/ERROR Werte ab.

**Diagnose-Output:**
```json
{
  "github_sync_error": "violates check constraint \"afu9_issues_github_mirror_status_check\"",
  "diagnosis": { "status": "CRITICAL", "problem": "ALL_UNKNOWN" }
}
```

**Root Cause:** Der CHECK Constraint erlaubt nur 6 Werte (UNKNOWN, NOT_PERSISTED, PERSIST_SUCCESS, PERSIST_FAILED, RETRY_EXHAUSTED, VALIDATION_ERROR) statt 9 (fehlen: OPEN, CLOSED, ERROR).

---

## Lösungen

### Option 1: Via ECS Exec (Empfohlen)

**Voraussetzungen:**
- AWS CLI konfiguriert mit `codefactory` Profile
- ECS Exec aktiviert für Control Center Tasks
- Berechtigungen: `ecs:ExecuteCommand`

**Ausführung:**
```powershell
.\scripts\apply-migration-staging.ps1
```

**Was passiert:**
1. Findet laufenden ECS Task für `afu9-control-center-staging`
2. Führt `bash scripts/db-migrate.sh` im Container aus
3. Verifiziert Migration wurde angewendet
4. Gibt nächste Schritte aus

**Erwartete Ausgabe:**
```
🔍 Finding running ECS task...
✅ Found task: arn:aws:ecs:eu-central-1:313095875771:task/afu9-cluster/abc123...
📋 Task ID: abc123

🚀 Applying Migration 049...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Executing: cd /app && bash scripts/db-migrate.sh

✅ Migration applied successfully!

📊 Verifying migration...
049_fix_github_mirror_status_constraint.sql | 2026-01-07 06:30:45

🔄 Triggering sync to test fix...
Run: curl -X POST https://stage.afu-9.com/api/ops/issues/sync -H 'x-afu9-sub: admin'

🧪 Run diagnostic to verify:
Browser: https://stage.afu-9.com/api/admin/diagnose-mirror-status-test
```

---

### Option 2: Via SQL direkt (Port Forward)

**Voraussetzungen:**
- Port Forward zu RDS (via Bastion oder SSM)
- `psql` installiert

**Setup:**
```powershell
# 1. Port Forward (Beispiel via SSM)
aws ssm start-session `
    --target <instance-id> `
    --document-name AWS-StartPortForwardingSessionToRemoteHost `
    --parameters '{
      "portNumber": ["5432"],
      "localPortNumber":["5433"],
      "host":["afu9-postgres.cvu0c0we856q.eu-central-1.rds.amazonaws.com"]
    }' `
    --profile codefactory

# 2. In neuem Terminal: Set DATABASE_URL
$env:DATABASE_URL = "postgresql://username:password@localhost:5433/afu9"

# 3. Apply migration
.\scripts\apply-migration-staging-sql.ps1
```

**Erwartete Ausgabe:**
```
🔍 Migration file: database/migrations/049_fix_github_mirror_status_constraint.sql
🔗 Database: postgresql://username:password@localhost:5433...

⚠️  WARNING: This will modify the staging database!
Press Ctrl+C to cancel, or any key to continue...

🚀 Applying migration...
✅ Migration applied successfully!
ALTER TABLE
ALTER TABLE

📊 Verifying CHECK constraint...
✅ Constraint now includes OPEN, CLOSED, ERROR

🧪 Next steps:
1. Test sync: curl -X POST https://stage.afu-9.com/api/ops/issues/sync -H 'x-afu9-sub: admin'
2. Verify: https://stage.afu-9.com/api/admin/diagnose-mirror-status-test
```

---

### Option 3: Via CI/CD (Neu-Deployment)

Falls `db-migrate.sh` im Deployment-Prozess läuft:

```bash
# Trigger re-deployment
git commit --allow-empty -m "chore: trigger migration 049 on staging"
git push origin main
```

Warte auf Deployment, dann prüfe Logs in CloudWatch.

---

## Verification

Nach Migration anwenden:

### 1. Check Constraint prüfen
```sql
SELECT pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'afu9_issues_github_mirror_status_check';
```

**Sollte enthalten:** `'OPEN'`, `'CLOSED'`, `'ERROR'` zusätzlich zu den 6 ursprünglichen Werten

**Erwartetes Ergebnis:**
```
CHECK (github_mirror_status = ANY (ARRAY[
  'UNKNOWN'::text, 
  'NOT_PERSISTED'::text, 
  'PERSIST_SUCCESS'::text, 
  'PERSIST_FAILED'::text, 
  'RETRY_EXHAUSTED'::text, 
  'VALIDATION_ERROR'::text,
  'OPEN'::text,          -- ✅ NEU
  'CLOSED'::text,        -- ✅ NEU
  'ERROR'::text          -- ✅ NEU
]))
```

### 2. Sync ausführen
```powershell
curl -X POST https://stage.afu-9.com/api/ops/issues/sync -H "x-afu9-sub: admin"
```

**Erwartete Response:**
```json
{
  "statusPersistOk": 67,      // ✅ > 0
  "statusPersistFailed": 0     // ✅ = 0
}
```

### 3. Diagnose prüfen
```
https://stage.afu-9.com/api/admin/diagnose-mirror-status-test
```

**Erwartete Response:**
```json
{
  "diagnosis": {
    "status": "OK",
    "message": "Alle Issues haben korrekten Status"
  },
  "results": {
    "issueI691": {
      "github_mirror_status": "CLOSED",  // ✅ Nicht mehr UNKNOWN
      "github_sync_error": null
    }
  }
}
```

---

## Troubleshooting

### ECS Exec: "ExecuteCommandFailedException"
**Ursache:** ECS Exec nicht aktiviert für Task

**Fix:**
```powershell
# Check ECS Exec Status
aws ecs describe-tasks `
    --cluster afu9-cluster `
    --tasks <task-arn> `
    --profile codefactory `
    --query 'tasks[0].enableExecuteCommand'

# Falls false: Update Service
aws ecs update-service `
    --cluster afu9-cluster `
    --service afu9-control-center-staging `
    --enable-execute-command `
    --profile codefactory `
    --region eu-central-1
```

### Port Forward: "Connection refused"
**Ursache:** Falsche RDS Endpoint oder Port

**Debug:**
```powershell
# Get RDS Endpoint
aws rds describe-db-instances `
    --db-instance-identifier afu9-postgres `
    --profile codefactory `
    --query 'DBInstances[0].Endpoint' `
    --output table

# Test connection
telnet localhost 5433
```

### Migration: "relation already exists"
**Ursache:** Migration wurde bereits angewendet

**Verify:**
```sql
SELECT * FROM schema_migrations WHERE filename LIKE '%049%';
```

Falls die Migration in `schema_migrations` existiert aber der Constraint falsch ist, wurde die Migration abgebrochen. Führe nur den ALTER TABLE Teil manuell aus:

```sql
ALTER TABLE afu9_issues 
DROP CONSTRAINT IF EXISTS afu9_issues_github_mirror_status_check;

ALTER TABLE afu9_issues 
ADD CONSTRAINT afu9_issues_github_mirror_status_check 
CHECK (github_mirror_status = ANY (ARRAY[
  'UNKNOWN'::text, 
  'NOT_PERSISTED'::text, 
  'PERSIST_SUCCESS'::text, 
  'PERSIST_FAILED'::text, 
  'RETRY_EXHAUSTED'::text, 
  'VALIDATION_ERROR'::text,
  'OPEN'::text,
  'CLOSED'::text,
  'ERROR'::text
]));
```

---

## Related

- **Issue:** #624
- **Migration File:** `database/migrations/049_fix_github_mirror_status_constraint.sql`
- **Test Endpoint:** `https://stage.afu-9.com/api/admin/diagnose-mirror-status-test`
- **Sync Endpoint:** `https://stage.afu-9.com/api/ops/issues/sync`
