# Step Executor S9 Contract v1 (E9.3-CTRL-07)

**Contract ID:** `step-executor-s9.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-07  
**Created:** 2026-02-05

## Overview

The S9 (Hold/Remediate) step executor implements the RED path for handling issues that require remediation. S9 transitions issues to HOLD state and creates explicit remediation records for tracking.

## Purpose

S9 serves as the remediation step that:

1. **Accepts** issues that failed verification or require intervention
2. **Places** issues on HOLD with explicit reason
3. **Records** remediation requirements for tracking
4. **Enables** explicit remediation workflow

## Preconditions

Before S9 can execute:

- Issue must be in a state that allows HOLD transition:
  - `DONE` (after S7 RED verdict)
  - `REVIEW_READY` (after S4 failure)
  - `IMPLEMENTING_PREP` (after implementation failure)
- Remediation reason must be provided
- No active locks on the issue

## Input Contract

### Database Schema Requirements

The executor expects the following issue data:

```typescript
interface IssueForS9 {
  id: string;                    // Issue UUID
  status: string;                // Current status (must allow HOLD transition)
  github_url: string;            // GitHub issue URL
  pr_url?: string;               // GitHub PR URL (optional)
}
```

### Step Executor Parameters

```typescript
interface ExecuteS9Params {
  issue: IssueForS9;
  runId: string;       // Loop run ID for traceability
  requestId: string;   // Request ID for correlation
  mode: 'execute' | 'dryRun';
  remediationReason: string;     // Explicit reason for HOLD
  remediationDetails?: {
    failedStep?: string;         // Which step failed
    blockerCode?: string;        // What blocked the issue
    redVerdict?: boolean;        // If from S7 RED verdict
    failedChecks?: string[];     // Specific failures
  };
}
```

## Execution Logic

### Step 1: Validate Preconditions

- **Check HOLD allowed**: Issue state must allow transition to HOLD
- **Verify remediation reason**: Must be non-empty and explicit
- **Check no active locks**: No concurrent operations

**Blocker codes** (if validation fails):
- `INVALID_STATE_FOR_HOLD` - Current state doesn't allow HOLD
- `NO_REMEDIATION_REASON` - Remediation reason required
- `LOCKED` - Issue is locked by another process

### Step 2: Create Remediation Record

```typescript
interface RemediationRecord {
  id: string;                     // UUID
  issue_id: string;               // Foreign key to afu9_issues
  run_id: string;                 // Foreign key to loop run
  remediation_reason: string;     // Explicit reason for HOLD
  failed_step?: string;           // Which step failed
  blocker_code?: string;          // What blocked progression
  red_verdict?: boolean;          // If from S7 RED verdict
  failed_checks?: string[];       // Specific check failures
  remediation_status: string;     // 'pending', 'in_progress', 'resolved'
  created_at: string;             // When remediation was recorded
  resolved_at?: string;           // When remediation was completed
  resolution_notes?: string;      // How issue was resolved
}
```

**Critical**: Remediation must be explicit - no silent HOLD transitions.

### Step 3: Transition to HOLD State

Update issue status:
- From: Current state (DONE, REVIEW_READY, IMPLEMENTING_PREP, etc.)
- To: `HOLD`

**Semantics**: HOLD is a terminal state requiring explicit remediation to exit.

### Step 4: Create Timeline Event

Record hold in timeline:

```typescript
{
  event_type: 'issue_held_for_remediation',
  event_data: {
    runId: string;
    step: 'S9_REMEDIATE';
    stateBefore: string;          // Original state
    stateAfter: 'HOLD';
    requestId: string;
    remediationId: string;
    remediationReason: string;
    failedStep?: string;
    blockerCode?: string;
  }
}
```

## Output Contract

### Success Response

```typescript
interface S9SuccessResult {
  success: true;
  runId: string;
  step: 'S9_REMEDIATE';
  stateBefore: string;
  stateAfter: 'HOLD';
  remediationRecord: {
    remediationId: string;        // UUID of remediation record
    reason: string;               // Why issue was held
    failedStep?: string;          // What step failed
    blockerCode?: string;         // What blocked progression
    createdAt: string;            // ISO 8601 timestamp
  };
  durationMs: number;
}
```

### Blocked Response

```typescript
interface S9BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S9_REMEDIATE';
  stateBefore: string;
  stateAfter: string;  // State unchanged on block
}
```

## Block Reasons

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `INVALID_STATE_FOR_HOLD` | State doesn't allow HOLD | Not a valid source state |
| `NO_REMEDIATION_REASON` | Reason required | remediationReason is empty |
| `LOCKED` | Issue locked | Concurrent operation in progress |
| `ALREADY_ON_HOLD` | Issue already on HOLD | status === 'HOLD' |

## State Transitions

### Valid Transitions to HOLD

| From State | To State | Condition |
|------------|----------|-----------|
| `CREATED` | `HOLD` | Early termination needed |
| `SPEC_READY` | `HOLD` | Spec issues found |
| `IMPLEMENTING_PREP` | `HOLD` | Implementation blocked |
| `REVIEW_READY` | `HOLD` | Review issues found |
| `DONE` | `HOLD` | S7 RED verdict |

### Remediation Workflow

1. Issue enters HOLD via S9
2. Remediation record created with status='pending'
3. Manual intervention addresses issue
4. Remediation status updated to 'in_progress'
5. When resolved, status becomes 'resolved'
6. Issue can be manually moved back to appropriate state

**Note**: Exiting HOLD requires explicit manual action (not automated).

## Event Types

S9 emits the following timeline events:

| Event Type | When | Required Fields |
|------------|------|-----------------|
| `issue_held_for_remediation` | Issue placed on HOLD | runId, step, remediationId, reason, requestId |
| `loop_step_s9_completed` | S9 completed successfully | runId, step, stateBefore, stateAfter, requestId |
| `loop_run_blocked` | S9 blocked | runId, step, blockerCode, requestId |

## Fail-Closed Semantics

**Critical**: S9 implements fail-closed remediation:

1. **No silent HOLD**: Remediation reason must be explicit
2. **No automatic recovery**: Exiting HOLD requires manual intervention
3. **Full audit trail**: All HOLD transitions tracked
4. **Explicit reasons**: Generic "failed" is not acceptable

## Remediation Tracking

**Critical**: S9 ensures full remediation tracking:

1. **Explicit reasons**: Why issue was held
2. **Failed step tracking**: Which step failed
3. **Blocker linkage**: Link to blocker code
4. **Resolution tracking**: How issue was resolved
5. **Timeline audit**: Full event history

## Idempotency Guarantees

**Critical**: S9 operations are idempotent:

1. **Duplicate-safe**: Holding already-held issue updates remediation record
2. **Same outcome**: Multiple calls with same reason produce same result
3. **Additive**: New remediation attempts create new records for audit

## State Machine Integration

### RED Path Flow

S9 is the RED path after verification:
1. S7 evaluates evidence → RED verdict → Issue remains `DONE`
2. S9 places on HOLD → Issue transitions to `HOLD`
3. Manual remediation required → Issue may return to earlier state
4. Re-execute from appropriate step

### Alternative Entry Points

S9 can be triggered from:
- **S4 failure**: Review issues → HOLD
- **S5 failure**: Merge conflicts → HOLD
- **S7 RED verdict**: Verification failures → HOLD
- **Manual intervention**: Explicit HOLD request

## Integration Points

### API Endpoint

S9 can be invoked via loop execution or directly:

```typescript
POST /api/loop/issues/:issueId/hold

