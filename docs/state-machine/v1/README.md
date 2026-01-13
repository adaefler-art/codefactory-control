# AFU-9 Canonical State Machine Specification v1

**Version:** 1.0  
**Date:** 2026-01-13  
**Status:** Canonical  
**Issue:** E85.1

## Overview

This directory contains the **canonical, machine-readable specification** for the AFU-9 issue state machine. It serves as the **Single Source of Truth** for:

- **State Definitions**: All valid AFU-9 issue states
- **State Transitions**: Allowed transitions with preconditions and effects
- **GitHub Integration**: Bidirectional mapping between AFU-9 and GitHub
- **Invariant Rules**: Canonical guardrails and enforcement policies
- **Automation Rules**: When and how automatic transitions occur

## Purpose

This specification addresses the following requirements from **E85.1**:

✅ **Explicit State Machine**: All states and transitions formally defined  
✅ **AFU-9 ↔ GitHub Mapping**: Canonical mapping between internal states and GitHub entities  
✅ **Guardrails**: Invariant rules prevent invalid state changes  
✅ **UI Derivations**: Complete information for UI status displays  
✅ **Automation Foundation**: Machine-readable format enables future automation  

## File Structure

```
/docs/state-machine/v1/
├── README.md                # This file - overview and usage guide
├── state-machine.yaml       # Core state definitions and transitions
├── github-mapping.yaml      # AFU-9 ↔ GitHub integration mappings
├── transitions.yaml         # Detailed transition specifications
└── invariants.yaml          # Canonical invariant rules
```

## State Machine Overview

### States

AFU-9 issues progress through the following states:

1. **CREATED** - Issue created, specification in progress
2. **SPEC_READY** - Specification complete, ready for implementation
3. **IMPLEMENTING** - Active development work
4. **VERIFIED** - Implementation complete and verified
5. **MERGE_READY** - Ready to merge to main branch
6. **DONE** - Completed and merged *(terminal)*
7. **HOLD** - Temporarily paused or blocked *(special)*
8. **KILLED** - Cancelled *(terminal)*

### State Categories

- **Initial**: CREATED
- **Ready**: SPEC_READY
- **Work In Progress**: IMPLEMENTING
- **Verification**: VERIFIED
- **Merge Pending**: MERGE_READY
- **Terminal**: DONE, KILLED
- **Special**: HOLD (can transition to any non-terminal state)

### Terminal States

**DONE** and **KILLED** are terminal states:
- No forward transitions allowed
- No workflow execution permitted
- Strict enforcement prevents "zombie issues"
- Reactivation requires explicit new intent (reopening issue)

## GitHub Integration

### AFU-9 State → GitHub Labels

| AFU-9 State | Primary GitHub Label | Additional Labels |
|------------|---------------------|-------------------|
| CREATED | `status:created` | - |
| SPEC_READY | `status:spec-ready` | `ready-for-work` |
| IMPLEMENTING | `status:implementing` | `in-progress` |
| VERIFIED | `status:verified` | - |
| MERGE_READY | `status:merge-ready` | `ready-to-merge` |
| DONE | `status:done` | `completed` |
| HOLD | `status:hold` | `blocked` |
| KILLED | `status:killed` | `wont-fix`, `cancelled` |

### GitHub → AFU-9 State Priority

When extracting state from GitHub, use this precedence:

1. **GitHub Project Status Field** (highest priority)
2. **GitHub Labels** (with `status:` prefix)
3. **GitHub Issue State** (`open`/`closed`)

**Note**: `closed` state does NOT automatically map to DONE unless there's an explicit done signal (Project status "Done" or label "status:done"). This prevents false positives.

### PR Status Mapping

| GitHub PR Status | AFU-9 State |
|-----------------|-------------|
| `draft` | IMPLEMENTING |
| `open` | MERGE_READY |
| `merged` | DONE |
| `closed` | *(no automatic mapping)* |

### Checks & Merge Status

See `github-mapping.yaml` for detailed CI check requirements and merge status mappings.

## Transition Rules

### Transition Types

1. **FORWARD** - Normal progression (e.g., IMPLEMENTING → VERIFIED)
2. **BACKWARD** - Regression due to issues (e.g., VERIFIED → IMPLEMENTING)
3. **PAUSE** - Move to HOLD state
4. **RESUME** - Return from HOLD to active state
5. **TERMINATE** - Move to terminal state (DONE or KILLED)

