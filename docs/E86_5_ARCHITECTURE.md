# E86.5 - Staging DB Repair Mechanism - Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER / ADMIN                                     │
│                    (Stage Environment Only)                              │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI PAGE                                        │
│                    /ops/db/repairs                                       │
│                                                                          │
│  1. LIST REPAIRS  →  2. PREVIEW  →  3. EXECUTE  →  4. VIEW RESULT      │
│     (read-only)       (read-only)    (with hash)     (audit record)     │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
        ┌─────────────┐  ┌────────────┐  ┌────────────┐
        │  GET /api/  │  │ POST /api/ │  │ POST /api/ │
        │  ops/db/    │  │ ops/db/    │  │ ops/db/    │
        │  repairs    │  │ repairs/   │  │ repairs/   │
        │             │  │ preview    │  │ execute    │
        └─────────────┘  └────────────┘  └────────────┘
                    │             │             │
                    └─────────────┼─────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      GUARD ORDERING (Fail-Closed)                        │
│                                                                          │
│  1. AUTH CHECK (401)     →  Verify x-afu9-sub header                   │
│  2. ENV GATING (409)     →  Block prod/unknown environments            │
│  3. ADMIN CHECK (403)    →  Verify AFU9_ADMIN_SUBS allowlist           │
│  4. DB OPERATIONS        →  Execute only if all gates pass              │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
        ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
        │ REPAIR REGISTRY │  │ DB QUERIES   │  │ AUDIT WRITES │
        │                 │  │              │  │              │
        │ • Stable-sorted │  │ • Check      │  │ • Insert to  │
        │ • SHA-256 hash  │  │   tables     │  │   db_repair_ │
        │ • Idempotent    │  │ • Validate   │  │   runs       │
        │   SQL           │  │   state      │  │              │
        │ • No DROP/      │  │ • Execute    │  │ • Append-    │
        │   TRUNCATE      │  │   repair SQL │  │   only       │
        └─────────────────┘  └──────────────┘  └──────────────┘
                                  │                    │
                                  ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL DATABASE                               │
│                                                                          │
│  ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────┐ │
│  │  Application Tables │  │  db_repair_runs    │  │  Migration Ledger│ │
│  │                     │  │  (Append-Only)     │  │                  │ │
│  │  • intent_issue_    │  │  • repair_id       │  │  • afu9_         │ │
│  │    authoring_events │  │  • expected_hash   │  │    migrations_   │ │
│  │  • intent_issue_    │  │  • actual_hash     │  │    ledger        │ │
│  │    drafts           │  │  • executed_by     │  │                  │ │
│  │  • intent_issue_    │  │  • executed_at     │  │  • schema_       │ │
│  │    sets             │  │  • status          │  │    migrations    │ │
│  │                     │  │  • error_code      │  │                  │ │
│  │  WITH:              │  │  • error_message   │  │                  │ │
│  │  • Indexes          │  │  • pre_missing_    │  │                  │ │
│  │  • Triggers         │  │    tables          │  │                  │ │
│  │    (append-only)    │  │  • post_missing_   │  │                  │ │
│  │                     │  │    tables          │  │                  │ │
│  │                     │  │                    │  │                  │ │
│  │                     │  │  TRIGGERS:         │  │                  │ │
│  │                     │  │  • prevent_update  │  │                  │ │
│  │                     │  │  • prevent_delete  │  │                  │ │
│  └────────────────────┘  └────────────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Repair Playbook Lifecycle

