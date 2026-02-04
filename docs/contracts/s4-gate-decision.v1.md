# S4 Gate Decision Contract v1 (E9.3-CTRL-03)

**Contract ID:** `s4-gate-decision.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-03  
**Created:** 2026-02-04

## Overview

The S4 Gate Decision implements the combined Review + Checks gate logic for determining whether a PR can proceed from Review Gate (S4) to Merge (S5). It provides deterministic PASS/FAIL verdicts with explicit block reasons.

## Purpose

S4 Gate Decision serves as the deterministic arbiter for review readiness:

1. **Combines** review approval status + checks snapshot status
2. **Produces** deterministic PASS/FAIL verdict
3. **Provides** explicit block reasons for all failures
4. **Enforces** fail-closed semantics (both must pass for gate to pass)

## Preconditions

Before S4 Gate Decision can execute:

- PR must exist in GitHub
- Checks snapshot should be captured (optional but recommended)
- Review process should be initiated

## Input Contract

### S4 Gate Decision Input

```typescript
interface S4GateDecisionInput {
  owner: string;          // Repository owner
  repo: string;           // Repository name
  prNumber: number;       // Pull request number
  snapshotId?: string;    // Optional: checks snapshot ID
  requestId?: string;     // Optional: request ID for tracing
}
```

## Gate Decision Logic

### Combined Verdict Rules

The gate decision is **fail-closed**. PASS only when:

1. **Review Status** = `APPROVED`
2. **Checks Status** = `PASS`

FAIL when ANY of:
- Review not approved
- Review requests changes
- Checks pending
- Checks failed
- No checks found (fail-closed)
- Snapshot not found

### Review Approval Status

```typescript
type ReviewApprovalStatus = 
  | 'APPROVED'              // At least one approval, no changes requested
  | 'NOT_APPROVED'          // No approvals found
  | 'CHANGES_REQUESTED';    // At least one review requests changes
```

**Algorithm:**
1. Fetch all PR reviews from GitHub
2. Group by user, take latest review per user
3. Check for `CHANGES_REQUESTED` (highest priority)
4. Check for `APPROVED` (second priority)
5. Default to `NOT_APPROVED`

### Checks Status

```typescript
type ChecksStatus = 'PASS' | 'FAIL';
```

**Algorithm:**
1. If no snapshot provided → FAIL (fail-closed)
2. If snapshot not found → FAIL
3. Use `getGateDecision()` from checks snapshot contract:
   - Pending checks > 0 → FAIL
   - Failed checks > 0 → FAIL
   - Total checks = 0 → FAIL (fail-closed)
   - All checks passed → PASS

## Output Contract

### S4 Gate Decision Result

```typescript
interface S4GateDecisionResult {
  verdict: 'PASS' | 'FAIL';
  blockReason?: S4BlockReason;
  blockMessage?: string;
  reviewStatus: ReviewApprovalStatus;
  checksStatus: 'PASS' | 'FAIL';
  snapshot?: ChecksSnapshotRow;
}
```

### Success Response (PASS)

```typescript
{
  verdict: 'PASS',
  reviewStatus: 'APPROVED',
  checksStatus: 'PASS',
  snapshot: { /* ChecksSnapshotRow */ }
}
```

### Blocked Response (FAIL)

```typescript
{
  verdict: 'FAIL',
  blockReason: 'NO_REVIEW_APPROVAL',
  blockMessage: 'PR review not approved',
  reviewStatus: 'NOT_APPROVED',
  checksStatus: 'PASS',
  snapshot: { /* ChecksSnapshotRow */ }
}
```

## Block Reasons

### Review-Related Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `NO_REVIEW_APPROVAL` | PR review not approved | reviewStatus = 'NOT_APPROVED' |
| `CHANGES_REQUESTED` | PR review requested changes | reviewStatus = 'CHANGES_REQUESTED' |

### Check-Related Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `CHECKS_PENDING` | Checks still pending | snapshot.pending_checks > 0 |
| `CHECKS_FAILED` | Checks failed | snapshot.failed_checks > 0 |
| `NO_CHECKS_FOUND` | No checks found (fail-closed) | snapshot.total_checks = 0 OR no snapshot |

### Snapshot-Related Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `SNAPSHOT_NOT_FOUND` | Checks snapshot not found | Snapshot ID provided but not in DB |
| `SNAPSHOT_FETCH_FAILED` | Failed to fetch snapshot | Database error |

### PR-Related Blocks

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `PR_FETCH_FAILED` | Failed to fetch PR review status | GitHub API error |

## Fail-Closed Semantics

**Critical**: S4 Gate Decision implements fail-closed semantics:

1. **No implicit pass**: Both review AND checks must explicitly pass
2. **No silent failures**: All failures result in explicit block reason
3. **No missing data**: Missing snapshot = FAIL
4. **No errors ignored**: API errors = FAIL

## Decision Matrix

| Review Status | Checks Status | Verdict | Block Reason |
|---------------|---------------|---------|--------------|
| APPROVED | PASS | **PASS** | - |
| APPROVED | FAIL (pending) | FAIL | CHECKS_PENDING |
| APPROVED | FAIL (failed) | FAIL | CHECKS_FAILED |
| APPROVED | FAIL (no checks) | FAIL | NO_CHECKS_FOUND |
| NOT_APPROVED | PASS | FAIL | NO_REVIEW_APPROVAL |
| NOT_APPROVED | FAIL | FAIL | NO_REVIEW_APPROVAL |
| CHANGES_REQUESTED | PASS | FAIL | CHANGES_REQUESTED |
| CHANGES_REQUESTED | FAIL | FAIL | CHANGES_REQUESTED |

## Integration Points

### S4 Step Executor

The S4 step executor uses gate decision before state transition:

```typescript
import { makeS4GateDecision } from './s4-gate-decision';

