# AFU9 State Model v1

**Version:** 1.0  
**Date:** 2026-01-04  
**Status:** Canonical

## Overview

This document defines the canonical AFU9 issue state model, including all state dimensions, enums, precedence rules, mapping tables, and UI display rules. This model is the single source of truth for how issue state is represented, computed, and displayed across the AFU9 system.

## State Dimensions

AFU9 issues have multiple orthogonal state dimensions that together determine the effective status displayed to users:

### 1. LocalStatus (AFU9 Workflow)

The canonical AFU9 workflow state, representing the issue's position in the AFU9 autonomous workflow.

**Enum Values:**
- `CREATED` - Issue created, awaiting specification
- `SPEC_READY` - Specification complete, ready for implementation
- `IMPLEMENTING` - Actively being implemented by AFU9
- `VERIFIED` - Implementation complete and verified
- `MERGE_READY` - Ready to be merged to main branch
- `DONE` - Successfully completed and merged
- `HOLD` - Temporarily paused or blocked
- `KILLED` - Permanently cancelled or abandoned

**Characteristics:**
- Drives AFU9 autonomous behavior and workflow transitions
- Set by AFU9 workflow engine or manual intervention
- Primary source for workflow decisions

### 2. GithubMirrorStatus (GitHub Mirror)

The status of the corresponding GitHub issue, mirrored from GitHub Projects, labels, or issue state.

**Enum Values:**
- `TODO` - Not yet started (from GitHub "To Do", "Backlog", etc.)
- `IN_PROGRESS` - Actively being worked on (from GitHub "In Progress", "Implementing", etc.)
- `IN_REVIEW` - Under review (from GitHub "In Review", "Review", etc.)
- `DONE` - Completed (from GitHub "Done", "Completed", etc.)
- `BLOCKED` - Blocked or on hold (from GitHub "Blocked", "Hold", "Waiting", etc.)
- `UNKNOWN` - No GitHub status available or unmapped

**Characteristics:**
- Read-only mirror from GitHub
- Updated via GitHub sync operations
- May be `UNKNOWN` if issue not synced to GitHub or status cannot be determined

### 3. ExecutionState (Runs/Playbooks)

The current execution state of any running playbooks or automation for this issue.

**Enum Values:**
- `IDLE` - No execution in progress
- `RUNNING` - Playbook or automation currently executing
- `FAILED` - Last execution failed
- `SUCCEEDED` - Last execution succeeded

**Characteristics:**
- Reflects real-time execution status
- Independent of workflow state
- Transitions: IDLE → RUNNING → (FAILED|SUCCEEDED) → IDLE

### 4. HandoffState (AFU9↔GitHub Link)

The synchronization state between AFU9 and GitHub.

**Enum Values:**
- `UNSYNCED` - Not synchronized with GitHub (issue not sent or sync failed)
- `SYNCED` - Successfully synchronized with GitHub

**Characteristics:**
- Tracks bidirectional sync health
- `UNSYNCED` can indicate either not yet sent to GitHub or sync failure
- `SYNCED` means AFU9 and GitHub are consistent

### 5. EffectiveStatus (Primary UI Status)

The computed status shown to users in the UI. This is **derived** from the other dimensions using the precedence rules.

**Characteristics:**
- Never stored directly (always computed)
- Single source of truth for UI display
- Deterministic based on precedence rules

## Precedence Rules v1

The effective status is computed deterministically using the following precedence:

```typescript
function computeEffectiveStatus(
  localStatus: LocalStatus,
  githubMirrorStatus: GithubMirrorStatus,
  executionState: ExecutionState
): LocalStatus {
  // Rule 1: If execution is actively running, show local AFU9 status
  // Rationale: AFU9 is actively working, local state is most accurate
  if (executionState === 'RUNNING') {
    return localStatus;
  }
  
  // Rule 2: If GitHub has known status, map and use it
  // Rationale: When not executing, GitHub is source of truth for external coordination
  if (githubMirrorStatus !== 'UNKNOWN') {
    return mapGithubToEffective(githubMirrorStatus);
  }
  
  // Rule 3: Fall back to local AFU9 status
  // Rationale: No GitHub status available, use AFU9's internal state
  return localStatus;
}
```

