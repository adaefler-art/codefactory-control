# Migration Parity Check Runbook

**Canonical ID**: E80.1 (AFU-9)  
**Last Updated**: 2026-01-05

## Overview

The Migration Parity Check provides a deterministic, evidence-based way to verify that all database migrations in `database/migrations/` are correctly applied to the database. This tool helps detect drift between local/staging/production environments.

## Access Methods

### 1. Web UI (Control Center)

Navigate to the ops page:

```
https://<your-domain>/ops/migrations
```

Features:
- Visual PASS/FAIL badge
- Detailed discrepancy lists (missing, extra, hash mismatches)
- Bounded output with configurable limits
- Refresh button for on-demand checks

**Requirements**:
- Authenticated user (valid JWT)
- Admin privileges (user must be in `AFU9_ADMIN_SUBS` environment variable)

### 2. API Endpoint

Direct API access for automation:

```http
GET /api/ops/db/migrations?limit=200&env=staging
```

**Query Parameters**:
- `limit` (optional): Result limit (default: 200, max: 500)
- `env` (optional): Environment filter (production|staging)

**Response Example**:

```json
{
  "version": "0.7.0",
  "generatedAt": "2026-01-05T12:00:00.000Z",
  "lawbookVersion": "v0.7.0",
  "db": {
    "reachable": true,
    "host": "localhost",
    "port": 5432,
    "database": "afu9"
  },
  "repo": {
    "migrationCount": 47,
    "latest": "047_lawbook_versioning.sql"
  },
  "ledger": {
    "table": "schema_migrations",
    "appliedCount": 47,
    "lastApplied": "047_lawbook_versioning.sql",
    "lastAppliedAt": "2026-01-05T11:30:00.000Z"
  },
  "parity": {
    "status": "PASS",
    "missingInDb": [],
    "extraInDb": [],
    "hashMismatches": []
  }
}
```

### 3. GitHub Actions Workflow

Manual workflow dispatch for automated checks:

```yaml
workflow_dispatch:
  inputs:
    baseUrl: 'https://stage.afu-9.com'
    env: 'staging'
    limit: '200'
```

**To trigger**:
1. Go to GitHub Actions → "Migration Parity Check"
2. Click "Run workflow"
3. Enter parameters
4. View results in workflow summary

## PowerShell Verification Commands

### Local Development Check

```powershell
# Start control-center locally (if not running)
npm --prefix control-center run dev

# Wait for server to start, then:
$Headers = @{
    "x-afu9-sub" = "test-admin-user"
    "Content-Type" = "application/json"
}

Invoke-RestMethod -Method Get `
    -Uri "http://localhost:3000/api/ops/db/migrations?limit=50" `
    -Headers $Headers | ConvertTo-Json -Depth 10
```

> **Note**: For local testing without auth, you may need to temporarily bypass auth checks or add your test user to `AFU9_ADMIN_SUBS`.

### Staging Environment Check

```powershell
# 1. Retrieve smoke key from AWS Secrets Manager
$SmokeKey = (aws secretsmanager get-secret-value `
    --region eu-central-1 `
    --profile codefactory `
    --secret-id "afu9/stage/smoke-key" `
    --query SecretString `
    --output text).Trim()

# 2. Call the endpoint
$BaseUrl = "https://stage.afu-9.com"
$Headers = @{
    "x-afu9-smoke-key" = $SmokeKey
    "x-afu9-sub" = "admin-user-sub-id"
    "Content-Type" = "application/json"
}

$Response = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/ops/db/migrations?limit=200&env=staging" `
    -Headers $Headers

# 3. Display results
Write-Host "Status: $($Response.parity.status)" -ForegroundColor $(if ($Response.parity.status -eq "PASS") { "Green" } else { "Red" })
Write-Host "Repo Migrations: $($Response.repo.migrationCount)"
Write-Host "DB Applied: $($Response.ledger.appliedCount)"
Write-Host "Missing in DB: $($Response.parity.missingInDb.Count)"
Write-Host "Extra in DB: $($Response.parity.extraInDb.Count)"
Write-Host "Hash Mismatches: $($Response.parity.hashMismatches.Count)"

