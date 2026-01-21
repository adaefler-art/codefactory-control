# I201.6 Evidence Link/Refresh - Verification Commands

## Prerequisites
Ensure you have the repository cloned and are in the root directory.

## Verification Steps

### 1. Repository Verification
Run the repository verification script to check for any issues:

```powershell
npm run repo:verify
```

**Expected Output**: All checks should pass (no errors related to the changes)

### 2. Build Verification
Build the control-center application to ensure TypeScript compilation succeeds:

```powershell
npm --prefix control-center run build
```

**Expected Output**: Build completes successfully without TypeScript errors

### 3. Test Verification
Run the tests to verify functionality:

```powershell
# Run all tests
npm --prefix control-center test

# Run specific evidence refresh tests
npm --prefix control-center test -- __tests__/api/afu9-evidence-refresh.test.ts

# Run integration tests
npm --prefix control-center test -- __tests__/integration/evidence-refresh-flow.test.ts
```

**Expected Output**: All tests pass

### 4. Database Migration
Apply the database migration to add evidence reference columns:

```powershell
npm --prefix control-center run db:migrate
```

**Expected Output**: Migration 082 applies successfully

### 5. API Route Verification
Verify that the new API route is registered:

```powershell
node scripts/verify-routes.js
```

**Expected Output**: No errors, route registered

### 6. Manual API Testing (Optional)

#### Start the Development Server
```powershell
npm --prefix control-center run dev
```

#### Test Evidence Refresh Endpoint
```powershell
# Create a test run first (if needed)
curl -X POST http://localhost:3000/api/afu9/issues/{issueId}/runs/start `
  -H "Content-Type: application/json" `
  -d '{"type": "test"}'

# Refresh evidence
curl -X POST http://localhost:3000/api/afu9/runs/{runId}/evidence/refresh `
  -H "Content-Type: application/json" `
  -d '{
    "url": "s3://bucket/evidence/run-123.json",
    "evidenceHash": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "version": "1.0"
  }'

# Get run details with evidenceRef
curl http://localhost:3000/api/runs/{runId}
```

**Expected Output**: 
- POST returns 200 with evidenceRef
- GET returns run details including evidenceRef

### 7. Database Verification
Check that the migration created the columns correctly:

```sql
-- Connect to your database and run:
\d runs

-- Should show new columns:
-- evidence_url | text
-- evidence_hash | character varying(64)
-- evidence_fetched_at | timestamp with time zone
-- evidence_version | character varying(50)

-- Check indexes:
\di runs_evidence_hash_idx
\di runs_evidence_fetched_at_idx
```

**Expected Output**: Columns and indexes exist

### 8. Security Scan (Optional)
Run security checks:

```powershell
npm run security:check
```

**Expected Output**: No new security issues introduced

## Validation Checklist

- [ ] Repository verification passes
- [ ] Build completes successfully
- [ ] All tests pass
- [ ] Database migration applies successfully
- [ ] API routes are registered
- [ ] Manual API testing works (if performed)
- [ ] Database schema is correct
- [ ] No security issues found

## Troubleshooting

### Build Fails
- **Issue**: Dependencies not installed
- **Solution**: Run `npm install` in root and `npm install --prefix control-center`

### Tests Fail
- **Issue**: Database connection or mocks not working
- **Solution**: Check that test mocks are properly configured

### Migration Fails
- **Issue**: Database connection or permissions
- **Solution**: Check database connection string and permissions

### API Route Not Found
- **Issue**: Server not restarted after changes
- **Solution**: Restart the development server

## Success Criteria

All verification steps should complete successfully:
1. ✅ Build completes without errors
2. ✅ Tests pass (10/10 test cases)
3. ✅ Migration applies cleanly
4. ✅ API endpoint responds correctly
5. ✅ No security vulnerabilities introduced

## Next Steps After Verification

1. Review the changes in the PR
2. Get stakeholder approval
3. Deploy migration to staging environment
4. Test in staging
5. Deploy to production
6. Monitor for issues

## Documentation References

- **Quick Reference**: `I201_6_QUICK_REFERENCE.md`
- **Security Summary**: `I201_6_SECURITY_SUMMARY.md`
- **Implementation Summary**: `I201_6_IMPLEMENTATION_SUMMARY.md`
