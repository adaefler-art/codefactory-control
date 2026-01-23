# Step Executor S3: Implement Prep Contract

**Version:** v1.0  
**Status:** Active  
**Issue:** E9.1-CTRL-7  
**Implementation:** `control-center/src/lib/loop/stepExecutors/s3-implement-prep.ts`

## Overview

The S3 Step Executor ("Implement Prep") transitions an AFU-9 issue from SPEC_READY to IMPLEMENTING_PREP state. This is a strictly state-only operation that validates the spec is ready and prepares the issue for implementation work.

## Purpose

S3 serves as the transition step after spec validation, ensuring that:
1. The issue has a validated specification (is in `SPEC_READY` state)
2. The issue is ready to begin implementation work
3. State transitions follow strict state machine invariants

This is an **idempotent** operation - calling it multiple times on the same issue in IMPLEMENTING_PREP state is safe and results in a no-op.

## Function Signature

```typescript
async function executeS3(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult>
```

## Input: StepContext

```typescript
interface StepContext {
  issueId: string;      // UUID of the AFU-9 issue
  runId: string;        // UUID of the loop run
  requestId: string;    // UUID for request tracing
  actor: string;        // Actor executing the step
  mode: 'execute' | 'dryRun';  // Execution mode
}
```

## Output: StepExecutionResult

```typescript
interface StepExecutionResult {
  success: boolean;           // True if step completed successfully
  blocked: boolean;           // True if step is blocked
  blockerCode?: BlockerCode;  // Blocker code (e.g., INVARIANT_VIOLATION)
  blockerMessage?: string;    // Human-readable blocker message
  stateBefore: string;        // Issue status before step
  stateAfter: string;         // Issue status after step
  fieldsChanged: string[];    // List of fields modified
  message: string;            // Result message
}
```

## Execution Modes

### Execute Mode (`mode: 'execute'`)

- Updates issue status in database
- Logs timeline event
- Adds `'status'` to `fieldsChanged` array on success

### Dry-Run Mode (`mode: 'dryRun'`)

- Does NOT update issue status
- Logs timeline event (for auditing)
- Returns empty `fieldsChanged` array
- Message indicates "would transition to..."

## Preconditions

For S3 to execute successfully, the following must be true:

1. **Issue State**: Issue status must be `SPEC_READY`

## Execution Flow

### Success Case

**Precondition:** Issue status is `SPEC_READY`

**Actions:**
1. Fetch issue from database
2. Verify state is `SPEC_READY`
3. In execute mode: Update status to `IMPLEMENTING_PREP`
4. Log timeline event with `stepName: 'loop_step_s3_implement_prep'`
5. Return success result

**Result:**
```typescript
{
  success: true,
  blocked: false,
  stateBefore: 'SPEC_READY',
  stateAfter: 'IMPLEMENTING_PREP',
  fieldsChanged: ['status'],  // Empty in dry-run mode
  message: 'S3 complete: Implement prep ready, transitioned to IMPLEMENTING_PREP'
}
```

### Idempotent No-Op Case

**Precondition:** Issue status is already `IMPLEMENTING_PREP`

**Actions:**
1. Fetch issue from database
2. Detect issue is already in target state
3. Log timeline event with `isNoOp: true`
4. Return success result with no changes

**Result:**
```typescript
{
  success: true,
  blocked: false,
  stateBefore: 'IMPLEMENTING_PREP',
  stateAfter: 'IMPLEMENTING_PREP',
  fieldsChanged: [],
  message: 'S3 complete: Already in IMPLEMENTING_PREP (no-op)'
}
```

### Blocked Case - Wrong State

**Precondition:** Issue status is NOT `SPEC_READY` and NOT `IMPLEMENTING_PREP`

**Blocker Code Logic:**
- If state is a known state (e.g., `CREATED`, `DONE`, `HOLD`): `INVARIANT_VIOLATION`
- If state is unknown/invalid (e.g., `INVALID_XYZ`): `UNKNOWN_STATE`

