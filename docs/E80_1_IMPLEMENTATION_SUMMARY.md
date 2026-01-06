# E80.1 Implementation Summary

**Canonical ID**: E80.1 (AFU-9)  
**Title**: Migration Parity Check (DB ↔ Repo) as On-Demand Workflow + Ops Page  
**Date**: 2026-01-05  
**Status**: ✅ Complete

## Overview

Implemented a comprehensive migration parity checking system that provides deterministic, evidence-based verification of database migration state vs. repository state. The system supports three access methods: Web UI, API endpoint, and GitHub Actions workflow.

## Implementation Details

### 1. Backend API Endpoint

**File**: `control-center/app/api/ops/db/migrations/route.ts`

- **Route**: `GET /api/ops/db/migrations`
- **Auth**: Auth-first (401) + Admin-only (403) enforcement
- **Features**:
  - Checks database reachability
  - Verifies schema_migrations ledger exists
  - Computes deterministic parity between repo and DB
  - Bounded output (limit: 1-500, default: 200)
  - Returns structured JSON with status, counts, and discrepancies

**Security**:
- ✅ Fail-closed admin authorization using `AFU9_ADMIN_SUBS` env var
- ✅ Auth-first pattern (checks `x-afu9-sub` before any operations)
- ✅ No secrets in responses
- ✅ Bounded output to prevent resource exhaustion

### 2. Database Access Layer

**File**: `control-center/src/lib/db/migrations.ts`

Functions:
- `checkDbReachability()`: Verifies database connection
- `checkLedgerExists()`: Checks if schema_migrations table exists
- `listAppliedMigrations()`: Retrieves applied migrations from DB
- `getLastAppliedMigration()`: Gets most recently applied migration
- `getAppliedMigrationCount()`: Returns total count of applied migrations

All functions return deterministically sorted results.

### 3. Business Logic

**File**: `control-center/src/lib/utils/migration-parity.ts`

Functions:
- `listRepoMigrations()`: Scans `database/migrations/` directory for .sql files
- `computeFileHash()`: Calculates SHA-256 hash for integrity verification
- `computeParity()`: Deterministic set comparison producing:
  - `missingInDb`: Migrations in repo but not applied
  - `extraInDb`: Migrations in DB but missing from repo
  - `hashMismatches`: Same filename but different content
- `getLatestMigration()`: Returns latest migration filename

**Determinism**:
- ✅ All arrays sorted lexicographically
- ✅ Stable output for same input (idempotent)
- ✅ No randomness or timestamps in comparison logic

### 4. UI: Ops Page

**File**: `control-center/app/ops/migrations/page.tsx`

Features:
- Visual PASS/FAIL badge with color coding
- Database connection status
- Migration counts (repo vs. DB)
- Detailed discrepancy lists:
  - Missing in Database (yellow alert)
  - Extra in Database (orange alert)
  - Hash Mismatches (red alert with hashes)
- Refresh button for on-demand checks
- Configurable result limit (50, 100, 200, 500)

### 5. GitHub Actions Workflow

**File**: `.github/workflows/migration-parity.yml`

