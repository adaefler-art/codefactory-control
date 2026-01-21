# E89.6 Verification Commands

## Local Verification (PowerShell)

### 1. Verify Repository
```powershell
npm run repo:verify
```

### 2. Run Tests
```powershell
# All tests
npm --prefix control-center test

# Specific test files
npm --prefix control-center test -- __tests__/lib/github/issue-draft-version-publisher.test.ts
npm --prefix control-center test -- __tests__/api/intent-issue-draft-version-publish.test.ts
```

### 3. Build Project
```powershell
npm --prefix control-center run build
```

## Staging Deployment (E89.9 Runbook)

### 1. Deploy to Staging
```bash
# Deploy the branch
git checkout copilot/create-batch-publish-issues
npm run deploy -- --profile staging
```

### 2. Set Environment Variables
```bash
# In AWS Console or via CLI
aws secretsmanager put-secret-value \
  --secret-id staging/codefactory-control/env \
  --secret-string '{
    "ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED": "true",
    "AFU9_ADMIN_SUBS": "your-user-id"
  }'
```

### 3. Create Test Session
```bash
# Via API or UI
curl -X POST https://staging.codefactory.example.com/api/intent/sessions \
  -H "x-afu9-sub: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{"name": "E89.6 Test Session"}'
```

### 4. Create Issue Draft Version
```bash
# Commit an issue draft to create a version
curl -X POST https://staging.codefactory.example.com/api/intent/sessions/{sessionId}/issue-draft/commit \
  -H "x-afu9-sub: your-user-id" \
  -H "Content-Type: application/json" \
  -d @test-issue-draft.json
```

### 5. Test Single Version Publish
```bash
# Publish single version
curl -X POST https://staging.codefactory.example.com/api/intent/sessions/{sessionId}/issue-draft/versions/publish \
  -H "x-afu9-sub: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{
    "version_id": "{versionId}",
    "owner": "test-owner",
    "repo": "test-repo"
  }'

# Expected: 200 OK with batch result
# Summary: created=1, updated=0, skipped=0, failed=0
```

### 6. Test Idempotency
```bash
# Run same request again
curl -X POST https://staging.codefactory.example.com/api/intent/sessions/{sessionId}/issue-draft/versions/publish \
  -H "x-afu9-sub: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{
    "version_id": "{versionId}",
    "owner": "test-owner",
    "repo": "test-repo"
  }'

# Expected: 200 OK with skipped items
# Summary: created=0, updated=0, skipped=1, failed=0
# Same batch_id returned
```

### 7. Test Batch Size Limit
```bash
# Create 30 draft versions
for i in {1..30}; do
  # Create draft, commit, get version ID
done

# Publish all versions
curl -X POST https://staging.codefactory.example.com/api/intent/sessions/{sessionId}/issue-draft/versions/publish \
  -H "x-afu9-sub: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{
    "issue_set_id": "{issueSetId}",
    "owner": "test-owner",
    "repo": "test-repo"
  }'

# Expected: 200 OK with warning
# Summary: total=25
# Warnings: ["Batch size clamped from 30 to 25 issues..."]
```

### 8. Test Production Guard
```bash
# Remove ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED from env
# Attempt publish
curl -X POST https://production.codefactory.example.com/api/intent/sessions/{sessionId}/issue-draft/versions/publish \
  -H "x-afu9-sub: your-user-id" \
  -H "Content-Type: application/json" \
  -d '{...}'

# Expected: 409 Conflict
# Error: "Publishing not enabled"
```

### 9. Test Admin Allowlist
```bash
# Attempt with non-admin user
curl -X POST https://staging.codefactory.example.com/api/intent/sessions/{sessionId}/issue-draft/versions/publish \
  -H "x-afu9-sub: non-admin-user" \
  -H "Content-Type: application/json" \
  -d '{...}'

# Expected: 403 Forbidden
# Error: "User not in admin allowlist"
```

### 10. Verify Audit Trail
```sql
-- Check batch events
SELECT batch_id, event_type, total_items, created_count, updated_count, skipped_count, failed_count, batch_hash
FROM intent_issue_set_publish_batch_events
WHERE session_id = '{sessionId}'
ORDER BY created_at DESC;

-- Check item events
SELECT canonical_id, action, github_issue_number, github_issue_url, event_type
FROM intent_issue_set_publish_item_events
WHERE batch_id = '{batchId}'
ORDER BY created_at ASC;

-- Verify batch hash uniqueness
SELECT batch_hash, COUNT(*) as count
FROM intent_issue_set_publish_batch_events
GROUP BY batch_hash
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)
```

## Acceptance Criteria Verification

### ✅ Criterion 1: Idempotency
**Test**: Run Steps 5 & 6 above
**Expected**: Second run returns skipped items, same batch_id

### ✅ Criterion 2: Batch Size Clamp
**Test**: Run Step 7 above
**Expected**: Warning in response, only 25 items published

### ✅ Criterion 3: Partial Failures
**Test**: Create invalid draft + valid draft, publish together
**Expected**: Valid published, invalid failed, batch completes

### ✅ Criterion 4: Audit Ledger
**Test**: Run Step 10 above
**Expected**: All batch/item events recorded with hashes

## Performance Metrics

Monitor these metrics during staging:
- Response time: <2s for 25 items
- Database queries: <10 per batch
- GitHub API calls: 1 per new issue
- Memory usage: Stable (no leaks)

## Rollback Plan

If issues found in staging:
```bash
# Revert deployment
git revert {commitHash}
npm run deploy -- --profile staging

# Or roll back to previous version
cdk deploy --profile staging --rollback
```

## Production Deployment

Only after staging verification complete:
```bash
# Merge PR
git checkout main
git merge copilot/create-batch-publish-issues

# Deploy to production
npm run deploy -- --profile production

# Set env vars (with publishing DISABLED initially)
aws secretsmanager put-secret-value \
  --secret-id prod/codefactory-control/env \
  --secret-string '{
    "ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED": "false",
    "AFU9_ADMIN_SUBS": "prod-admin-user-1,prod-admin-user-2"
  }'

# Enable after verification
aws secretsmanager put-secret-value \
  --secret-id prod/codefactory-control/env \
  --secret-string '{
    "ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED": "true",
    "AFU9_ADMIN_SUBS": "prod-admin-user-1,prod-admin-user-2"
  }'
```

## Success Criteria

All tests must pass before production deployment:
- [ ] Repository verification passes
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Staging idempotency verified
- [ ] Batch size limit enforced
- [ ] Production guard blocks access
- [ ] Admin allowlist enforced
- [ ] Audit trail complete
- [ ] Performance acceptable
- [ ] No errors in logs

---

**Created**: 2026-01-15
**Issue**: E89.6
**Ready for**: Staging verification (E89.9)
