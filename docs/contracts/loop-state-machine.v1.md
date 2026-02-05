# Loop State Machine v1 Contract (E9.1-CTRL-4, E9.3-CTRL-06, E9.3-CTRL-07)

**Version:** v1.2  
**Status:** Active  
**Issue:** E9.1-CTRL-4, E9.3-CTRL-06, E9.3-CTRL-07  

## Overview

The Loop State Machine v1 provides deterministic, fail-closed state resolution for AFU-9 issue lifecycle management. It implements steps S1-S9 with explicit blocker codes instead of ambiguous "unknown" errors.

## States

The state machine operates on the following issue states:

- **CREATED** - Initial state, issue created but no work started
- **SPEC_READY** - Specification is complete and validated
- **IMPLEMENTING_PREP** - Ready for implementation
- **REVIEW_READY** - Ready for review (after S4 gate)
- **HOLD** - Terminal state, work paused (requires manual intervention)
- **DONE** - Work completed, awaiting verification
- **VERIFIED** - Deployment verified (after S7 GREEN verdict)
- **CLOSED** - Immutable terminal state, issue successfully closed (after S8)

## Steps

The state machine defines nine execution steps:

- **S1: Pick Issue** - Initial step to select and prepare an issue
- **S2: Spec Ready** - Validate and finalize specification
- **S3: Implement Prep** - Prepare for implementation
- **S4: Review Gate** - Code review gate
- **S5: Merge** - Merge approved PR
- **S6: Deployment Observe** - Observe deployment
- **S7: Verify Gate** - Explicit verification of deployment success (E9.3-CTRL-06)
- **S8: Close** - Close verified issue immutably (GREEN path, E9.3-CTRL-07)
- **S9: Remediate** - Place issue on HOLD with explicit reason (RED path, E9.3-CTRL-07)

## Blocker Codes

When progression is blocked, the state machine returns explicit codes:

| Code | Description |
|------|-------------|
| `NO_GITHUB_LINK` | Issue must be linked to a GitHub issue |
| `NO_DRAFT` | Specification draft must be created |
| `NO_COMMITTED_DRAFT` | Draft must be committed and versioned |
| `DRAFT_INVALID` | Draft validation failed |
| `LOCKED` | Issue is locked by another process |
| `UNKNOWN_STATE` | Issue is in an unknown or invalid state |
| `INVARIANT_VIOLATION` | State machine invariant violated |
| `NO_EVIDENCE` | No evidence provided for S7 verification |
| `INVALID_EVIDENCE` | Evidence schema invalid for S7 |
| `STALE_EVIDENCE` | Evidence too old for S7 |
| `NO_DEPLOYMENT_OBSERVATIONS` | No S6 observations found for S7 |
| `NOT_VERIFIED` | Issue must be in VERIFIED state for S8 |
| `NO_GREEN_VERDICT` | No GREEN verdict found for S8 |
| `INVALID_STATE_FOR_HOLD` | Current state doesn't allow HOLD transition |
| `NO_REMEDIATION_REASON` | Remediation reason required for S9 |
| `ALREADY_ON_HOLD` | Issue is already on HOLD |

## State Transitions

Valid state transitions:

```
CREATED → SPEC_READY → IMPLEMENTING_PREP → REVIEW_READY → DONE → VERIFIED → CLOSED
   ↓           ↓              ↓                ↓           ↓         ↓
  HOLD        HOLD           HOLD             HOLD        HOLD      HOLD (S9)
```

Terminal states:
- **CLOSED** - Immutable, no transitions allowed (S8 only)
- **HOLD** - Requires manual intervention to exit (S9 records remediation)

## Resolution Rules

### S1 (Pick Issue)

**Preconditions:**
- Issue state: `CREATED`
- GitHub URL: must be present and non-empty

**Blockers:**
- `NO_GITHUB_LINK` - if `github_url` is null or empty

**Next State:** Can transition to `SPEC_READY` after S2

### S2 (Spec Ready)

**Preconditions:**
- Issue state: `CREATED`, `DRAFT_READY`, or `VERSION_COMMITTED`
- Draft: must exist (`current_draft_id` or `draft` parameter)
- Draft validation: must be `valid`
- Draft committed: `handoff_state` must be `SYNCED` or `SYNCHRONIZED`, OR `last_validation_status` must be `valid`

**Blockers:**
- `NO_DRAFT` - if no draft exists
- `NO_COMMITTED_DRAFT` - if draft is not committed/validated
- `DRAFT_INVALID` - if draft validation failed

**Next State:** Transitions to `SPEC_READY`

### S3 (Implement Prep)

**Preconditions:**
- Issue state: `SPEC_READY`

**Blockers:** None (if preconditions met)

**Next State:** Transitions to `IMPLEMENTING_PREP`

### S7 (Verify Gate)

**Preconditions:**
- Issue state: `DONE`
- Evidence: Must be provided with deployment observations

**Blockers:**
- `NO_EVIDENCE` - if no evidence provided
- `INVALID_EVIDENCE` - if evidence schema invalid
- `STALE_EVIDENCE` - if evidence too old
- `NO_DEPLOYMENT_OBSERVATIONS` - if no S6 observations found

**Next State:** Transitions to `VERIFIED` (GREEN) or `HOLD` (RED)

### S8 (Close)

**Preconditions:**
- Issue state: `VERIFIED`
- S7 verdict: Must be GREEN
- No active locks

**Blockers:**
- `NOT_VERIFIED` - if issue is not in VERIFIED state
- `NO_GREEN_VERDICT` - if no GREEN verdict from S7

**Next State:** Transitions to `CLOSED` (immutable, terminal)

