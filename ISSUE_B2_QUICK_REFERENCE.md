# Issue B2 Quick Reference

**Simplified Verdict → Action Mapping**

## Core Mapping (1:1)

```
GREEN  → ADVANCE           (Advance/Deploy/Next State)
RED    → ABORT             (Abort/Rollback/Kill)
HOLD   → FREEZE            (Freeze + Human Review)
RETRY  → RETRY_OPERATION   (Deterministic retry)
```

## Quick Usage

```typescript
import { 
  SimpleVerdict, 
  SimpleAction, 
  getSimpleAction 
} from '@codefactory/verdict-engine';

// Get action for verdict
const action = getSimpleAction(SimpleVerdict.GREEN);
// Returns: SimpleAction.ADVANCE
```

## Integration with VerdictType

```typescript
import { 
  VerdictType, 
  getActionForVerdictType 
} from '@codefactory/verdict-engine';

// Direct conversion
const action = getActionForVerdictType(VerdictType.APPROVED);
// Returns: SimpleAction.ADVANCE
```

## VerdictType → SimpleVerdict Mapping

```
APPROVED   → GREEN
WARNING    → GREEN
REJECTED   → RED
ESCALATED  → HOLD
BLOCKED    → HOLD
DEFERRED   → RETRY
PENDING    → RETRY
```

## Color Coding

```
GREEN  🟢 - Success, proceed
RED    🔴 - Critical, abort
HOLD   🟡 - Waiting, human review
RETRY  🔵 - Transient, retry
```

## Complete Documentation

- [ISSUE_B2_IMPLEMENTATION.md](packages/verdict-engine/ISSUE_B2_IMPLEMENTATION.md)
- [Verdict Engine README](packages/verdict-engine/README.md)
- [IMPLEMENTATION_SUMMARY_ISSUE_B2.md](IMPLEMENTATION_SUMMARY_ISSUE_B2.md)
