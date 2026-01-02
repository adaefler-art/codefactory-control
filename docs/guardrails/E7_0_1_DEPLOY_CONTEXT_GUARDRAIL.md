# E7.0.1 Deploy Context Guardrail - Implementation Summary

## Overview

The Deploy Context Guardrail enforces strict stage/prod environment separation to prevent cross-environment contamination during deployments. This addresses the incident where deploys were "mentally stage" but technically touched production.

## Problem Statement

**Before E7.0.1:**
- Deploys could implicitly target production (default behavior)
- Stage artifacts (secrets, images, services) could accidentally be used in production deploys
- Production artifacts could leak into staging deploys
- No clear "target summary" before deployment execution
- Environment boundaries were not technically enforced

**After E7.0.1:**
- Explicit `DEPLOY_ENV` required (no defaults, fail-closed)
- Hard-fail if `DEPLOY_ENV=production` uses stage artifacts
- Hard-fail if `DEPLOY_ENV=staging` uses prod-only artifacts
- Target summary displayed before each deploy for human verification
- Cross-env secrets/IAM technically unterbunden (blocked)

## Implementation

### 1. Central Context Resolver (`scripts/deploy-context-resolver.ts`)

Single source of truth for deploy environment resolution:

```typescript
export function resolveDeployContext(deployEnv?: string): DeployContext {
  const env = deployEnv || process.env.DEPLOY_ENV;

  if (!env) {
    throw new Error('DEPLOY_ENV is required. No default is provided (fail-closed).');
  }

  if (env !== 'staging' && env !== 'production') {
    throw new Error(`Invalid DEPLOY_ENV: "${env}". Must be exactly "staging" or "production".`);
  }
  
  // Returns: environment, cluster, service, imageTagPrefix, secretsPrefix, readyHost
}
```

**Key Features:**
- No defaults - explicit environment required
- Only accepts `"staging"` or `"production"` (not `"prod"`, `"stage"`, etc.)
- Returns complete deployment context

### 2. Deploy Context Guardrail (`scripts/deploy-context-guardrail.ts`)

Pre-deployment gate that validates environment boundaries:

**Production Deploy Validation:**
- ❌ Blocks stage secret ARNs (e.g., `afu9/stage/smoke-key`)
- ❌ Blocks stage image tags (e.g., `:stage-*`)
- ❌ Blocks staging service names
- ❌ Blocks `CREATE_STAGING_SERVICE=true`

**Staging Deploy Validation:**
- ❌ Blocks prod service names (missing "staging")
- ❌ Blocks prod image tags (e.g., `:prod-*`)

**Target Summary Display:**
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

### 3. Workflow Integration

**deploy-ecs.yml:**
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

**deploy-database-stack.yml:**
```yaml
- name: Deploy Context Guardrail (E7.0.1)
  shell: bash
  env:
    DEPLOY_ENV: ${{ github.event.inputs.environment }}
    CREATE_STAGING_SERVICE: ${{ env.CREATE_STAGING_SERVICE }}
  run: |
    ts-node scripts/deploy-context-guardrail.ts
```

### 4. Test Coverage

**Unit Tests (`scripts/__tests__/deploy-context-guardrail.test.ts`):**
- ✅ 16 passing tests covering all validation scenarios
- Context resolver validation (fail-closed)
- Production artifact validation
- Staging artifact validation
- Artifact extraction

**Negative Tests (`scripts/test-deploy-context-guardrail-negative.sh`):**
- Tests that guardrail correctly FAILS on violations
- 8+ negative test cases covering all violation types

## Acceptance Criteria

### ✅ AC1: Explicit DEPLOY_ENV Required
- No default environment
- Workflow fails if `DEPLOY_ENV` is missing or invalid
- Only accepts `"staging"` or `"production"` (exact strings)

### ✅ AC2: Hard-fail on Stage Artifacts in Prod
- Blocks stage secret ARNs/names
- Blocks stage image tags (`:stage-*`)
- Blocks staging service names
- Blocks `CREATE_STAGING_SERVICE=true`

### ✅ AC3: Hard-fail on Prod Artifacts in Stage
- Blocks prod service names (missing "staging")
- Blocks prod image tags (`:prod-*`)