### S9 (Remediate)

**Preconditions:**
- Issue state: Any state except CLOSED
- Remediation reason: Must be provided and non-empty
- No active locks

**Blockers:**
- `INVALID_STATE_FOR_HOLD` - if state doesn't allow HOLD (e.g., CLOSED)
- `NO_REMEDIATION_REASON` - if remediation reason is empty
- `ALREADY_ON_HOLD` - informational, creates new remediation record

**Next State:** Transitions to `HOLD` (requires manual intervention to exit)

## API: resolveNextStep

**Signature:**
```typescript
function resolveNextStep(
  issue: IssueData,
  draft?: DraftData | null
): StepResolution
```

**Input Types:**

```typescript
interface IssueData {
  id: string;
  status: string;
  github_url?: string | null;
  current_draft_id?: string | null;
  handoff_state?: string | null;
}

interface DraftData {
  id: string;
  last_validation_status?: string | null;
  issue_json?: unknown;
}
```

**Output Type:**

```typescript
interface StepResolution {
  step: LoopStep | null;
  blocked: boolean;
  blockerCode?: BlockerCode;
  blockerMessage?: string;
}
```

**Guarantees:**

1. **Deterministic**: Same inputs always produce same outputs
2. **Pure**: No side effects, does not modify inputs
3. **Total**: Always returns a valid result (never throws)
4. **Fail-Closed**: Returns explicit blocker codes instead of "unknown"

## Examples

### Example 1: CREATED state with GitHub link

```typescript
const issue = {
  id: 'AFU9-123',
  status: 'CREATED',
  github_url: 'https://github.com/org/repo/issues/123'
};

const result = resolveNextStep(issue);
// {
//   step: 'S1_PICK_ISSUE',
//   blocked: false
// }
```

### Example 2: CREATED state without GitHub link

```typescript
const issue = {
  id: 'AFU9-123',
  status: 'CREATED',
  github_url: null
};

const result = resolveNextStep(issue);
// {
//   step: null,
//   blocked: true,
//   blockerCode: 'NO_GITHUB_LINK',
//   blockerMessage: 'S1 (Pick Issue) requires GitHub issue link'
// }
```

### Example 3: Draft validation failed

```typescript
const issue = {
  id: 'AFU9-123',
  status: 'CREATED',
  github_url: 'https://github.com/org/repo/issues/123',
  current_draft_id: 'draft-123',
  handoff_state: 'SYNCED'
};

const draft = {
  id: 'draft-123',
  last_validation_status: 'invalid'
};

const result = resolveNextStep(issue, draft);
// {
//   step: null,
//   blocked: true,
//   blockerCode: 'DRAFT_INVALID',
//   blockerMessage: 'Draft validation failed, cannot proceed to S2'
// }
```

### Example 4: Valid spec ready for S2

```typescript
const issue = {
  id: 'AFU9-123',
  status: 'CREATED',
  github_url: 'https://github.com/org/repo/issues/123',
  current_draft_id: 'draft-123',
  handoff_state: 'SYNCED'
};

const draft = {
  id: 'draft-123',
  last_validation_status: 'valid',
  issue_json: { title: 'Implement feature X' }
};

const result = resolveNextStep(issue, draft);
// {
//   step: 'S2_SPEC_READY',
//   blocked: false
// }
```

### Example 5: Terminal state

```typescript
const issue = {
  id: 'AFU9-123',
  status: 'DONE',
  github_url: 'https://github.com/org/repo/issues/123'
};

const result = resolveNextStep(issue);
// {
//   step: null,
//   blocked: false,
//   blockerMessage: 'Issue is in terminal state: DONE'
// }
```

## Validation Contract

### Test Cases

All implementations must pass the following test cases:

1. **S1 Available**: CREATED + GitHub link → S1_PICK_ISSUE
2. **S1 Blocked**: CREATED + no GitHub link → NO_GITHUB_LINK
3. **S2 Available**: CREATED + valid draft → S2_SPEC_READY
4. **S2 Blocked - No Draft**: CREATED + no draft → NO_DRAFT
5. **S2 Blocked - Not Committed**: CREATED + draft not committed → NO_COMMITTED_DRAFT
6. **S2 Blocked - Invalid**: CREATED + invalid draft → DRAFT_INVALID
7. **S3 Available**: SPEC_READY → S3_IMPLEMENT_PREP
8. **Terminal State**: DONE/HOLD → no next step
9. **Unknown State**: Invalid status → UNKNOWN_STATE

## Integration

The state machine resolver is a pure function and can be:

1. Called from Loop execution logic to determine next step
2. Used in API endpoints to check if actions are allowed
3. Integrated with UI to show/hide action buttons
4. Used in validation before state transitions

## Version History

- **v1.2** (2026-02-05): Added S8 Close and S9 Remediate steps, CLOSED state (E9.3-CTRL-07)
- **v1.1** (2026-02-05): Added S7 Verify Gate step and VERIFIED state (E9.3-CTRL-06)
- **v1.0** (2026-01-21): Initial implementation with S1-S3 steps and explicit blocker codes (E9.1-CTRL-4)

## Related Contracts

- [Loop API v1](./loop-api.v1.md) - Loop execution API
- [Step Executor S8 v1](./step-executor-s8.v1.md) - S8 Close step
- [Step Executor S9 v1](./step-executor-s9.v1.md) - S9 Remediate step
- [AFU-9 Issue Lifecycle](./afu9-issue-lifecycle.md) - Overall issue lifecycle

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- `control-center/src/lib/loop/stateMachine.ts`

Tests validating this contract:
- `control-center/__tests__/lib/loop/stateMachine.test.ts`
