# AFU-9 Canonical Issue State Machine

**Status**: Canonical  
**Version**: 1.0  
**Issue Reference**: Issue A1

## Overview

This document defines the canonical state machine for issues in the AFU-9 system. Every issue follows a defined lifecycle through these states, ensuring consistent tracking and automation across the autonomous fabrication pipeline.

## Canonical States

### Primary Flow States

#### 1. CREATED
- **Description**: Issue has been created but specification is not yet complete
- **Entry**: Issue is opened in GitHub or created via Control Center
- **Activities**: Requirements gathering, stakeholder input, initial scoping
- **Exit Criteria**: Specification is complete and validated
- **Next States**: SPEC_READY, HOLD, KILLED

#### 2. SPEC_READY
- **Description**: Specification is complete and ready for implementation
- **Entry**: Specification has been reviewed and approved
- **Activities**: Planning, task breakdown, resource allocation
- **Exit Criteria**: Implementation begins
- **Next States**: IMPLEMENTING, HOLD, KILLED

#### 3. IMPLEMENTING
- **Description**: Implementation is in progress
- **Entry**: Developer/Agent starts working on the issue
- **Activities**: Coding, unit testing, documentation updates
- **Exit Criteria**: Implementation is complete and ready for verification
- **Next States**: VERIFIED, SPEC_READY (if refinement needed), HOLD, KILLED

#### 4. VERIFIED
- **Description**: Implementation is complete and verified
- **Entry**: Code passes all tests and code review
- **Activities**: Final checks, integration testing, documentation review
- **Exit Criteria**: Ready for merge approval
- **Next States**: MERGE_READY, IMPLEMENTING (if verification fails), HOLD, KILLED

#### 5. MERGE_READY
- **Description**: Ready to be merged to main branch
- **Entry**: All approvals obtained, CI checks pass
- **Activities**: Final review, merge conflict resolution (if any)
- **Exit Criteria**: Successfully merged to main branch
- **Next States**: DONE, VERIFIED (if merge checks fail), HOLD, KILLED

#### 6. DONE
- **Description**: Issue is completed and merged
- **Entry**: Successfully merged to main branch
- **Activities**: Closure, retrospective (optional)
- **Exit Criteria**: N/A (terminal state)
- **Next States**: None (terminal state)

### Special States

#### 7. HOLD
- **Description**: Issue is on hold (paused, not currently being worked on)
- **Entry**: Work is temporarily suspended
- **Reasons**: Blocking dependency, resource constraints, priority shift
- **Exit Criteria**: Blocking condition resolved, work can resume
- **Next States**: Can transition back to any non-terminal state, or to KILLED

#### 8. KILLED
- **Description**: Issue has been killed (cancelled, will not be implemented)
- **Entry**: Decision made not to proceed with implementation
- **Reasons**: No longer needed, superseded by other work, out of scope
- **Exit Criteria**: N/A (terminal state)
- **Next States**: None (terminal state)
- **Enforcement**: Issue A5 implements strict enforcement to prevent "zombie issues"
  - All workflow execution is blocked on KILLED issues
  - All state transitions from KILLED are blocked
  - Re-activation requires explicit new intent (reopening issue or creating new one)
  - See [KILLED State Enforcement](./KILLED_STATE_ENFORCEMENT.md) for details

## State Transition Diagram

```
                    ┌─────────┐
                    │ CREATED │
                    └────┬────┘
                         │
                         ▼
                  ┌────────────┐
                  │ SPEC_READY │
                  └─────┬──────┘
                        │
                        ▼
                 ┌──────────────┐
            ┌────┤ IMPLEMENTING ├────┐
            │    └──────┬───────┘    │
            │           │            │
            │           ▼            │
            │      ┌──────────┐     │
            └──────┤ VERIFIED ├─────┘
                   └────┬─────┘
                        │
                        ▼
                 ┌─────────────┐
                 │ MERGE_READY │
                 └──────┬──────┘
                        │
                        ▼
                    ┌──────┐
                    │ DONE │
                    └──────┘

        Special States (can be entered from any non-terminal state):
        
        ┌──────┐              ┌────────┐
        │ HOLD │◄────────────►│ KILLED │
        └──────┘              └────────┘
```

## State Transitions

### Valid Transitions Matrix

| From State    | To States                                        |
|---------------|--------------------------------------------------|
| CREATED       | SPEC_READY, HOLD, KILLED                         |
| SPEC_READY    | IMPLEMENTING, HOLD, KILLED                       |
| IMPLEMENTING  | VERIFIED, SPEC_READY, HOLD, KILLED               |
| VERIFIED      | MERGE_READY, IMPLEMENTING, HOLD, KILLED          |
| MERGE_READY   | DONE, VERIFIED, HOLD, KILLED                     |
| DONE          | (none - terminal state)                          |
| HOLD          | CREATED, SPEC_READY, IMPLEMENTING, VERIFIED,     |
|               | MERGE_READY, KILLED                              |
| KILLED        | (none - terminal state)                          |

### Backward Transitions

The state machine allows backward transitions in certain scenarios:

- **IMPLEMENTING → SPEC_READY**: When specification needs refinement based on implementation insights
- **VERIFIED → IMPLEMENTING**: When verification uncovers issues requiring rework
- **MERGE_READY → VERIFIED**: When merge checks fail and require fixes

## Implementation

### TypeScript Types

