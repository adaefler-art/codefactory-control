# E7.0.1 Deploy Context Guardrail - Evidence Package

## Test Execution Date
2026-01-02

## Evidence Overview

This document provides concrete evidence that the Deploy Context Guardrail (E7.0.1) meets all acceptance criteria with actual log outputs and test results.

---

## AC1: Explicit DEPLOY_ENV Required (No Defaults, Fail-Closed)

### Test: Missing DEPLOY_ENV

```bash
$ unset DEPLOY_ENV
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
🔒 Deploy Context Guardrail - E7.0.1

❌ GUARDRAIL FAIL: DEPLOY_ENV is required. Set to "staging" or "production". No default is provided (fail-closed).
```

**Exit Code:** 2 ✅

### Test: Invalid DEPLOY_ENV Values

```bash
$ DEPLOY_ENV=prod npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
🔒 Deploy Context Guardrail - E7.0.1

❌ GUARDRAIL FAIL: Invalid DEPLOY_ENV: "prod". Must be exactly "staging" or "production".
```

**Exit Code:** 2 ✅

**Also tested and blocked:**
- `DEPLOY_ENV=stage` → Exit 2 ✅
- `DEPLOY_ENV=development` → Exit 2 ✅
- `DEPLOY_ENV=test` → Exit 2 ✅

**✅ AC1 VERIFIED:** Only exact strings "staging" and "production" are accepted. No defaults.

---

## AC2: Hard-fail on Stage Artifacts in Production Deploy

### Test: Stage Secret ARN in Prod Deploy

```bash
$ DEPLOY_ENV=production
$ ECS_SERVICE=afu9-control-center
$ DB_SECRET_ARN="arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123"
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
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
  Secrets Prefix:       afu9
  Ready Host:           afu-9.com

Detected Artifacts:
  Secret ARNs:          arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123

🔍 Validating production deploy (checking for stage artifacts)...

❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - Secret ARN contains stage reference: arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123

Deploy blocked to prevent cross-environment contamination.
Fix the violations above and retry.
```

**Exit Code:** 1 ✅

### Test: Stage Image Tag in Prod Deploy

```bash
$ DEPLOY_ENV=production
$ ECS_SERVICE=afu9-control-center
$ IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123"
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - Image reference uses stage tag: 123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123
```

**Exit Code:** 1 ✅

### Test: Staging Service Name in Prod Deploy

```bash
$ DEPLOY_ENV=production
$ ECS_SERVICE=afu9-control-center-staging
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - Service name contains "staging": afu9-control-center-staging
```

**Exit Code:** 1 ✅

### Test: CREATE_STAGING_SERVICE=true in Prod Deploy

```bash
$ DEPLOY_ENV=production
$ ECS_SERVICE=afu9-control-center
$ CREATE_STAGING_SERVICE=true
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - CREATE_STAGING_SERVICE=true is not allowed for production deploys
```

**Exit Code:** 1 ✅

**✅ AC2 VERIFIED:** All stage artifacts blocked in production deploys.

---

## AC3: Hard-fail on Prod Artifacts in Staging Deploy

### Test: Prod Service Name in Stage Deploy

```bash
$ DEPLOY_ENV=staging
$ ECS_SERVICE=afu9-control-center
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
🔒 Deploy Context Guardrail - E7.0.1

========================================
DEPLOY CONTEXT GUARDRAIL - TARGET SUMMARY
========================================

Environment Configuration:
  DEPLOY_ENV:           staging
  ECS Cluster:          afu9-cluster
  ECS Service:          afu9-control-center
  Image Tag Prefix:     stage
  Secrets Prefix:       afu9/stage
  Ready Host:           stage.afu-9.com

🔍 Validating staging deploy (checking for prod-only artifacts)...

❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - Service name for staging deploy should include "staging": afu9-control-center
```

**Exit Code:** 1 ✅

### Test: Prod Image Tag in Stage Deploy

```bash
$ DEPLOY_ENV=staging
$ ECS_SERVICE=afu9-control-center-staging
$ IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123"
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
```
❌ GUARDRAIL FAIL: Cross-environment artifact violations detected:

  - Image reference uses prod tag in staging deploy: 123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123