Request:
{
  reason: string;
  details?: {
    failedStep?: string;
    blockerCode?: string;
    failedChecks?: string[];
  };
}

Response:
{
  success: true;
  remediationId: string;
  reason: string;
  heldAt: string;
}
```

### Database Integration

S9 stores remediation records in `remediation_records` table:

```sql
CREATE TABLE remediation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id),
  run_id UUID REFERENCES loop_runs(id),
  remediation_reason TEXT NOT NULL,
  failed_step TEXT,
  blocker_code TEXT,
  red_verdict BOOLEAN DEFAULT FALSE,
  failed_checks TEXT[] DEFAULT '{}',
  remediation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (remediation_status IN ('pending', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  
  -- Index for querying by issue
  CONSTRAINT remediation_records_issue_id_created_at_idx 
    UNIQUE(issue_id, created_at)
);
```

## Determinism Guarantees

The S9 remediation operation is **deterministic**:

1. **Same inputs → Same record**: Same reason creates consistent record
2. **Stable rules**: Remediation rules are versioned
3. **Reproducible**: Remediation can be verified from audit trail

## Error Handling

### Transient Errors

- Database connection lost → Retry OR fail with blocker code
- Lock acquisition failed → Retry OR fail with `LOCKED`

### Permanent Errors

- Invalid state → Fail with `INVALID_STATE_FOR_HOLD`
- No reason provided → Fail with `NO_REMEDIATION_REASON`

All errors result in **explicit blocker code** (fail-closed).

## Testing

### Unit Tests

Required test cases:

1. **Successful HOLD:**
   - DONE (S7 RED) → HOLD
   - Remediation record created
   - Timeline event emitted

2. **Blocked conditions:**
   - Invalid state → Blocked with INVALID_STATE_FOR_HOLD
   - No reason → Blocked with NO_REMEDIATION_REASON
   - Already on HOLD → Blocked with ALREADY_ON_HOLD

3. **Idempotency:**
   - Holding already-held issue → Success (new record)

4. **Explicit reasoning:**
   - Generic reasons rejected
   - Specific reasons required

### Integration Tests

1. Full S7 RED → S9 flow
2. S4 failure → S9 flow
3. Manual HOLD → S9
4. Remediation workflow: pending → in_progress → resolved

## Acceptance Criteria

1. ✅ **Remediation is explicit**
   - No silent HOLD transitions
   - Reason always required
   - Full audit trail

2. ✅ **Tracking is comprehensive**
   - Failed step recorded
   - Blocker code linked
   - Resolution tracked

3. ✅ **Fail-closed semantics**
   - All failures → Explicit blocker codes
   - No automatic recovery
   - Manual intervention required

4. ✅ **Deterministic remediation**
   - Same inputs → Same outcome
   - Reproducible from audit trail

## Version History

- **v1.0** (2026-02-05): Initial S9 Hold/Remediate implementation (E9.3-CTRL-07)

## Related Contracts

- [Step Executor S7 v1](./step-executor-s7.v1.md) - S7 Verify Gate (may trigger S9)
- [Step Executor S8 v1](./step-executor-s8.v1.md) - S8 Close (alternative to S9)
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/step-executor-s9.v1.md` (this file)
- Executor: `control-center/src/lib/loop/stepExecutors/s9-remediate.ts`
- Database: `database/migrations/091_remediation_records.sql`
- Tests: `control-center/__tests__/lib/loop/stepExecutors/s9-remediate.test.ts`