**Actions:**
1. Fetch issue from database
2. Detect state is not valid for S3
3. Log timeline event with blocked flag and blocker code
4. Return blocked result

**Result (Known State):**
```typescript
{
  success: false,
  blocked: true,
  blockerCode: 'INVARIANT_VIOLATION',
  blockerMessage: 'S3 (Implement Prep) requires state SPEC_READY, but issue is in state \'CREATED\'',
  stateBefore: 'CREATED',
  stateAfter: 'CREATED',
  fieldsChanged: [],
  message: 'Step blocked: S3 (Implement Prep) requires state SPEC_READY...'
}
```

**Result (Unknown State):**
```typescript
{
  success: false,
  blocked: true,
  blockerCode: 'UNKNOWN_STATE',
  blockerMessage: 'S3 (Implement Prep) encountered unknown state: \'INVALID_XYZ\'',
  stateBefore: 'INVALID_XYZ',
  stateAfter: 'INVALID_XYZ',
  fieldsChanged: [],
  message: 'Step blocked: S3 (Implement Prep) encountered unknown state...'
}
```

## Timeline Events

S3 creates timeline events with the following structure:

### Success Event

```typescript
{
  issue_id: string,
  event_type: 'RUN_STARTED',
  event_data: {
    runId: string,
    step: 'S3_IMPLEMENT_PREP',
    stepName: 'loop_step_s3_implement_prep',
    stateBefore: 'SPEC_READY',
    stateAfter: 'IMPLEMENTING_PREP',
    requestId: string,
    blocked: false,
    fieldsChanged: ['status'],
    mode: 'execute' | 'dryRun'
  },
  actor: string,
  actor_type: 'system'
}
```

### No-Op Event

```typescript
{
  issue_id: string,
  event_type: 'RUN_STARTED',
  event_data: {
    runId: string,
    step: 'S3_IMPLEMENT_PREP',
    stateBefore: 'IMPLEMENTING_PREP',
    stateAfter: 'IMPLEMENTING_PREP',
    requestId: string,
    blocked: false,
    isNoOp: true,
    mode: 'execute' | 'dryRun'
  },
  actor: string,
  actor_type: 'system'
}
```

### Blocked Event

```typescript
{
  issue_id: string,
  event_type: 'RUN_STARTED',
  event_data: {
    runId: string,
    step: 'S3_IMPLEMENT_PREP',
    stateBefore: string,
    stateAfter: string,  // Same as stateBefore
    requestId: string,
    blocked: true,
    blockerCode: 'INVARIANT_VIOLATION' | 'UNKNOWN_STATE',
    mode: 'execute' | 'dryRun',
    expectedState: 'SPEC_READY'
  },
  actor: string,
  actor_type: 'system'
}
```

## Blocker Codes

| Code | When Used | Description |
|------|-----------|-------------|
| `INVARIANT_VIOLATION` | Issue is in a known state but not `SPEC_READY` | State machine invariant violated - issue must be in SPEC_READY to proceed to IMPLEMENTING_PREP |
| `UNKNOWN_STATE` | Issue status is not a recognized state | Issue is in an unknown or invalid state |

## Guarantees

1. **Idempotent**: Calling S3 multiple times on the same issue produces consistent results
2. **No Side Effects**: S3 only modifies issue status, no PR creation or branch handling
3. **State Validation**: Strictly enforces SPEC_READY → IMPLEMENTING_PREP transition
4. **Audit Trail**: All executions (success, no-op, blocked) are logged to timeline
5. **Fail-Closed**: Returns explicit blocker codes instead of generic errors

## State Machine Integration

S3 integrates with the Loop State Machine v1 (E9.1-CTRL-4):

**Valid Transition:**
```
SPEC_READY → IMPLEMENTING_PREP
```

**Invalid Transitions (Blocked):**
```
CREATED → IMPLEMENTING_PREP          (INVARIANT_VIOLATION)
DONE → IMPLEMENTING_PREP             (INVARIANT_VIOLATION)
HOLD → IMPLEMENTING_PREP             (INVARIANT_VIOLATION)
UNKNOWN_STATE → IMPLEMENTING_PREP    (UNKNOWN_STATE)
```

