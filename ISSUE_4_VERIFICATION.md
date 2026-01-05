# Issue 4 Verification Commands

## Quick Verification

### 1. Run All Tests

```bash
# Run all migration parity tests (14 tests)
npm --prefix control-center test -- __tests__/api/migration-parity.test.ts

# Run environment detection tests (18 tests)
npm --prefix control-center test -- __tests__/lib/utils/deployment-env.test.ts

# Run both together
npm --prefix control-center test -- __tests__/api/migration-parity.test.ts __tests__/lib/utils/deployment-env.test.ts
```

**Expected:** ✅ 32 tests pass

---

### 2. Verify Prod-Block Behavior

```bash
# Test 1: Prod-block returns 409
cd control-center
npm test -- -t "409: Production access disabled"

# Test 2: Prod-block executes before auth
npm test -- -t "409: Prod-block happens before auth checks"
```

**Expected:** ✅ Both tests pass

---

### 3. Check Environment Detection

```bash
# Test fail-safe behavior
cd control-center
npm test -- -t "returns \"staging\" for missing ENVIRONMENT"

# Test production detection
npm test -- -t "returns \"production\" for ENVIRONMENT=production"
```

**Expected:** ✅ All environment tests pass

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

- [ ] All 32 tests pass (18 deployment-env + 14 migration-parity)
- [ ] Prod-block test passes (409 response)
- [ ] Staging allows admin access (200 response)
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
