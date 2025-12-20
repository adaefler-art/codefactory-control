# Issue B3 Quick Reference

**Issue B3: Verdict als Gate vor Deploy**

## TL;DR

✅ **No deployment without GREEN verdict**

All deployment workflows now check the verdict before deploying to ECS. Only GREEN verdicts allow deployment to proceed.

## How It Works

```
┌─────────────┐
│   Verdict   │
│   (GREEN,   │
│  RED, HOLD, │
│   RETRY)    │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ Deployment Gate     │
│ Check               │
└──────┬──────┬───────┘
       │      │
     GREEN   OTHER
       │      │
       ▼      ▼
   ┌─────┐ ┌────────┐
   │ALLOW│ │ BLOCK  │
   └─────┘ └────────┘
```

## Verdict Rules

| Verdict | Deployment | Action | Why |
|---------|------------|--------|-----|
| **GREEN** 🟢 | ✅ ALLOWED | ADVANCE | All checks passed |
| **RED** 🔴 | ❌ BLOCKED | ABORT | Critical failure |
| **HOLD** 🟡 | ❌ BLOCKED | FREEZE | Needs human review |
| **RETRY** 🔵 | ❌ BLOCKED | RETRY | Transient condition |

## Usage in Code

### TypeScript/JavaScript

```typescript
import { checkDeploymentGate, SimpleVerdict } from '@codefactory/verdict-engine';

// Check deployment gate
const result = checkDeploymentGate(SimpleVerdict.GREEN);

if (result.allowed) {
  console.log('✅ Deploying...');
  await deploy();
} else {
  console.error('❌', result.reason);
  process.exit(1);
}
```

### CI/CD (GitHub Actions)

```yaml
- name: Check deployment verdict gate
  env:
    DEPLOYMENT_VERDICT: ${{ vars.DEPLOYMENT_VERDICT || 'GREEN' }}
  run: |
    node scripts/check-deployment-gate.js "$DEPLOYMENT_VERDICT"
```

### Command Line

```bash
# Allow deployment (exit code 0)
node scripts/check-deployment-gate.js GREEN

# Block deployment (exit code 1)
node scripts/check-deployment-gate.js RED
```

## Configuration

### Set Deployment Verdict

GitHub repository variables:

1. Go to **Settings** → **Secrets and variables** → **Actions** → **Variables**
2. Add variable: `DEPLOYMENT_VERDICT`
3. Set value: `GREEN`, `RED`, `HOLD`, or `RETRY`

**Default:** If not set, defaults to `GREEN` (allows deployment)

### Override for Emergency

To block all deployments temporarily:

```bash
# Set repository variable
DEPLOYMENT_VERDICT=RED

# Or set in workflow manually
DEPLOYMENT_VERDICT=HOLD
```

## Files Modified

### Core Implementation
- `packages/verdict-engine/src/deployment-gate.ts` - Gate logic
- `packages/verdict-engine/src/index.ts` - Exports
- `packages/verdict-engine/__tests__/deployment-gate.test.ts` - Tests (38 passing)

### CI/CD Integration
- `scripts/check-deployment-gate.js` - CLI script
- `.github/workflows/deploy-stage.yml` - Stage deployment
- `.github/workflows/deploy-prod.yml` - Production deployment
- `.github/workflows/deploy-ecs.yml` - Generic ECS deployment

### Documentation
- `IMPLEMENTATION_SUMMARY_ISSUE_B3.md` - Full implementation summary
- `packages/verdict-engine/README.md` - Updated with deployment gate section

## Examples

### Example 1: GREEN Verdict

```bash
$ node scripts/check-deployment-gate.js GREEN

========================================
AFU-9 Deployment Gate Check
========================================

Verdict: GREEN
Action:  ADVANCE

✅ Deployment allowed: Verdict is GREEN (all checks passed)

Deployment is ALLOWED to proceed.
```

**Exit code:** 0 (success)

### Example 2: RED Verdict

```bash
$ node scripts/check-deployment-gate.js RED

========================================
AFU-9 Deployment Gate Check
========================================

Verdict: RED
Action:  ABORT

❌ Deployment BLOCKED: Verdict is RED (critical failure detected). Fix the issues and retry.

Deployment is BLOCKED.

Required action:
  • ABORT: Fix critical issues before retrying deployment
```

**Exit code:** 1 (failure)

### Example 3: HOLD Verdict

```bash
$ node scripts/check-deployment-gate.js HOLD

========================================
AFU-9 Deployment Gate Check
========================================

Verdict: HOLD
Action:  FREEZE

❌ Deployment BLOCKED: Verdict is HOLD (requires human review). Manual intervention needed.

Deployment is BLOCKED.

Required action:
  • FREEZE: Requires human review and manual approval
```

**Exit code:** 1 (failure)

## API Reference

### checkDeploymentGate(verdict)

Check if deployment should be allowed.

**Parameters:**
- `verdict`: `SimpleVerdict | VerdictType | Verdict`

**Returns:** `DeploymentGateResult`
```typescript
{
  allowed: boolean;
  verdict: SimpleVerdict;
  action: SimpleAction;
  reason: string;
  originalVerdictType?: VerdictType;
}
```

### validateDeploymentGate(verdict)

Validate deployment gate, throwing error if not allowed.

**Parameters:**
- `verdict`: `SimpleVerdict | VerdictType | Verdict`

**Throws:** Error if deployment is not allowed

### isDeploymentAllowed(verdict)

Simple boolean check.

**Parameters:**
- `verdict`: `SimpleVerdict | VerdictType | Verdict`

**Returns:** `boolean`

## Testing

All tests passing:

```bash
cd packages/verdict-engine
npm test

# Test Suites: 3 passed, 3 total
# Tests:       106 passed, 106 total
```

**Deployment Gate Tests:** 38 tests
- All SimpleVerdicts (GREEN, RED, HOLD, RETRY)
- All VerdictTypes (7 types)
- Full Verdict objects
- Error messages
- API consistency

## Related

- **Issue B2:** Simplified Verdict → Action Mapping (foundation)
- **EPIC B:** Verdict Types for Decision Authority (parent)
- **EPIC 2:** Governance & Auditability (context)

## See Also

- [IMPLEMENTATION_SUMMARY_ISSUE_B3.md](../IMPLEMENTATION_SUMMARY_ISSUE_B3.md) - Complete implementation
- [packages/verdict-engine/README.md](../packages/verdict-engine/README.md) - Verdict Engine docs
- [ISSUE_B2_QUICK_REFERENCE.md](./ISSUE_B2_QUICK_REFERENCE.md) - Simplified verdict system