Trigger: `workflow_dispatch` with inputs:
- `baseUrl`: API base URL (e.g., https://stage.afu-9.com)
- `env`: Environment (production|staging)
- `limit`: Result limit (default: 200)

Features:
- Retrieves smoke key from AWS Secrets Manager
- Calls parity endpoint with admin auth
- Parses JSON response
- Generates formatted summary in GitHub Actions UI
- Uploads parity report as artifact (30-day retention)
- Fails workflow if parity status is FAIL

### 6. Database Migration

**File**: `database/migrations/048_schema_migrations_ledger.sql`

Creates the migration ledger table:

```sql
CREATE TABLE schema_migrations (
    filename TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Includes:
- Primary key on filename (uniqueness)
- Index on applied_at (performance)
- Column comments for documentation

### 7. Tests

#### Unit Tests (14 tests)
**File**: `control-center/__tests__/lib/utils/migration-parity.test.ts`

Coverage:
- ✅ PASS scenario (identical repo and DB)
- ✅ FAIL scenarios (missing, extra, hash mismatches)
- ✅ Multiple simultaneous discrepancies
- ✅ Deterministic ordering (lexicographic sort)
- ✅ Edge cases (empty sets, single item)
- ✅ Idempotence verification

#### API Tests (12 tests)
**File**: `control-center/__tests__/api/migration-parity.test.ts`

Coverage:
- ✅ 401 without x-afu9-sub header
- ✅ 401 with empty x-afu9-sub header
- ✅ 403 when AFU9_ADMIN_SUBS missing (fail-closed)
- ✅ 403 when AFU9_ADMIN_SUBS empty (fail-closed)
- ✅ 403 when user not in admin allowlist
- ✅ 500 DB unreachable error
- ✅ 500 migration ledger missing error
- ✅ 200 PASS scenario
- ✅ 200 FAIL scenario with discrepancies
- ✅ Bounded output (limit parameter)
- ✅ Limit capping at 500
- ✅ Admin allowlist exact matching

**Test Results**: All 26 tests passing ✅

### 8. Documentation

**File**: `docs/runbooks/MIGRATION_PARITY_CHECK.md`

Comprehensive runbook including:
- Overview and access methods
- PowerShell verification commands (local, staging, production)
- Error codes and troubleshooting
- Parity status interpretation
- Best practices
- Development workflow
- Schema documentation
- Testing instructions

## API Response Example

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
    "migrationCount": 48,
    "latest": "048_schema_migrations_ledger.sql"
  },
  "ledger": {
    "table": "schema_migrations",
    "appliedCount": 48,
    "lastApplied": "048_schema_migrations_ledger.sql",
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

## Security Compliance

✅ **Auth-first**: All requests require valid `x-afu9-sub` header (401 before any operations)  
✅ **Admin-only**: Fail-closed authorization using `AFU9_ADMIN_SUBS` env var (403 if missing/empty)  
✅ **Bounded output**: All arrays limited (default 200, max 500)  
✅ **No secrets**: URLs sanitized, no tokens in responses  
✅ **Deterministic**: Same input → same output (audit-friendly)  
✅ **Fail-closed**: Missing config → deny access

## Acceptance Criteria

✅ **Deterministic output**: Byte-stable JSON for same DB/repo state  
✅ **Admin-only enforced**: 403 when not admin; fail-closed if allowlist missing  
✅ **Auth-first enforced**: 401 before any DB calls  
✅ **Ledger-based check**: Works with schema_migrations table; explicit error if missing  
✅ **UI page renders**: Status, counts, and bounded details  
✅ **Workflow exists**: Manually callable via workflow_dispatch; prints PASS/FAIL  
✅ **Tests**: 26 tests passing (14 unit + 12 API)  
✅ **Docs**: Runbook with PowerShell commands created  

## Verification Commands

### Local Tests
```powershell
cd control-center
npm test -- __tests__/lib/utils/migration-parity.test.ts  # 14 passing
npm test -- __tests__/api/migration-parity.test.ts        # 12 passing
```

### Repository Verification
```powershell
npm run repo:verify  # ✅ All checks passed
```

### Build (Note)
```powershell
npm --prefix control-center run build
# Note: Build blocked by unrelated dependency issues in packages/verdict-engine
# This is a pre-existing issue not related to E80.1 implementation
```

## Files Created/Modified

### Created Files (9)
1. `control-center/app/api/ops/db/migrations/route.ts` - API endpoint
2. `control-center/src/lib/db/migrations.ts` - Database DAO
3. `control-center/src/lib/utils/migration-parity.ts` - Business logic
4. `control-center/app/ops/migrations/page.tsx` - UI page
5. `control-center/__tests__/lib/utils/migration-parity.test.ts` - Unit tests
6. `control-center/__tests__/api/migration-parity.test.ts` - API tests
7. `.github/workflows/migration-parity.yml` - GitHub Actions workflow
8. `docs/runbooks/MIGRATION_PARITY_CHECK.md` - Runbook documentation
9. `database/migrations/048_schema_migrations_ledger.sql` - Ledger table migration

### Modified Files
- None (all new functionality)

## Usage Examples

### Via Web UI
```
Navigate to: https://<domain>/ops/migrations
```

### Via API
```powershell
$Headers = @{
    "x-afu9-sub" = "admin-user-id"
    "Content-Type" = "application/json"
}

Invoke-RestMethod -Method Get `
    -Uri "https://stage.afu-9.com/api/ops/db/migrations?limit=200" `
    -Headers $Headers
```

### Via GitHub Actions
1. Go to Actions → "Migration Parity Check"
2. Click "Run workflow"
3. Enter baseUrl, env, limit
4. View results in workflow summary

## Notes

- The build step is currently blocked by unrelated dependency issues in `packages/verdict-engine` and `packages/deploy-memory`. These are pre-existing issues not related to the E80.1 implementation.
- All new code passes linting and testing
- Repository verification passes
- Implementation follows existing patterns in the codebase
- All non-negotiables from the issue have been met

## Next Steps

To use this feature in production:

1. Deploy the changes to staging/production
2. Run database migrations to create schema_migrations table
3. Update migration runner to populate ledger on each migration
4. Configure AFU9_ADMIN_SUBS environment variable with admin user IDs
5. Access via UI at `/ops/migrations` or trigger GitHub Actions workflow
6. Consider integrating parity check into deployment pipeline as a gate

## Success Metrics

- ✅ All 26 tests passing
- ✅ Repository verification passing
- ✅ Comprehensive documentation created
- ✅ Three access methods implemented (UI, API, Workflow)
- ✅ Security hardening complete (auth-first, admin-only, fail-closed)
- ✅ Deterministic output guaranteed
