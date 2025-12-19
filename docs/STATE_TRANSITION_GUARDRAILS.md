# State Transition Guardrails

**Status**: Canonical  
**Version**: 1.0  
**Issue Reference**: Issue A2 — Automatische State-Transitions (Guardrails)

## Overview

State Transition Guardrails implement automatic, rule-based state transitions for issues in the AFU-9 system. Instead of manual "Continue" button clicks, state transitions occur automatically when validation rules (guardrails) are satisfied.

## Key Principles

1. **No Manual Intervention**: State transitions happen automatically when conditions are met
2. **Rule-Based Validation**: Each critical state has specific entry criteria that must be satisfied
3. **Transparent Feedback**: Clear reasons and suggestions when guardrails block a transition
4. **Safe Defaults**: Invalid transitions are prevented at the state machine level

## Guarded Transitions

### 1. CREATED → SPEC_READY

**Guardrail**: Specification must be valid and complete

**Required Conditions**:
- ✅ Specification document exists
- ✅ Specification is marked as complete
- ✅ Requirements are defined
- ✅ Acceptance criteria are defined

**Example Context**:
```typescript
{
  specification: {
    exists: true,
    isComplete: true,
    hasRequirements: true,
    hasAcceptanceCriteria: true,
  }
}
```

**Suggestions on Failure**:
- Create a specification document
- Complete all sections of the specification
- Define clear requirements
- Define acceptance criteria

### 2. IMPLEMENTING → VERIFIED

**Guardrail**: QA tests must pass (green)

**Required Conditions**:
- ✅ QA tests have been executed
- ✅ All QA tests pass
- ✅ Minimum test coverage met (≥70%, if available)

**Example Context**:
```typescript
{
  qaResults: {
    executed: true,
    passed: true,
    testCount: 50,
    passedCount: 50,
    failedCount: 0,
    coveragePercent: 85,
  }
}
```

**Suggestions on Failure**:
- Run QA test suite
- Fix failing tests
- Increase test coverage to at least 70%

### 3. VERIFIED → MERGE_READY

**Guardrail**: Diff-gate criteria must be met

**Required Conditions**:
- ✅ Changes are present for merge
- ✅ No unresolved merge conflicts
- ✅ Required reviews approved
- ✅ CI pipeline passing
- ✅ Security checks passed (if enabled)

**Example Context**:
```typescript
{
  diffGate: {
    hasChanges: true,
    conflictsResolved: true,
    reviewsApproved: true,
    ciPassing: true,
    securityChecksPassed: true,
  }
}
```

**Suggestions on Failure**:
- Commit changes to the branch
- Resolve all merge conflicts
- Obtain required code review approvals
- Fix CI pipeline failures
- Address security vulnerabilities

## Unguarded Transitions

The following transitions have no specific guardrails (beyond state machine validity):

- **SPEC_READY → IMPLEMENTING**: Start implementation when ready
- **MERGE_READY → DONE**: Complete when merged
- **Any → HOLD**: Can pause work at any time
- **Any → KILLED**: Can cancel work at any time

## Implementation

### Core Module

**File**: `control-center/src/lib/state-transition-guardrails.ts`

**Key Functions**:

#### `validateStateTransition()`
Validates whether a state transition is allowed based on context and guardrails.

```typescript
const result = validateStateTransition(
  IssueState.CREATED,
  IssueState.SPEC_READY,
  context
);

if (result.allowed) {
  // Perform the transition
  await updateIssueState(issueId, IssueState.SPEC_READY);
} else {
  console.log('Blocked:', result.reason);
  console.log('Suggestions:', result.suggestions);
}
```

#### `attemptAutomaticTransition()`
Attempts an automatic state transition and returns whether it should be performed.

```typescript
const result = attemptAutomaticTransition(
  currentState,
  targetState,
  context
);

if (result.shouldTransition) {
  // Transition is allowed
  await performStateTransition(issueId, targetState);
}
```

#### `evaluateNextStateProgression()`
Evaluates if an issue can automatically progress to the next state in the natural flow.

```typescript
const progression = evaluateNextStateProgression(
  IssueState.IMPLEMENTING,
  context
);

if (progression.canProgress) {
  // Automatically transition to progression.nextState
  await performStateTransition(issueId, progression.nextState);
}
```

### Data Types

#### `StateTransitionContext`
Contains all data needed to evaluate guardrails:

```typescript
interface StateTransitionContext {
  issue?: {
    number: number;
    title?: string;
    body?: string;
    labels?: string[];
  };
  
  specification?: {
    exists: boolean;
    isComplete: boolean;
    hasRequirements: boolean;
    hasAcceptanceCriteria: boolean;
  };
  
  qaResults?: {
    executed: boolean;
    passed: boolean;
    testCount?: number;
    passedCount?: number;
    failedCount?: number;
    coveragePercent?: number;
  };
  
  diffGate?: {
    hasChanges: boolean;
    conflictsResolved: boolean;
    reviewsApproved: boolean;
    ciPassing: boolean;
    securityChecksPassed?: boolean;
  };
  
  pullRequest?: {
    number: number;
    state: string;
    mergeable: boolean;
    reviewsCount?: number;
    approvalsCount?: number;
  };
}
```

