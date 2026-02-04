# Step Executor S5 Contract v1 (E9.3-CTRL-04)

**Contract ID:** `step-executor-s5.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-04  
**Created:** 2026-02-04

## Overview

The S5 (Merge) step executor implements controlled merge for AFU-9 issues. S5 ensures that PRs are only merged when the gate verdict is PASS, implementing fail-closed semantics with idempotent merge operations.

## Purpose

S5 serves as the controlled merge gate that:

1. **Validates** gate verdict from S4 (review + checks must pass)
2. **Executes** merge operation idempotently
3. **Prevents** direct GitHub merge bypass
4. **Records** merge evidence and audit trail

## Preconditions

Before S5 can execute:

- Issue must be in `REVIEW_READY` state (completed S4)
- PR must exist and be linked to the issue
- Gate verdict must be PASS (review approved + checks passed)
- No active lock on the issue

## Input Contract

### Database Schema Requirements

The executor expects the following issue data:

```typescript
interface IssueForS5 {
  id: string;                    // Issue UUID
  status: 'REVIEW_READY';        // Must be in this state
  github_url: string;            // GitHub issue URL
  pr_url: string;                // GitHub PR URL (required for merge)
}
```

### Step Executor Parameters

```typescript
interface ExecuteS5Params {
  issue: IssueForS5;
  runId: string;       // Loop run ID for traceability
  requestId: string;   // Request ID for correlation
  mode: 'execute' | 'dryRun';
}
```

## Execution Logic

### Step 1: PR Validation

- **Check PR exists**: Issue must have `pr_url` set
- **Check PR state**: PR must be open (not already merged, not closed)
- **Parse PR URL**: Extract owner, repo, and PR number

**Blocker codes** (if validation fails):
- `NO_PR_LINKED` - Issue has no PR URL
- `PR_NOT_FOUND` - PR does not exist on GitHub
- `PR_ALREADY_MERGED` - PR is already merged
- `PR_CLOSED` - PR is closed without merge

### Step 2: Gate Decision Check

Invoke S4 gate decision to validate readiness:

```typescript
const gateDecision = await makeS4GateDecision(pool, {
  owner,
  repo,
  prNumber,
  snapshotId: latestSnapshotId,  // Use latest checks snapshot
  requestId,
});
```

**Gate verdict rules:**
- PASS: Both review approved AND checks passed → Proceed to merge
- FAIL: Any blocker present → Block merge with explicit reason

**Blocker codes** (from gate decision):
- `NO_REVIEW_APPROVAL` - PR review not approved
- `CHANGES_REQUESTED` - PR review requested changes
- `CHECKS_PENDING` - Checks still pending
- `CHECKS_FAILED` - Checks failed
- `NO_CHECKS_FOUND` - No checks found (fail-closed)
- `SNAPSHOT_NOT_FOUND` - Checks snapshot not found

### Step 3: Idempotent Merge Execution

Execute merge only if gate verdict is PASS:

```typescript
// Check if already merged (idempotency)
const prDetails = await octokit.rest.pulls.get({
  owner,
  repo,
  pull_number: prNumber,
});

if (prDetails.data.merged) {
  // Already merged - idempotent success
  return idempotentMergeResult(prDetails.data.merge_commit_sha);
}

