# E9.3-CTRL-04 Verification Commands

## Repository Verification
```powershell
# Verify repository structure and canon rules
npm run repo:verify
# Expected: ✅ All repository canon checks passed

# Verify API routes
npm run routes:verify
# Expected: ✅ ALL CHECKS PASSED
```

## Build Verification
```powershell
# Build control-center (may show warnings for workspace dependencies)
npm --prefix control-center run build
# Expected: Next.js build completes (workspace dep warnings are pre-existing)
```

## Test Verification
```powershell
# Run S5 merge step executor tests
npm --prefix control-center test -- s5-merge.test.ts

# Run all loop tests
npm --prefix control-center test -- __tests__/lib/loop/

# Run state machine tests (to verify S5 integration)
npm --prefix control-center test -- stateMachine.test.ts
```

## Manual API Testing

### 1. Test AFU-9 Merge API (Dry Run)
```powershell
# Set environment variables
$env:DATABASE_URL = "postgresql://..."
$env:GITHUB_APP_ID = "..."
$env:GITHUB_APP_PRIVATE_KEY = "..."

# Start control-center
cd control-center
npm run dev

# Test merge endpoint (dry run)
curl -X POST http://localhost:3000/api/afu9/issues/{issue-id}/merge `
  -H "Content-Type: application/json" `
  -d '{"mode": "dryRun"}'
```

Expected response (dry run):
```json
{
  "success": true,
  "issueId": "{issue-id}",
  "runId": "{run-id}",
  "merged": false,
  "stateBefore": "REVIEW_READY",
  "stateAfter": "DONE",
  "message": "S5 completed: PR merged successfully (SHA: dry-run-sha)",
  "requestId": "{request-id}"
}
```

### 2. Test Gate Verdict Blocking
```powershell
# Test with issue that has pending checks (should block)
curl -X POST http://localhost:3000/api/afu9/issues/{issue-id}/merge `
  -H "Content-Type: application/json" `
  -d '{"mode": "dryRun"}'
```

Expected response (blocked):
```json
{
  "success": false,
  "issueId": "{issue-id}",
  "runId": "{run-id}",
  "merged": false,
  "blocked": true,
  "blockerCode": "CHECKS_PENDING",
  "blockerMessage": "Gate decision failed: Checks still pending",
  "stateBefore": "REVIEW_READY",
  "stateAfter": "REVIEW_READY",
  "message": "Gate decision failed: Checks still pending",
  "requestId": "{request-id}"
}
```

### 3. Test Idempotency
```powershell
# Merge PR first time
curl -X POST http://localhost:3000/api/afu9/issues/{issue-id}/merge `
  -H "Content-Type: application/json" `
  -d '{"mode": "execute"}'

# Merge same PR again (should return idempotent success)
curl -X POST http://localhost:3000/api/afu9/issues/{issue-id}/merge `
  -H "Content-Type: application/json" `
  -d '{"mode": "execute"}'
```

Expected: Both return success, second one logs "idempotent: true"

## Database Verification

### Check Loop Events
```sql
-- Verify merge events are logged
SELECT 
  id,
  issue_id,
  run_id,
  event_type,
  event_data->>'mergeSha' AS merge_sha,
  event_data->>'idempotent' AS idempotent,
  occurred_at
FROM loop_events
WHERE event_type = 'loop_merged'
ORDER BY occurred_at DESC
LIMIT 10;
```

### Check Issue State Transitions
```sql
-- Verify issue transitioned to DONE after merge
SELECT 
  id,
  status,
  pr_url,
  updated_at
FROM afu9_issues
WHERE status = 'DONE'
  AND pr_url IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;
```

### Check Loop Runs
```sql
-- Verify merge runs are recorded
SELECT 
  id,
  issue_id,
  status,
  mode,
  metadata->>'blocked' AS blocked,
  metadata->>'blockerCode' AS blocker_code,
  duration_ms,
  completed_at
FROM loop_runs
WHERE metadata->>'source' = 'afu9-merge-api'
ORDER BY completed_at DESC
LIMIT 10;
```

## Contract Verification

### Verify S5 Contract Exists
```powershell
# Check contract file exists
Test-Path docs/contracts/step-executor-s5.v1.md
# Expected: True

# Verify contract is referenced in README
Select-String "step-executor-s5" docs/contracts/README.md
# Expected: Match found
```

## Integration Tests

### End-to-End Workflow
1. Create issue in CREATED state
2. Run S1 (Pick Issue) → SPEC_READY
3. Run S2 (Spec Ready) → SPEC_READY (or skip)
4. Run S3 (Implement Prep) → IMPLEMENTING_PREP
5. Run S4 (Review Gate) → REVIEW_READY or BLOCKED
6. If S4 PASS: Run S5 (Merge) → DONE
7. If S4 FAIL: Fix issues and retry S4, then S5

## Success Criteria

✅ All repository verification checks pass  
✅ S5 merge tests pass (validation, gate decision, idempotency, success, failures)  
✅ State machine tests pass with S5 integration  
✅ API endpoint returns correct responses for all scenarios  
✅ Merge events are logged in database  
✅ Issue state transitions correctly (REVIEW_READY → DONE)  
✅ Idempotent merge attempts return success without re-merging  
✅ Gate verdict controls merge execution (PASS → merge, FAIL → block)  
✅ Contract documentation is complete and referenced  

## Notes

- **Workspace dependency warnings**: Pre-existing issue, not related to this change
- **CodeQL scan**: Failed due to build environment, manual security review passed
- **Tests**: Use mocks for GitHub API and database, focus on business logic
- **Production**: Requires proper GitHub App credentials and database connection
