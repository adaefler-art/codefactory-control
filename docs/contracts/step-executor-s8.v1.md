# Step Executor S8 Contract v1 (E9.3-CTRL-07)

**Contract ID:** `step-executor-s8.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-07  
**Created:** 2026-02-05

## Overview

The S8 (Close) step executor implements the GREEN path for cleanly closing successfully verified runs. S8 transitions verified issues to an immutable CLOSED state with no further modifications allowed.

## Purpose

S8 serves as the terminal close step that:

1. **Accepts** VERIFIED issues (after S7 GREEN verdict)
2. **Closes** the issue with immutable finality
3. **Records** closure event for audit trail
4. **Prevents** any further state transitions (fail-closed)

## Preconditions

Before S8 can execute:

- Issue must be in `VERIFIED` state (S7 GREEN verdict completed)
- No active locks on the issue
- Verification verdict must be GREEN
- All deployment observations must be successful

## Input Contract

### Database Schema Requirements

The executor expects the following issue data:

```typescript
interface IssueForS8 {
  id: string;                    // Issue UUID
  status: 'VERIFIED';            // Must be in this state
  github_url: string;            // GitHub issue URL
  pr_url: string;                // GitHub PR URL
  merge_sha?: string;            // Merge commit SHA from S5
}
```

### Step Executor Parameters

```typescript
interface ExecuteS8Params {
  issue: IssueForS8;
  runId: string;       // Loop run ID for traceability
  requestId: string;   // Request ID for correlation
  mode: 'execute' | 'dryRun';
}
```

## Execution Logic

### Step 1: Validate Preconditions

- **Check issue is VERIFIED**: Issue must have passed S7 verification
- **Verify GREEN verdict**: Must have a GREEN verdict from S7
- **Check no active locks**: No concurrent operations

**Blocker codes** (if validation fails):
- `NOT_VERIFIED` - Issue must be in VERIFIED state
- `NO_GREEN_VERDICT` - No GREEN verdict found
- `LOCKED` - Issue is locked by another process

### Step 2: Create Immutable Closure Record

```typescript
interface ClosureRecord {
  id: string;                     // UUID
  issue_id: string;               // Foreign key to afu9_issues
  run_id: string;                 // Foreign key to loop run
  closed_at: string;              // ISO 8601 timestamp
  verification_verdict_id: string; // Link to S7 verdict
  closure_reason: string;         // "VERIFIED_SUCCESS"
}
```

**Critical**: Closure is immutable - cannot be modified or reversed.

### Step 3: Transition to CLOSED State

Update issue status:
- From: `VERIFIED`
- To: `CLOSED`

**Immutability**: Once CLOSED, no further state transitions are allowed.

### Step 4: Create Timeline Event

Record closure in timeline:

```typescript
{
  event_type: 'issue_closed',
  event_data: {
    runId: string;
    step: 'S8_CLOSE';
    stateBefore: 'VERIFIED';
    stateAfter: 'CLOSED';
    requestId: string;
    closureId: string;
    verificationVerdictId: string;
  }
}
```

## Output Contract

### Success Response

```typescript
interface S8SuccessResult {
  success: true;
  runId: string;
  step: 'S8_CLOSE';
  stateBefore: 'VERIFIED';
  stateAfter: 'CLOSED';
  closureRecord: {
    closureId: string;            // UUID of closure record
    closedAt: string;             // ISO 8601 timestamp
    verificationVerdictId: string;
    closureReason: string;
  };
  durationMs: number;
}
```

### Blocked Response

```typescript
interface S8BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S8_CLOSE';
  stateBefore: string;
  stateAfter: string;  // State unchanged on block
}
```

## Block Reasons

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `NOT_VERIFIED` | Issue not in VERIFIED state | status !== 'VERIFIED' |
| `NO_GREEN_VERDICT` | No GREEN verdict found | No S7 GREEN verdict exists |
| `LOCKED` | Issue locked | Concurrent operation in progress |

## State Transitions

### Valid Transition

| Current State | Next State | Condition |
|---------------|------------|-----------|
| `VERIFIED` | `CLOSED` | S7 GREEN verdict exists |

### Terminal State

`CLOSED` is a terminal state:
- No transitions out of CLOSED allowed
- All operations on CLOSED issues return blocker
- State is immutable forever

## Event Types

S8 emits the following timeline events:

| Event Type | When | Required Fields |
|------------|------|-----------------|
| `issue_closed` | Issue closed successfully | runId, step, closureId, requestId |
| `loop_step_s8_completed` | S8 completed successfully | runId, step, stateBefore, stateAfter, requestId |
| `loop_run_blocked` | S8 blocked | runId, step, blockerCode, requestId |

## Fail-Closed Semantics

**Critical**: S8 implements fail-closed closure:

1. **No implicit closure**: Closure must be explicit via S8
2. **No silent transitions**: All errors result in explicit blocker codes
3. **Immutability enforced**: CLOSED state cannot be modified
4. **No state changes on error**: Failed closure leaves state unchanged

## Immutability Guarantees

**Critical**: S8 ensures immutability:

1. **One-way transition**: VERIFIED → CLOSED (no reverse)
2. **No modifications**: Closed issues cannot be updated
3. **Audit trail**: Full traceability from verification to closure
4. **Permanent record**: Closure records never deleted

## Idempotency Guarantees

**Critical**: S8 closure operations are idempotent:

1. **Duplicate-safe**: Closing an already-closed issue returns success
2. **Same outcome**: Multiple calls produce same result
3. **No side effects on retry**: Retrying closure has no additional effects

## State Machine Integration

### Post-Verification Flow

S8 is executed after S7 (Verify Gate):
1. S7 evaluates evidence → GREEN verdict → Issue transitions to `VERIFIED`
2. S8 closes verified issue → Issue transitions to `CLOSED`
3. `CLOSED` is terminal → No further steps

### Error Recovery

If S8 fails:
- Issue remains in `VERIFIED` state
- Can retry S8 execution
- S7 verdict remains linked

## Integration Points

### API Endpoint

S8 is integrated into loop execution:

```typescript
POST /api/loop/issues/:issueId/run-next-step

