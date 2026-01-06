# E7.0.1 Implementation Summary

## Issue
**E7.0.1 Deploy Context Guardrail — Stage/Prod strikt trennen (fail-closed)**

## Problem/Context
The incident demonstrated that deploys that were "mentally stage" could technically affect production. Additionally, there was risk of cross-environment secrets/policies contamination.

## Goal
Every deploy is explicitly assigned to an environment and cannot accidentally change the wrong environment. Cross-env secrets/IAM are technically blocked.

## Implementation

### 1. Core Components

#### Central Context Resolver (`scripts/deploy-context-resolver.ts`)
- **Fail-closed**: No defaults, explicit `DEPLOY_ENV` required
- Only accepts `"staging"` or `"production"` (exact strings)
- Returns complete deployment context: environment, cluster, service, imageTagPrefix, secretsPrefix, readyHost

#### Deploy Context Guardrail (`scripts/deploy-context-guardrail.ts`)
- Pre-deployment gate that validates environment boundaries
- Extracts artifact references from environment variables
- Validates prod deploys don't use stage artifacts
- Validates stage deploys don't use prod artifacts
- Displays comprehensive target summary before deployment

### 2. Workflow Integration

**Modified Files:**
- `.github/workflows/deploy-ecs.yml` - Added guardrail step before preflight
- `.github/workflows/deploy-database-stack.yml` - Added guardrail step

**New Step (Example):**
```yaml
- name: Deploy Context Guardrail (E7.0.1)
  shell: bash
  env:
    DEPLOY_ENV: ${{ steps.target.outputs.deploy_env }}
    ECS_SERVICE: ${{ steps.target.outputs.ecs_service }}
    ECS_CLUSTER: ${{ steps.target.outputs.ecs_cluster }}
    CREATE_STAGING_SERVICE: 'false'
  run: |
    ts-node scripts/deploy-context-guardrail.ts
```

### 3. Validation Rules

#### Production Deploy Blocks:
- ❌ Stage secret ARNs (contains `/stage/` or `staging`)
- ❌ Stage image tags (`:stage-*`)
- ❌ Staging service names
- ❌ `CREATE_STAGING_SERVICE=true`

#### Staging Deploy Blocks:
- ❌ Prod service names (missing "staging" in name)
- ❌ Prod image tags (`:prod-*`)

### 4. Test Coverage

**Unit Tests (`scripts/__tests__/deploy-context-guardrail.test.ts`):**
- 16 passing tests
- Context resolver validation
- Production artifact validation
- Staging artifact validation
- Artifact extraction

**Negative Tests (`scripts/test-deploy-context-guardrail-negative.sh`):**
- 10 tests proving guardrail correctly blocks violations
- Tests all cross-env violation scenarios
- Exit code validation

**Positive Tests (`scripts/test-deploy-context-guardrail-positive.sh`):**
- 4 tests proving valid deploys pass
- Tests both production and staging valid scenarios

## Acceptance Criteria

### ✅ AC1: Deploy-Workflow erzwingt explizites DEPLOY_ENV
- No defaults, no "implicit prod"
- Workflow fails if `DEPLOY_ENV` is missing
- Only accepts exact strings: `"staging"` or `"production"`

**Evidence:**
```bash
$ DEPLOY_ENV=prod npx ts-node scripts/deploy-context-guardrail.ts
❌ GUARDRAIL FAIL: Invalid DEPLOY_ENV: "prod". Must be exactly "staging" or "production".
Exit code: 2
```

### ✅ AC2: Hard-fail wenn DEPLOY_ENV=prod und stage-Artefakt
- Blocks stage secret ARNs/names
- Blocks stage image tags
- Blocks staging service names
- Blocks `CREATE_STAGING_SERVICE=true`

**Evidence:**
```bash
$ DEPLOY_ENV=production ECS_SERVICE=afu9-control-center-staging \
  npx ts-node scripts/deploy-context-guardrail.ts

❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:
  - Service name contains "staging": afu9-control-center-staging
Exit code: 1
```

### ✅ AC3: Hard-fail wenn DEPLOY_ENV=stage und prod-only Artefakte
- Blocks prod service names (missing "staging")
- Blocks prod image tags

**Evidence:**
```bash
$ DEPLOY_ENV=staging ECS_SERVICE=afu9-control-center \
  npx ts-node scripts/deploy-context-guardrail.ts

❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:
  - Service name for staging deploy should include "staging": afu9-control-center
Exit code: 1
```

### ✅ AC4: "Target summary" wird vor Apply angezeigt
- Displays environment configuration
- Lists detected artifacts (secrets, images, services)
- Shows feature flags (CREATE_STAGING_SERVICE, etc.)
- Acts as human verification gate

**Evidence:**
```
========================================
DEPLOY CONTEXT GUARDRAIL - TARGET SUMMARY
========================================

Environment Configuration:
  DEPLOY_ENV:           production
  ECS Cluster:          afu9-cluster
  ECS Service:          afu9-control-center
  Image Tag Prefix:     prod
  Secrets Prefix:       afu9
  Ready Host:           afu-9.com

Detected Artifacts:
  Secret ARNs:          arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123
  Image References:     123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123
  Service Names:        afu9-control-center

Feature Flags:
  CREATE_STAGING_SERVICE: false
  AFU9_ENABLE_HTTPS: true
```