### Precedence Rationale

1. **Execution State Takes Precedence When Running**: When AFU9 is actively executing (ExecutionState = RUNNING), the local AFU9 status is the most current and accurate representation of work in progress.

2. **GitHub Status When Available**: When not executing, GitHub status provides the canonical external view that humans see and interact with. This ensures UI consistency with GitHub.

3. **Local Status as Fallback**: When GitHub status is unknown or unavailable, fall back to AFU9's internal workflow state as the best available information.

## Mapping Tables

### GitHub Mirror Status → Effective Status Mapping

| GithubMirrorStatus | Maps to LocalStatus | Rationale |
|-------------------|---------------------|-----------|
| `TODO` | `SPEC_READY` | Ready to be worked on |
| `IN_PROGRESS` | `IMPLEMENTING` | Actively being developed |
| `IN_REVIEW` | `MERGE_READY` | Code review in progress, ready to merge |
| `DONE` | `DONE` | Successfully completed |
| `BLOCKED` | `HOLD` | Temporarily blocked or paused |
| `UNKNOWN` | *(no mapping)* | Use precedence rules fallback |

### GitHub Raw Status → GitHub Mirror Status Mapping

GitHub provides status through multiple channels (Projects v2 fields, labels, issue state). These map to GithubMirrorStatus as follows:

| GitHub Source | Raw Value | Maps to GithubMirrorStatus |
|---------------|-----------|---------------------------|
| Project Status | "To Do", "Backlog" | `TODO` |
| Project Status | "In Progress", "Implementing" | `IN_PROGRESS` |
| Project Status | "In Review", "Review", "PR" | `IN_REVIEW` |
| Project Status | "Done", "Completed" | `DONE` |
| Project Status | "Blocked", "Hold", "Waiting" | `BLOCKED` |
| Labels | "status: implementing" | `IN_PROGRESS` |
| Labels | "status: done" | `DONE` |
| Labels | "status: blocked" | `BLOCKED` |
| Issue State | "closed" (with done signal) | `DONE` |
| Issue State | "closed" (without done signal) | *(no mapping to avoid false positives)* |
| Issue State | "open" | *(use other signals)* |

**Note on Closed Issues**: A GitHub issue with `state = "closed"` does NOT automatically map to DONE unless there's an explicit completion signal (Project status "Done" or label "status: done"). This prevents semantic errors where cancelled/killed issues are incorrectly marked as done.

## Examples

### Example 1: AFU9 I775 ↔ GitHub adaefler-art/codefactory-control#458 Implementing

**Scenario:** AFU9 issue I775 is actively being implemented by the system, and the corresponding GitHub issue #458 shows "In Progress" status.

**State Dimensions:**
- LocalStatus: `IMPLEMENTING`
- GithubMirrorStatus: `IN_PROGRESS` (from GitHub "In Progress")
- ExecutionState: `RUNNING` (playbook executing)
- HandoffState: `SYNCED`

**Effective Status Computation:**
```
executionState === 'RUNNING' → return localStatus
effectiveStatus = IMPLEMENTING
```

**UI Display:** Shows "IMPLEMENTING" badge, indicates active execution

---

### Example 2: GitHub Takes Precedence (Not Executing)

**Scenario:** Issue was implementing but execution finished, GitHub shows "In Review"

**State Dimensions:**
- LocalStatus: `IMPLEMENTING` (last AFU9 state)
- GithubMirrorStatus: `IN_REVIEW` (from GitHub "In Review")
- ExecutionState: `IDLE` (no execution)
- HandoffState: `SYNCED`

**Effective Status Computation:**
```
executionState !== 'RUNNING' → check GitHub status
githubMirrorStatus === 'IN_REVIEW' → map to MERGE_READY
effectiveStatus = MERGE_READY
```