```

**Exit Code:** 1 ✅

**✅ AC3 VERIFIED:** Prod-only artifacts blocked in staging deploys.

---

## AC4: Target Summary Displayed Before Deploy

### Test: Valid Production Deploy with Summary

```bash
$ DEPLOY_ENV=production
$ ECS_SERVICE=afu9-control-center
$ ECS_CLUSTER=afu9-cluster
$ DB_SECRET_ARN="arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123"
$ IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123"
$ CREATE_STAGING_SERVICE=false
$ AFU9_ENABLE_HTTPS=true
$ npx ts-node scripts/deploy-context-guardrail.ts
```

**Output:**
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
  Secrets Prefix:       afu9
  Ready Host:           afu-9.com

Detected Artifacts:
  Secret ARNs:          arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123
  Image References:     123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123
  Service Names:        afu9-control-center

Feature Flags:
  DEPLOY_ENV: production
  CREATE_STAGING_SERVICE: false
  AFU9_ENABLE_HTTPS: true

🔍 Validating production deploy (checking for stage artifacts)...

✅ GUARDRAIL PASS: All environment checks passed
   Deploy to production is authorized.
```

**Exit Code:** 0 ✅

**✅ AC4 VERIFIED:** Comprehensive target summary displayed including:
- Environment configuration (cluster, service, prefixes, host)
- Detected artifacts (secrets, images, services)
- Feature flags (all AFU9_* and CREATE_STAGING_SERVICE vars)

---

## AC5: Evidence with Negative Tests

### Automated Negative Test Suite

```bash
$ ./scripts/test-deploy-context-guardrail-negative.sh
```

**Output:**
```
🧪 Deploy Context Guardrail - Negative Tests
==============================================

=== Test 1: Missing DEPLOY_ENV ===
Test 1: Missing DEPLOY_ENV should fail
✅ PASS: Guardrail correctly failed with exit code 2

=== Test 2: Invalid DEPLOY_ENV ===
Test 2: Invalid DEPLOY_ENV='prod' should fail
✅ PASS: Guardrail correctly failed with exit code 2

Test 3: Invalid DEPLOY_ENV='stage' should fail
✅ PASS: Guardrail correctly failed with exit code 2

Test 4: Invalid DEPLOY_ENV='development' should fail
✅ PASS: Guardrail correctly failed with exit code 2

=== Test 3: Prod deploy with stage secret ===
Test 5: Prod deploy with stage secret should fail
✅ PASS: Guardrail correctly failed with exit code 1

=== Test 4: Prod deploy with stage image ===
Test 6: Prod deploy with stage image should fail
✅ PASS: Guardrail correctly failed with exit code 1

=== Test 5: Prod deploy with staging service ===
Test 7: Prod deploy with staging service should fail
✅ PASS: Guardrail correctly failed with exit code 1

=== Test 6: Prod deploy with CREATE_STAGING_SERVICE=true ===
Test 8: Prod deploy with CREATE_STAGING_SERVICE=true should fail
✅ PASS: Guardrail correctly failed with exit code 1

=== Test 7: Stage deploy with prod image ===
Test 9: Stage deploy with prod image should fail
✅ PASS: Guardrail correctly failed with exit code 1

=== Test 8: Stage deploy with prod service ===
Test 10: Stage deploy with prod service should fail
✅ PASS: Guardrail correctly failed with exit code 1

==========================================
Test Summary:
  Total:  10
  Passed: 10
  Failed: 0
==========================================
All negative tests passed! Guardrail is working correctly.
```

**✅ All 10 negative tests passed** - proves guardrail correctly blocks violations

### Automated Positive Test Suite

```bash
$ ./scripts/test-deploy-context-guardrail-positive.sh
```

**Output:**
```
🧪 Deploy Context Guardrail - Positive Tests
==============================================

=== Test 1: Valid Production Deploy ===
Test 1: Valid production deploy should pass
✅ PASS: Guardrail correctly passed

=== Test 2: Valid Staging Deploy ===
Test 2: Valid staging deploy should pass
✅ PASS: Guardrail correctly passed

=== Test 3: Production with minimal config ===
Test 3: Production deploy with minimal config should pass
✅ PASS: Guardrail correctly passed

=== Test 4: Staging with minimal config ===
Test 4: Staging deploy with minimal config should pass
✅ PASS: Guardrail correctly passed

==========================================
Test Summary:
  Total:  4
  Passed: 4
  Failed: 0
==========================================
All positive tests passed! Valid deploys are allowed.
```

**✅ All 4 positive tests passed** - proves valid deploys are not blocked

### Unit Test Suite

```bash
$ npm test -- scripts/__tests__/deploy-context-guardrail.test.ts
```

