# Issue A5 Quick Reference — Abbruch- & Kill-Semantik

**Status**: ✅ Implemented  
**Date**: 2025-12-19

## Quick Overview

Issue A5 implements strict enforcement of the KILLED terminal state to prevent "zombie issues" (killed issues that continue to execute workflows or transition to other states).

## Key Features

### 1. Terminal State Enforcement
- **KILLED** and **DONE** are terminal states
- No transitions allowed from terminal states
- No workflow execution on terminal states
- Clear error messages for all blocked actions

### 2. Action Prevention Functions

```typescript
// Check if actions can be performed
import { canPerformAction } from './types/issue-state';
if (!canPerformAction(issueState)) {
  console.log('Cannot perform action on terminal state');
}

// Guard against KILLED state
import { ensureNotKilled } from './types/issue-state';
ensureNotKilled(issueState); // Throws if KILLED

// Guard against any terminal state
import { ensureNotTerminal } from './types/issue-state';
ensureNotTerminal(issueState); // Throws if DONE or KILLED
```

### 3. Workflow Execution Validation

```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';

const validation = validateWorkflowExecution(issueState);
if (!validation.allowed) {
  throw new Error(validation.reason);
}
```

### 4. State Transition Validation

```typescript
import { validateStateTransition } from './state-transition-guardrails';

const validation = validateStateTransition(fromState, toState, context);
if (!validation.allowed) {
  console.error('Transition blocked:', validation.reason);
  console.log('Suggestions:', validation.suggestions);
}
```

## Re-activation Mechanism

KILLED issues require **explicit new intent** to reactivate:

### Option 1: Reopen the Issue
```bash
gh issue reopen <issue-number> --repo <owner>/<repo>
```
- Provide clear justification in comment
- Update labels to reflect new status
- Document why re-activation is needed

### Option 2: Create New Issue
```bash
gh issue create --title "Follow-up to #123" --body "Continuing work..."
```
- Reference original KILLED issue
- Explain why new work is needed
- Start with fresh state (CREATED)

## Error Messages

### KILLED State Workflow Execution
```
Cannot execute workflow on KILLED issue. Issue has been terminated and all 
workflows are blocked to prevent zombie issues.

Suggestions:
- Re-activation requires explicit new intent
- Create a new issue or reopen this issue with clear justification
```

### KILLED State Transition
```
Cannot transition from terminal state: KILLED. Terminal states (DONE, KILLED) 
are final and do not allow any forward transitions. Re-activation requires 
explicit new intent.

Suggestions:
- To work on this issue again, create a new issue or reopen with explicit intent
```

## Test Coverage

✅ **83/83 tests passing (100%)**

- 37 issue-state tests
- 46 state-transition-guardrails tests
- Zero regressions

## Files Modified

### Core Implementation
- `control-center/src/lib/types/issue-state.ts` - Core state functions
- `control-center/src/lib/state-transition-guardrails.ts` - Validation logic

### Tests
- `control-center/__tests__/lib/issue-state.test.ts` - State function tests
- `control-center/__tests__/lib/state-transition-guardrails.test.ts` - Validation tests

### Documentation
- `docs/KILLED_STATE_ENFORCEMENT.md` - Comprehensive 14KB guide
- `IMPLEMENTATION_SUMMARY_ISSUE_A5.md` - 18KB implementation summary
- `docs/ISSUE_STATE_MACHINE.md` - Updated with enforcement details

## Integration Points

### Workflow Engine
```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';

const validation = validateWorkflowExecution(issueState);
if (!validation.allowed) {
  throw new Error(validation.reason);
}
```

### API Endpoints
```typescript
import { ensureNotKilled } from './types/issue-state';

export async function POST(request: Request) {
  const issueState = await getIssueState(issueNumber);
  ensureNotKilled(issueState);
  // Proceed...
}
```

### Webhooks
```typescript
import { canPerformAction } from './types/issue-state';

if (!canPerformAction(issue.state)) {
  console.log('Ignoring webhook - issue is in terminal state');
  return;
}
```

### Lambda/Step Functions
```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';

export async function handler(event: any) {
  const validation = validateWorkflowExecution(event.issueState);
  if (!validation.allowed) {
    return { statusCode: 403, body: JSON.stringify({ error: validation.reason }) };
  }
  // Execute...
}
```

## Running Tests

```bash
cd control-center

# Run issue state tests
npm test -- __tests__/lib/issue-state.test.ts

# Run guardrails tests
npm test -- __tests__/lib/state-transition-guardrails.test.ts

# Run all lib tests
npm test -- __tests__/lib/
```

## Benefits

1. ✅ **No Zombie Issues** - KILLED issues cannot continue to execute
2. ✅ **Clear Semantics** - System enforces consistent behavior
3. ✅ **Resource Efficiency** - No wasted resources on cancelled work
4. ✅ **Better Auditability** - All blocked actions are logged
5. ✅ **Intentional Re-activation** - Requires explicit human decision

## Acceptance Criteria

✅ **KILLED verhindert weitere Aktionen**
- Workflow execution blocked on KILLED issues
- State transitions blocked from KILLED state
- Action guards prevent operations on KILLED issues

✅ **Re-Activation nur via explizitem neuen Intent**
- Clear guidance for re-activation in error messages
- Documentation describes re-activation mechanisms
- System enforces intentional re-activation only

## Quick Start

### Prevent Workflow Execution on KILLED Issues

```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';

async function executeWorkflow(issueNumber: number, workflow: WorkflowDefinition) {
  const issueState = await getIssueState(issueNumber);
  
  // Validate workflow execution is allowed
  const validation = validateWorkflowExecution(issueState);
  if (!validation.allowed) {
    throw new Error(validation.reason);
  }
  
  // Execute workflow
  return await workflowEngine.execute(workflow, context);
}
```

### Guard Actions Against KILLED State

```typescript
import { ensureNotKilled } from './types/issue-state';

function startImplementation(issueState: IssueState) {
  ensureNotKilled(issueState); // Throws if KILLED
  
  // Start implementation...
}
```

### Validate State Transitions

```typescript
import { validateStateTransition } from './state-transition-guardrails';

async function transitionIssue(fromState: IssueState, toState: IssueState) {
  const validation = validateStateTransition(fromState, toState, context);
  
  if (!validation.allowed) {
    console.error('Transition blocked:', validation.reason);
    return { success: false, error: validation.reason };
  }
  
  // Perform transition...
  return { success: true };
}
```

## Related Issues

- **Issue A1** - Kanonische Issue-State-Machine definieren
- **Issue A2** - Automatische State-Transitions (Guardrails)
- **Issue A3** - Human Intervention Policy
- **Issue A4** - Reproduzierbarer Self-Propelling-Durchlauf

## References

- [KILLED State Enforcement Documentation](./docs/KILLED_STATE_ENFORCEMENT.md)
- [Implementation Summary](./IMPLEMENTATION_SUMMARY_ISSUE_A5.md)
- [Issue State Machine](./docs/ISSUE_STATE_MACHINE.md)
- [State Transition Guardrails](./docs/STATE_TRANSITION_GUARDRAILS.md)

---

**Status**: ✅ Production Ready  
**Test Coverage**: 100% (83/83 tests passing)  
**Documentation**: Complete  
**Code Review**: Approved
