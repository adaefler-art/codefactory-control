# KILLED State Enforcement

**Status**: Canonical  
**Version**: 1.0  
**Issue Reference**: Issue A5 — Abbruch- & Kill-Semantik

## Overview

This document defines the enforcement mechanisms for the KILLED terminal state in the AFU-9 system. The implementation ensures that KILLED issues cannot execute workflows or transition to other states, preventing "zombie issues" (issues that are killed but continue to have actions performed on them).

## Problem Statement

Without proper enforcement, issues in the KILLED state could:
- Continue to execute workflows
- Transition to other states
- Consume system resources
- Create confusion about their actual status
- Lead to "zombie issues" that appear dead but continue to act

## Solution: Terminal State Enforcement

The KILLED state is now strictly enforced as a **terminal state** with the following characteristics:

### 1. No Forward Transitions

Issues in the KILLED state cannot transition to any other state, including:
- Cannot transition back to HOLD
- Cannot transition back to active states (CREATED, SPEC_READY, IMPLEMENTING, etc.)
- Cannot transition to DONE

This is enforced in the state machine definition and validated in the guardrails.

### 2. No Workflow Execution

Workflows cannot be executed on issues in the KILLED state:
- All workflow execution requests are blocked
- Clear error messages explain why execution is prevented
- Suggestions guide users toward proper re-activation

### 3. No Actions Allowed

General actions are prevented on KILLED issues:
- Helper functions validate state before performing actions
- Functions throw descriptive errors when actions are attempted
- Errors include guidance for re-activation

## Implementation

### Core Functions

#### `isTerminalState(state: IssueState): boolean`

Returns true if the state is terminal (DONE or KILLED).

```typescript
import { isTerminalState, IssueState } from './types/issue-state';

if (isTerminalState(IssueState.KILLED)) {
  // Issue is in a terminal state
}
```

#### `canPerformAction(state: IssueState): boolean`

Returns true if actions can be performed on an issue in the given state.
Returns false for terminal states (DONE, KILLED).

```typescript
import { canPerformAction, IssueState } from './types/issue-state';

if (!canPerformAction(currentState)) {
  throw new Error('Cannot perform action on issue in terminal state');
}
```

#### `ensureNotKilled(state: IssueState): void`

Throws an error if the issue is in KILLED state.
Use this before performing any action on an issue.

```typescript
import { ensureNotKilled } from './types/issue-state';

function performAction(issueState: IssueState) {
  ensureNotKilled(issueState); // Throws if state is KILLED
  
  // Perform action...
}
```

**Error thrown:**
```
Cannot perform action on KILLED issue. Issue has been terminated and cannot be reactivated. 
Re-activation requires explicit new intent (e.g., reopening the issue or creating a new one).
```

#### `ensureNotTerminal(state: IssueState): void`

Throws an error if the issue is in any terminal state (DONE or KILLED).

```typescript
import { ensureNotTerminal } from './types/issue-state';

function startWork(issueState: IssueState) {
  ensureNotTerminal(issueState); // Throws if state is DONE or KILLED
  
  // Start work...
}
```

### State Transition Guardrails

#### `validateStateTransition(fromState, toState, context)`

Enhanced to block all transitions from terminal states:

```typescript
import { validateStateTransition } from './state-transition-guardrails';

const result = validateStateTransition(
  IssueState.KILLED,
  IssueState.HOLD,
  context
);

console.log(result.allowed); // false
console.log(result.reason); // "Cannot transition from terminal state: KILLED..."
```

**Validation Result for KILLED state:**
```json
{
  "allowed": false,
  "reason": "Cannot transition from terminal state: KILLED. Terminal states (DONE, KILLED) are final and do not allow any forward transitions. Re-activation requires explicit new intent.",
  "conditions": [{
    "name": "terminal_state_check",
    "passed": false,
    "message": "KILLED is a terminal state and cannot transition to any other state"
  }],
  "suggestions": [
    "To work on this issue again, create a new issue or reopen with explicit intent"
  ]
}
```

#### `validateWorkflowExecution(issueState: IssueState)`

New function to prevent workflow execution on terminal states:

```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';

const result = validateWorkflowExecution(IssueState.KILLED);

console.log(result.allowed); // false
console.log(result.reason); // "Cannot execute workflow on KILLED issue..."
```