### Preconditions

Every transition has explicit preconditions that must be met. Examples:

- **IMPLEMENTING → VERIFIED**:
  - Code committed to branch
  - All tests pass
  
- **VERIFIED → MERGE_READY**:
  - Code review approved
  - All CI checks pass
  - No merge conflicts

- **MERGE_READY → DONE**:
  - PR successfully merged
  - CI checks green on main branch

### Side Effects

Transitions trigger side effects such as:

- **GitHub Labels**: Add/remove status labels
- **GitHub Issues**: Close/reopen/comment
- **GitHub PRs**: Request review, merge, close
- **Execution State**: Update AFU-9 execution state
- **Notifications**: Send alerts to stakeholders
- **Audit Log**: Record state change

### Auto-Transitions

Only **one** transition is automatic:

- **MERGE_READY → DONE** when PR is merged with green checks

All other transitions require explicit action. This prevents phantom state changes.

## Invariant Rules

Seven canonical invariants ensure system integrity:

### INV-001: DONE State Equivalence
```
DONE state ⇔ (PR merged AND all CI checks green)
```
Enforcement: **Strict** (blocking)

### INV-002: Terminal State Immutability
```
Terminal states (DONE, KILLED) allow no further actions
```
Enforcement: **Strict** (blocking)

### INV-003: GitHub Sync Consistency
```
AFU-9 state matches GitHub primary label within 5 minutes
```
Enforcement: **Eventual** (warning)

### INV-004: Evidence-Based Transitions
```
Automatic transitions require observable evidence
```
Enforcement: **Strict** (blocking)

### INV-005: MERGE_READY Preconditions
```
MERGE_READY requires (code review AND CI pass AND no conflicts)
```
Enforcement: **Strict** (blocking)

### INV-006: State Transition Atomicity
```
Transitions are atomic - fully complete or fully rollback
```
Enforcement: **Strict** (blocking)

### INV-007: Backward Transition Justification
```
Backward transitions require documented reason
```
Enforcement: **Strict** (blocking)

See `invariants.yaml` for complete specifications.

## Usage Examples

### Example 1: Normal Flow

```
CREATED → SPEC_READY → IMPLEMENTING → VERIFIED → MERGE_READY → DONE
```

**Actions:**
1. Issue created → CREATED
2. Spec complete → SPEC_READY
3. Work starts → IMPLEMENTING
4. Tests pass → VERIFIED
5. Review approved + CI green → MERGE_READY
6. PR merges → DONE (auto-transition)

**GitHub:**
- Labels updated at each step
- Issue closed when DONE
- Audit trail recorded

### Example 2: Backward Flow (Rework)

```
IMPLEMENTING → VERIFIED → IMPLEMENTING → VERIFIED → MERGE_READY → DONE
```

**Actions:**
1. Initial implementation → VERIFIED
2. Review finds issue → IMPLEMENTING (with reason)
3. Issue fixed → VERIFIED
4. Approval obtained → MERGE_READY
5. PR merges → DONE

**GitHub:**
- Comment added when going back to IMPLEMENTING
- Reason documented in transition metadata

### Example 3: Hold and Resume

```
IMPLEMENTING → HOLD → IMPLEMENTING → VERIFIED → MERGE_READY → DONE
```

**Actions:**
1. Implementation starts → IMPLEMENTING
2. Blocking dependency → HOLD (with reason)
3. Dependency resolved → IMPLEMENTING (resume)
4. Complete work → VERIFIED
5. Merge → DONE

**GitHub:**
- `status:hold` label added
- `status:blocked` label added
- Labels removed when resumed

### Example 4: Cancellation

```
SPEC_READY → IMPLEMENTING → KILLED
```

**Actions:**
1. Work starts → IMPLEMENTING
2. Decision to cancel → KILLED (with reason)

**GitHub:**
- Issue closed
- `status:killed` label added
- PR closed if exists

## Integration Guide

### For UI Components

Use the state machine spec to:

1. **Display Status Badges**: Use `ui_color` and `ui_icon` from `state-machine.yaml`
2. **Show Next Actions**: Use `successors` to show allowed transitions
3. **Validate User Input**: Use `preconditions` to disable invalid actions
4. **Show Sync Status**: Use `github_to_afu9_state` to indicate GitHub sync

