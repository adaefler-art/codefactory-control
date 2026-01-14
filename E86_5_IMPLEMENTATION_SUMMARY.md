# E86.5 - Staging DB Repair Mechanism - Implementation Summary

## Overview

Implemented a staging-only DB repair mechanism that fixes schema drift without DB reset. The solution is evidence-first, deterministic, idempotent, fully audited, and fail-closed.

## Components Implemented

### 1. Contracts & Types (`control-center/src/lib/contracts/db-repair.ts`)

Defined TypeScript interfaces for:
- `DbRepairPlaybook`: Immutable repair action with deterministic hash
- `DbRepairRun`: Append-only audit record
- `DbRepairPreview`: Preview result (no DB writes)
- `DbRepairExecuteResult`: Execution result with summary

### 2. Repair Registry (`control-center/src/lib/db/db-repair-registry.ts`)

Registry Properties:
- **Deterministic**: Stable-sorted by repairId
- **Idempotent**: All SQL uses CREATE IF NOT EXISTS, no DROP
- **Audited**: Each playbook has SHA-256 hash of canonical SQL
- **Stage-only**: All repairs are staging-only
- **Fail-closed**: Hash verification required for execution

Initial Repair Playbooks:
1. **R-DB-INTENT-AUTH-EVENTS-001**: Creates `intent_issue_authoring_events` table with indexes and append-only triggers
2. **R-DB-INTENT-DRAFTS-001**: Creates `intent_issue_drafts` and `intent_issue_sets` tables
3. **R-DB-MIGRATIONS-LEDGER-001**: Creates `afu9_migrations_ledger` table (no history rewriting)

Functions:
- `getAllRepairPlaybooks()`: Returns all repairs (stable-sorted)
- `getRepairPlaybook(repairId)`: Returns single repair by ID
- `validateRepairHash(repairId, expectedHash)`: Validates hash match

### 3. Database Migration (`database/migrations/066_db_repair_runs.sql`)

Created `db_repair_runs` table:
- **Append-only**: Triggers prevent UPDATE/DELETE
- **Audit fields**: repair_id, expected_hash, actual_hash, executed_by, executed_at, status, error details
- **Evidence**: pre_missing_tables, post_missing_tables (JSON)
- **Indexes**: On repair_id, executed_at, executed_by, status, deployment_env

### 4. DAO Layer (`control-center/src/lib/db/dbRepairRuns.ts`)

Functions:
- `insertDbRepairRun()`: Insert audit record (append-only)
- `getDbRepairRun(id)`: Get single run by ID
- `listDbRepairRuns(limit)`: List recent runs (stable-sorted)
- `listDbRepairRunsByRepairId(repairId, limit)`: List runs for specific repair

### 5. API Endpoints

#### GET /api/ops/db/repairs (`control-center/app/api/ops/db/repairs/route.ts`)

Lists all available repair playbooks.

**Guard Order**:
1. AUTH CHECK (401)
2. ENV GATING (409) - stage-only
3. ADMIN CHECK (403)
4. READ OPERATIONS (no DB writes)

**Response**:
- version, generatedAt, requestId
- repairs: Array of repair playbooks (stable-sorted)

#### POST /api/ops/db/repairs/preview (`control-center/app/api/ops/db/repairs/preview/route.ts`)

Previews a repair without executing it (no DB writes).

**Guard Order**: Same as above

**Request Body**:
- repairId: string

**Response**:
- repairId, description, hash
- requiredTablesCheck: { required, missing, allPresent }
- wouldApply: boolean
- plan: Array of SQL statements (may be truncated)
- requestId, deploymentEnv, lawbookHash

#### POST /api/ops/db/repairs/execute (`control-center/app/api/ops/db/repairs/execute/route.ts`)

Executes a repair playbook with full audit.

**Guard Order**: Same as above

**Request Body**:
- repairId: string
- expectedHash: string (fail-closed verification)

**Response**:
- repairId, repairRunId, requestId, status
- summary: { preMissingTables, postMissingTables, statementsExecuted, errorCode, errorMessage }

**Execution Flow**:
1. Validate hash (fail-closed)
2. Get lawbook hash
3. Check required tables before repair
4. Execute SQL statements
5. Check required tables after repair
6. Write append-only audit record
7. Return result

### 6. UI Page (`control-center/app/ops/db/repairs/page.tsx`)

Path: `/ops/db/repairs`

Features:
- **List Repairs**: Shows all available repairs with ID, description, hash, version
- **Preview**: Click to preview repair without DB writes
  - Shows required tables check
  - Shows plan (SQL statements)
  - Shows would apply status
- **Execute**: Button enabled only after preview and if wouldApply is true
  - Confirmation dialog
  - Shows execution result (status, run ID, statements executed, missing tables)

### 7. Tests (`control-center/__tests__/lib/db-repair-registry.test.ts`)