### ✅ AC5: Evidence: Log-Auszug "guardrail pass/fail" + Negativtest

**Guardrail Pass:**
```
✅ GUARDRAIL PASS: All environment checks passed
   Deploy to production is authorized.
```

**Guardrail Fail:**
```
❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:
  - Service name contains "staging": afu9-control-center-staging
Deploy blocked to prevent cross-environment contamination.
```

**Negative Test Results:**
```bash
$ ./scripts/test-deploy-context-guardrail-negative.sh

Test Summary:
  Total:  10
  Passed: 10
  Failed: 0

All negative tests passed! Guardrail is working correctly.
```

**Positive Test Results:**
```bash
$ ./scripts/test-deploy-context-guardrail-positive.sh

Test Summary:
  Total:  4
  Passed: 4
  Failed: 0

All positive tests passed! Valid deploys are allowed.
```

## Files Created

1. `scripts/deploy-context-resolver.ts` - Central context resolver (single source)
2. `scripts/deploy-context-guardrail.ts` - Main guardrail implementation
3. `scripts/__tests__/deploy-context-guardrail.test.ts` - Unit tests (16 tests)
4. `scripts/test-deploy-context-guardrail-negative.sh` - Negative tests (10 tests)
5. `scripts/test-deploy-context-guardrail-positive.sh` - Positive tests (4 tests)
6. `docs/guardrails/E7_0_1_DEPLOY_CONTEXT_GUARDRAIL.md` - Detailed documentation
7. `E7_0_1_IMPLEMENTATION_SUMMARY.md` - This document

## Files Modified

1. `.github/workflows/deploy-ecs.yml` - Added guardrail step
2. `.github/workflows/deploy-database-stack.yml` - Added guardrail step
3. `jest.config.cjs` - Added scripts root for testing

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Guardrail passed - deploy authorized |
| 1    | Validation error - cross-env artifact detected |
| 2    | Usage error - missing/invalid DEPLOY_ENV |

## Out of Scope

- Smoke-Key/Runner Fix selbst (separater Track)
- Automated rollback on guardrail failure
- Multi-region deployment guardrails
- Cost estimation guardrails

## Testing

### Run All Tests
```bash
# Unit tests
npm test -- scripts/__tests__/deploy-context-guardrail.test.ts

# Negative tests (prove guardrail blocks violations)
./scripts/test-deploy-context-guardrail-negative.sh

# Positive tests (prove valid deploys pass)
./scripts/test-deploy-context-guardrail-positive.sh

# Repository verification
npm run repo:verify
```

### Test Results
- ✅ Unit tests: 16/16 passed
- ✅ Negative tests: 10/10 passed (all violations correctly blocked)
- ✅ Positive tests: 4/4 passed (valid deploys allowed)
- ✅ Repository verification: All checks passed

## Security Impact

**Positive:**
- Prevents accidental production contamination
- Prevents stage secrets leaking to production
- Enforces explicit environment boundaries
- Reduces blast radius of misconfigurations
- Fail-closed design (no implicit defaults)

**No Negative Impact:**
- Guardrail runs before AWS API calls
- Only blocks on detected violations
- Exit codes allow automated retry after fix
- No performance impact (milliseconds)

## Determinism

The guardrail is fully deterministic:
- Same inputs → same outputs
- No external API calls for validation
- Uses only environment variables and static rules
- Reproducible across all CI runs

## Labels Applied

- `prio:P0`
- `area:deploy`
- `guardrail`
- `determinism`
- `security`

## Validation Commands

```bash
# Verify implementation
npm run repo:verify

# Run all tests
npm test -- scripts/__tests__/deploy-context-guardrail.test.ts
./scripts/test-deploy-context-guardrail-negative.sh
./scripts/test-deploy-context-guardrail-positive.sh

# Test CLI directly
DEPLOY_ENV=production ECS_SERVICE=afu9-control-center \
  npx ts-node scripts/deploy-context-guardrail.ts

# Test failure case
DEPLOY_ENV=production ECS_SERVICE=afu9-control-center-staging \
  npx ts-node scripts/deploy-context-guardrail.ts
```

## Next Steps

1. Monitor guardrail logs in first 10 production/staging deploys
2. Update deployment runbooks with guardrail troubleshooting
3. Consider adding Slack notifications on guardrail failure
4. Extend guardrail to cover CDK context validation (future enhancement)

## Conclusion

E7.0.1 has been fully implemented with:
- ✅ Explicit DEPLOY_ENV enforcement (fail-closed)
- ✅ Cross-environment artifact detection and blocking
- ✅ Target summary display before deploy
- ✅ Comprehensive test coverage (30 tests total)
- ✅ Evidence of guardrail pass/fail behavior
- ✅ Negative tests proving violations are blocked

The guardrail is now active in both `deploy-ecs.yml` and `deploy-database-stack.yml` workflows, providing fail-safe protection against cross-environment contamination.