#### `GuardrailValidationResult`
Result of a guardrail validation:

```typescript
interface GuardrailValidationResult {
  allowed: boolean;          // Can transition proceed?
  reason: string;            // Human-readable explanation
  conditions: Array<{        // Individual condition checks
    name: string;
    passed: boolean;
    message: string;
  }>;
  suggestions?: string[];    // Actions to take if blocked
}
```

## Usage Examples

### Example 1: Automatic Progression in Workflow

```typescript
import { evaluateNextStateProgression } from '@/lib/state-transition-guardrails';

// In a workflow step that completes QA testing
async function afterQATestsComplete(issue: Issue, qaResults: QAResults) {
  const context: StateTransitionContext = {
    qaResults: {
      executed: true,
      passed: qaResults.allTestsPassed,
      testCount: qaResults.totalTests,
      passedCount: qaResults.passedTests,
      failedCount: qaResults.failedTests,
      coveragePercent: qaResults.coverage,
    },
  };

  // Evaluate if we can automatically progress
  const progression = evaluateNextStateProgression(
    issue.state,
    context
  );

  if (progression.canProgress) {
    console.log(`Automatically transitioning to ${progression.nextState}`);
    await updateIssueState(issue.id, progression.nextState);
  } else {
    console.log('Cannot progress:', progression.validation?.reason);
    console.log('Suggestions:', progression.validation?.suggestions);
  }
}
```

### Example 2: GitHub Webhook Handler with Guardrails

```typescript
import { attemptAutomaticTransition } from '@/lib/state-transition-guardrails';

// Handle GitHub check run completion
async function handleCheckRunCompleted(event: CheckRunEvent) {
  const issue = await getIssueForPR(event.check_run.pull_requests[0].number);
  
  // Build context from GitHub data
  const context: StateTransitionContext = {
    qaResults: {
      executed: true,
      passed: event.check_run.conclusion === 'success',
    },
    diffGate: {
      hasChanges: true,
      conflictsResolved: event.check_run.pull_requests[0].mergeable,
      reviewsApproved: await hasRequiredApprovals(event.check_run.pull_requests[0]),
      ciPassing: event.check_run.conclusion === 'success',
    },
  };

  // Attempt automatic transition
  if (issue.state === IssueState.IMPLEMENTING) {
    const result = attemptAutomaticTransition(
      IssueState.IMPLEMENTING,
      IssueState.VERIFIED,
      context
    );

    if (result.shouldTransition) {
      await updateIssueState(issue.id, IssueState.VERIFIED);
      await notifyStateChange(issue, IssueState.VERIFIED);
    }
  }
}
```

### Example 3: Manual Validation for UI Feedback

```typescript
import { validateStateTransition } from '@/lib/state-transition-guardrails';

// API endpoint to check if transition is possible
export async function GET(
  request: Request,
  { params }: { params: { issueId: string } }
) {
  const issue = await getIssue(params.issueId);
  const targetState = new URL(request.url).searchParams.get('targetState');
  
  // Gather context for validation
  const context = await buildTransitionContext(issue);
  
  // Validate the transition
  const validation = validateStateTransition(
    issue.state as IssueState,
    targetState as IssueState,
    context
  );

  return Response.json({
    canTransition: validation.allowed,
    reason: validation.reason,
    conditions: validation.conditions,
    suggestions: validation.suggestions,
  });
}
```

### Example 4: Batch Evaluation for Dashboard

```typescript
import { evaluateNextStateProgression } from '@/lib/state-transition-guardrails';

// Evaluate which issues can automatically progress
async function getProgressableIssues(issues: Issue[]) {
  const results = await Promise.all(
    issues.map(async (issue) => {
      const context = await buildTransitionContext(issue);
      const progression = evaluateNextStateProgression(issue.state, context);
      
      return {
        issue,
        canProgress: progression.canProgress,
        nextState: progression.nextState,
        blockers: progression.validation?.conditions
          .filter(c => !c.passed)
          .map(c => c.message),
      };
    })
  );

  return results.filter(r => r.canProgress);
}
```

## Integration Points

### 1. Workflow Engine

Workflows can automatically check and transition states:

```typescript
// In workflow step
{
  name: "auto-transition-after-tests",
  tool: "internal.autoTransition",
  params: {
    issueId: "${issue.id}",
    currentState: "${issue.state}",
    context: {
      qaResults: "${test_results}"
    }
  }
}
```

### 2. GitHub Webhooks