// Perform merge
const mergeResult = await octokit.rest.pulls.merge({
  owner,
  repo,
  pull_number: prNumber,
  merge_method: 'squash',  // Default method
});
```

**Idempotency guarantee:**
- If PR already merged → Return success with existing merge SHA
- If merge in progress → Return success (GitHub handles race conditions)
- Double merge attempts are safe and return same result

### Step 4: State Transition

Transition issue state:
- **From**: `REVIEW_READY`
- **To**: `DONE`

Record merge evidence:

```typescript
{
  event_type: 'loop_merged',
  event_data: {
    runId: string;
    step: 'S5_MERGE',
    stateBefore: 'REVIEW_READY',
    stateAfter: 'DONE',
    requestId: string;
    prUrl: string;
    mergeSha: string;
    mergeMethod: 'squash';
    gateVerdict: 'PASS';
    snapshotId?: string;
  }
}
```

## Output Contract

### Success Response

```typescript
interface S5ExecutionResult {
  success: true;
  runId: string;
  step: 'S5_MERGE';
  stateBefore: 'REVIEW_READY';
  stateAfter: 'DONE';
  mergeEvidence: {
    eventId: string;        // UUID of merge event
    prUrl: string;
    mergeSha: string;       // GitHub merge commit SHA
    mergeMethod: string;
    gateVerdict: 'PASS';
  };
  durationMs: number;
}
```

### Blocked Response

```typescript
interface S5BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S5_MERGE';
  stateBefore: 'REVIEW_READY';
  stateAfter: 'REVIEW_READY';  // State unchanged on block
  gateVerdict?: 'FAIL';
  gateBlockReason?: string;
}
```

## Block Reasons

### PR-Related Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `NO_PR_LINKED` | Issue has no PR URL | pr_url is null/empty |
| `PR_NOT_FOUND` | PR does not exist | GitHub API 404 |
| `PR_ALREADY_MERGED` | PR already merged | pr.merged = true (idempotent success) |
| `PR_CLOSED` | PR closed without merge | pr.state = 'closed' AND !pr.merged |

### Gate-Related Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `NO_REVIEW_APPROVAL` | Review not approved | Gate verdict = FAIL |
| `CHANGES_REQUESTED` | Changes requested | Gate verdict = FAIL |
| `CHECKS_PENDING` | Checks still pending | Gate verdict = FAIL |
| `CHECKS_FAILED` | Checks failed | Gate verdict = FAIL |
| `NO_CHECKS_FOUND` | No checks found | Gate verdict = FAIL |

### Other Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `MERGE_CONFLICT` | PR has merge conflict | GitHub merge API error |
| `MERGE_FAILED` | Merge operation failed | GitHub API error |

## Event Types

S5 emits the following timeline events:

| Event Type | When | Required Fields |
|------------|------|-----------------|
| `loop_merged` | PR successfully merged | runId, step, stateBefore, stateAfter, prUrl, mergeSha, requestId |
| `loop_step_s5_completed` | S5 completed successfully | runId, step, stateBefore, stateAfter, requestId |
| `loop_run_blocked` | S5 blocked (gate failed) | runId, step, stateBefore, blockerCode, requestId |

## Fail-Closed Semantics

**Critical**: S5 implements fail-closed merge gate:

1. **No implicit merge**: Merge only when gate verdict is PASS
2. **No silent bypass**: Cannot bypass gate decision check
3. **No manual merge**: Direct GitHub merge without control is prevented
4. **Audit trail**: All merge attempts are logged permanently

## Idempotency Guarantees

**Critical**: S5 merge operations are idempotent:

1. **Double merge safe**: If PR already merged, return success with existing SHA
2. **Concurrent requests**: Multiple merge requests for same PR converge to same result
3. **Deterministic outcome**: Same inputs → Same output
4. **No side effects on retry**: Retrying merge has no additional side effects

## State Machine Integration

### State Transition Rules

| Current State | Step | Next State | Condition |
|---------------|------|------------|-----------|
| `REVIEW_READY` | S5 | `DONE` | Gate PASS + Merge successful |
| `REVIEW_READY` | S5 | `REVIEW_READY` | Gate FAIL (blocked) |
| Any other state | S5 | Blocked | Invalid state for S5 |

### Blocker Handling

When S5 is blocked:
1. Issue state remains `REVIEW_READY`
2. Explicit blocker code and message returned
3. Timeline event records block reason
4. No state transition occurs

## Integration Points

### S4 Gate Decision

S5 relies on S4 gate decision service:

```typescript
import { makeS4GateDecision } from '../s4-gate-decision';

