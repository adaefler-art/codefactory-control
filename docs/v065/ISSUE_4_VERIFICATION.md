# Issue 4 Verification Commands (AFU-9 Guardrails)

## Quick Verification

### 1. Run All Tests

```bash
# Run all migration parity tests (17 tests)
npm --prefix control-center test -- __tests__/api/migration-parity.test.ts

# Run environment detection tests (22 tests)
npm --prefix control-center test -- __tests__/lib/utils/deployment-env.test.ts

# Run both together
npm --prefix control-center test -- __tests__/api/migration-parity.test.ts __tests__/lib/utils/deployment-env.test.ts

# Verify repo (includes linting and other checks)
npm run repo:verify
```

**Expected:** ✅ 39 tests pass (17 migration-parity + 22 deployment-env)

---

### 2. Verify AFU-9 Guardrail Ordering (401-first)

```bash
# Test 1: Unauthenticated returns 401 (auth-first, not env gating)
cd control-center
npm test -- -t "401: Unauthorized without x-afu9-sub header"

# Test 2: Unauthenticated in prod returns 401 (not 409)
npm test -- -t "401: Unauthenticated in production returns 401"

# Test 3: Production env disabled (after auth)
npm test -- -t "409: Production environment disabled"

# Test 4: Unknown env disabled (fail-closed)
npm test -- -t "409: Unknown environment disabled"
```

**Expected:** ✅ All tests pass, proving correct ordering: 401 → 409 → 403

---

### 3. Verify Zero DB Calls in Prod/Unknown

```bash
# All env gating tests verify mockCheckDbReachability is NOT called
cd control-center
npm test -- -t "409:"
```

**Expected:** ✅ All 409 tests pass with zero DB calls

---

### 4. Check Environment Detection (Fail-Closed)

```bash
# Test fail-closed behavior (unknown, not staging)
cd control-center
npm test -- -t "returns \"unknown\" for missing ENVIRONMENT"

# Test production detection
npm test -- -t "returns \"production\" for ENVIRONMENT=production"

# Test staging detection
npm test -- -t "returns \"staging\" for ENVIRONMENT=staging"

# Test isUnknown helper
npm test -- -t "isUnknown"
```

**Expected:** ✅ All environment tests pass (unknown for invalid/missing)

---

### 4. Verify GitHub Workflow Change

```bash
# Check workflow file
grep "role-to-assume" .github/workflows/migration-parity.yml
```

**Expected:**
```yaml
role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}
```

---

### 5. Build Verification (TypeScript)

```bash
# Check TypeScript compilation of new files
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/utils/deployment-env.ts
```

**Expected:** No errors (exit code 0)

---

## Manual Testing (Optional)

### Test in Staging Environment

1. **Set up admin user:**
   ```bash
   # In ECS task definition, set:
   AFU9_ADMIN_SUBS=your-cognito-sub-here
   ```

2. **Access UI:**
   ```
   https://stage.afu-9.com/ops/migrations
   ```

3. **Expected behavior:**
   - If authenticated + admin → 200 OK, shows migration parity data
   - If authenticated + not admin → 403, shows diagnostic with sub + fix instructions
   - If not authenticated → 401, shows login prompt

### Test in Production Environment

1. **Access UI:**
   ```
   https://afu-9.com/ops/migrations
   ```

2. **Expected behavior:**
   - Always returns 409 "Production Access Disabled"
   - Shows clear message: "Migration parity checks are disabled in production"
   - No database calls made (check CloudWatch logs)

---

## PowerShell Verification

```powershell
# Stage UI reachable (replace with actual stage URL)
$StageBase = "https://stage.afu-9.com"
Invoke-WebRequest -Uri "$StageBase/ops/migrations" -TimeoutSec 20 | Select-Object StatusCode

# Prod returns 409 (replace with actual prod URL)
$ProdBase = "https://afu-9.com"
try {
    Invoke-WebRequest -Uri "$ProdBase/ops/migrations" -TimeoutSec 20
} catch {
    $_.Exception.Response.StatusCode.value__  # Should be 409
}

# Get AWS Account ID (for verifying ARN)
aws sts get-caller-identity --profile codefactory --region eu-central-1
```

---

## GitHub Actions Verification

### Step 1: Set Secret