Webhook handlers can trigger automatic transitions:

```typescript
// In webhook handler
webhooks.on('check_run.completed', async (event) => {
  await attemptAutomaticStateProgression(event);
});
```

### 3. MCP Tools

MCP tools can use guardrails to validate operations:

```typescript
// In MCP tool implementation
if (!validateStateTransition(fromState, toState, context).allowed) {
  throw new Error('State transition not allowed - guardrails failed');
}
```

### 4. Control Center UI

UI can display transition readiness:

```tsx
const TransitionStatusIndicator = ({ issue, targetState }) => {
  const [validation, setValidation] = useState(null);
  
  useEffect(() => {
    validateTransition(issue, targetState).then(setValidation);
  }, [issue, targetState]);

  if (validation?.allowed) {
    return <Badge color="green">Ready to transition</Badge>;
  }
  
  return (
    <div>
      <Badge color="red">Blocked</Badge>
      <ul>
        {validation?.suggestions?.map(s => <li>{s}</li>)}
      </ul>
    </div>
  );
};
```

## Testing

### Test Suite

**File**: `control-center/__tests__/lib/state-transition-guardrails.test.ts`

**Test Coverage**: 37 tests covering:
- ✅ SPEC_READY guardrail validation (6 tests)
- ✅ VERIFIED guardrail validation (6 tests)
- ✅ MERGE_READY guardrail validation (8 tests)
- ✅ General transition validation (7 tests)
- ✅ Automatic transition attempts (2 tests)
- ✅ Next state progression evaluation (8 tests)

**Run Tests**:
```bash
cd control-center
npm test -- __tests__/lib/state-transition-guardrails.test.ts
```

## Benefits

### 1. No Manual Intervention Required
- Eliminates "Continue" button clicks
- Reduces human error
- Enables true automation

### 2. Clear Validation Rules
- Explicit entry criteria for each state
- Transparent reasoning when blocked
- Actionable suggestions for resolution

### 3. Consistent Enforcement
- Rules applied uniformly across all issues
- No bypassing of requirements
- Audit trail of validation decisions

### 4. Flexible Context
- Extensible context structure
- Optional conditions (e.g., security checks)
- Configurable thresholds (e.g., coverage percentage)

### 5. Integration Ready
- Works with workflow engine
- Compatible with GitHub webhooks
- Usable in UI components
- Available to MCP tools

## Configuration

### Adjustable Thresholds

Currently, thresholds are hardcoded but can be made configurable:

```typescript
// In validateVerifiedTransition
const minCoverage = 70; // TODO: Make configurable

// Could become:
const minCoverage = config.qa.minCoveragePercent || 70;
```

### Custom Guardrails

Additional guardrails can be added for organization-specific needs:

```typescript
// Add custom guardrail
function validateCustomTransition(
  context: StateTransitionContext
): GuardrailValidationResult {
  // Custom validation logic
}

// Use in validateStateTransition
switch (toState) {
  case IssueState.CUSTOM_STATE:
    return validateCustomTransition(context);
}
```

## Best Practices

1. **Always provide context**: Populate as much context as possible for accurate validation
2. **Handle failed validations gracefully**: Show clear messages and actionable suggestions
3. **Log validation decisions**: Use the built-in logging for audit trails
4. **Test guardrails thoroughly**: Ensure validation logic is correct and comprehensive
5. **Update context dynamically**: Refresh context before validation to ensure accuracy
6. **Respect state machine rules**: Guardrails complement, not replace, the state machine

## Future Enhancements

### 1. Configurable Thresholds
Make validation thresholds configurable per organization or project:
- Test coverage percentage
- Required review count
- Security check requirements

### 2. Custom Guardrail Extensions
Allow organizations to define custom guardrails:
- Custom validation functions
- Organization-specific rules
- Project-specific requirements

### 3. Automatic Retries
Automatically retry transitions when conditions change:
- Poll for condition changes
- Webhook-driven re-evaluation
- Scheduled validation checks

### 4. Detailed Audit Logs
Enhanced logging of validation decisions:
- Store validation history
- Track condition changes over time
- Generate compliance reports

### 5. UI Indicators
Rich UI feedback for transition status:
- Progress bars for completion
- Real-time condition monitoring
- Estimated time to readiness

## Related Documentation

- [Issue State Machine](./ISSUE_STATE_MACHINE.md) - Canonical state definitions
- [Issue State Usage Examples](./examples/ISSUE_STATE_USAGE.md) - Code examples
- [Workflow Schema](./WORKFLOW-SCHEMA.md) - Workflow integration
- [Database Schema](./architecture/database-schema.md) - Data persistence

## Changelog

### Version 1.0 (2025-12-19)
- Initial implementation
- Three guarded transitions: SPEC_READY, VERIFIED, MERGE_READY
- Comprehensive validation functions
- 37 passing tests
- Complete documentation