# Full JSON output
$Response | ConvertTo-Json -Depth 10
```

### Production Environment Check

```powershell
# 1. Retrieve smoke key from AWS Secrets Manager
$SmokeKey = (aws secretsmanager get-secret-value `
    --region eu-central-1 `
    --profile codefactory `
    --secret-id "afu9/prod/smoke-key" `
    --query SecretString `
    --output text).Trim()

# 2. Call the endpoint
$BaseUrl = "https://afu-9.com"
$Headers = @{
    "x-afu9-smoke-key" = $SmokeKey
    "x-afu9-sub" = "admin-user-sub-id"
    "Content-Type" = "application/json"
}

$Response = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/ops/db/migrations?limit=200&env=production" `
    -Headers $Headers

# Display summary
Write-Host "=== Production Migration Parity ===" -ForegroundColor Cyan
Write-Host "Status: $($Response.parity.status)" -ForegroundColor $(if ($Response.parity.status -eq "PASS") { "Green" } else { "Red" })
Write-Host "Repo: $($Response.repo.migrationCount) | DB: $($Response.ledger.appliedCount)"

if ($Response.parity.status -ne "PASS") {
    Write-Host "`nDiscrepancies Found:" -ForegroundColor Yellow
    if ($Response.parity.missingInDb.Count -gt 0) {
        Write-Host "  Missing in DB: $($Response.parity.missingInDb -join ', ')"
    }
    if ($Response.parity.extraInDb.Count -gt 0) {
        Write-Host "  Extra in DB: $($Response.parity.extraInDb -join ', ')"
    }
    if ($Response.parity.hashMismatches.Count -gt 0) {
        Write-Host "  Hash Mismatches: $($Response.parity.hashMismatches.filename -join ', ')"
    }
}
```

## Error Codes and Troubleshooting

### 401 UNAUTHORIZED

**Cause**: Missing or invalid authentication.

**Fix**:
- Ensure `x-afu9-sub` header is set (from JWT)
- For smoke testing, use `x-afu9-smoke-key` header
- Verify JWT is valid and not expired

### 403 FORBIDDEN

**Cause**: User is not in admin allowlist.

**Fix**:
1. Check `AFU9_ADMIN_SUBS` environment variable is set
2. Verify your user sub is in the comma-separated list
3. Contact admin to add your user sub to allowlist

**Example**:
```bash
AFU9_ADMIN_SUBS=user-sub-1,user-sub-2,user-sub-3
```

### 500 MIGRATION_LEDGER_MISSING

**Cause**: `schema_migrations` table does not exist in database.

**Fix**:
1. Run database migrations to create the ledger table
2. Ensure migration runner creates the table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

3. Re-run the parity check

### 500 DB_UNREACHABLE

**Cause**: Cannot connect to the database.

**Fix**:
1. Verify database connection environment variables:
   - `DATABASE_HOST`
   - `DATABASE_PORT`
   - `DATABASE_NAME`
   - `DATABASE_USER`
   - `DATABASE_PASSWORD`
2. Check network connectivity
3. Verify database is running
4. Check firewall/security group rules

## Parity Status Interpretation

### PASS

✅ **All migrations are in sync**

- Repository migration count matches database ledger count
- No missing migrations
- No extra migrations
- No hash mismatches

**Action**: None required. System is in healthy state.

### FAIL - Missing in DB

⚠️ **Migrations exist in repo but not applied to database**

**Cause**: New migrations added to repository but not yet deployed.

**Action**:
1. Review missing migrations list
2. Run migration script: `npm --prefix control-center run db:migrate`
3. Re-check parity

### FAIL - Extra in DB

⚠️ **Migrations in database but missing from repository**

**Cause**: 
- Migration files deleted from repository (bad practice)
- Database from different branch/environment

**Action**:
1. **DO NOT** delete migrations from repo
2. Investigate which branch/environment the database came from
3. Restore missing migration files to repository
4. Consider database state reconciliation

### FAIL - Hash Mismatches

🚨 **Migration content differs between repo and database**

**Cause**:
- Migration file was modified after being applied (violation of immutability)
- Database was manually altered

**Action**:
1. **CRITICAL**: Investigate immediately
2. Compare file hashes to understand differences
3. **Never modify applied migrations** (create new migration instead)
4. Consider rolling back changes or creating compensating migration

## Best Practices

1. **Always check parity before deployment**
   - Use GitHub Actions workflow as pre-deployment gate
   - Verify PASS status before proceeding

2. **Never modify applied migrations**
   - Migrations are immutable once applied
   - Create new migrations for schema changes

3. **Investigate FAIL status immediately**
   - Drift indicates configuration mismatch
   - May cause deployment failures or data issues

4. **Use bounded limits for large projects**
   - Default 200 is sufficient for most cases
   - Increase to 500 only when needed

5. **Monitor migration history**
   - Check `lastAppliedAt` timestamp
   - Verify migrations are applied in order

## Development Workflow

### Before Committing New Migrations

```powershell
# 1. Create new migration file
# database/migrations/048_my_new_feature.sql

# 2. Verify repository sees it
npm --prefix control-center run dev

# Then check via API or UI
# Expected: FAIL with missing in DB (normal for new migration)

# 3. Apply migration locally
npm --prefix control-center run db:migrate

# 4. Re-check parity
# Expected: PASS

# 5. Commit migration file
git add database/migrations/048_my_new_feature.sql
git commit -m "Add migration 048_my_new_feature"
```

### After Deployment

```powershell
# 1. Trigger GitHub Actions workflow
# GitHub → Actions → Migration Parity Check → Run workflow

# 2. Or use PowerShell command (see above)

# Expected: PASS status
```

## Schema: schema_migrations Table

The migration ledger table must follow this schema:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Columns**:
- `filename`: Migration filename (e.g., `047_lawbook_versioning.sql`)
- `sha256`: SHA-256 hash of file content (for integrity checks)
- `applied_at`: Timestamp when migration was applied

**Indices**:
- Primary key on `filename` (unique constraint)
- Consider index on `applied_at` for performance

## Testing

### Unit Tests

```bash
cd control-center
npm test -- src/lib/utils/migration-parity.test.ts
```

### API Tests

```bash
cd control-center
npm test -- __tests__/api/migration-parity.test.ts
```

### Integration Tests

```bash
# Full test suite
npm --prefix control-center test

# Verify build
npm --prefix control-center run build

# Repository verification
npm run repo:verify
```

## Related Documentation

- [Database Migration Guide](./DATABASE_MIGRATIONS.md) (if exists)
- [Admin Authorization](../AUTH_STABILITY_IMPLEMENTATION.md)
- [E80.1 Implementation Summary](../E80_1_IMPLEMENTATION_SUMMARY.md)

## Support

For issues or questions:
1. Check error codes above
2. Review GitHub Actions workflow logs
3. Check control-center application logs
4. Contact AFU-9 infrastructure team
