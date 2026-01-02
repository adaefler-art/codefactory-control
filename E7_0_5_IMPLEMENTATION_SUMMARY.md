# E7.0.5 Implementation Summary - IAM/Secrets Scope Linter

## Issue
**E7.0.5 IAM/Secrets Scope Linter — verbiete Cross-Env Secret Access**

Cross-environment secret access (e.g., stage-secrets in prod-ExecutionRole or vice versa) is a security and governance smell that can trigger incidents. This implementation provides automated detection and blocking of such violations.

## Implementation

### Core Components

#### 1. Secrets Scope Linter (`scripts/validate-secrets-scope.ts`)

A comprehensive TypeScript-based linter that:
- **Parses IAM policies** from CDK stack files using TypeScript AST analysis
- **Detects environment context** from role names, task definitions, and file names
- **Validates secret access patterns** against environment-specific rules
- **Generates clear error messages** for violations with remediation guidance

**Environment-Specific Rules:**
```typescript
ALLOWED_SECRET_PREFIXES: {
  prod: [
    'afu9/prod/',      // Production-specific secrets
    'afu9/database',   // Legacy database secret (shared)
    'afu9/github',     // Legacy GitHub secret (shared)
    'afu9/llm',        // Legacy LLM secret (shared)
  ],
  stage: [
    'afu9/stage/',     // Stage-specific secrets
    'afu9/database',   // Legacy database secret (shared)
    'afu9/github',     // Legacy GitHub secret (shared)
    'afu9/llm',        // Legacy LLM secret (shared)
  ],
  legacy: [
    'afu9/',           // Legacy deployments can access all afu9/* secrets
  ],
}

FORBIDDEN_CROSS_ENV_PATTERNS: {
  prod: ['afu9/stage/'],   // Prod cannot access stage secrets
  stage: ['afu9/prod/'],   // Stage cannot access prod secrets
}
```

**Key Features:**
- Automatic environment detection from naming conventions
- Support for legacy shared secrets (backward compatibility)
- Rotation-safe ARN handling (supports wildcard suffixes)
- Clear separation between errors and warnings

#### 2. Test Suite (`scripts/test-secrets-scope.ts`)

Comprehensive test coverage with 14 test cases:

**Valid Cases (8 tests):**
- ✅ Prod role accessing prod secret
- ✅ Stage role accessing stage secret
- ✅ Prod/stage roles accessing legacy shared secrets (database, github, llm)
- ✅ Legacy role accessing any afu9 secret
- ✅ Secret ARNs with rotation suffixes

**Violation Cases (4 tests):**
- ❌ Prod role accessing stage secret
- ❌ Stage role accessing prod secret
- ❌ Cross-environment database access
- ❌ Cross-environment config access

**Edge Cases (2 tests):**
- Template literal variables (validation skipped)
- Wildcard ARNs for rotation support

#### 3. CI Integration

Updated `.github/workflows/security-validation.yml`:
- Added `validate-secrets-scope` job
- Runs on all PR changes to `lib/**/*.ts`
- Blocks merge if violations detected
- Provides detailed summary in PR checks

### NPM Scripts

```json
{
  "validate-secrets-scope": "ts-node scripts/validate-secrets-scope.ts",
  "test-secrets-scope": "ts-node scripts/test-secrets-scope.ts",
  "security:check": "npm run validate-iam && npm run validate-secrets-scope && npm run repo:verify"
}
```

## Acceptance Criteria Met

### ✅ 1. Linter/Check defines allowed Secret-Prefixes per Environment
- **Implementation:** `ALLOWED_SECRET_PREFIXES` constant with environment-specific rules
- **Evidence:** See `scripts/validate-secrets-scope.ts` lines 30-53

### ✅ 2. CI Gate: Violation blocks Merge/Deploy
- **Implementation:** GitHub Actions workflow job with exit code 1 on violations
- **Evidence:** `.github/workflows/security-validation.yml` lines 78-126

### ✅ 3. Evidence: Pass-Run + Fail-Run + Clear Error Messages
See Evidence sections below.

## Evidence

### Pass-Run Evidence

```bash
$ npm run test-secrets-scope

================================================================================
Secrets Scope Validation Test Suite - E7.0.5
================================================================================

✅ Test 1: Valid: Prod role accessing prod secret
✅ Test 2: Valid: Stage role accessing stage secret
✅ Test 3: Valid: Prod role accessing legacy database secret
✅ Test 4: Valid: Stage role accessing legacy database secret
✅ Test 5: Valid: Prod role accessing legacy GitHub secret
✅ Test 6: Valid: Stage role accessing legacy GitHub secret
✅ Test 7: Valid: Prod role accessing legacy LLM secret
✅ Test 8: Valid: Legacy role accessing any afu9 secret
✅ Test 9: VIOLATION: Prod role accessing stage secret
   ✓ Reason matches: "Cross-environment access forbidden"
✅ Test 10: VIOLATION: Stage role accessing prod secret
   ✓ Reason matches: "Cross-environment access forbidden"
✅ Test 11: VIOLATION: Prod role accessing stage-specific DB secret
   ✓ Reason matches: "Cross-environment access forbidden"
✅ Test 12: VIOLATION: Stage role accessing prod-specific config
   ✓ Reason matches: "Cross-environment access forbidden"
✅ Test 13: Edge: Secret ARN with rotation suffix (wildcard)
✅ Test 14: Edge: Template literal variable (skip validation)

================================================================================
Results: 14 passed, 0 failed
================================================================================

Integration Test: Validate Actual CDK Stacks
================================================================================

Validating: lib/afu9-ecs-stack.ts
  Found 6 policy statements

Validating: lib/afu9-iam-stack.ts
  Found 19 policy statements

================================================================================
VALIDATION RESULTS
================================================================================

✅ No cross-environment secret access violations found!

  All secrets are properly scoped to their environments:
    - Production resources → afu9/prod/* secrets only
    - Staging resources → afu9/stage/* secrets only
    - Legacy shared secrets → afu9/* (no env prefix)

================================================================================
SUMMARY
================================================================================
Violations: 0
================================================================================
```

