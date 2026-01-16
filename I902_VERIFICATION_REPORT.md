# I902 Draft Access Reliability: Audit & Verification Report

## Executive Summary

All acceptance criteria for I902 have been verified through comprehensive E2E testing and infrastructure audit. The INTENT draft access system is functioning reliably with proper session-binding, authentication, and deterministic behavior.

## Audit Findings

### 1. Session-Binding & Authentication (✓ VERIFIED)

All draft-related API routes properly validate session ownership:

#### GET /api/intent/sessions/[id]/issue-draft
- ✓ Validates `x-afu9-sub` header (userId) - returns 401 if missing
- ✓ Checks session ownership before returning draft data
- ✓ Returns 404 if session not found or access denied
- ✓ Location: `app/api/intent/sessions/[id]/issue-draft/route.ts:38-44`

#### PUT /api/intent/sessions/[id]/issue-draft
- ✓ Validates `x-afu9-sub` header (userId) - returns 401 if missing
- ✓ Checks session ownership before saving draft
- ✓ Returns 404 if session not found or access denied
- ✓ Location: `app/api/intent/sessions/[id]/issue-draft/route.ts:147-154`

#### PATCH /api/intent/sessions/[id]/issue-draft
- ✓ Validates `x-afu9-sub` header (userId) - returns 401 if missing
- ✓ Checks session ownership before applying patch
- ✓ Returns 404 if session not found or access denied
- ✓ Location: `app/api/intent/sessions/[id]/issue-draft/route.ts:300-308`

#### POST /api/intent/sessions/[id]/issue-draft/commit
- ✓ Validates `x-afu9-sub` header (userId) - returns 401 if missing
- ✓ Checks session ownership before committing
- ✓ Returns 404 if session not found or access denied
- ✓ Location: `app/api/intent/sessions/[id]/issue-draft/commit/route.ts:39-45`

#### GET /api/intent/sessions/[id]/issue-draft/versions
- ✓ Validates `x-afu9-sub` header (userId) - returns 401 if missing
- ✓ Checks session ownership before listing versions
- ✓ Returns 404 if session not found or access denied
- ✓ Location: `app/api/intent/sessions/[id]/issue-draft/versions/route.ts:35-42`

### 2. Tool Registry & Capabilities (✓ VERIFIED)

#### INTENT Tools for Draft Access
All draft-related tools are properly registered in `intent-tool-registry.ts`:

- ✓ `get_issue_draft_summary` - Compact draft summary
- ✓ `get_issue_draft` - Full draft retrieval
- ✓ `save_issue_draft` - Draft creation/update
- ✓ `apply_issue_draft_patch` - Partial updates
- ✓ `validate_issue_draft` - Validation with save
- ✓ `commit_issue_draft` - Version creation

#### Tool Executor Context
- ✓ Tool executor receives correct session context from agent
- ✓ Context includes: userId, sessionId, triggerType, conversationMode
- ✓ Location: `src/lib/intent-agent.ts:387`
- ✓ Tools execute with proper session ownership validation

#### Capabilities Rendering
- ✓ `renderIntentToolCapabilities()` generates system prompt with tool list
- ✓ Gate status checked for each tool (enabled/disabled)
- ✓ Location: `src/lib/intent-tool-registry.ts:375-387`

### 3. Route Guards (✓ VERIFIED)

#### Authentication Guards
- ✓ All routes check `x-afu9-sub` header presence
- ✓ Missing header returns 401 Unauthorized
- ✓ Consistent across all draft endpoints

#### Session Ownership Guards
- ✓ All routes verify session belongs to authenticated user
- ✓ Database query: `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`
- ✓ Fail-safe: returns 404 if session not found or access denied
- ✓ Location: `src/lib/db/intentIssueDrafts.ts:36-45` (and similar in all DB functions)

#### Tool Gating (V09-I02)
- ✓ Draft-mutating tools gated in FREE mode (requires explicit user trigger)
- ✓ All tools allowed in DRAFTING mode
- ✓ Production write disabled unless enabled via feature flag
- ✓ Location: `src/lib/intent-agent-tool-executor.ts:69-119`

### 4. Empty State Handling (✓ VERIFIED)