// In executeS4 function
const gateDecision = await makeS4GateDecision(pool, {
  owner,
  repo,
  prNumber,
  snapshotId: capturedSnapshotId,
  requestId: ctx.requestId,
});

if (gateDecision.verdict === 'FAIL') {
  // Block state transition
  return {
    success: false,
    blocked: true,
    blockerCode: gateDecision.blockReason,
    blockerMessage: gateDecision.blockMessage,
    stateBefore,
    stateAfter: stateBefore,
    fieldsChanged: [],
    message: gateDecision.blockMessage,
  };
}

// Proceed with state transition
```

### Checks Mirror Service

Gate decision relies on checks snapshot:

```typescript
// Before gate decision
const snapshotResult = await captureChecksSnapshot(pool, {
  repo_owner: owner,
  repo_name: repo,
  ref: prHeadSha,
  run_id: ctx.runId,
  issue_id: ctx.issueId,
  request_id: ctx.requestId,
});

const snapshotId = snapshotResult.snapshot?.id;
```

## Determinism Guarantees

The gate decision is **deterministic**:

1. **Same inputs → Same output**: Given same review state + checks snapshot, always returns same verdict
2. **Idempotent snapshots**: Checks snapshot hash ensures identical checks = identical snapshot
3. **Stable review logic**: Latest review per user ensures consistent review status
4. **No time dependencies**: Decision based on explicit data, not timing

## Error Handling

### Transient Errors

- GitHub API rate limit → Fail with `PR_FETCH_FAILED`
- Network timeout → Fail with `PR_FETCH_FAILED`
- DB connection lost → Fail with `SNAPSHOT_FETCH_FAILED`

All transient errors result in **FAIL verdict** (fail-closed).

### Permanent Errors

- PR not found → Fail with `PR_FETCH_FAILED`
- Snapshot not found → Fail with `SNAPSHOT_NOT_FOUND`
- Auth failure → Fail with `PR_FETCH_FAILED`

## Testing

### Unit Tests

Required test cases:

1. **PASS conditions:**
   - Review approved + Checks passed → PASS

2. **Review FAIL conditions:**
   - Review not approved → FAIL with NO_REVIEW_APPROVAL
   - Changes requested → FAIL with CHANGES_REQUESTED

3. **Checks FAIL conditions:**
   - Checks pending → FAIL with CHECKS_PENDING
   - Checks failed → FAIL with CHECKS_FAILED
   - No checks found → FAIL with NO_CHECKS_FOUND

4. **Snapshot FAIL conditions:**
   - No snapshot provided → FAIL with NO_CHECKS_FOUND
   - Snapshot not found → FAIL with SNAPSHOT_NOT_FOUND

5. **Error conditions:**
   - PR fetch fails → FAIL with PR_FETCH_FAILED

### Integration Tests

1. Full S4 gate decision flow with real snapshot
2. Gate decision determinism (same inputs → same verdict)
3. Review status calculation with multiple reviewers

## Acceptance Criteria

1. ✅ **Merge without PASS not possible**
   - Gate decision blocks state transition on FAIL
   - S4 executor respects gate verdict

2. ✅ **Block-Reason is explicit**
   - All FAIL verdicts have explicit blockReason
   - All FAIL verdicts have blockMessage
   - No silent failures

3. ✅ **Deterministic verdict**
   - Same inputs → Same output
   - No time-based decisions
   - Idempotent checks snapshot

## Version History

- **v1.0** (2026-02-04): Initial S4 Gate Decision implementation (E9.3-CTRL-03)

## Related Contracts

- [Step Executor S4 v1](./step-executor-s4.v1.md) - S4 Review Gate step
- [Checks Mirror Contract](./checks-mirror-contract.md) - Checks snapshot
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/s4-gate-decision.v1.md` (this file)
- Service: `control-center/src/lib/loop/s4-gate-decision.ts`
- Tests: `control-center/__tests__/lib/loop/s4-gate-decision.test.ts`