The canonical state machine is implemented in:
```
control-center/src/lib/types/issue-state.ts
```

**Enum Definition**:
```typescript
export enum IssueState {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',
  IMPLEMENTING = 'IMPLEMENTING',
  VERIFIED = 'VERIFIED',
  MERGE_READY = 'MERGE_READY',
  DONE = 'DONE',
  HOLD = 'HOLD',
  KILLED = 'KILLED'
}
```

**Helper Functions**:
- `isValidIssueState(state: string): boolean` - Type guard
- `isValidTransition(from: IssueState, to: IssueState): boolean` - Validate transitions
- `getIssueStateDescription(state: IssueState): string` - Get human-readable description
- `isTerminalState(state: IssueState): boolean` - Check if state is terminal
- `isActiveState(state: IssueState): boolean` - Check if state represents active work

### Database Schema

Issues can be tracked with state in the database. Consider adding to workflow executions or creating a dedicated issues table:

```sql
CREATE TABLE issue_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_issue_number INTEGER NOT NULL,
  repository VARCHAR(255) NOT NULL,
  state VARCHAR(50) NOT NULL,
  previous_state VARCHAR(50),
  state_changed_at TIMESTAMP DEFAULT NOW(),
  state_changed_by VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_issue_state CHECK (state IN (
    'CREATED', 'SPEC_READY', 'IMPLEMENTING', 'VERIFIED', 
    'MERGE_READY', 'DONE', 'HOLD', 'KILLED'
  ))
);

CREATE INDEX idx_issue_tracking_state ON issue_tracking(state);
CREATE INDEX idx_issue_tracking_repo_number ON issue_tracking(repository, github_issue_number);
```

## Usage Examples

### Basic State Transition

```typescript
import { IssueState, isValidTransition } from '@/lib/types/issue-state';

const currentState = IssueState.IMPLEMENTING;
const nextState = IssueState.VERIFIED;

if (isValidTransition(currentState, nextState)) {
  // Perform state transition
  console.log('Transition is valid');
} else {
  console.error('Invalid state transition');
}
```

### State-Based Workflow Logic

```typescript
import { IssueState, isActiveState, isTerminalState } from '@/lib/types/issue-state';

function shouldProcessIssue(state: IssueState): boolean {
  // Only process issues in active states
  return isActiveState(state);
}

function canArchiveIssue(state: IssueState): boolean {
  // Only archive issues in terminal states
  return isTerminalState(state);
}
```

### State Transition Validation

```typescript
import { IssueState, isValidTransition, ISSUE_STATE_TRANSITIONS } from '@/lib/types/issue-state';

function getAvailableTransitions(currentState: IssueState): IssueState[] {
  return ISSUE_STATE_TRANSITIONS[currentState];
}

function transitionIssue(
  issueId: string,
  fromState: IssueState,
  toState: IssueState
): { success: boolean; error?: string } {
  if (!isValidTransition(fromState, toState)) {
    return {
      success: false,
      error: `Invalid transition from ${fromState} to ${toState}`
    };
  }
  
  // Perform the transition
  // ... update database, trigger workflows, etc.
  
  return { success: true };
}
```

## Integration Points

### GitHub Labels

Consider using GitHub labels to track issue states:
- `state:created`
- `state:spec-ready`
- `state:implementing`
- `state:verified`
- `state:merge-ready`
- `state:done`
- `state:hold`
- `state:killed`

### Workflow Automation

The state machine integrates with:
1. **GitHub Actions**: Automated state transitions based on PR events
2. **Control Center**: Manual state updates via UI
3. **Webhooks**: State change notifications
4. **MCP Servers**: State-based tool routing

### Monitoring & Metrics

Track state-based metrics:
- Time in each state (cycle time analysis)
- State transition patterns
- Bottleneck identification
- Success/kill rate

## Best Practices

1. **Always validate transitions**: Use `isValidTransition()` before attempting state changes
2. **Record state history**: Maintain audit trail of state changes
3. **Document reasons for HOLD/KILLED**: Add metadata explaining why work was paused or cancelled
4. **Automate where possible**: Use webhooks and GitHub Actions to automatically transition states
5. **Handle backward transitions gracefully**: Treat as learning opportunities, not failures

## Governance

- **Change Management**: Any changes to states or transitions require RFC process
- **Backward Compatibility**: State additions should not break existing workflows
- **Documentation**: This document is the canonical reference for issue states
- **Review Cycle**: Quarterly review of state machine effectiveness

## Changelog

### Version 1.1 (2025-12-19)
- **Issue A5**: Added strict enforcement of KILLED state
  - Workflow execution blocked on KILLED issues
  - State transitions from KILLED blocked
  - Re-activation requires explicit new intent
  - See [KILLED State Enforcement](./KILLED_STATE_ENFORCEMENT.md)

### Version 1.0 (2025-12-19)
- Initial canonical definition
- Eight states defined: CREATED, SPEC_READY, IMPLEMENTING, VERIFIED, MERGE_READY, DONE, HOLD, KILLED
- State transition matrix established
- TypeScript implementation provided

## References

- **Implementation**: `control-center/src/lib/types/issue-state.ts`
- **Workflow Schema**: `docs/WORKFLOW-SCHEMA.md`
- **Database Schema**: `docs/architecture/database-schema.md`
- **Issue Reference**: Issue A1 — Kanonische Issue-State-Machine definieren