Test coverage:
- ✅ Registry returns repairs in stable-sorted order
- ✅ All repairs have required fields (repairId, hash, sql, etc.)
- ✅ All repairs are stage-only and admin-only
- ✅ SQL is idempotent (no DROP, no TRUNCATE, no DELETE)
- ✅ Hash validation works correctly
- ✅ Individual playbook tests for each repair

### 8. Documentation (`docs/E86_5_VERIFICATION_GUIDE.md`)

PowerShell verification steps for:
- List repairs
- Preview repair
- Execute repair
- Verify required tables gate
- Authentication methods
- Error scenarios
- UI verification
- Audit trail queries
- Guard ordering verification

## Security & Compliance

### Guard Ordering (Fail-Closed)

All endpoints enforce strict ordering:
1. **AUTH CHECK (401-first)**: Verify x-afu9-sub header (set by proxy.ts)
2. **ENV GATING (409)**: Block prod/unknown environments (stage-only)
3. **ADMIN CHECK (403)**: Verify AFU9_ADMIN_SUBS allowlist
4. **DB OPERATIONS**: Only execute if all gates pass

### Fail-Closed Design

- **Empty/missing AFU9_ADMIN_SUBS**: Deny all (fail-closed)
- **Hash mismatch**: Reject execution (409)
- **Missing client headers**: Stripped by middleware to prevent spoofing
- **Production environment**: Blocked (409)

### Audit Trail

- All executions logged to `db_repair_runs` (append-only)
- Triggers prevent UPDATE/DELETE
- Fields logged: repair_id, expected_hash, actual_hash, executed_by, executed_at, status, error details, pre/post missing tables

### Idempotency

All repair SQL uses idempotent patterns:
- `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`
- `CREATE OR REPLACE FUNCTION`
- `DO $$ ... IF NOT EXISTS ... END $$` for triggers

No destructive operations:
- ❌ No DROP TABLE
- ❌ No TRUNCATE
- ❌ No DELETE FROM
- ❌ No UPDATE (except via idempotent functions)

## Files Created/Modified

### Created Files

1. `control-center/src/lib/contracts/db-repair.ts` - Type definitions
2. `control-center/src/lib/db/db-repair-registry.ts` - Repair registry and playbooks
3. `control-center/src/lib/db/dbRepairRuns.ts` - DAO for db_repair_runs
4. `database/migrations/066_db_repair_runs.sql` - Migration for audit table
5. `control-center/app/api/ops/db/repairs/route.ts` - GET /api/ops/db/repairs
6. `control-center/app/api/ops/db/repairs/preview/route.ts` - POST /api/ops/db/repairs/preview
7. `control-center/app/api/ops/db/repairs/execute/route.ts` - POST /api/ops/db/repairs/execute
8. `control-center/app/ops/db/repairs/page.tsx` - UI page
9. `control-center/__tests__/lib/db-repair-registry.test.ts` - Tests
10. `docs/E86_5_VERIFICATION_GUIDE.md` - Verification guide

### Modified Files

None (minimal change approach - all new functionality)

## Acceptance Criteria

✅ **Repair Registry is deterministic and stable-sorted**: Each playbook has repairId + hash
✅ **Preview makes no DB writes**: Shows requiredTablesCheck + plan
✅ **Execute requires expectedHash**: Logs full audit record to db_repair_runs
✅ **Staging-only**: Prod fail-closed (409)
✅ **Admin-only**: 403 if not in AFU9_ADMIN_SUBS
✅ **Post-Execute validation**: Required tables gate becomes green if repair successful
✅ **PowerShell Verify Steps**: Documented in E86_5_VERIFICATION_GUIDE.md

## Usage Example

```powershell
# 1. List repairs
$repairs = Invoke-RestMethod "https://stage.afu-9.com/api/ops/db/repairs"

# 2. Preview
$preview = Invoke-RestMethod "https://stage.afu-9.com/api/ops/db/repairs/preview" `
  -Method Post -ContentType "application/json" `
  -Body '{"repairId":"R-DB-INTENT-AUTH-EVENTS-001"}'

# 3. Execute (using hash from preview)
$result = Invoke-RestMethod "https://stage.afu-9.com/api/ops/db/repairs/execute" `
  -Method Post -ContentType "application/json" `
  -Body "{`"repairId`":`"R-DB-INTENT-AUTH-EVENTS-001`",`"expectedHash`":`"$($preview.hash)`"}"
```

## Next Steps

1. Deploy migration 066 to staging database
2. Test all three repair playbooks on staging
3. Verify required tables gate goes green after repairs
4. Confirm audit records are written correctly
5. Test guard ordering (401 → 409 → 403)
6. Document any additional repairs needed for common drift scenarios

## Notes

- All repairs are idempotent and can be run multiple times safely
- Each repair has a unique SHA-256 hash for verification
- The UI provides a safe workflow: List → Preview → Execute
- All operations are fully audited in append-only db_repair_runs table
- The mechanism is the defined path when post-migrate required tables gate goes red