### For Backend Services

Use the state machine spec to:

1. **Validate Transitions**: Check `predecessors` and `successors`
2. **Enforce Preconditions**: Validate before allowing state change
3. **Apply Side Effects**: Execute all side effects atomically
4. **Sync with GitHub**: Use mappings from `github-mapping.yaml`
5. **Audit Changes**: Record all transitions with evidence

### For Automation

Use the state machine spec to:

1. **Auto-Transition MERGE_READY → DONE**: On PR merge event
2. **Auto-Update Labels**: When AFU-9 state changes
3. **Sync from GitHub**: When GitHub labels/status change
4. **Enforce Invariants**: Validate periodically and on transitions

### For Webhooks

Map GitHub webhook events to state transitions:

| Webhook Event | Potential Transition |
|--------------|---------------------|
| `pull_request.opened` | VERIFIED → MERGE_READY |
| `pull_request.closed` (merged) | MERGE_READY → DONE |
| `pull_request.closed` (not merged) | any → KILLED |
| `check_suite.completed` (success) | IMPLEMENTING → VERIFIED |
| `check_suite.completed` (failure) | VERIFIED → IMPLEMENTING |
| `issues.closed` | any → check for done signal |
| `issues.labeled` | extract status from label |
| `issues.reopened` | KILLED → CREATED |

See `github-mapping.yaml` for complete webhook mappings.

## Validation

### Machine-Readable Format

All specification files are in YAML format and can be:

- Parsed by standard YAML libraries
- Validated against JSON Schema (future)
- Loaded into state machine engines
- Used for code generation

### Validation Script (Future)

```bash
# Validate state machine integrity
npm run validate-state-machine

# Check invariants against current issues
npm run check-invariants

# Sync AFU-9 with GitHub
npm run sync-github
```

## Non-Goals

This specification **intentionally excludes**:

❌ **Automation Implementation**: This is spec only, not code  
❌ **PR Merge Logic**: Implementation left to E85.2–E85.4  
❌ **Database Schema**: Storage implementation separate  
❌ **UI Components**: UI code separate from spec  
❌ **Webhook Handlers**: Event handling code separate  

## Future Enhancements

Potential future additions (not in E85.1 scope):

- JSON Schema for validation
- TypeScript type generation from spec
- GraphViz state machine diagram generator
- Automated invariant checking tool
- GitHub Action for sync enforcement

## References

### Related Documentation

- **State Model v1**: `/docs/state/STATE_MODEL_V1.md`
- **Issue State Machine**: `/docs/v04/ISSUE_STATE_MACHINE.md`
- **Issue State Types**: `/control-center/src/lib/types/issue-state.ts`
- **Status Mapping**: `/control-center/src/lib/utils/status-mapping.ts`
- **State Model Logic**: `/control-center/src/lib/issues/stateModel.ts`

### Implementation Files

- **Backend Types**: `control-center/src/lib/types/issue-state.ts`
- **Status Utilities**: `control-center/src/lib/utils/status-mapping.ts`
- **State Computation**: `control-center/src/lib/issues/stateModel.ts`
- **GitHub Sync**: `control-center/src/lib/github-status-sync.ts`

### Related Issues

- **E85.1**: Canonical State Machine Spec (this issue)
- **E85.2**: Auto-Transition MERGE_READY → DONE (future)
- **E85.3**: GitHub Label Sync Automation (future)
- **E85.4**: Invariant Enforcement (future)

## Changelog

### Version 1.0 (2026-01-13)

- Initial canonical specification
- Eight states defined with full metadata
- Complete transition rules with preconditions
- GitHub integration mappings
- Seven invariant rules
- Webhook event mappings
- Machine-readable YAML format

## Acceptance Criteria

✅ **State Machine Artifact**: Files in `/docs/state-machine/v1/`  
✅ **State Relationships**: Predecessors and successors defined  
✅ **Explicit Preconditions**: Each transition has preconditions  
✅ **GitHub Mapping**: Labels/checks uniquely mapped  
✅ **Machine-Readable**: YAML format, parseable  
✅ **No Automation**: Spec only, no implementation  
✅ **No PR Merge**: Definition phase only  

## License

This specification is part of the codefactory-control project.

---

**Maintained by**: AFU-9 Team  
**Last Updated**: 2026-01-13  
**Version**: 1.0
