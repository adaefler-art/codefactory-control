# Issue B2: Simplified Verdict → Action Mapping

**Issue ID:** B2  
**Status:** ✅ Implemented  
**Date:** 2025-12-20

## Ziel (Goal)

Jedes Verdict hat exakt eine Wirkung (Each verdict has exactly one action).

## Implementation

### Simplified Verdict System

A new simplified verdict classification has been added to complement the existing detailed `VerdictType` enum. The simplified system provides a higher-level abstraction with exactly one action per verdict.

| Verdict | Wirkung (Action) | Description |
|---------|------------------|-------------|
| **GREEN** | Advance/Deploy/Next State | Proceed to next workflow state |
| **RED** | Abort/Rollback/Kill | Stop and potentially rollback |
| **HOLD** | Freeze + Human Review | Pause for manual intervention |
| **RETRY** | Deterministic retry attempt | Retry after delay |

### New Types

#### SimpleVerdict Enum

```typescript
export enum SimpleVerdict {
  GREEN = 'GREEN',    // Advance/Deploy/Next State
  RED = 'RED',        // Abort/Rollback/Kill
  HOLD = 'HOLD',      // Freeze + Human Review
  RETRY = 'RETRY',    // Deterministic retry attempt
}
```

#### SimpleAction Enum

```typescript
export enum SimpleAction {
  ADVANCE = 'ADVANCE',              // Continue to next state
  ABORT = 'ABORT',                  // Stop and rollback
  FREEZE = 'FREEZE',                // Pause for human review
  RETRY_OPERATION = 'RETRY_OPERATION', // Retry with delay
}
```

### Mappings

#### 1. SimpleVerdict → SimpleAction (1:1)

```typescript
const SIMPLE_VERDICT_TO_ACTION: Record<SimpleVerdict, SimpleAction> = {
  GREEN: SimpleAction.ADVANCE,
  RED: SimpleAction.ABORT,
  HOLD: SimpleAction.FREEZE,
  RETRY: SimpleAction.RETRY_OPERATION,
}
```

This is the core mapping that satisfies the requirement: **each verdict has exactly one action**.

#### 2. VerdictType → SimpleVerdict

```typescript
const VERDICT_TYPE_TO_SIMPLE: Record<VerdictType, SimpleVerdict> = {
  APPROVED: SimpleVerdict.GREEN,
  WARNING: SimpleVerdict.GREEN,      // Proceed with caution
  REJECTED: SimpleVerdict.RED,
  ESCALATED: SimpleVerdict.HOLD,
  BLOCKED: SimpleVerdict.HOLD,
  DEFERRED: SimpleVerdict.RETRY,
  PENDING: SimpleVerdict.RETRY,
}
```

This mapping converts the detailed 7-type `VerdictType` system to the simplified 4-type system.

### Utility Functions

#### `toSimpleVerdict(verdictType: VerdictType): SimpleVerdict`

Converts a detailed verdict type to a simplified verdict.

```typescript
const simpleVerdict = toSimpleVerdict(VerdictType.APPROVED);
// Returns: SimpleVerdict.GREEN
```

#### `getSimpleAction(simpleVerdict: SimpleVerdict): SimpleAction`

Gets the exact action for a simple verdict (1:1 mapping).

```typescript
const action = getSimpleAction(SimpleVerdict.GREEN);
// Returns: SimpleAction.ADVANCE
```

#### `getActionForVerdictType(verdictType: VerdictType): SimpleAction`

Convenience function that directly converts a detailed verdict type to its action.

```typescript
const action = getActionForVerdictType(VerdictType.APPROVED);
// Returns: SimpleAction.ADVANCE
```

#### `validateSimpleVerdictMapping(): { valid: boolean; issues: string[] }`

Validates that the mapping is complete and deterministic.

```typescript
const validation = validateSimpleVerdictMapping();
// Returns: { valid: true, issues: [] }
```

## Usage Examples

### Example 1: Workflow Automation

```typescript
import { 
  generateVerdict, 
  toSimpleVerdict, 
  getSimpleAction 
} from '@codefactory/verdict-engine';

// Generate detailed verdict from failure signals
const verdict = generateVerdict({
  execution_id: 'exec-123',
  policy_snapshot_id: 'policy-v1',
  signals: [...],
});

// Convert to simplified verdict for workflow decision
const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
const action = getSimpleAction(simpleVerdict);

// Take action based on simple verdict
switch (action) {
  case SimpleAction.ADVANCE:
    await proceedToNextStage();
    break;
  case SimpleAction.ABORT:
    await abortWorkflow();
    break;
  case SimpleAction.FREEZE:
    await requestHumanReview();
    break;
  case SimpleAction.RETRY_OPERATION:
    await scheduleRetry();
    break;
}
```

### Example 2: Quick Decision Making

```typescript
import { getActionForVerdictType } from '@codefactory/verdict-engine';

// Get action directly from verdict type
const action = getActionForVerdictType(verdict.verdict_type);

if (action === SimpleAction.ADVANCE) {
  console.log('✅ Deployment approved - proceeding');
} else if (action === SimpleAction.ABORT) {
  console.log('❌ Deployment rejected - aborting');
}
```

### Example 3: Dashboard Display