#### NO_DRAFT State
- ✓ Returns 200 with `success:true, draft:null, reason:"NO_DRAFT"`
- ✓ Non-error response (not 404)
- ✓ Test: `__tests__/api/intent-draft-access-e2e.test.ts:70-82`

#### MIGRATION_REQUIRED State
- ✓ Returns 503 with `code:"MIGRATION_REQUIRED"`
- ✓ Includes requestId and helpful error message
- ✓ Triggered when table is missing (PostgreSQL error code 42P01)
- ✓ Location: `src/lib/db/intentIssueDrafts.ts:82-91`
- ✓ Test: `__tests__/api/intent-draft-access-e2e.test.ts:84-97`

## Acceptance Criteria Verification

### AC1: GET delivers deterministic Empty-States ✓

**Requirement:** GET /api/intent/sessions/{id}/issue-draft liefert deterministische Empty-States (NO_DRAFT / MIGRATION_REQUIRED etc.).

**Status:** ✓ PASSED

**Evidence:**
- Test: "returns 200 with success:true, draft:null, reason:NO_DRAFT when no draft exists"
- Test: "returns 503 with code:MIGRATION_REQUIRED when table is missing"
- Both tests pass consistently
- Response format is deterministic and documented

### AC2: Idempotent PATCH operations ✓

**Requirement:** INTENT kann denselben Draft mehrfach patchen ohne Konflikte (idempotent patch apply).

**Status:** ✓ PASSED

**Evidence:**
- Test: "applies first patch successfully"
- Test: "applies second patch to already patched draft (idempotent)"
- Test: "handles multiple PATCH operations without conflicts"
- All tests demonstrate successful sequential patches
- Patch application is deterministic (same input = same output)

**Implementation:**
- Patch operations use `applyPatchToDraft()` which merges changes
- Each PATCH gets current draft state before applying
- Evidence recorded for each patch operation (audit trail)
- Location: `app/api/intent/sessions/[id]/issue-draft/route.ts:368-377`

### AC3: Version list shows hash/correlationId ✓

**Requirement:** Versionsliste zeigt neue Versionen deterministisch inkl. hash/correlationId.

**Status:** ✓ PASSED

**Evidence:**
- Test: "lists versions with deterministic ordering (newest first)"
- Test: "includes hash in each version entry"
- Versions returned with: id, version_number, issue_hash, created_at, correlation_id
- Ordering is deterministic (newest first by version_number)

**Implementation:**
- Database query orders by `version_number DESC`
- Each version includes SHA-256 hash of canonical issue JSON
- Correlation ID tracks version lineage
- Location: `src/lib/db/intentIssueDraftVersions.ts`

### AC4: UI Panel shows current draft (no stale reads) ✓

**Requirement:** UI Draft Panel zeigt immer den aktuellen Draft (keine stale reads).

**Status:** ✓ PASSED

**Evidence:**
- Test: "GET draft returns Cache-Control: no-store header"
- Test: "PATCH draft returns Cache-Control: no-store header"
- Test: "GET versions returns Cache-Control: no-store header"
- All draft endpoints return `Cache-Control: no-store`

**Implementation:**
- All responses include `Cache-Control: no-store` header
- Browser will not cache responses
- UI always fetches fresh data from server
- Location: All route files include this header in responses

### AC5: Complete E2E Flow ✓

**Requirement:** E2E: mindestens ein Test deckt den Flow ab (API-level ok, UI optional).

**Status:** ✓ PASSED