### ✅ AC4: Target Summary Display
- Shows environment configuration before deploy
- Lists detected artifacts (secrets, images, services)
- Displays feature flags
- Acts as human verification gate

### ✅ AC5: Evidence & Negative Tests
- Log output shows "GUARDRAIL PASS/FAIL"
- Negative test script validates all failure scenarios
- Tests prove guardrail blocks cross-env contamination

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Guardrail passed - deploy authorized |
| 1    | Validation error - cross-env artifact detected |
| 2    | Usage error - missing/invalid DEPLOY_ENV |

## Usage Examples

### CLI Testing

```bash
# Production deploy (pass)
DEPLOY_ENV=production \
ECS_SERVICE=afu9-control-center \
ts-node scripts/deploy-context-guardrail.ts

# Staging deploy (pass)
DEPLOY_ENV=staging \
ECS_SERVICE=afu9-control-center-staging \
ts-node scripts/deploy-context-guardrail.ts

# Invalid environment (fail)
DEPLOY_ENV=prod \
ts-node scripts/deploy-context-guardrail.ts
# ERROR: Invalid DEPLOY_ENV: "prod". Must be exactly "staging" or "production".

# Cross-env violation (fail)
DEPLOY_ENV=production \
ECS_SERVICE=afu9-control-center-staging \
ts-node scripts/deploy-context-guardrail.ts
# ❌ GUARDRAIL FAIL: Service name contains "staging": afu9-control-center-staging
```

### Run Negative Tests

```bash
./scripts/test-deploy-context-guardrail-negative.sh
```

### Run Unit Tests

```bash
npm test -- scripts/__tests__/deploy-context-guardrail.test.ts
```

## Evidence Log Samples

### Guardrail Pass (Production)
```
🔒 Deploy Context Guardrail - E7.0.1

========================================
DEPLOY CONTEXT GUARDRAIL - TARGET SUMMARY
========================================

Environment Configuration:
  DEPLOY_ENV:           production
  ECS Cluster:          afu9-cluster
  ECS Service:          afu9-control-center
  Image Tag Prefix:     prod

🔍 Validating production deploy (checking for stage artifacts)...

✅ GUARDRAIL PASS: All environment checks passed
   Deploy to production is authorized.
```

### Guardrail Fail (Cross-Env Violation)
```
🔒 Deploy Context Guardrail - E7.0.1

========================================
DEPLOY CONTEXT GUARDRAIL - TARGET SUMMARY
========================================

Environment Configuration:
  DEPLOY_ENV:           production
  ECS Service:          afu9-control-center-staging
  
🔍 Validating production deploy (checking for stage artifacts)...

❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - Service name contains "staging": afu9-control-center-staging

Deploy blocked to prevent cross-environment contamination.
Fix the violations above and retry.
```

## Out of Scope

- Smoke-Key/Runner fixes (separate track)
- Automated rollback on guardrail failure
- Multi-region deployment guardrails
- Cost estimation guardrails

## Files Modified

1. `.github/workflows/deploy-ecs.yml` - Added guardrail step
2. `.github/workflows/deploy-database-stack.yml` - Added guardrail step
3. `jest.config.cjs` - Added scripts root for testing

## Files Created

1. `scripts/deploy-context-resolver.ts` - Central context resolver
2. `scripts/deploy-context-guardrail.ts` - Main guardrail implementation
3. `scripts/__tests__/deploy-context-guardrail.test.ts` - Unit tests
4. `scripts/test-deploy-context-guardrail-negative.sh` - Negative tests
5. `docs/guardrails/E7_0_1_DEPLOY_CONTEXT_GUARDRAIL.md` - This document

## Security Impact

**Positive:**
- Prevents accidental production contamination
- Prevents stage secrets leaking to production
- Enforces explicit environment boundaries
- Reduces blast radius of misconfigurations

**No Negative Impact:**
- Guardrail runs before AWS API calls
- Only blocks on detected violations
- Exit codes allow automated retry after fix

## Next Steps

1. Monitor guardrail logs in first 10 deploys
2. Update runbooks to include guardrail troubleshooting
3. Consider adding Slack notifications on guardrail failure
4. Extend guardrail to cover CDK context validation (future)
