# Issue 3: Production Deactivation Verification Runbook

**Date:** 2026-01-05  
**Purpose:** Step-by-step verification commands for Issue 3 implementation  
**Audience:** Ops, DevOps, QA

## Prerequisites

```powershell
# Set your AWS profile and region
$Profile = "codefactory"
$Region = "eu-central-1"

# Verify AWS credentials
aws sts get-caller-identity --profile $Profile --region $Region
```

## Part 1: Deploy Guardrail Verification

### Test 1: Block Production Deploys (ENABLE_PROD=false)

```powershell
# Set ENABLE_PROD=false
$env:ENABLE_PROD = "false"
$env:DEPLOY_ENV = "production"

# Run deploy guardrail (should BLOCK)
npx ts-node scripts/deploy-context-guardrail.ts

# Expected output:
# ❌ GUARDRAIL FAIL: Production deploys are currently disabled
# Exit code: 1
```

**Verify:**
- ✅ Exit code = 1 (blocked)
- ✅ Error message mentions "ENABLE_PROD=false"
- ✅ No deployment proceeds

### Test 2: Allow Staging Deploys (ENABLE_PROD=false)

```powershell
# ENABLE_PROD still false, but staging should work
$env:ENABLE_PROD = "false"
$env:DEPLOY_ENV = "staging"

# Run deploy guardrail (should PASS)
npx ts-node scripts/deploy-context-guardrail.ts

# Expected output:
# ✅ GUARDRAIL PASS: All environment checks passed
# Exit code: 0
```

**Verify:**
- ✅ Exit code = 0 (allowed)
- ✅ Staging is not affected by ENABLE_PROD

### Test 3: Allow Production When Enabled (ENABLE_PROD=true)

```powershell
# Set ENABLE_PROD=true
$env:ENABLE_PROD = "true"
$env:DEPLOY_ENV = "production"

# Run deploy guardrail (should PASS)
npx ts-node scripts/deploy-context-guardrail.ts

# Expected output:
# ✅ GUARDRAIL PASS: All environment checks passed
# Exit code: 0
```

**Verify:**
- ✅ Exit code = 0 (allowed)
- ✅ Production allowed when explicitly enabled

## Part 2: API Endpoint Guardrail Verification

### Prerequisites: Set Up Test Environment

```powershell
# Install dependencies
npm --prefix control-center install

# Set environment variables for API
$env:ENABLE_PROD = "false"
$env:ENVIRONMENT = "production"
$env:DATABASE_ENABLED = "false"  # Simplify testing
$env:NODE_ENV = "test"
```

### Test 4: Verify Guard Ordering (401 → 409 → 403)

**Test 4a: Missing Auth → 401**

```bash
# Without x-afu9-sub header
curl -X POST http://localhost:3000/api/ops/issues/sync \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: HTTP 401 UNAUTHORIZED
# Body: { "code": "UNAUTHORIZED", "details": "Authentication required..." }
```

**Test 4b: Prod Disabled → 409**

```bash
# With auth, but ENABLE_PROD=false in production
curl -X POST http://localhost:3000/api/ops/issues/sync \
  -H "x-afu9-sub: test-user-123" \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected: HTTP 409 CONFLICT
# Body: { "code": "PROD_DISABLED", "details": { "environment": "production" } }
```

**Test 4c: Non-Admin → 403** (for admin-required endpoints)

```bash
# With auth, ENABLE_PROD=true, but not admin
curl -X POST http://localhost:3000/api/ops/db/migrations \
  -H "x-afu9-sub: non-admin-user" \
  -H "Content-Type: application/json"

# Expected: HTTP 403 FORBIDDEN (if endpoint requires admin)
# Body: { "code": "FORBIDDEN", "details": "User not in admin allowlist" }
```

### Test 5: Verify /api/ready Semantics

**Test 5a: Production with ENABLE_PROD=false**

