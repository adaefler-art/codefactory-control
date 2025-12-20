# Human Intervention Policy (Issue A3)

**Status**: Canonical  
**Version**: 1.0  
**Issue Reference**: Issue A3 — Human-Touchpoint formal begrenzen  
**Date**: 2025-12-19

## Overview

This document defines the **formal constraints on human touchpoints** in the AFU-9 system. The policy restricts when and how humans may intervene in the autonomous workflow, ensuring that automation remains the primary driver while allowing necessary human oversight in controlled circumstances.

## Policy Statement

**Humans may ONLY intervene in the following circumstances:**

1. **Issue State = HOLD**
   - Issue is explicitly paused for human review
   - Manual transitions in/out of HOLD are permitted
   
2. **Issue State = KILLED**
   - Issue is cancelled and requires human decision
   - Can manually kill an issue from any state
   
3. **Verdict Action = HUMAN_REQUIRED**
   - Verdict engine explicitly requires human intervention
   - Applies to specific error classes (e.g., Route53 delegation, manual DNS configuration)

**All other manual interventions are FORBIDDEN.**

## Rationale

### Why Restrict Human Interventions?

1. **Consistency**: Automated decisions are uniform and repeatable
2. **Auditability**: Clear distinction between automated and manual actions
3. **Scale**: Humans cannot manually manage high-volume workflows
4. **Quality**: Guardrails ensure objective criteria are met before progression
5. **Governance**: Formal policy prevents informal workarounds

### Why Allow Intervention in HOLD?

- HOLD is the designated state for human review and intervention
- Provides an explicit "escape hatch" when automation cannot proceed
- Maintains audit trail of when and why human intervention occurred

### Why Allow Intervention with HUMAN_REQUIRED Verdict?

- Some error classes genuinely require human action (e.g., DNS delegation)
- Verdict engine has high confidence that automation cannot resolve
- Policy acknowledges the limits of automation

## Technical Enforcement

The policy is enforced through code, not just documentation:

### Implementation

**Module**: `control-center/src/lib/types/human-intervention-policy.ts`

**Core Functions**:
- `checkHumanInterventionPolicy()` - Validates if intervention is allowed
- `checkManualStateTransition()` - Validates manual state transitions
- `validateManualActionContext()` - Ensures required context is provided

### Policy Rules

#### Rule 1: Automatic Actions Always Allowed

```typescript
if (!context.isManualAction) {
  return { allowed: true, policyRule: 'RULE_1_AUTOMATIC_ACTIONS_ALLOWED' };
}
```

Automatic actions (triggered by guardrails, workflows, webhooks) are never restricted.

#### Rule 2a: Manual Intervention in Allowed States

```typescript
if (currentState === IssueState.HOLD || currentState === IssueState.KILLED) {
  return { allowed: true, policyRule: 'RULE_2A_ALLOWED_STATE' };
}
```

Manual intervention is permitted when the issue is in HOLD or KILLED state.

#### Rule 2b: Verdict Requires Human

```typescript
if (verdictAction === 'HUMAN_REQUIRED') {
  return { allowed: true, policyRule: 'RULE_2B_VERDICT_REQUIRES_HUMAN' };
}
```

Manual intervention is permitted when the verdict explicitly requires it.

#### Rule 3: Intermediate State Blocked

```typescript
// All other manual interventions are forbidden
return {
  allowed: false,
  policyRule: 'RULE_3_INTERMEDIATE_STATE_BLOCKED',
  violation: 'Manual intervention not allowed in intermediate state',
};
```

Manual intervention in intermediate states (CREATED, SPEC_READY, IMPLEMENTING, VERIFIED, MERGE_READY) is blocked.

## Allowed and Forbidden Actions

### ✅ Allowed Actions

| Action | From State | To State | Reason |
|--------|-----------|----------|--------|
| Put on HOLD | Any | HOLD | Explicit human review needed |
| Resume from HOLD | HOLD | Any | Resume automated workflow |
| Kill issue | Any | KILLED | Cancel work |
| Intervene with verdict | Any | Any | HUMAN_REQUIRED verdict |
| Automatic transition | Any | Any | Guardrails validate transition |

### ❌ Forbidden Actions

| Action | From State | To State | Reason |
|--------|-----------|----------|--------|
| Manual advance | CREATED | SPEC_READY | Spec must be validated automatically |
| Manual advance | IMPLEMENTING | VERIFIED | Tests must pass automatically (green) |
| Manual advance | VERIFIED | MERGE_READY | Merge checks must pass automatically |
| Manual advance | MERGE_READY | DONE | Merge must complete automatically |
| Skip validation | Any intermediate | Any | Bypasses guardrails |

## Usage

### Checking Policy Before Action