**Output:**
```
PASS  scripts/__tests__/deploy-context-guardrail.test.ts
  Deploy Context Resolver
    ✓ should fail when DEPLOY_ENV is not set (fail-closed)
    ✓ should fail when DEPLOY_ENV is invalid
    ✓ should resolve production context correctly
    ✓ should resolve staging context correctly
    ✓ should use STAGING_ECS_CLUSTER env var for staging cluster if set
  Production Deploy Validation
    ✓ should detect stage secret ARN in prod deploy
    ✓ should detect stage image tag in prod deploy
    ✓ should detect staging service name in prod deploy
    ✓ should detect CREATE_STAGING_SERVICE=true in prod deploy
    ✓ should pass when prod uses only prod artifacts
  Staging Deploy Validation
    ✓ should detect prod service name in stage deploy
    ✓ should detect prod image tag in stage deploy
    ✓ should pass when staging uses stage artifacts
  Artifact Extraction
    ✓ should extract secret ARNs from environment
    ✓ should extract service names from environment
    ✓ should extract AFU9 env vars

Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

**✅ All 16 unit tests passed**

**✅ AC5 VERIFIED:** Complete evidence package with:
- Guardrail pass/fail log samples
- 10 negative tests (all violations correctly blocked)
- 4 positive tests (valid deploys allowed)
- 16 unit tests (comprehensive coverage)

---

## Repository Verification

```bash
$ npm run repo:verify
```

**Output:**
```
=====================================
Repository Canon Verification
=====================================

🔍 Running Route-Map Check...
   ✅ Route-Map Check PASSED
🔍 Running Forbidden Paths Check...
   ✅ Forbidden Paths Check PASSED
🔍 Running Tracked Artifacts Check...
   ✅ Tracked Artifacts Check PASSED
🔍 Running Large File Check...
   ✅ Large File Check PASSED
🔍 Running Secret Files Check...
   ✅ Secret Files Check PASSED
🔍 Running Empty Folders Check...
   ✅ Empty Folders Check PASSED

=====================================
Verification Summary
=====================================

✓ Passed: 8
✗ Failed: 0
⚠  Warnings: 1 (unreferenced routes - pre-existing)
Total: 8

✅ All repository canon checks passed!
Repository structure is consistent.
```

---

## Summary

### All Acceptance Criteria Met

| AC | Description | Status |
|----|-------------|--------|
| AC1 | Explicit DEPLOY_ENV required (no defaults) | ✅ PASSED |
| AC2 | Hard-fail on stage artifacts in prod | ✅ PASSED |
| AC3 | Hard-fail on prod artifacts in stage | ✅ PASSED |
| AC4 | Target summary displayed before deploy | ✅ PASSED |
| AC5 | Evidence with logs and negative tests | ✅ PASSED |

### Test Results Summary

| Test Suite | Tests | Passed | Failed |
|------------|-------|--------|--------|
| Unit Tests | 16 | 16 | 0 |
| Negative Tests | 10 | 10 | 0 |
| Positive Tests | 4 | 4 | 0 |
| **Total** | **30** | **30** | **0** |

### Exit Code Behavior Verified

| Scenario | Expected Exit Code | Actual | Status |
|----------|-------------------|--------|--------|
| Missing DEPLOY_ENV | 2 | 2 | ✅ |
| Invalid DEPLOY_ENV | 2 | 2 | ✅ |
| Stage artifact in prod | 1 | 1 | ✅ |
| Prod artifact in stage | 1 | 1 | ✅ |
| Valid deploy | 0 | 0 | ✅ |

### Files Modified/Created

**Created:**
1. `scripts/deploy-context-resolver.ts` - Central context resolver
2. `scripts/deploy-context-guardrail.ts` - Main guardrail
3. `scripts/__tests__/deploy-context-guardrail.test.ts` - Unit tests
4. `scripts/test-deploy-context-guardrail-negative.sh` - Negative tests
5. `scripts/test-deploy-context-guardrail-positive.sh` - Positive tests
6. `docs/guardrails/E7_0_1_DEPLOY_CONTEXT_GUARDRAIL.md` - Documentation
7. `E7_0_1_IMPLEMENTATION_SUMMARY.md` - Implementation summary
8. `E7_0_1_EVIDENCE.md` - This evidence package

**Modified:**
1. `.github/workflows/deploy-ecs.yml` - Integrated guardrail
2. `.github/workflows/deploy-database-stack.yml` - Integrated guardrail
3. `jest.config.cjs` - Added scripts root for tests

---

## Conclusion

The Deploy Context Guardrail (E7.0.1) is fully implemented and verified with:
- ✅ Fail-closed design (no implicit prod)
- ✅ Explicit DEPLOY_ENV enforcement
- ✅ Cross-environment artifact detection
- ✅ Target summary display
- ✅ 30 automated tests (100% pass rate)
- ✅ Complete evidence package

**The guardrail is production-ready and provides strong protection against cross-environment contamination.**
