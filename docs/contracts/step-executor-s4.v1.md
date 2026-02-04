# Step Executor S4 Contract v1 (E9.3-CTRL-01)

**Contract ID:** `step-executor-s4.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-01  
**Created:** 2026-02-04

## Overview

The S4 (Review Gate) step executor implements the explicit review request gate in the AFU-9 loop. S4 ensures that code review is explicitly requested before proceeding to merge, implementing fail-closed semantics where no implicit entry is allowed.

## Purpose

S4 serves as a mandatory gate between implementation (S3) and merge (S5). The step:

1. **Validates** that the issue is ready for review (PR exists, checks are running/complete)
2. **Requests** explicit review from designated reviewers
3. **Records** review-intent as a persistent event
4. **Blocks** implicit progression to S5 without explicit review request

## Preconditions

Before S4 can execute:

- Issue must be in `IMPLEMENTING_PREP` state (completed S3)
- PR must exist and be linked to the issue
- No active lock on the issue

## Input Contract

### Database Schema Requirements

The executor expects the following issue data:

```typescript
interface IssueForS4 {
  id: string;                    // Issue UUID
  status: 'IMPLEMENTING_PREP';   // Must be in this state
  github_url: string;            // GitHub issue URL
  pr_url?: string | null;        // GitHub PR URL (if linked)
}
```

### Step Executor Parameters

```typescript
interface ExecuteS4Params {
  issue: IssueForS4;
  runId: string;       // Loop run ID for traceability
  requestId: string;   // Request ID for correlation
  mode: 'execute' | 'dryRun';
}
```

## Execution Logic

### Step 1: Validation

- **Check PR exists**: Issue must have `pr_url` set
- **Check PR state**: PR must be open (not merged, not closed)
- **Check GitHub link**: `github_url` must be present

**Blocker codes** (if validation fails):
- `NO_PR_LINKED` - Issue has no PR URL
- `PR_NOT_FOUND` - PR does not exist on GitHub
- `PR_CLOSED` - PR is closed or merged
- `NO_GITHUB_LINK` - Issue has no GitHub URL

### Step 2: Review Intent Recording

Record explicit review-intent event:

```typescript
{
  event_type: 'loop_review_requested',
  event_data: {
    runId: string;
    step: 'S4_REVIEW',
    stateBefore: 'IMPLEMENTING_PREP',
    requestId: string;
    prUrl: string;
    reviewers?: string[];  // Optional list of reviewers
  }
}
```

### Step 3: State Transition

Transition issue state:
- **From**: `IMPLEMENTING_PREP`
- **To**: `REVIEW_READY`

The state transition creates audit trail and timeline event.

## Output Contract

### Success Response

```typescript
interface S4ExecutionResult {
  success: true;
  runId: string;
  step: 'S4_REVIEW';
  stateBefore: 'IMPLEMENTING_PREP';
  stateAfter: 'REVIEW_READY';
  reviewIntent: {
    eventId: string;        // UUID of review-intent event
    prUrl: string;
    reviewers?: string[];
  };
  durationMs: number;
}
```

### Blocked Response

```typescript
interface S4BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S4_REVIEW';
  stateBefore: 'IMPLEMENTING_PREP';
}
```

## Event Types

S4 emits the following timeline events:

| Event Type | When | Required Fields |
|------------|------|-----------------|
| `loop_review_requested` | Review explicitly requested | runId, step, stateBefore, prUrl, requestId |
| `loop_step_s4_completed` | S4 completed successfully | runId, step, stateBefore, stateAfter, requestId |
| `loop_run_blocked` | S4 blocked (validation failed) | runId, step, stateBefore, blockerCode, requestId |

## Fail-Closed Semantics

**Critical**: S4 implements fail-closed entry to review gate:

1. **No implicit review**: Review must be explicitly requested via S4
2. **No silent bypass**: Cannot skip S4 and go directly to S5
3. **Evidence required**: Review-intent event must exist before S5 entry
4. **Audit trail**: All review requests are logged permanently

## State Machine Integration

S4 extends the state machine with a new step:

```typescript
enum LoopStep {
  S1_PICK_ISSUE = 'S1_PICK_ISSUE',
  S2_SPEC_READY = 'S2_SPEC_READY',
  S3_IMPLEMENT_PREP = 'S3_IMPLEMENT_PREP',
  S4_REVIEW = 'S4_REVIEW',  // NEW
}