**Idempotent Case:**
```
IMPLEMENTING_PREP → IMPLEMENTING_PREP  (No-op, success)
```

## Usage Examples

### Example 1: Execute Mode - Success

```typescript
const pool = getPostgresPool();
const ctx: StepContext = {
  issueId: 'afu9-issue-uuid',
  runId: 'run-uuid',
  requestId: 'req-uuid',
  actor: 'system',
  mode: 'execute'
};

const result = await executeS3(pool, ctx);

// Result:
// {
//   success: true,
//   blocked: false,
//   stateBefore: 'SPEC_READY',
//   stateAfter: 'IMPLEMENTING_PREP',
//   fieldsChanged: ['status'],
//   message: 'S3 complete: Implement prep ready, transitioned to IMPLEMENTING_PREP'
// }
```

### Example 2: Dry-Run Mode

```typescript
const ctx: StepContext = {
  issueId: 'afu9-issue-uuid',
  runId: 'run-uuid',
  requestId: 'req-uuid',
  actor: 'system',
  mode: 'dryRun'
};

const result = await executeS3(pool, ctx);

// Result:
// {
//   success: true,
//   blocked: false,
//   stateBefore: 'SPEC_READY',
//   stateAfter: 'IMPLEMENTING_PREP',
//   fieldsChanged: [],  // Empty - no actual changes
//   message: 'S3 dry-run complete: Implement prep ready, would transition to IMPLEMENTING_PREP'
// }
```

### Example 3: Blocked - Wrong State

```typescript
const result = await executeS3(pool, ctx);

// If issue is in CREATED state:
// {
//   success: false,
//   blocked: true,
//   blockerCode: 'INVARIANT_VIOLATION',
//   blockerMessage: 'S3 (Implement Prep) requires state SPEC_READY, but issue is in state \'CREATED\'',
//   stateBefore: 'CREATED',
//   stateAfter: 'CREATED',
//   fieldsChanged: [],
//   message: 'Step blocked: S3 (Implement Prep) requires state SPEC_READY...'
// }
```

### Example 4: Idempotent No-Op

```typescript
// Issue already in IMPLEMENTING_PREP
const result = await executeS3(pool, ctx);

// Result:
// {
//   success: true,
//   blocked: false,
//   stateBefore: 'IMPLEMENTING_PREP',
//   stateAfter: 'IMPLEMENTING_PREP',
//   fieldsChanged: [],
//   message: 'S3 complete: Already in IMPLEMENTING_PREP (no-op)'
// }
```

## Testing Requirements

All implementations must pass the following test scenarios:

1. **Success**: SPEC_READY → IMPLEMENTING_PREP in execute mode
2. **Dry-Run**: SPEC_READY → IMPLEMENTING_PREP in dry-run mode (no DB update)
3. **Idempotent**: IMPLEMENTING_PREP → IMPLEMENTING_PREP (no-op)
4. **Blocked - Known State**: CREATED/DONE/HOLD → INVARIANT_VIOLATION
5. **Blocked - Unknown State**: INVALID_XYZ → UNKNOWN_STATE
6. **Timeline Logging**: Verify all cases log appropriate timeline events
7. **Error Handling**: Issue not found → throws error

## Version History

- **v1.0** (2026-01-23): Initial implementation (E9.1-CTRL-7)

## Related Contracts

- [Loop State Machine v1](./loop-state-machine.v1.md) - State machine with S1-S3 steps
- [Step Executor S1 v1](./step-executor-s1.v1.md) - S1 Pick/Link step
- [Step Executor S2 v1](./step-executor-s2.v1.md) - S2 Spec Gate step (if exists)
- [Loop API v1](./loop-api.v1.md) - Loop execution API

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- `control-center/src/lib/loop/stepExecutors/s3-implement-prep.ts`

Tests validating this contract:
- `control-center/__tests__/lib/loop/s3-implement-prep.test.ts`
