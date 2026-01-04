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

#### Run All Playbook Tests

```powershell
# Run all playbook tests
npm --prefix control-center test -- --testPathPattern=playbooks
```

**Expected Output:**
- ✅ All playbook tests pass
- ✅ service-health-reset tests pass
- ✅ registry tests pass

#### Run Service Health Reset Tests Specifically

```powershell
# Run service-health-reset playbook tests
npm --prefix control-center test -- service-health-reset.test.ts
```

**Expected Output:**
```
PASS  __tests__/lib/playbooks/service-health-reset.test.ts
  SERVICE_HEALTH_RESET Playbook
    Playbook Definition
      ✓ should have correct metadata
      ✓ should require ECS or ALB evidence
      ✓ should have five steps
    Step 1: Snapshot State
      ✓ should fail when no ECS evidence is found
      ✓ should fail when evidence is missing cluster or service
      ✓ should snapshot service state successfully
    Step 2: Apply Reset
      ✓ should fail when lawbook denies operation
      ✓ should execute force new deployment when allowed
    Step 3: Wait & Observe
      ✓ should poll service stability with bounded timeout
      ✓ should handle timeout when service does not stabilize
    Step 4: Post Verification
      ✓ should skip verification when no environment provided
      ✓ should run verification when environment is provided
    Step 5: Update Status
      ✓ should update incident to MITIGATED when remediation succeeds
      ✓ should keep incident as ACKED when remediation partially fails
    Idempotency Keys
      ✓ should generate consistent snapshot idempotency key
      ✓ should generate consistent reset idempotency key
      ✓ should generate consistent observe idempotency key

Test Suites: 1 passed, 1 total
Tests:       17 passed, 17 total
```

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
- ✅ `npm --prefix control-center test` - all tests pass
- ✅ service-health-reset.test.ts - 17 tests pass
- ✅ registry.test.ts - 15 tests pass (4 playbooks registered)
- ✅ No TypeScript compilation errors
- ✅ No linting errors
- ✅ All new files created and tracked in git

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