enum IssueState {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',
  IMPLEMENTING_PREP = 'IMPLEMENTING_PREP',
  REVIEW_READY = 'REVIEW_READY',  // NEW
  HOLD = 'HOLD',
  DONE = 'DONE',
}
```

### State Transition Rules

```
IMPLEMENTING_PREP → S4_REVIEW → REVIEW_READY
```

Valid transitions:
- `IMPLEMENTING_PREP` → `REVIEW_READY` (via S4)
- `IMPLEMENTING_PREP` → `HOLD` (cancel/pause)

## Database Schema

### New Issue State

Migration required to add `REVIEW_READY` to issue status enum:

```sql
-- Migration: 089_add_review_ready_state.sql
ALTER TYPE issue_status ADD VALUE IF NOT EXISTS 'REVIEW_READY';
```

### Review Intent Events

Stored in `loop_events` table (existing schema):

```sql
INSERT INTO loop_events (
  issue_id,
  run_id,
  event_type,
  event_data,
  occurred_at
) VALUES (
  $1,  -- issue_id
  $2,  -- run_id
  'loop_review_requested',
  $3,  -- event_data (JSONB)
  NOW()
);
```

## Integration Points

### Loop Execution Engine

The loop execution engine integrates S4:

```typescript
// In execution.ts
import { executeS4 } from './stepExecutors/s4-review-gate';

// ... in runNextStep function
if (nextStep === LoopStep.S4_REVIEW) {
  result = await executeS4({
    issue,
    runId,
    requestId,
    mode,
  });
}
```

### State Machine Resolver

```typescript
// In stateMachine.ts
export function resolveNextStep(
  issue: IssueData,
  draft?: DraftData | null
): StepResolution {
  // ... existing logic ...
  
  // State: IMPLEMENTING_PREP → Check for S4 (Review Gate)
  if (status === IssueState.IMPLEMENTING_PREP) {
    return {
      step: LoopStep.S4_REVIEW,
      blocked: false,
    };
  }
  
  // ... rest of logic ...
}
```

## Acceptance Criteria

1. ✅ **S4 only starts after explicit request**
   - S4 step executor exists and is callable
   - No automatic progression from S3 to S5

2. ✅ **Review-Intent visible in Control-Log**
   - `loop_review_requested` event is persisted
   - Event is queryable via `/api/loop/issues/[issueId]/events`
   - Event contains: runId, step, prUrl, requestId

3. ✅ **Fail-closed enforcement**
   - S4 blocks if PR not found
   - S4 blocks if PR is closed/merged
   - State machine prevents skipping S4

## Error Handling

### Transient Errors

- GitHub API rate limit → Retry with backoff
- Network timeout → Retry up to 3 times
- DB connection lost → Retry with backoff

### Permanent Errors

- PR not found → Block with `PR_NOT_FOUND`
- PR closed → Block with `PR_CLOSED`
- No PR linked → Block with `NO_PR_LINKED`
- Auth failure → Block with `GITHUB_AUTH_FAILED`

All errors result in **blocked status** (fail-closed).

## Testing

### Unit Tests

Required test cases:

1. S4 available when issue in `IMPLEMENTING_PREP` state
2. S4 blocked when no PR linked
3. S4 blocked when PR not found
4. S4 blocked when PR is closed
5. S4 creates `loop_review_requested` event
6. S4 transitions state to `REVIEW_READY`
7. Dry-run mode does not modify state

### Integration Tests

1. Full S1 → S2 → S3 → S4 flow
2. Event persistence and queryability
3. State machine transition validation

## Version History

- **v1.0** (2026-02-04): Initial S4 Review Gate implementation (E9.3-CTRL-01)

## Related Contracts

- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic
- [Loop Timeline Events v1](./loop-timeline-events.v1.md) - Event persistence
- [Loop API v1](./loop-api.v1.md) - Loop execution API
- [Checks Mirror Contract](./checks-mirror-contract.md) - Check status snapshots

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/step-executor-s4.v1.md` (this file)
- Executor: `control-center/src/lib/loop/stepExecutors/s4-review-gate.ts`
- State Machine: `control-center/src/lib/loop/stateMachine.ts`
- Tests: `control-center/__tests__/lib/loop/stepExecutors/s4-review-gate.test.ts`
