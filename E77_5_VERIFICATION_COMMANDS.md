# E77.5 Verification Commands

This document provides PowerShell commands to verify the E77.5 audit trail implementation.

## Prerequisites

Ensure you're in the repository root directory and dependencies are installed:

```powershell
cd /path/to/codefactory-control
npm install
```

## 1. Run Audit Trail Tests

Run all remediation tests including the new audit trail tests:

```powershell
npm --prefix control-center test -- __tests__/lib/remediation
```

**Expected Output:**
```
PASS __tests__/lib/remediation-audit-trail.test.ts
PASS __tests__/lib/remediation-audit-integration.test.ts
PASS __tests__/lib/remediation-executor.test.ts
PASS __tests__/lib/remediation-hardening.test.ts

Test Suites: 4 passed, 4 total
Tests:       48 passed, 48 total
```

### Run Specific Audit Trail Tests

**Unit tests only:**
```powershell
npm --prefix control-center test -- __tests__/lib/remediation-audit-trail.test.ts
```

**Integration tests only:**
```powershell
npm --prefix control-center test -- __tests__/lib/remediation-audit-integration.test.ts
```

## 2. Build Application

Build the control-center application to verify TypeScript compilation and Next.js build:

```powershell
npm --prefix control-center run build
```

**Expected Output:**
Should complete successfully and show the new API routes:
```
├ ƒ /api/remediation/runs/[id]/audit
├ ƒ /api/remediation/runs/[id]/export
```

## 3. Verify Repository Canon

Run repository structure verification:

```powershell
npm run repo:verify
```

**Expected Output:**
```
✅ All repository canon checks passed!
```

Note: Warnings about unreferenced routes are expected for new APIs that haven't been wired to UI yet.

## 4. Run Database Migration (Optional)

If you have a local database setup, you can test the migration:

```powershell
# Run migrations
npm --prefix control-center run db:migrate

# Or manually with psql
psql -d your_database -f database/migrations/040_remediation_audit_events.sql
```

**Verification Query:**
```sql
-- Verify table exists
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'remediation_audit_events'
ORDER BY ordinal_position;

-- Verify append-only trigger exists
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trg_prevent_remediation_audit_event_updates';

-- Verify indexes exist
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'remediation_audit_events';
```

## 5. Test Payload Hash Determinism

Run a quick test to verify payload hash function works correctly:

```powershell
npm --prefix control-center test -- -t "should compute same hash for same payload"
```

## 6. Test Audit Event Emission

Verify audit events are emitted in correct order:

```powershell
npm --prefix control-center test -- -t "should emit audit events in correct order"
```

## 7. Code Quality Checks (Optional)

### TypeScript Type Checking
```powershell
cd control-center
npx tsc --noEmit
```

### Linting
```powershell
npm --prefix control-center run lint
```

## Quick Verification Script

Run all verification steps in sequence:

```powershell
# PowerShell script to run all verifications
function Test-E77_5 {
    Write-Host "=== E77.5 Audit Trail Verification ===" -ForegroundColor Cyan
    
    Write-Host "`n[1/4] Running audit trail tests..." -ForegroundColor Yellow
    npm --prefix control-center test -- __tests__/lib/remediation
    if ($LASTEXITCODE -ne 0) { 
        Write-Host "❌ Tests failed!" -ForegroundColor Red
        return
    }
    
    Write-Host "`n[2/4] Building application..." -ForegroundColor Yellow
    npm --prefix control-center run build
    if ($LASTEXITCODE -ne 0) { 
        Write-Host "❌ Build failed!" -ForegroundColor Red
        return
    }
    
    Write-Host "`n[3/4] Verifying repository canon..." -ForegroundColor Yellow
    npm run repo:verify
    
    Write-Host "`n[4/4] Running TypeScript type check..." -ForegroundColor Yellow
    Set-Location control-center
    npx tsc --noEmit
    Set-Location ..
    
    Write-Host "`n✅ All verifications complete!" -ForegroundColor Green
}

# Run the verification
Test-E77_5
```

## Expected Results Summary

| Check | Status | Notes |
|-------|--------|-------|
| Audit Trail Tests | ✅ 11/11 passing | Payload hash, ordering, sanitization |
| Integration Tests | ✅ 1/1 passing | End-to-end event emission |
| All Remediation Tests | ✅ 48/48 passing | Includes existing + new tests |
| Build | ✅ Success | New API routes registered |
| Repo Verification | ✅ Pass | Warnings for unreferenced routes OK |
| TypeScript Compilation | ✅ No errors | All types valid |

## Troubleshooting

### Tests Failing
- Ensure all dependencies installed: `npm install`
- Clear jest cache: `npm --prefix control-center test -- --clearCache`

### Build Failing
- Check for TypeScript errors: `cd control-center && npx tsc --noEmit`
- Ensure packages built: `npm run build` in root

### Repo Verification Failing
- Check for .next directory: `rm -rf control-center/.next`
- Verify .gitignore includes `.next/`

## Additional Validation

### Manual API Testing (Requires Running Server)

Start the development server:
```powershell
npm --prefix control-center run dev
```

Test audit query endpoint:
```powershell
curl http://localhost:3000/api/remediation/runs/[run-id]/audit
```

Test export endpoint:
```powershell
curl http://localhost:3000/api/remediation/runs/[run-id]/export > audit-export.json
```

### Database Testing (If Database Available)

Test append-only constraint:
```sql
-- This should succeed
INSERT INTO remediation_audit_events (
  remediation_run_id, incident_id, event_type,
  lawbook_version, payload_json, payload_hash
) VALUES (
  gen_random_uuid(), gen_random_uuid(), 'PLANNED',
  'v1.0.0', '{"test": true}'::jsonb, 'hash123'
);

-- This should FAIL with error
UPDATE remediation_audit_events 
SET payload_json = '{"modified": true}'::jsonb 
WHERE id = (SELECT id FROM remediation_audit_events LIMIT 1);
-- Expected: ERROR: remediation_audit_events is append-only: updates are not allowed
```

## Success Criteria

All of the following should be true:
- ✅ All 48 remediation tests pass
- ✅ Build completes without errors
- ✅ New API routes appear in build output
- ✅ Repository canon verification passes
- ✅ TypeScript compilation has no errors
- ✅ Append-only constraint prevents updates (if database available)