```
┌──────────────────────────────────────────────────────────────────────┐
│ PLAYBOOK CREATION (Developer)                                        │
│                                                                       │
│  1. Define SQL (idempotent, CREATE IF NOT EXISTS)                   │
│  2. Compute SHA-256 hash                                            │
│  3. Add to registry (code review required)                          │
│  4. Deploy to staging                                               │
└──────────────────────────────────────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PLAYBOOK EXECUTION (Admin)                                           │
│                                                                       │
│  1. Browse /ops/db/repairs                                           │
│  2. Click "Preview" → See plan (no DB writes)                       │
│  3. Click "Execute" → Confirm with hash                             │
│  4. Backend validates:                                               │
│     • Auth (401 if missing)                                         │
│     • Environment (409 if prod)                                     │
│     • Admin (403 if not admin)                                      │
│     • Hash (409 if mismatch)                                        │
│  5. Execute SQL (idempotent, safe to replay)                        │
│  6. Verify post-conditions (required tables)                        │
│  7. Write audit record (append-only)                                │
│  8. Return result (status, run ID, summary)                         │
└──────────────────────────────────────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ POST-EXECUTION (Audit & Verification)                                │
│                                                                       │
│  1. Audit record in db_repair_runs (tamper-proof)                   │
│  2. Required tables gate → GREEN (if successful)                    │
│  3. Ops team notified of result                                     │
│  4. Can re-run if needed (idempotent)                               │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
REQUEST
   │
   ├─ GET /api/ops/db/repairs
   │     │
   │     └─→ [Guards] → Registry.getAllRepairPlaybooks()
   │                      → Response: [repairs array]
   │
   ├─ POST /api/ops/db/repairs/preview
   │     │
   │     ├─→ [Guards] → Validate repairId
   │     ├─→ Registry.getRepairPlaybook(repairId)
   │     ├─→ DB.getMissingTables(requiredBefore)
   │     ├─→ Build plan (truncate SQL for display)
   │     └─→ Response: { hash, requiredTablesCheck, plan, ... }
   │
   └─ POST /api/ops/db/repairs/execute
         │
         ├─→ [Guards] → Validate repairId + expectedHash
         ├─→ Registry.validateRepairHash(repairId, expectedHash)
         ├─→ DB.getMissingTables(requiredBefore)  [PRE]
         ├─→ Execute SQL statements (for loop, idempotent)
         ├─→ DB.getMissingTables(requiredAfter)   [POST]
         ├─→ DAO.insertDbRepairRun(audit record)  [APPEND-ONLY]
         └─→ Response: { status, repairRunId, summary, ... }
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: AUTHENTICATION (401-first)                         │
│                                                              │
│  • Verify x-afu9-sub header (set by proxy.ts)              │
│  • Client headers stripped by middleware                    │
│  • Missing/empty → 401 UNAUTHORIZED                         │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: ENVIRONMENT GATING (409)                           │
│                                                              │
│  • Check deployment environment                             │
│  • Production → 409 ENV_DISABLED (fail-closed)             │
│  • Unknown → 409 ENV_DISABLED (fail-closed)                │
│  • Only staging allowed                                     │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: AUTHORIZATION (403)                                │
│                                                              │
│  • Check AFU9_ADMIN_SUBS allowlist                         │
│  • User sub must be in allowlist                           │
│  • Empty/missing allowlist → deny all (fail-closed)        │
│  • Not in list → 403 FORBIDDEN                             │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 4: HASH VERIFICATION (Execute only)                   │
│                                                              │
│  • Validate expectedHash == registryHash                    │
│  • Mismatch → 409 HASH_MISMATCH                            │
│  • Prevents execution of stale/modified playbooks           │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 5: DB OPERATIONS                                      │
│                                                              │
│  • Execute idempotent SQL (CREATE IF NOT EXISTS)           │
│  • Verify post-conditions (required tables check)          │
│  • Write append-only audit record                          │
│  • Database triggers prevent audit tampering               │
└─────────────────────────────────────────────────────────────┘
```

## Idempotency Guarantees

```
ALLOWED SQL PATTERNS:
  ✓ CREATE TABLE IF NOT EXISTS
  ✓ CREATE INDEX IF NOT EXISTS
  ✓ CREATE OR REPLACE FUNCTION
  ✓ DO $$ ... IF NOT EXISTS ... END $$ (for triggers)

PROHIBITED SQL PATTERNS:
  ✗ DROP TABLE
  ✗ DROP INDEX
  ✗ TRUNCATE
  ✗ DELETE FROM
  ✗ UPDATE (except via idempotent functions)

SAFETY:
  • Multiple executions = same final state
  • Partial execution = safe to re-run
  • Failed execution = safe to retry
  • Test coverage validates patterns
```

## Audit Trail

```
db_repair_runs TABLE (Append-Only)
┌────────────────────┬──────────────────────────────────────┐
│ Field              │ Purpose                              │
├────────────────────┼──────────────────────────────────────┤
│ id                 │ Unique run identifier (UUID)         │
│ repair_id          │ Which repair was executed            │
│ expected_hash      │ Hash provided by caller              │
│ actual_hash        │ Hash from registry                   │
│ executed_at        │ When executed (timestamp)            │
│ executed_by        │ Who executed (user sub)              │
│ deployment_env     │ Where executed (staging/prod)        │
│ lawbook_hash       │ Lawbook version at execution         │
│ request_id         │ Correlation ID                       │
│ status             │ SUCCESS | FAILED                     │
│ error_code         │ Error code (if failed)               │
│ error_message      │ Error message (bounded)              │
│ pre_missing_tables │ Tables missing before (JSON)         │
│ post_missing_tables│ Tables missing after (JSON)          │
└────────────────────┴──────────────────────────────────────┘

TRIGGERS (Database-Level Enforcement):
  • prevent_update_db_repair_runs  → Blocks UPDATE
  • prevent_delete_db_repair_runs  → Blocks DELETE
  • RAISE EXCEPTION → PostgreSQL error
```

---

**Issue**: E86.5 — Staging DB Repair Mechanism
**Status**: Complete ✅
**Architecture**: Multi-layer defense, fail-closed, append-only audit