```typescript
import { SimpleVerdict, SimpleAction } from '@codefactory/verdict-engine';

function getVerdictColor(verdict: SimpleVerdict): string {
  switch (verdict) {
    case SimpleVerdict.GREEN:
      return '🟢 Green';
    case SimpleVerdict.RED:
      return '🔴 Red';
    case SimpleVerdict.HOLD:
      return '🟡 Yellow';
    case SimpleVerdict.RETRY:
      return '🔵 Blue';
  }
}

function getActionDescription(action: SimpleAction): string {
  switch (action) {
    case SimpleAction.ADVANCE:
      return 'Advancing to next state';
    case SimpleAction.ABORT:
      return 'Aborting deployment';
    case SimpleAction.FREEZE:
      return 'Awaiting human review';
    case SimpleAction.RETRY_OPERATION:
      return 'Retrying operation';
  }
}
```

## Mapping Details

### VerdictType → SimpleVerdict → SimpleAction

| VerdictType | SimpleVerdict | SimpleAction | Description |
|-------------|---------------|--------------|-------------|
| APPROVED | GREEN | ADVANCE | Safe to proceed |
| WARNING | GREEN | ADVANCE | Proceed with caution |
| REJECTED | RED | ABORT | Critical failure |
| ESCALATED | HOLD | FREEZE | Human review required |
| BLOCKED | HOLD | FREEZE | Resource lock/constraint |
| DEFERRED | RETRY | RETRY_OPERATION | Transient condition |
| PENDING | RETRY | RETRY_OPERATION | In progress |

## Determinism Guarantee

The mapping system guarantees deterministic behavior:

1. **1:1 Mapping**: Each `SimpleVerdict` maps to exactly one `SimpleAction`
2. **Immutable**: Mappings are defined as const and cannot be modified
3. **Complete**: All `VerdictType` values have a mapping to `SimpleVerdict`
4. **Tested**: Comprehensive test suite validates determinism

## Testing

The implementation includes 43 comprehensive tests covering:

- ✅ 1:1 mapping validation (GREEN→ADVANCE, RED→ABORT, etc.)
- ✅ VerdictType conversion to SimpleVerdict
- ✅ Direct VerdictType to SimpleAction conversion
- ✅ Mapping completeness and consistency
- ✅ Determinism across multiple invocations
- ✅ Practical usage scenarios
- ✅ Issue B2 specification compliance

Run tests with:

```bash
cd packages/verdict-engine
npm test
```

All 68 tests pass (including 43 new tests for Issue B2).

## Integration with Existing System

The simplified verdict system complements the existing detailed system:

- **Existing**: 7 VerdictTypes + 3 FactoryActions (detailed classification)
- **New**: 4 SimpleVerdicts + 4 SimpleActions (operational decisions)

Both systems coexist and can be used together:

- Use `VerdictType` for detailed analysis and auditability
- Use `SimpleVerdict`/`SimpleAction` for workflow automation and UI

## API Reference

### Exports

```typescript
// Enums
export { SimpleVerdict, SimpleAction } from './types';

// Functions
export {
  toSimpleVerdict,
  getSimpleAction,
  getActionForVerdictType,
  validateSimpleVerdictMapping,
} from './engine';

// Constants
export {
  SIMPLE_VERDICT_TO_ACTION,
  VERDICT_TYPE_TO_SIMPLE,
  SIMPLE_VERDICTS,
  SIMPLE_ACTIONS,
} from './constants';
```

## Files Changed

1. **packages/verdict-engine/src/types.ts**
   - Added `SimpleVerdict` enum
   - Added `SimpleAction` enum

2. **packages/verdict-engine/src/constants.ts**
   - Added `SIMPLE_VERDICT_TO_ACTION` mapping
   - Added `VERDICT_TYPE_TO_SIMPLE` mapping
   - Added `SIMPLE_VERDICTS` and `SIMPLE_ACTIONS` arrays

3. **packages/verdict-engine/src/engine.ts**
   - Added `toSimpleVerdict()` function
   - Added `getSimpleAction()` function
   - Added `getActionForVerdictType()` function
   - Added `validateSimpleVerdictMapping()` function

4. **packages/verdict-engine/src/index.ts**
   - Exported new types, functions, and constants

5. **packages/verdict-engine/__tests__/simple-verdict.test.ts**
   - Added 43 comprehensive tests for Issue B2

## Backward Compatibility

✅ **Fully backward compatible**

- Existing `VerdictType` system unchanged
- Existing `FactoryAction` system unchanged
- New types and functions are additive
- No breaking changes to existing APIs

## Documentation Updates

- ✅ README.md - Updated with SimpleVerdict system
- ✅ This document (ISSUE_B2_IMPLEMENTATION.md) - Complete implementation guide

## Acceptance Criteria

✅ **All criteria met:**

1. ✅ Each verdict (GREEN, RED, HOLD, RETRY) has exactly one action
2. ✅ Mapping is deterministic and immutable
3. ✅ Complete test coverage (43 tests)
4. ✅ Integration with existing VerdictType system
5. ✅ Documentation complete
6. ✅ Backward compatible

## Next Steps

The simplified verdict system is ready for use in:

1. **Workflow automation** - Use `SimpleAction` for state machine transitions
2. **UI/Dashboard** - Display simple verdicts with color coding
3. **Alerting** - Trigger different alerts based on `SimpleVerdict`
4. **Metrics** - Track distribution of GREEN/RED/HOLD/RETRY verdicts

## Related Documentation

- [Verdict Types](../../docs/VERDICT_TYPES.md) - Detailed VerdictType documentation
- [Verdict Engine README](./README.md) - Complete package documentation
- [Confidence Score Schema](../../docs/CONFIDENCE_SCORE_SCHEMA.md) - Confidence normalization
