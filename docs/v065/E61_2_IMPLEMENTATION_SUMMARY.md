# E61.2 Implementation Summary: Activate Semantik (maxActive=1) atomar erzwingen

## Overview
Implemented atomic activate semantics where exactly ONE issue can be active (status = SPEC_READY) at any time, with 409 CONFLICT returned if another issue is already active.

## Changed Files

### 1. Database Migrations

#### `database/migrations/023_add_activated_by_field.sql`
- **Rationale**: Added `activated_by` field to track who activated the issue
- **Changes**: ALTER TABLE to add `activated_by VARCHAR(255)`

#### `database/migrations/024_update_single_active_constraint_spec_ready.sql`
- **Rationale**: Updated database trigger to enforce single-active constraint for SPEC_READY status
- **Changes**: Updated `enforce_single_active_issue()` function to check for SPEC_READY instead of IMPLEMENTING

### 2. Backend Logic

#### `control-center/src/lib/db/afu9Issues.ts`
- **Rationale**: Updated active issue detection to use SPEC_READY status
- **Changes**:
  - `getActiveIssue()`: Changed query to check for SPEC_READY instead of IMPLEMENTING
  - `canSetIssueActive()`: Changed validation to check for SPEC_READY
  - `createAfu9Issue()`: Updated to enforce single-active constraint for SPEC_READY
  - `updateAfu9Issue()`: Added support for `activated_by` field, updated constraint check for SPEC_READY

#### `control-center/app/api/issues/[id]/activate/route.ts`
- **Rationale**: Implemented E61.2 activate semantics with 409 conflict handling
- **Changes**:
  - Removed automatic deactivation of other issues
  - Changed target status from IMPLEMENTING to SPEC_READY
  - Added 409 CONFLICT response when another issue is already active
  - Set both `activated_at` and `activated_by` fields
  - Uses `transitionIssue()` for atomic state change with event logging

#### `control-center/app/api/issues/_shared.ts`
- **Rationale**: Added support for `activated_by` field in API responses
- **Changes**: 
  - Added `activatedBy` extraction from normalized data
  - Added `activatedBy` to API response (both camelCase and snake_case)

### 3. Frontend UI

#### `control-center/app/issues/[id]/page.tsx`
- **Rationale**: Updated UI to reflect E61.2 semantics and handle 409 conflicts
- **Changes**:
  - `handleActivate()`: Updated to handle 409 conflict responses
  - `performActivation()`: Added explicit 409 status check and error handling
  - Activate button: Changed disabled condition to check for SPEC_READY
  - Warning modal: Changed from "allow override" to "block activation" mode
  - Modal text: Updated to explain SPEC_READY status and manual deactivation requirement

### 4. Tests

#### `control-center/__tests__/api/activate-semantik-e61-2.test.ts`
- **Rationale**: Comprehensive test coverage for E61.2 requirements
- **Changes**: Created new test file with 6 test cases:
  1. Successful activation when no other issue is active
  2. Success when issue is already SPEC_READY
  3. 409 conflict when another issue is already SPEC_READY
  4. No `transitionIssue()` call when another issue is active
  5. 400 error for invalid state transitions
  6. 400 error for activation without title

## Test Results

All tests pass:
- E61.2 tests: 6/6 passed ✓
- All issues API tests: 43/43 passed ✓
- Issue lifecycle invariants: 8/8 passed ✓

## Semantic Changes

### Before (Old Behavior)
- Active status: IMPLEMENTING
- On activation: Automatically deactivates (sets to DONE) any other active issue
- User sees warning but can proceed with activation

### After (E61.2 Behavior)
- Active status: SPEC_READY
- On activation: Returns 409 CONFLICT if another issue is active
- User sees blocking warning and cannot proceed with activation
- Must manually deactivate other issue first

## Atomicity Guarantees

The activation operation is atomic through:
1. Database-level single-active trigger constraint
2. `transitionIssue()` uses transaction to update status + write event
3. Race conditions prevented at DB level, not UI level
4. 409 conflict returned if trigger constraint is violated

## Event Logging

- Successful activation: Creates ONE `TRANSITION` event via `transitionIssue()`
- Failed activation (409): NO event created
- Event includes: type, from_status, to_status, actor, payload

## Fields Set on Activation

1. `status` → SPEC_READY (via `transitionIssue()`)
2. `activated_at` → current timestamp (via `updateAfu9Issue()`)
3. `activated_by` → 'api-user' (via `updateAfu9Issue()`)

## API Contract

### POST /api/issues/{id}/activate

**Success (200)**
```json
{
  "message": "Issue activated successfully",
  "issue": { ... }
}
```

**Already Active (200)**
```json
{
  "message": "Issue is already active (SPEC_READY)",
  "issue": { ... }
}
```

**Conflict (409)**
```json
{
  "error": "Another issue is already active",
  "details": "Issue 987fcdeb (\"Other Issue\") is already active...",
  "activeIssue": {
    "id": "987fcdeb-...",
    "publicId": "987fcdeb",
    "title": "Other Issue",
    "status": "SPEC_READY"
  }
}
```

**Invalid Transition (400)**
```json
{
  "error": "Invalid transition: DONE -> SPEC_READY. This transition is not allowed..."
}
```

**Missing Title (400)**
```json
{
  "error": "Cannot activate issue without a title",
  "details": "Activation requires a non-empty title..."
}
```