1. Go to GitHub repo settings
2. Navigate to: Settings → Secrets and variables → Actions
3. Ensure `AWS_ROLE_TO_ASSUME` exists with value:
   ```
   arn:aws:iam::313095875771:role/GitHubActionsRole
   ```

### Step 2: Trigger Workflow

1. Go to Actions tab
2. Select "Migration Parity Check" workflow
3. Click "Run workflow"
4. Fill in:
   - Base URL: `https://stage.afu-9.com`
   - Environment: `staging`
   - Limit: `200`

### Step 3: Verify Results

**Expected:**
- ✅ "Configure AWS credentials" step succeeds
- ✅ "Retrieve smoke key" step succeeds
- ✅ "Call Migration Parity Endpoint" step succeeds (HTTP 200)
- ✅ Artifact "migration-parity-report" is uploaded

**If it fails:**
- Check IAM role trust policy includes GitHub OIDC provider
- Verify `AWS_ROLE_TO_ASSUME` secret is set correctly
- Check CloudWatch logs for errors

---

## Success Criteria Checklist

### AFU-9 Guardrails (Strict Ordering)
- [ ] All 39 tests pass (22 deployment-env + 17 migration-parity)
- [ ] Auth-first test passes (401 before env gating)
- [ ] Unauthenticated in prod returns 401 (not 409)
- [ ] Production env disabled returns 409 (after auth)
- [ ] Unknown env disabled returns 409 (fail-closed)
- [ ] Zero DB calls in prod/unknown (verified in tests)

### Original Requirements
- [ ] Staging allows admin access (200 response)
- [ ] Staging blocks non-admin (403 with helpful diagnostic)
- [ ] Production always returns 409 (ENV_DISABLED)
- [ ] Unknown/unconfigured env returns 409 (fail-closed)
- [ ] GitHub Actions workflow succeeds
- [ ] OIDC authentication works
- [ ] No secrets in logs or UI
- [ ] Environment logging works (check console output in tests)

### Repo Verification
- [ ] `npm run repo:verify` passes
- [ ] `npm --prefix control-center test` passes
- [ ] Staging blocks non-admin (403 with helpful diagnostic)
- [ ] Production always returns 409
- [ ] GitHub Actions workflow succeeds
- [ ] OIDC authentication works
- [ ] No secrets in logs or UI
- [ ] Environment logging works (check console output in tests)

---

## Troubleshooting

### Test Failures

**Problem:** Tests fail with "Cannot find module"
**Solution:**
```bash
cd control-center
npm ci  # Reinstall dependencies
npm test
```

**Problem:** Build fails
**Solution:**
Check that package dependencies are installed:
```bash
cd control-center
npm ci
npm run build
```

### Workflow Failures

**Problem:** "Could not assume role with OIDC"
**Solution:**
1. Check `AWS_ROLE_TO_ASSUME` secret is set
2. Verify secret contains full ARN: `arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME>`
3. Check IAM role trust policy allows GitHub OIDC

**Problem:** "Smoke key not found"
**Solution:**
Ensure AWS Secrets Manager has:
- `afu9/staging/smoke-key` for staging
- `afu9/production/smoke-key` for production

### UI Issues

**Problem:** 403 error but I'm admin
**Solution:**
Check ECS task definition has `AFU9_ADMIN_SUBS` set to your Cognito sub

**Problem:** Environment shows wrong value
**Solution:**
Check ECS task definition has `ENVIRONMENT` set to `stage` or `production`

---

## Files Changed Summary

```
✅ .github/workflows/migration-parity.yml
✅ control-center/src/lib/utils/deployment-env.ts (NEW)
✅ control-center/__tests__/lib/utils/deployment-env.test.ts (NEW)
✅ control-center/app/api/ops/db/migrations/route.ts
✅ control-center/app/ops/migrations/page.tsx
✅ control-center/__tests__/api/migration-parity.test.ts
✅ docs/ISSUE_4_IMPLEMENTATION.md (NEW)
✅ SECURITY_SUMMARY_ISSUE_4.md (NEW)
```

**Total:** 8 files, +785 lines

---

## Sign-Off

- [x] All tests passing
- [x] Code review completed
- [x] Security review completed
- [x] Documentation complete
- [x] Verification commands tested
- [x] Ready for merge

**Status:** ✅ READY FOR PRODUCTION