```bash
# Set environment
export ENABLE_PROD=false
export ENVIRONMENT=production
export DATABASE_ENABLED=false

# Call /api/ready
curl http://localhost:3000/api/ready | jq

# Expected:
# {
#   "ready": true,  ← ✅ Should be true, not false
#   "prodControl": {
#     "prodEnabled": false,
#     "prodWritesBlocked": true,
#     "reason": "Production environment in cost-reduction mode..."
#   },
#   "checks": {
#     "prod_enabled": {
#       "status": "info",  ← ✅ Should be 'info', not 'error'
#       "message": "Production write operations disabled..."
#     }
#   }
# }
```

**Verify:**
- ✅ `ready` = `true` (not false)
- ✅ `prodControl.prodEnabled` = `false`
- ✅ `prodControl.prodWritesBlocked` = `true`
- ✅ `checks.prod_enabled.status` = `'info'` (not 'error')
- ✅ HTTP status = 200 (not 503)

**Test 5b: Staging (no prodControl flags)**

```bash
export ENABLE_PROD=false
export ENVIRONMENT=staging

curl http://localhost:3000/api/ready | jq

# Expected:
# {
#   "ready": true,
#   "prodControl": undefined,  ← Not present for staging
#   "checks": {
#     // No prod_enabled check
#   }
# }
```

## Part 3: ECS Service Verification

### Test 6: Verify Prod ECS Desired Count = 0

```powershell
# Check ECS service desired count
aws ecs describe-services `
  --cluster afu9-cluster `
  --services afu9-control-center-prod `
  --region $Region `
  --profile $Profile `
  --query 'services[0].[serviceName,desiredCount,runningCount,status]' `
  --output table

# Expected:
# -----------------------------------------------
# |              DescribeServices              |
# +--------------------------------------------+
# |  afu9-control-center-prod                 |
# |  0                          (desiredCount) |
# |  0                          (runningCount) |
# |  ACTIVE                         (status)   |
# +--------------------------------------------+
```

**Verify:**
- ✅ desiredCount = 0
- ✅ runningCount = 0 (may take a few minutes to scale down)
- ✅ status = ACTIVE (service exists but paused)

### Test 7: Verify Stage ECS Still Running

```powershell
# Check stage service
aws ecs describe-services `
  --cluster afu9-cluster `
  --services afu9-control-center-staging `
  --region $Region `
  --profile $Profile `
  --query 'services[0].[serviceName,desiredCount,runningCount,status]' `
  --output table

# Expected:
# -----------------------------------------------
# |              DescribeServices              |
# +--------------------------------------------+
# |  afu9-control-center-staging              |
# |  1                          (desiredCount) |
# |  1                          (runningCount) |
# |  ACTIVE                         (status)   |
# +--------------------------------------------+
```

**Verify:**
- ✅ desiredCount > 0
- ✅ runningCount > 0
- ✅ Stage is still operational

## Part 4: ALB Health Check Verification

### Test 8: Verify Prod Returns 503

```bash
# Test production endpoint
curl -I https://prod.afu-9.com

# Expected: HTTP/1.1 503 Service Unavailable
# Body: "Production environment is currently paused..."
```

### Test 9: Verify Stage Returns 200

```bash
# Test staging endpoint
curl -I https://stage.afu-9.com

# Expected: HTTP/1.1 200 OK
```

### Test 10: Verify ALB Health Checks Use /api/health

```powershell
# Check target group health check configuration
$TgArn = aws elbv2 describe-target-groups `
  --names afu9-tg-prod `
  --region $Region `
  --profile $Profile `
  --query 'TargetGroups[0].TargetGroupArn' `
  --output text

aws elbv2 describe-target-health `
  --target-group-arn $TgArn `
  --region $Region `
  --profile $Profile `
  --query 'TargetHealthDescriptions[0].TargetHealth' `
  --output json

# Expected: Empty (no targets) or unhealthy (tasks stopped)
```

**Verify CDK Configuration:**