// In executeS5 function
const gateDecision = await makeS4GateDecision(pool, {
  owner,
  repo,
  prNumber,
  snapshotId,
  requestId,
});

if (gateDecision.verdict === 'FAIL') {
  // Block merge
  return blockedResult(gateDecision.blockReason, gateDecision.blockMessage);
}

// Proceed with merge
```

### Checks Mirror Service

S5 may optionally capture fresh snapshot before merge:

```typescript
// Optional: Capture fresh snapshot immediately before merge
const snapshotResult = await captureSnapshotForPR(pool, {
  owner,
  repo,
  prNumber,
  gate_step: 'S5',
});
```

## Determinism Guarantees

The S5 merge operation is **deterministic**:

1. **Same inputs → Same output**: Given same PR state + gate verdict, always returns same result
2. **Idempotent merge**: Multiple merge attempts converge to same merge SHA
3. **Stable gate logic**: Gate decision is deterministic (from S4 contract)
4. **No time dependencies**: Decision based on explicit data, not timing

## Error Handling

### Transient Errors

- GitHub API rate limit → Retry with backoff OR fail with `MERGE_FAILED`
- Network timeout → Retry OR fail with `MERGE_FAILED`
- DB connection lost → Retry OR fail with `MERGE_FAILED`

### Permanent Errors

- PR not found → Fail with `PR_NOT_FOUND`
- PR closed → Fail with `PR_CLOSED`
- Merge conflict → Fail with `MERGE_CONFLICT`
- Auth failure → Fail with `MERGE_FAILED`

All errors result in **explicit blocker code** (fail-closed).

## Testing

### Unit Tests

Required test cases:

1. **Success conditions:**
   - Gate PASS + PR open → Merge succeeds
   - PR already merged → Idempotent success

2. **Gate FAIL conditions:**
   - Review not approved → Blocked with NO_REVIEW_APPROVAL
   - Checks failed → Blocked with CHECKS_FAILED
   - Checks pending → Blocked with CHECKS_PENDING

3. **PR FAIL conditions:**
   - No PR linked → Blocked with NO_PR_LINKED
   - PR not found → Blocked with PR_NOT_FOUND
   - PR closed → Blocked with PR_CLOSED

4. **Error conditions:**
   - Merge conflict → Blocked with MERGE_CONFLICT
   - GitHub API error → Blocked with MERGE_FAILED

### Integration Tests

1. Full S5 merge flow with real gate decision
2. Idempotency: Multiple merge attempts return same result
3. Gate decision integration: S4 gate verdict controls merge
4. State transition: REVIEW_READY → DONE on success

## Acceptance Criteria

1. ✅ **Merge only on PASS**
   - S5 blocks merge when gate verdict is FAIL
   - S5 executes merge only when gate verdict is PASS

2. ✅ **Idempotent merge attempts**
   - Double merge attempts are safe
   - Already-merged PR returns success with existing SHA
   - No side effects on retry

3. ✅ **No bypass**
   - Direct GitHub merge without control is prevented
   - All merges go through S5 gate
   - Explicit audit trail for all merge attempts

4. ✅ **Explicit block reasons**
   - All FAIL verdicts have explicit blockerCode
   - All FAIL verdicts have blockerMessage
   - No silent failures

## Version History

- **v1.0** (2026-02-04): Initial S5 Merge implementation (E9.3-CTRL-04)

## Related Contracts

- [S4 Gate Decision v1](./s4-gate-decision.v1.md) - Gate verdict logic
- [Step Executor S4 v1](./step-executor-s4.v1.md) - S4 Review Gate
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic
- [Checks Mirror Contract](./checks-mirror-contract.md) - Checks snapshot

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/step-executor-s5.v1.md` (this file)
- Service: `control-center/src/lib/loop/stepExecutors/s5-merge.ts`
- API: `control-center/app/api/afu9/issues/[id]/merge/route.ts`
- Tests: `control-center/__tests__/lib/loop/s5-merge.test.ts`
