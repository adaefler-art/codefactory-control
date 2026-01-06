# E77.4 Verification Commands

This document provides PowerShell commands to verify the E77.4 Service Health Reset playbook implementation.

## Prerequisites

Ensure the following are installed and available:
- Node.js (v18 or later)
- npm
- PostgreSQL (for database tests)
- AWS credentials configured (for ECS operations)

## Setup

```powershell
# Install all dependencies
npm install

# Install control-center dependencies
npm --prefix control-center install
```

## Verification Steps

### 1. Repository Structure Verification

```powershell
# Verify repository structure and API routes
npm run repo:verify
```

**Expected Output:**
- ✅ No forbidden paths found
- ✅ No empty directories
- ✅ All API routes have corresponding client calls
- ✅ No client calls to non-existent routes

### 2. TypeScript Compilation

```powershell
# Check TypeScript compilation (control-center)
npm --prefix control-center run build
```

**Expected Output:**
- ✅ No TypeScript errors
- ✅ Build completes successfully
- ✅ .next directory created

### 3. Run Tests

#### Run Hardening Tests (Priority)

```powershell
# Run service-health-reset hardening tests
npm --prefix control-center test -- --testPathPattern="service-health-reset-hardening"
```

**Expected Output:**
```
PASS  __tests__/lib/playbooks/service-health-reset-hardening.test.ts
  SERVICE_HEALTH_RESET Hardening
    Target Allowlist Enforcement
      ✓ should deny target not in allowlist
      ✓ should allow target in allowlist
      ✓ should require environment for allowlist validation
    Deterministic ALB Evidence Mapping
      ✓ should fail-close when ALB evidence lacks cluster/service and no mapping
      ✓ should use lawbook mapping for ALB evidence
      ✓ should accept ALB evidence with explicit cluster/service (no mapping needed)
    Canonical Environment Semantics
      ✓ should require environment for snapshot
      ✓ should normalize environment aliases (prod -> production)
      ✓ should only mark MITIGATED when verification env matches target env
      ✓ should not mark MITIGATED when verification env does not match
      ✓ should handle environment alias matching (prod vs production)
      ✓ should fail-close on invalid verification env
    Frequency Limiting
      ✓ should include hour key in reset idempotency key
      ✓ should generate different keys for different environments
    Secret Sanitization
      ✓ should sanitize outputs to prevent token persistence

Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

#### Run All Playbook Tests

```powershell
# Run all service-health-reset tests
npm --prefix control-center test -- --testPathPattern="service-health-reset"
```

**Expected Output:**
- ✅ All hardening tests pass (14 tests)
- ✅ All functional tests pass (17 tests)
- ✅ Total: 31 tests pass

#### Run Registry Tests

```powershell
# Run registry tests
npm --prefix control-center test -- registry.test.ts
```

**Expected Output:**
```
PASS  __tests__/lib/playbooks/registry.test.ts
  Playbook Registry Tests
    Playbook Lookup
      ✓ should find safe-retry-runner playbook by ID
      ✓ should find rerun-post-deploy-verification playbook by ID
      ✓ should return undefined for non-existent playbook
    Playbook Lookup by Category
      ✓ should find safe-retry-runner for RUNNER_WORKFLOW_FAILED category
      ✓ should find rerun-post-deploy-verification for DEPLOY_VERIFICATION_FAILED
      ✓ should find rerun-post-deploy-verification for ALB_TARGET_UNHEALTHY
      ✓ should find service-health-reset for ECS_TASK_CRASHLOOP
      ✓ should return empty array for category with no playbooks
    All Playbooks
      ✓ should return all registered playbooks (4 playbooks)
    Has Playbook
      ✓ should return true for existing playbook
      ✓ should return false for non-existent playbook
    Step Executors
      ✓ should have executors for all steps in safe-retry-runner
      ✓ should have executors for all steps in rerun-post-deploy-verification
    Idempotency Key Functions
      ✓ should have idempotency key functions for all steps in safe-retry-runner
      ✓ should have idempotency key functions for all steps in rerun-post-deploy-verification
      ✓ should have idempotency key functions for all steps in service-health-reset

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

