# Issue B6 Quick Reference: Reproduzierbare Verdict-Simulation

**Status**: ✅ Implemented  
**Date**: 2025-12-20

## Problem Statement

**Ziel**: GREEN / HOLD / RED gezielt testbar (Make verdicts specifically testable)

**Acceptance**:
- ✅ Mind. ein absichtlich provozierter HOLD (At least one intentionally triggered HOLD)
- ✅ Mind. ein absichtlich provozierter RED (At least one intentionally triggered RED)

## Solution Summary

Created **VerdictSimulator** helper class to reproducibly trigger any verdict type (GREEN, RED, HOLD, RETRY) with deterministic signal patterns.

## Quick Usage

### Trigger a RED Verdict

```typescript
import { VerdictSimulator } from './verdict-simulation.test';
import { generateVerdict, toSimpleVerdict, getSimpleAction } from '../src/engine';

// Create signals for RED verdict
const signals = VerdictSimulator.createRedSignals_MissingSecret();

// Generate verdict
const verdict = generateVerdict({
  execution_id: 'test-001',
  policy_snapshot_id: 'policy-v1',
  signals,
});

// Verify
expect(verdict.verdict_type).toBe(VerdictType.REJECTED);
expect(toSimpleVerdict(verdict.verdict_type)).toBe(SimpleVerdict.RED);
expect(getSimpleAction(SimpleVerdict.RED)).toBe(SimpleAction.ABORT);
```

### Trigger a HOLD Verdict

```typescript
// Create signals for HOLD verdict
const signals = VerdictSimulator.createHoldSignals_Route53Delegation();

// Generate verdict
const verdict = generateVerdict({
  execution_id: 'test-002',
  policy_snapshot_id: 'policy-v1',
  signals,
});

// Verify
expect(verdict.verdict_type).toBe(VerdictType.ESCALATED);
expect(toSimpleVerdict(verdict.verdict_type)).toBe(SimpleVerdict.HOLD);
expect(getSimpleAction(SimpleVerdict.HOLD)).toBe(SimpleAction.FREEZE);
```

### Trigger a GREEN Verdict

```typescript
// Create signals for GREEN verdict
const signals = VerdictSimulator.createGreenSignals();

// Generate verdict
const verdict = generateVerdict({
  execution_id: 'test-003',
  policy_snapshot_id: 'policy-v1',
  signals,
});

// Verify
expect(verdict.verdict_type).toBe(VerdictType.WARNING);
expect(toSimpleVerdict(verdict.verdict_type)).toBe(SimpleVerdict.GREEN);
expect(getSimpleAction(SimpleVerdict.GREEN)).toBe(SimpleAction.ADVANCE);
```

## VerdictSimulator API

```typescript
class VerdictSimulator {
  // GREEN: Deprecated API warning
  static createGreenSignals(): CfnFailureSignal[]
  
  // RED: Critical failures
  static createRedSignals_MissingSecret(): CfnFailureSignal[]
  static createRedSignals_MissingEnvVar(): CfnFailureSignal[]
  
  // HOLD: Requires human intervention or blocked
  static createHoldSignals_Route53Delegation(): CfnFailureSignal[]
  static createHoldSignals_CfnInProgress(): CfnFailureSignal[]
  static createHoldSignals_CfnRollback(): CfnFailureSignal[]
  
  // RETRY: Transient condition
  static createRetrySignals_AcmDnsValidation(): CfnFailureSignal[]
}
```

## Verdict Mapping Quick Reference

| Verdict | Error Class | Action | Simple Verdict | Simple Action |
|---------|-------------|--------|----------------|---------------|
| **GREEN** | DEPRECATED_CDK_API | OPEN_ISSUE | GREEN | ADVANCE |
| **RED** | MISSING_SECRET | OPEN_ISSUE | RED | ABORT |
| **RED** | MISSING_ENV_VAR | OPEN_ISSUE | RED | ABORT |
| **HOLD** | ROUTE53_DELEGATION_PENDING | HUMAN_REQUIRED | HOLD | FREEZE |
| **HOLD** | CFN_IN_PROGRESS_LOCK | WAIT_AND_RETRY | HOLD | FREEZE |
| **HOLD** | CFN_ROLLBACK_LOCK | OPEN_ISSUE | HOLD | FREEZE |
| **RETRY** | ACM_DNS_VALIDATION_PENDING | WAIT_AND_RETRY | RETRY | RETRY_OPERATION |