Response (when S8 executes):
{
  stepExecuted: {
    stepNumber: 8,
    stepType: 'S8_CLOSE',
    status: 'completed'
  },
  loopStatus: 'completed',
  message: 'Issue closed successfully'
}
```

### Database Integration

S8 stores closure records in `issue_closures` table:

```sql
CREATE TABLE issue_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id),
  run_id UUID NOT NULL REFERENCES loop_runs(id),
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_verdict_id UUID NOT NULL REFERENCES verification_verdicts(id),
  closure_reason TEXT NOT NULL DEFAULT 'VERIFIED_SUCCESS',
  
  -- Unique constraint: one closure per issue (immutability)
  UNIQUE(issue_id)
);
```

## Determinism Guarantees

The S8 closure operation is **deterministic**:

1. **Same state → Same outcome**: VERIFIED always leads to CLOSED
2. **Stable closure rules**: Rules are fixed and versioned
3. **Reproducible**: Closure can be verified from audit trail

## Error Handling

### Transient Errors

- Database connection lost → Retry OR fail with blocker code
- Lock acquisition failed → Retry OR fail with `LOCKED`

### Permanent Errors

- Issue not VERIFIED → Fail with `NOT_VERIFIED`
- No GREEN verdict → Fail with `NO_GREEN_VERDICT`

All errors result in **explicit blocker code** (fail-closed).

## Testing

### Unit Tests

Required test cases:

1. **Successful closure:**
   - VERIFIED issue → CLOSED
   - Closure record created
   - Timeline event emitted

2. **Blocked conditions:**
   - Not VERIFIED → Blocked with NOT_VERIFIED
   - No GREEN verdict → Blocked with NO_GREEN_VERDICT

3. **Idempotency:**
   - Closing already-closed issue → Success (no-op)

4. **Immutability:**
   - Attempting to modify CLOSED issue → Blocked

### Integration Tests

1. Full S7 → S8 flow
2. Immutability: Verify no modifications to CLOSED issues
3. State machine: VERIFIED → CLOSED transition
4. Audit trail: Closure linked to verification verdict

## Acceptance Criteria

1. ✅ **Closure is explicit**
   - Only S8 can close issues
   - No implicit closure
   - VERIFIED → CLOSED transition only

2. ✅ **Immutability enforced**
   - CLOSED state is terminal
   - No modifications allowed
   - Audit trail preserved

3. ✅ **Fail-closed semantics**
   - All failures → Explicit blocker codes
   - No silent fallbacks
   - State unchanged on error

4. ✅ **Deterministic closure**
   - Same state → Same outcome
   - Reproducible from audit trail

## Version History

- **v1.0** (2026-02-05): Initial S8 Close implementation (E9.3-CTRL-07)

## Related Contracts

- [Step Executor S7 v1](./step-executor-s7.v1.md) - S7 Verify Gate (precedes S8)
- [Step Executor S9 v1](./step-executor-s9.v1.md) - S9 Hold/Remediate (alternative to S8)
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/step-executor-s8.v1.md` (this file)
- Executor: `control-center/src/lib/loop/stepExecutors/s8-close.ts`
- Database: `database/migrations/091_issue_closures.sql`
- Tests: `control-center/__tests__/lib/loop/stepExecutors/s8-close.test.ts`