```bash
# Check that ALB health checks use /api/health
grep -n "path.*health" lib/afu9-network-stack.ts bin/codefactory-control.ts

# Expected output showing:
# lib/afu9-network-stack.ts:169:        path: '/api/health',
```

## Part 5: Automated Test Verification

### Test 11: Run Guard Tests

```bash
# Run prod-write-guard tests
npm --prefix control-center test -- prod-write-guard.test.ts

# Expected: All tests pass
# ✅ Guard ordering: 401 → 409 → 403
# ✅ No DB calls on blocked paths
# ✅ Fail-closed behavior
```

### Test 12: Run /api/ready Tests

```bash
# Run ready endpoint tests
npm --prefix control-center test -- ready-prod-disabled.test.ts

# Expected: All tests pass
# ✅ ready=true when ENABLE_PROD=false
# ✅ prodControl flags present
# ✅ No unhealthy churn
```

### Test 13: Run Full Test Suite

```bash
# Run all control-center tests
npm --prefix control-center test

# Expected: All existing tests still pass
# No regressions introduced
```

### Test 14: Build Verification

```bash
# Verify TypeScript compiles
npm --prefix control-center run build

# Expected: Build succeeds with no errors
```

### Test 15: Repo Verification

```bash
# Run repository verification
npm run repo:verify

# Expected: All checks pass
# No forbidden directories
# No security violations
```

## Part 6: Merge Evidence

### Checklist Before Merge

- [ ] All deploy guardrail tests pass (Tests 1-3)
- [ ] All API endpoint tests pass (Tests 4-5)
- [ ] ECS service verification passes (Tests 6-7)
- [ ] ALB health checks verified (Tests 8-10)
- [ ] Automated tests pass (Tests 11-15)
- [ ] Documentation reviewed
- [ ] Code review completed
- [ ] No secrets in responses or logs

### Baseline vs Branch Test Parity

```bash
# Run tests on main branch (baseline)
git checkout main
npm --prefix control-center test 2>&1 | tee /tmp/baseline-tests.txt

# Run tests on feature branch
git checkout copilot/deactivate-prod-services
npm --prefix control-center test 2>&1 | tee /tmp/branch-tests.txt

# Compare (known failures are acceptable if unrelated)
diff /tmp/baseline-tests.txt /tmp/branch-tests.txt
```

### Build Determinism

```bash
# Verify build is deterministic
npm --prefix control-center run build
npm run determinism:check
```

## Troubleshooting

### Issue: Guard tests fail with "Cannot find module"

**Solution:**
```bash
cd control-center
npm install
npm test
```

### Issue: /api/ready returns ready=false

**Check:**
1. Verify DATABASE_ENABLED is set correctly
2. Check database connection if DATABASE_ENABLED=true
3. Review checks object for errors (exclude prod_enabled)

### Issue: Deploy guardrail passes when it should block

**Check:**
1. Verify ENABLE_PROD environment variable is set to exactly "false"
2. Check DEPLOY_ENV is set to "production"
3. Review scripts/deploy-context-guardrail.ts for logic errors

## Success Criteria

✅ All 15 tests pass  
✅ Deploy guardrail blocks prod when ENABLE_PROD=false  
✅ API endpoints return correct status codes (401 → 409 → 403)  
✅ /api/ready returns ready=true with prodControl flags  
✅ ECS prod service at desiredCount=0  
✅ Stage service still running  
✅ No regressions in existing tests  
✅ Build succeeds  
✅ repo:verify passes  

## References

- [ISSUE_3_GUARD_AUDIT.md](../audit/v0.7/ISSUE_3_GUARD_AUDIT.md) - Current implementation audit
- [ISSUE_3_IMPLEMENTATION_SUMMARY.md](../../ISSUE_3_IMPLEMENTATION_SUMMARY.md) - Original implementation
- [LOW_COST_MODE.md](../runbooks/LOW_COST_MODE.md) - Pause/resume runbook