## Signal Patterns

### RED: Missing Secret
```typescript
{
  resourceType: 'AWS::Lambda::Function',
  logicalId: 'MyFunction',
  statusReason: 'ResourceNotFoundException: Secrets Manager cannot find the specified secret',
  timestamp: new Date(),
  resourceStatus: 'CREATE_FAILED',
}
```

### HOLD: Route53 Delegation
```typescript
{
  resourceType: 'AWS::Route53::HostedZone',
  logicalId: 'HostedZone',
  statusReason: 'NS records not configured - delegation pending for zone',
  timestamp: new Date(),
  resourceStatus: 'CREATE_COMPLETE',
}
```

### GREEN: Deprecated API
```typescript
{
  resourceType: 'AWS::CDK::Metadata',
  logicalId: 'CDKMetadata',
  statusReason: '[DEPRECATED] API method is deprecated - use new method instead',
  timestamp: new Date(),
}
```

## Running Tests

```bash
# Run all verdict simulation tests
cd packages/verdict-engine
npm test -- verdict-simulation.test.ts

# Run specific test
npm test -- verdict-simulation.test.ts -t "RED Verdict"

# Watch mode
npm test -- verdict-simulation.test.ts --watch
```

## Test Coverage

- **17 total tests**
- **4 RED verdict tests** ✅ (Acceptance met)
- **5 HOLD verdict tests** ✅ (Acceptance met)
- **2 GREEN verdict tests**
- **2 RETRY verdict tests**
- **4 validation tests**

All tests pass with 100% determinism and reproducibility.

## Integration Examples

### Testing Workflow Abort on RED

```typescript
// Create RED verdict
const signals = VerdictSimulator.createRedSignals_MissingSecret();
const verdict = generateVerdict({ signals, ... });

// Verify workflow should abort
const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
expect(simpleVerdict).toBe(SimpleVerdict.RED);

// In workflow engine, this would trigger:
// await abortExecution(executionId, 'system', 'RED verdict - critical failure');
```

### Testing Workflow Pause on HOLD

```typescript
// Create HOLD verdict
const signals = VerdictSimulator.createHoldSignals_Route53Delegation();
const verdict = generateVerdict({ signals, ... });

// Verify workflow should pause
const simpleVerdict = toSimpleVerdict(verdict.verdict_type);
expect(simpleVerdict).toBe(SimpleVerdict.HOLD);

// In workflow engine, this would trigger:
// await pauseExecution(executionId, 'Requires human intervention');
```

## Files

**Implementation**:
- `packages/verdict-engine/__tests__/verdict-simulation.test.ts` - Test suite

**Documentation**:
- `IMPLEMENTATION_SUMMARY_ISSUE_B6.md` - Complete implementation guide
- `ISSUE_B6_QUICK_REFERENCE.md` - This file

## Related Issues

- **Issue B2**: Simplified Verdict → Action Mapping
- **Issue B3**: Verdict als Gate vor Deploy
- **Issue B4**: HOLD Workflow Enforcement
- **Issue B5**: RED Workflow & Rollback

## Benefits

✅ **Reproducible** - Same signals always produce same verdict  
✅ **Deterministic** - 100% consistent across runs  
✅ **Fast** - All tests run in ~1.6 seconds  
✅ **Clear** - Simple API with obvious intent  
✅ **Complete** - Covers all verdict types (GREEN, RED, HOLD, RETRY)

## Next Steps

1. Use `VerdictSimulator` in integration tests
2. Add to CI/CD pipeline
3. Reference in developer documentation
4. Extend with additional signal patterns as needed

---

**Quick Check**: Are verdict simulations working?

```bash
cd packages/verdict-engine
npm test -- verdict-simulation.test.ts

# Expected: PASS with 17 tests ✅
```

**Status**: ✅ **Fully Implemented**