```typescript
import {
  checkHumanInterventionPolicy,
  HumanInterventionContext,
} from '@/lib/types/human-intervention-policy';

// Manual action check
const context: HumanInterventionContext = {
  currentState: IssueState.IMPLEMENTING,
  targetState: IssueState.VERIFIED,
  isManualAction: true,
  initiatedBy: 'user@example.com',
  reason: 'Want to advance manually',
};

const result = checkHumanInterventionPolicy(context);

if (!result.allowed) {
  console.error('Policy violation:', result.violation);
  console.log('Suggestions:', result.suggestions);
  // Block the action
}
```

### Checking Manual State Transition

```typescript
import { checkManualStateTransition } from '@/lib/types/human-intervention-policy';

const result = checkManualStateTransition(
  IssueState.IMPLEMENTING,
  IssueState.VERIFIED,
  'user@example.com',
  'Tests look good'
);

if (!result.allowed) {
  throw new Error(`Policy violation: ${result.violation}`);
}
```

### Validating Context

```typescript
import { validateManualActionContext } from '@/lib/types/human-intervention-policy';

const errors = validateManualActionContext(context);

if (errors.length > 0) {
  throw new Error(`Invalid context: ${errors.join(', ')}`);
}
```

## Integration Points

### 1. State Transition Guardrails

The human intervention policy **complements** the state transition guardrails (Issue A2):

- **Guardrails** ensure transitions only occur when validation criteria are met
- **Intervention Policy** ensures those criteria are evaluated automatically, not manually

```typescript
// In state transition logic
async function transitionIssueState(
  issueId: string,
  fromState: IssueState,
  toState: IssueState,
  initiatedBy: string,
  reason?: string
) {
  // Check if manual transition is allowed by policy
  const policyCheck = checkManualStateTransition(
    fromState,
    toState,
    initiatedBy,
    reason
  );
  
  if (!policyCheck.allowed) {
    throw new PolicyViolationError(policyCheck.violation);
  }
  
  // Check if transition meets guardrail requirements
  const context = await buildTransitionContext(issueId);
  const guardResult = validateStateTransition(fromState, toState, context);
  
  if (!guardResult.allowed) {
    throw new GuardrailViolationError(guardResult.reason);
  }
  
  // Both checks passed - perform transition
  await updateIssueState(issueId, toState);
}
```

### 2. Workflow Engine

Workflows flag actions as automatic:

```typescript
interface WorkflowStepExecution {
  isManualAction: false; // Always false for workflow-driven actions
  initiatedBy: 'workflow-engine';
}
```

### 3. API Endpoints

API endpoints must enforce the policy:

```typescript
export async function POST(request: Request) {
  const { issueId, targetState, initiatedBy, reason } = await request.json();
  
  // Validate policy
  const context: HumanInterventionContext = {
    currentState: issue.state,
    targetState,
    isManualAction: true, // User-initiated via API
    initiatedBy,
    reason,
  };
  
  const policyResult = checkHumanInterventionPolicy(context);
  
  if (!policyResult.allowed) {
    return Response.json(
      { error: policyResult.violation, suggestions: policyResult.suggestions },
      { status: 403 }
    );
  }
  
  // Proceed with transition
  await transitionIssueState(issueId, issue.state, targetState, initiatedBy, reason);
  return Response.json({ success: true });
}
```

### 4. UI Components

UI should show/hide manual controls based on policy:

```tsx
const ManualTransitionButton = ({ issue, targetState }) => {
  const [policyCheck, setPolicyCheck] = useState(null);
  
  useEffect(() => {
    const context = {
      currentState: issue.state,
      targetState,
      isManualAction: true,
      initiatedBy: currentUser.email,
    };
    
    const result = checkHumanInterventionPolicy(context);
    setPolicyCheck(result);
  }, [issue, targetState]);
  
  if (!policyCheck?.allowed) {
    return (
      <Tooltip content={policyCheck?.violation}>
        <Button disabled>
          Manual Transition Not Allowed
        </Button>
      </Tooltip>
    );
  }
  
  return <Button onClick={handleTransition}>Transition to {targetState}</Button>;
};
```

## Audit Trail

All manual interventions must be logged:

```typescript
interface ManualInterventionLog {
  id: string;
  timestamp: string;
  issueId: string;
  fromState: IssueState;
  toState: IssueState;
  initiatedBy: string;
  reason: string;
  policyRule: string; // Which rule allowed it
  verdict?: {
    action: FactoryAction;
    confidence: number;
  };
}
```

## Violation Handling

### When Policy is Violated

1. **Block the action** - Do not allow it to proceed
2. **Log the attempt** - Record who tried and why
3. **Return clear error** - Explain the policy and suggest alternatives
4. **Notify if needed** - Alert on repeated violations

### Error Response Format

```typescript
{
  error: 'Policy violation',
  violation: 'Manual intervention not allowed in state IMPLEMENTING',
  policyRule: 'RULE_3_INTERMEDIATE_STATE_BLOCKED',
  suggestions: [
    'Use automatic state transitions with guardrails',
    'Put issue on HOLD if manual review is needed',
    'Wait for verdict to require human intervention',
  ],
}
```

## Examples

### Example 1: Automatic Transition (Allowed)