**UI Display:** Shows "MERGE_READY" badge, reflects GitHub state

---

### Example 3: GitHub Unknown, Use Local

**Scenario:** AFU9 issue not yet synced to GitHub

**State Dimensions:**
- LocalStatus: `SPEC_READY`
- GithubMirrorStatus: `UNKNOWN` (no GitHub issue)
- ExecutionState: `IDLE`
- HandoffState: `UNSYNCED`

**Effective Status Computation:**
```
executionState !== 'RUNNING' → check GitHub status
githubMirrorStatus === 'UNKNOWN' → use local fallback
effectiveStatus = SPEC_READY
```

**UI Display:** Shows "SPEC_READY" badge, uses AFU9 internal state

---

### Example 4: GitHub Closed Without Done Signal

**Scenario:** GitHub issue closed but no explicit "done" indicator

**State Dimensions:**
- LocalStatus: `IMPLEMENTING`
- GithubMirrorStatus: `UNKNOWN` (GitHub closed without done signal → no mapping)
- ExecutionState: `IDLE`
- HandoffState: `SYNCED`

**Effective Status Computation:**
```
executionState !== 'RUNNING' → check GitHub status
githubMirrorStatus === 'UNKNOWN' → use local fallback
effectiveStatus = IMPLEMENTING
```

**Rationale:** Prevents false positives where cancelled issues are marked DONE

## UI Display Rules

### Status Badge Colors

| Status | Color | CSS Class | Badge Style |
|--------|-------|-----------|-------------|
| `CREATED` | Gray | `bg-gray-500` | Neutral |
| `SPEC_READY` | Blue | `bg-blue-500` | Info |
| `IMPLEMENTING` | Yellow | `bg-yellow-500` | Warning |
| `VERIFIED` | Purple | `bg-purple-500` | Info |
| `MERGE_READY` | Orange | `bg-orange-500` | Warning |
| `DONE` | Green | `bg-green-500` | Success |
| `HOLD` | Red | `bg-red-500` | Error |
| `KILLED` | Dark Gray | `bg-gray-700` | Disabled |

### Status Icons

| Status | Icon | Unicode |
|--------|------|---------|
| `CREATED` | ○ | U+25CB |
| `SPEC_READY` | ✓ | U+2713 |
| `IMPLEMENTING` | ⚙ | U+2699 |
| `VERIFIED` | ✓✓ | U+2713 U+2713 |
| `MERGE_READY` | ↑ | U+2191 |
| `DONE` | ✓ | U+2713 |
| `HOLD` | ∥ | U+2225 |
| `KILLED` | ✕ | U+2715 |

### Execution State Indicators

When `ExecutionState = RUNNING`, display an animated spinner or progress indicator alongside the status badge.

**Visual Example:**
```
[IMPLEMENTING ⚙] 🔄
```

### Handoff State Indicators

Display a GitHub sync indicator when `HandoffState = SYNCED`:
- ✓ GitHub icon for SYNCED
- ⚠ for UNSYNCED

**Visual Example:**
```
[IMPLEMENTING ⚙] ✓ GitHub
[SPEC_READY ✓] ⚠ Not synced
```

## Determinism Guarantees

The state model provides the following determinism guarantees:

1. **Idempotent Computation**: Computing effective status multiple times with the same inputs always produces the same output
2. **No Hidden State**: All inputs to effective status computation are explicit and documented
3. **No Time Dependencies**: Effective status does not depend on current time or external state
4. **Total Function**: Every combination of state dimensions produces a valid effective status

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-04 | Initial canonical definition |

## References

- AFU9 Workflow Specification: `docs/architecture/AFU9_WORKFLOW.md`
- GitHub Integration: `docs/GITHUB_APP_INTEGRATION.md`
- Issue State Machine: `control-center/src/lib/types/issue-state.ts`
- Status Mapping Utilities: `control-center/src/lib/utils/status-mapping.ts`