**Validation Result:**
```json
{
  "allowed": false,
  "reason": "Cannot execute workflow on KILLED issue. Issue has been terminated and all workflows are blocked to prevent zombie issues.",
  "conditions": [{
    "name": "issue_not_killed",
    "passed": false,
    "message": "Issue is in KILLED state"
  }],
  "suggestions": [
    "Re-activation requires explicit new intent",
    "Create a new issue or reopen this issue with clear justification"
  ]
}
```

## Usage Examples

### Example 1: Preventing Workflow Execution

```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';
import { WorkflowEngine } from './workflow-engine';

async function executeWorkflow(issueNumber: number, workflow: WorkflowDefinition) {
  // Get current issue state (from database, GitHub API, etc.)
  const issueState = await getIssueState(issueNumber);
  
  // Validate that workflow execution is allowed
  const validation = validateWorkflowExecution(issueState);
  
  if (!validation.allowed) {
    throw new Error(validation.reason);
  }
  
  // Execute workflow
  const engine = new WorkflowEngine();
  return await engine.execute(workflow, context);
}
```

### Example 2: State Transition with Validation

```typescript
import { validateStateTransition } from './state-transition-guardrails';

async function transitionIssue(
  issueNumber: number,
  fromState: IssueState,
  toState: IssueState
) {
  // Validate the transition
  const validation = validateStateTransition(fromState, toState, context);
  
  if (!validation.allowed) {
    console.error('Transition blocked:', validation.reason);
    console.log('Suggestions:', validation.suggestions);
    return { success: false, error: validation.reason };
  }
  
  // Perform the transition
  await updateIssueState(issueNumber, toState);
  return { success: true };
}
```

### Example 3: Using Action Guards

```typescript
import { ensureNotKilled, canPerformAction } from './types/issue-state';

function startImplementation(issueState: IssueState) {
  // Method 1: Use canPerformAction for conditional logic
  if (!canPerformAction(issueState)) {
    console.log('Cannot start implementation - issue is in terminal state');
    return;
  }
  
  // Method 2: Use ensureNotKilled to throw on KILLED state
  try {
    ensureNotKilled(issueState);
    
    // Start implementation
    console.log('Starting implementation...');
  } catch (error) {
    console.error('Implementation blocked:', error.message);
  }
}
```

## Re-activation Mechanism

### Explicit New Intent Required

KILLED issues cannot be automatically reactivated. Re-activation requires explicit human action demonstrating new intent:

#### Option 1: Reopen the Issue

```bash
# Via GitHub API or UI
gh issue reopen <issue-number> --repo <owner>/<repo>
```

When reopening:
1. Issue state transitions from KILLED to CREATED (or appropriate state)
2. Provide clear justification in the issue comment
3. Update issue labels to reflect new status
4. Consider updating the issue title/description if requirements changed

#### Option 2: Create a New Issue

```bash
# Create a new issue with references to the killed one
gh issue create --title "Follow-up to #123" --body "Continuing work from #123..."
```

When creating a new issue:
1. Reference the original KILLED issue
2. Explain why new work is needed
3. Update requirements based on lessons learned
4. Start with fresh state (CREATED)

### Why Explicit Intent?

Requiring explicit intent prevents:
- Accidental reactivation of cancelled work
- Zombie issues operating without oversight
- Confusion about issue status
- Wasted resources on abandoned work
- Loss of the decision to kill the issue

## Testing

### Test Coverage

The implementation includes comprehensive tests:

**Issue State Tests (`__tests__/lib/issue-state.test.ts`):**
- ✅ `canPerformAction` returns false for terminal states
- ✅ `ensureNotKilled` throws for KILLED state
- ✅ `ensureNotKilled` does not throw for other states
- ✅ `ensureNotTerminal` throws for DONE and KILLED states
- ✅ `ensureNotTerminal` does not throw for non-terminal states

**State Transition Guardrails Tests (`__tests__/lib/state-transition-guardrails.test.ts`):**
- ✅ Blocks transitions from KILLED to any state
- ✅ Blocks transitions from DONE to any state
- ✅ Provides clear error messages for terminal state transitions
- ✅ `validateWorkflowExecution` blocks KILLED state
- ✅ `validateWorkflowExecution` blocks DONE state
- ✅ `validateWorkflowExecution` allows non-terminal states
- ✅ Provides clear suggestions for re-activation

### Running Tests

```bash
cd control-center
npm test -- __tests__/lib/issue-state.test.ts
npm test -- __tests__/lib/state-transition-guardrails.test.ts
```