**Evidence:**
- Test: "executes full flow: create → patch → commit → verify versions"
- Flow tested:
  1. GET (empty state) → receives NO_DRAFT
  2. PUT (create draft) → draft created with hash
  3. PATCH (modify draft) → draft updated with new hash
  4. COMMIT (create version) → immutable version created
  5. GET versions → committed version appears in list
  6. GET draft → draft still exists (commit doesn't delete it)

**Test File:** `__tests__/api/intent-draft-access-e2e.test.ts`

**Test Results:** 11/11 tests passing

## Test Coverage Summary

### New E2E Test Suite
- **File:** `control-center/__tests__/api/intent-draft-access-e2e.test.ts`
- **Tests:** 11 total, 11 passing
- **Coverage:**
  - AC1: Deterministic Empty States (2 tests)
  - AC2: Idempotent PATCH operations (3 tests)
  - AC3: Version list with hash/correlationId (2 tests)
  - AC4: No stale reads (3 tests)
  - AC5: Complete E2E Flow (1 comprehensive test)

### Existing Test Suites (Still Passing)
- `intent-issue-draft-route.test.ts` - 3/3 passing
- `issue-draft-patch.test.ts` - Tests for PATCH endpoint
- `intent-issue-draft.test.ts` - Database layer tests
- `intent-agent-tool-get-draft-summary.test.ts` - Tool tests

**Note:** 3 pre-existing test failures in `compileWorkPlanToIssueDraft.test.ts` are unrelated to draft access reliability and existed before this work.

## Verification Commands

### Run E2E Tests
```bash
cd control-center
npm test -- __tests__/api/intent-draft-access-e2e.test.ts
```

### Run All Draft Tests
```bash
cd control-center
npm test -- --testPathPattern="draft"
```

### Verify Repository Structure
```bash
npm run repo:verify
```

## PowerShell API Verification (Manual)

The following PowerShell commands can be used to manually verify the API endpoints:

```powershell
$base = "https://stage.afu-9.com"  # or http://localhost:3000
$sessionId = "<your-session-id>"
$token = "<your-auth-token>"

# 1. GET draft (empty state)
$headers = @{
    "Authorization" = "Bearer $token"
    "x-request-id" = "manual-test-1"
}
Invoke-RestMethod -Uri "$base/api/intent/sessions/$sessionId/issue-draft" `
    -Method GET -Headers $headers

# Expected: { "success": true, "draft": null, "reason": "NO_DRAFT" }

# 2. CREATE draft
$body = @{
    issue_json = @{
        issueDraftVersion = "1.0"
        title = "Test Draft"
        body = "Test body"
        type = "issue"
        canonicalId = "ITEST"
        labels = @("test")
        dependsOn = @()
        priority = "P1"
        acceptanceCriteria = @("AC1")
        verify = @{
            commands = @("npm test")
            expected = @("pass")
        }
        guards = @{
            env = "development"
            prodBlocked = $true
        }
    }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri "$base/api/intent/sessions/$sessionId/issue-draft" `
    -Method PUT -Headers $headers -Body $body -ContentType "application/json"

# Expected: { "id": "...", "issue_hash": "...", ... }

# 3. PATCH draft
$patchBody = @{
    patch = @{
        title = "Updated Test Draft"
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri "$base/api/intent/sessions/$sessionId/issue-draft" `
    -Method PATCH -Headers $headers -Body $patchBody -ContentType "application/json"

# Expected: { "success": true, "diffSummary": { "changedFields": ["title"] }, ... }

# 4. GET versions
Invoke-RestMethod -Uri "$base/api/intent/sessions/$sessionId/issue-draft/versions" `
    -Method GET -Headers $headers

# Expected: { "versions": [...], "total": N, ... }

# 5. COMMIT draft (requires valid draft)
Invoke-RestMethod -Uri "$base/api/intent/sessions/$sessionId/issue-draft/commit" `
    -Method POST -Headers $headers

# Expected: { "version": { "version_number": 1, "issue_hash": "...", ... }, "isNew": true }
```

## Conclusion

All acceptance criteria for I902 have been met:

1. ✓ GET returns deterministic empty states (NO_DRAFT, MIGRATION_REQUIRED)
2. ✓ PATCH is idempotent (multiple patches without conflicts)
3. ✓ Version list shows hash/correlationId deterministically
4. ✓ Cache-Control headers prevent stale reads in UI
5. ✓ Complete E2E flow tested and working

The draft access infrastructure is reliable, with proper:
- Session-binding (all routes validate session ownership)
- Authentication (401 on missing auth, 403/404 on access denied)
- Tool registry (all draft tools registered and callable)
- Route guards (consistent across all endpoints)
- Empty state handling (deterministic responses)

No code changes were required to the existing infrastructure - it was already implemented correctly. The comprehensive E2E test suite now provides ongoing verification of these guarantees.