### 4. Code Quality Checks

```powershell
# Run linter (if configured)
npm --prefix control-center run lint
```

**Expected Output:**
- ✅ No linting errors
- ✅ Code follows project style guidelines

### 5. Manual Code Review Checklist

```powershell
# Verify new files exist
Test-Path control-center/src/lib/ecs/adapter.ts
Test-Path control-center/src/lib/playbooks/service-health-reset.ts
Test-Path control-center/__tests__/lib/playbooks/service-health-reset.test.ts
```

**Expected Output:**
```
True
True
True
```

## Integration Testing

### Database Setup

```powershell
# Run database migrations
npm --prefix control-center run db:migrate
```

### Lawbook Parameter Configuration

```sql
-- Connect to PostgreSQL and run:
INSERT INTO lawbook_parameters (key, value, scope, category, type, description)
VALUES (
  'ecs_force_new_deployment_enabled',
  true,
  'deploy',
  'safety',
  'boolean',
  'Enable ECS force new deployment operation for service health reset'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

### Test Playbook Execution (Manual)

```powershell
# 1. Create a test incident with ECS evidence
# 2. Execute the playbook via remediation executor
# 3. Verify the service is reset
# 4. Verify incident status is updated
```

## Troubleshooting

### Issue: Tests fail with "Cannot find module 'next/jest'"

**Solution:**
```powershell
# Reinstall dependencies
rm -rf control-center/node_modules
npm --prefix control-center install
```

### Issue: Build fails with "next: not found"

**Solution:**
```powershell
# Ensure Next.js is installed
npm --prefix control-center install next
```

### Issue: ECS operations fail with access denied

**Solution:**
1. Check AWS credentials are configured
2. Verify IAM role has ECS permissions:
   - `ecs:DescribeServices`
   - `ecs:UpdateService`
3. Verify lawbook parameter is enabled

### Issue: Playbook not found in registry

**Solution:**
```powershell
# Verify registry.ts includes service-health-reset
Get-Content control-center/src/lib/playbooks/registry.ts | Select-String "service-health-reset"
```

## Success Criteria

All of the following must be true:

- ✅ `npm run repo:verify` passes without errors
- ✅ `npm --prefix control-center run build` completes successfully
- ✅ `npm --prefix control-center test -- --testPathPattern="service-health-reset"` - all tests pass
- ✅ service-health-reset.test.ts - 17 functional tests pass
- ✅ service-health-reset-hardening.test.ts - 14 hardening tests pass
- ✅ registry.test.ts - 15 tests pass (4 playbooks registered)
- ✅ No TypeScript compilation errors
- ✅ No linting errors
- ✅ All new files created and tracked in git

### Hardening-Specific Criteria

- ✅ Target allowlist enforced (deny-by-default, fail-closed)
- ✅ ALB evidence mapping deterministic (no heuristics)
- ✅ Canonical environment semantics (normalized matching)
- ✅ Frequency limiting (hourly idempotency keys)
- ✅ Secret sanitization (all outputs use `sanitizeRedact()`)
- ✅ All new behavior is fail-closed, deny-by-default
- ✅ Tests prove: denied target→0 adapter calls, ALB without mapping→fail-closed, env mismatch→not MITIGATED, frequency limiting→once per hour

## Verification Report Template

```markdown
## E77.4 Verification Report

**Date:** [DATE]
**Tester:** [NAME]
**Environment:** [development/staging/production]

### Results

- [ ] Repository verification: PASS/FAIL
- [ ] Build: PASS/FAIL
- [ ] Unit tests: PASS/FAIL (XX/17 service-health-reset tests passed)
- [ ] Registry tests: PASS/FAIL (XX/15 tests passed)
- [ ] Integration tests: PASS/FAIL
- [ ] Code review: PASS/FAIL

### Notes

[Any issues encountered, workarounds, or additional observations]

### Conclusion

- [ ] Ready for merge
- [ ] Needs fixes (see notes)
```