## Integration Points

### 1. Workflow Engine

The workflow engine should check issue state before execution:

```typescript
// In WorkflowEngine.execute()
import { validateWorkflowExecution } from './state-transition-guardrails';

const validation = validateWorkflowExecution(issueState);
if (!validation.allowed) {
  throw new Error(validation.reason);
}
```

### 2. API Endpoints

API endpoints that trigger actions should validate issue state:

```typescript
// In API route handlers
import { ensureNotKilled } from './types/issue-state';

export async function POST(request: Request) {
  const { issueNumber } = await request.json();
  const issueState = await getIssueState(issueNumber);
  
  ensureNotKilled(issueState);
  
  // Proceed with action...
}
```

### 3. GitHub Webhooks

Webhook handlers should respect KILLED state:

```typescript
// In webhook processor
import { canPerformAction } from './types/issue-state';

if (!canPerformAction(issue.state)) {
  console.log('Ignoring webhook - issue is in terminal state');
  return;
}
```

### 4. Step Functions / Lambda

AWS Lambda functions should validate state:

```typescript
// In Lambda handler
import { validateWorkflowExecution } from './state-transition-guardrails';

export async function handler(event: any) {
  const issueState = event.issueState;
  const validation = validateWorkflowExecution(issueState);
  
  if (!validation.allowed) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: validation.reason })
    };
  }
  
  // Execute workflow...
}
```

## Benefits

### 1. Prevents Zombie Issues

KILLED issues cannot continue to execute workflows or consume resources.

### 2. Clear State Semantics

The system has a clear understanding of what KILLED means and enforces it consistently.

### 3. Better Resource Management

Resources are not wasted on issues that have been explicitly cancelled.

### 4. Improved Auditability

All attempts to act on KILLED issues are logged with clear error messages.

### 5. Intentional Re-activation

Re-activation requires explicit human decision, ensuring cancelled work isn't accidentally restarted.

## Monitoring & Metrics

Track KILLED state enforcement:

```sql
-- Count blocked workflow executions
SELECT COUNT(*) 
FROM workflow_executions 
WHERE status = 'failed' 
  AND error LIKE '%KILLED issue%';

-- Count blocked state transitions
SELECT COUNT(*) 
FROM issue_state_history 
WHERE transition_failed = true 
  AND reason LIKE '%terminal state%';

-- Track re-activation attempts
SELECT COUNT(*) 
FROM issue_state_history 
WHERE from_state = 'KILLED' 
  AND to_state != 'KILLED';
```

## Best Practices

1. **Always validate state before actions**: Use `canPerformAction()` or `ensureNotKilled()` before performing any action on an issue.

2. **Provide clear error messages**: When blocking an action, explain why and how to proceed.

3. **Log enforcement events**: Log all blocked actions for monitoring and debugging.

4. **Document re-activation**: When reopening a KILLED issue, document why in the issue comments.

5. **Review KILLED issues periodically**: Ensure KILLED issues are actually no longer needed.

## Migration Guide

If you have existing code that doesn't enforce KILLED state:

### Before
```typescript
// No state validation
await executeWorkflow(issueNumber, workflow);
```

### After
```typescript
import { validateWorkflowExecution } from './state-transition-guardrails';

const issueState = await getIssueState(issueNumber);
const validation = validateWorkflowExecution(issueState);

if (!validation.allowed) {
  throw new Error(validation.reason);
}

await executeWorkflow(issueNumber, workflow);
```

## References

- [Issue State Machine](./ISSUE_STATE_MACHINE.md) - Canonical state definitions
- [State Transition Guardrails](./STATE_TRANSITION_GUARDRAILS.md) - Validation rules
- **Implementation**: 
  - `control-center/src/lib/types/issue-state.ts` - Core state functions
  - `control-center/src/lib/state-transition-guardrails.ts` - Validation logic
- **Tests**:
  - `control-center/__tests__/lib/issue-state.test.ts`
  - `control-center/__tests__/lib/state-transition-guardrails.test.ts`

## Changelog

### Version 1.0 (2025-12-19)
- Initial implementation of KILLED state enforcement
- Added `canPerformAction()` function
- Added `ensureNotKilled()` function
- Added `ensureNotTerminal()` function
- Added `validateWorkflowExecution()` function
- Enhanced `validateStateTransition()` to block terminal state transitions
- Comprehensive test coverage (83 tests passing)
- Documentation complete