### Fail-Run Evidence (Demonstration)

The test suite includes a demonstration of what a violation looks like:

```bash
================================================================================
DEMONSTRATION: Cross-Environment Violation Example
================================================================================

Scenario: Production ExecutionRole tries to access stage secrets

❌ VIOLATION DETECTED:
   Cross-environment access forbidden: prod environment cannot access afu9/stage/* secrets

This is the type of security/governance smell we prevent!

================================================================================
```

**Example of full violation output:**

If a developer tried to add this to a production role:
```typescript
taskExecutionRole.addToPolicy(
  new iam.PolicyStatement({
    sid: 'BadCrossEnvAccess',
    actions: ['secretsmanager:GetSecretValue'],
    resources: [
      'arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/stage/smoke-key-*'
    ],
  })
);
```

The linter would output:
```
❌ CROSS-ENVIRONMENT SECRET ACCESS VIOLATIONS:

  Environment: PROD
    afu9-ecs-stack.ts:530 [BadCrossEnvAccess]
      Secret: arn:aws:secretsmanager:eu-central-1:123456789012:secret:afu9/stage/smoke-key-*
      Error: Cross-environment access forbidden: prod environment cannot access afu9/stage/* secrets

REMEDIATION:
  1. Review the IAM policies above
  2. Ensure production resources only access afu9/prod/* secrets
  3. Ensure staging resources only access afu9/stage/* secrets
  4. Use environment-specific secret names
  5. For shared secrets, use legacy afu9/* prefix (without env)
```

### Clear Error Messages

The linter provides:
1. **Precise location:** File name and line number
2. **Context:** Environment and policy statement ID
3. **Problem:** Exact secret ARN causing violation
4. **Reason:** Why it's a violation
5. **Remediation:** Step-by-step fix instructions

## Security Benefits

1. **Prevents Incidents:** Blocks stage credentials from being used in production and vice versa
2. **Enforces Isolation:** Maintains strict environment boundaries
3. **Governance Compliance:** Prevents security/governance smells that trigger audits
4. **Early Detection:** Catches violations during development/PR review, not deployment
5. **Blast Radius Minimization:** Limits damage from compromised credentials to single environment

## Backward Compatibility

The linter supports legacy deployments:
- Shared secrets (`afu9/database`, `afu9/github`, `afu9/llm`) allowed in all environments
- Legacy environment detection falls back to permissive mode
- No breaking changes to existing infrastructure

## Integration with Existing Security Framework

This linter complements existing security checks:
- **IAM Policy Validation** (`validate-iam-policies.ts`): Checks resource scoping and wildcards
- **Secrets Scope Validation** (`validate-secrets-scope.ts`): NEW - Checks cross-env access
- **Repository Verification** (`repo-verify.ts`): Checks for secret files and forbidden paths
- **Secret Scanning** (Gitleaks): Detects hardcoded secrets in code

All run as part of `npm run security:check` and in CI pipeline.

## Files Changed

1. **Created:** `scripts/validate-secrets-scope.ts` (439 lines)
2. **Created:** `scripts/test-secrets-scope.ts` (289 lines)
3. **Modified:** `package.json` (added scripts)
4. **Modified:** `.github/workflows/security-validation.yml` (added CI job)

## Testing

```bash
# Run test suite
npm run test-secrets-scope

# Validate current stacks
npm run validate-secrets-scope

# Run all security checks
npm run security:check
```

## Labels Applied
- ✅ `prio:P1` - High priority security feature
- ✅ `security` - Security hardening
- ✅ `guardrail` - Preventive control
- ✅ `iam` - IAM policy validation
- ✅ `determinism` - Consistent behavior across environments

## Summary

E7.0.5 successfully implements automated detection and blocking of cross-environment secret access patterns. The linter:
- ✅ Defines environment-specific secret prefix rules
- ✅ Blocks violations in CI (merge/deploy gate)
- ✅ Provides clear error messages with remediation guidance
- ✅ Passes all tests (14/14)
- ✅ Validates existing stacks without violations
- ✅ Integrates seamlessly with existing security framework

**Result:** Cross-environment secret access is now automatically prevented, reducing security risk and governance violations.