```typescript
// Guardrail evaluates QA results and automatically transitions
const context: HumanInterventionContext = {
  currentState: IssueState.IMPLEMENTING,
  targetState: IssueState.VERIFIED,
  isManualAction: false, // Automatic
};

const result = checkHumanInterventionPolicy(context);
// Result: { allowed: true, policyRule: 'RULE_1_AUTOMATIC_ACTIONS_ALLOWED' }
```

### Example 2: Put on HOLD (Allowed)

```typescript
// User puts issue on HOLD for manual review
const result = checkManualStateTransition(
  IssueState.IMPLEMENTING,
  IssueState.HOLD,
  'developer@example.com',
  'Need architecture review'
);
// Result: { allowed: true, policyRule: 'RULE_TRANSITION_TO_HOLD_OR_KILLED' }
```

### Example 3: Resume from HOLD (Allowed)

```typescript
// User resumes from HOLD after review
const result = checkManualStateTransition(
  IssueState.HOLD,
  IssueState.IMPLEMENTING,
  'developer@example.com',
  'Review complete, resuming work'
);
// Result: { allowed: true, policyRule: 'RULE_TRANSITION_FROM_HOLD' }
```

### Example 4: Manual Skip Verification (Forbidden)

```typescript
// User tries to skip QA verification
const result = checkManualStateTransition(
  IssueState.IMPLEMENTING,
  IssueState.VERIFIED,
  'developer@example.com',
  'Tests look good to me'
);
// Result: {
//   allowed: false,
//   policyRule: 'RULE_INTERMEDIATE_TRANSITION_BLOCKED',
//   violation: 'Manual transition between intermediate states (IMPLEMENTING → VERIFIED) violates policy',
//   suggestions: ['Transition to VERIFIED must be automatic based on guardrails', ...]
// }
```

### Example 5: Verdict Requires Human (Allowed)

```typescript
// DNS delegation requires manual configuration
const context: HumanInterventionContext = {
  currentState: IssueState.IMPLEMENTING,
  verdictAction: 'HUMAN_REQUIRED',
  isManualAction: true,
  initiatedBy: 'operator@example.com',
  reason: 'Route53 delegation requires nameserver configuration',
};

const result = checkHumanInterventionPolicy(context);
// Result: { allowed: true, policyRule: 'RULE_2B_VERDICT_REQUIRES_HUMAN' }
```

## Testing

**Test Suite**: `control-center/__tests__/lib/human-intervention-policy.test.ts`

**Coverage**: 36 tests, all passing ✅

Test categories:
- ✅ Policy constant definitions (2 tests)
- ✅ Automatic actions (2 tests)
- ✅ Manual actions in allowed states (2 tests)
- ✅ Manual actions with verdict requirement (2 tests)
- ✅ Forbidden manual interventions (6 tests)
- ✅ Manual state transitions - allowed (3 tests)
- ✅ Manual state transitions - forbidden (5 tests)
- ✅ Context validation (5 tests)
- ✅ Policy description (3 tests)
- ✅ Integration scenarios (6 tests)

Run tests:
```bash
cd control-center
npm test -- __tests__/lib/human-intervention-policy.test.ts
```

## Governance

### Policy Changes

Any changes to this policy require:

1. **RFC Process**: Propose change with rationale
2. **Security Review**: Ensure no bypass mechanisms
3. **Team Approval**: Consensus on policy modification
4. **Code Update**: Update enforcement code
5. **Test Update**: Add tests for new rules
6. **Documentation**: Update this canonical document

### Monitoring

Track policy violations:

```sql
-- Query manual intervention attempts
SELECT 
  timestamp,
  issue_id,
  from_state,
  to_state,
  initiated_by,
  policy_rule,
  allowed
FROM manual_intervention_log
WHERE allowed = false
ORDER BY timestamp DESC;
```

## Related Documentation

- [Issue State Machine](./ISSUE_STATE_MACHINE.md) - Canonical state definitions (Issue A1)
- [State Transition Guardrails](./STATE_TRANSITION_GUARDRAILS.md) - Automatic transition rules (Issue A2)
- [Verdict Engine](./VERDICT_ENGINE.md) - HUMAN_REQUIRED action definition
- [Workflow Schema](./WORKFLOW-SCHEMA.md) - Workflow integration

## Changelog

### Version 1.0 (2025-12-19)
- Initial policy definition
- Three policy rules established
- Technical enforcement implemented
- 36 comprehensive tests added
- Complete documentation provided

## Conclusion

The Human Intervention Policy (Issue A3) establishes **formal constraints** on when humans may intervene in the autonomous workflow:

- ✅ **HOLD state** - Explicit human review
- ✅ **KILLED state** - Human cancellation decision
- ✅ **HUMAN_REQUIRED verdict** - System requires human action

All other manual interventions are **technically forbidden** through code enforcement, ensuring that automation remains the primary driver of the AFU-9 system while providing necessary escape hatches for genuine human oversight.
