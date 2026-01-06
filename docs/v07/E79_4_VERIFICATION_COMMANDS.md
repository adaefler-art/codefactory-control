# E79.4 Verification Commands

## Test the Guardrail Gates Library

Run the test suite to verify all 40 tests pass:

```powershell
# Run guardrail gates tests only
npm --prefix control-center test -- __tests__/lib/guardrail-gates.test.ts

# Expected output:
# Test Suites: 1 passed, 1 total
# Tests:       40 passed, 40 total
```

## Build the Control Center

Build the Next.js application:

```powershell
# Build control-center
npm --prefix control-center run build
```

Note: There may be pre-existing build issues with the `@codefactory/deploy-memory` package that are unrelated to this PR.

## Verify Repository

Run repository verification:

```powershell
# Verify repository structure and integrity
npm run repo:verify
```

## Test Coverage Breakdown

The test suite covers all gate functions with the following scenarios:

### computeInputsHash (4 tests)
- ✅ Deterministic hash for same inputs (different key order)
- ✅ Different hash for different inputs
- ✅ Nested objects handled deterministically
- ✅ Arrays in inputs handled correctly

### gatePlaybookAllowed (13 tests)
- ✅ Deny-by-default (no lawbook, remediation disabled, playbook not allowed)
- ✅ Evidence gating (missing evidence, all evidence present)
- ✅ MaxRunsPerIncident policy (exceeded, under limit)
- ✅ Cooldown policy (active, expired)
- ✅ Deterministic verdicts
- ✅ Includes lawbookVersion and generatedAt

### gateActionAllowed (4 tests)
- ✅ Deny-by-default (no lawbook, action not allowed)
- ✅ Allow when action in list
- ✅ Deterministic verdicts

### gateEvidence (4 tests)
- ✅ Deny when evidence missing (with sorted missing kinds)
- ✅ Allow when all evidence present
- ✅ Deterministic verdicts with sorted missing kinds
- ✅ No lawbook required

### gateDeterminismRequired (7 tests)
- ✅ Deny when no lawbook
- ✅ Allow when determinism not required
- ✅ Hold when report missing
- ✅ Hold when report pending
- ✅ Deny when report failed
- ✅ Allow when report passed
- ✅ Deterministic verdicts

### gateIdempotencyKeyFormat (7 tests)
- ✅ Deny when key too long
- ✅ Deny when invalid characters (spaces, special chars)
- ✅ Allow valid alphanumeric keys
- ✅ Allow hyphens, underscores, colons
- ✅ Respect custom maxLength
- ✅ Deterministic verdicts
- ✅ No lawbook required

### GateVerdict schema (1 test)
- ✅ Deterministic reason ordering

## Example Usage

```typescript
import { gatePlaybookAllowed, gateActionAllowed } from './lib/guardrail-gates';
import { loadActiveLawbook } from './lib/db/lawbook';

// Load active lawbook
const lawbook = await loadActiveLawbook();

// Check if playbook is allowed
const verdict = gatePlaybookAllowed(
  {
    playbookId: 'SAFE_RETRY_RUNNER',
    incidentCategory: 'workflow_failure',
    evidenceKinds: ['github_workflow_run', 'error_log'],
    currentRunCount: 1,
  },
  lawbook
);

if (verdict.verdict === 'ALLOW') {
  // Proceed with remediation
  console.log('Playbook allowed:', verdict.reasons);
} else {
  // Reject or hold
  console.log('Playbook denied/held:', verdict.reasons);
}

// Check if action is allowed
const actionVerdict = gateActionAllowed(
  { actionType: 'runner_dispatch' },
  lawbook
);
```

## Files Changed Summary

| File | Lines | Description |
|------|-------|-------------|
| `control-center/src/lib/guardrail-gates.ts` | +493 | Core library implementation |
| `control-center/__tests__/lib/guardrail-gates.test.ts` | +618 | Comprehensive test suite |
| `E79_4_IMPLEMENTATION_SUMMARY.md` | +207 | Documentation and examples |
| `control-center/package-lock.json` | ±33 | Dependency updates |

**Total:** 1,330 lines added/modified

## Success Criteria

✅ All 40 tests passing  
✅ Deny-by-default verified  
✅ Deterministic verdicts verified  
✅ Transparent reasons with rule IDs  
✅ No LLM usage (pure rule evaluation)  
✅ Code review feedback addressed  
✅ Ready for integration  
