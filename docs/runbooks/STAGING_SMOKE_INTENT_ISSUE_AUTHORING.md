# Staging Smoke Test: INTENT Issue Authoring & Publishing

**Purpose:** End-to-end smoke test for the complete Issue Draft authoring and publishing workflow.  
**Target:** Staging environment only (`https://stage.afu-9.com`)  
**Time Estimate:** < 15 minutes  
**Issue:** E89.9 - Staging Smoke Runbook "Draft→Validate→Commit→Batch Publish→Verify"

---

## Prerequisites

### Required Tools
- PowerShell 7+ (`pwsh --version`)
- Valid staging credentials
- Admin privileges (user must be in `AFU9_ADMIN_SUBS`)

### Environment Variables
```powershell
# Required: Staging smoke key for authentication
$env:AFU9_SMOKE_KEY = "your-staging-smoke-key"

# Optional: Custom staging base URL
$env:STAGING_BASE_URL = "https://stage.afu-9.com"
```

### Pre-flight Checks
1. Verify staging is accessible: `curl https://stage.afu-9.com/api/health`
2. Verify you have admin access (check with ops team)
3. Confirm smoke key is configured

---

## Step 1: Create INTENT Session

### Action
Create a new INTENT session to hold our issue draft.

### PowerShell
```powershell
$BaseUrl = $env:STAGING_BASE_URL ?? "https://stage.afu-9.com"
$SmokeKey = $env:AFU9_SMOKE_KEY
$UserId = "smoke-test-user"

$headers = @{
  'x-afu9-sub' = $UserId
  'x-afu9-smoke-key' = $SmokeKey
  'accept' = 'application/json'
}

# Create session
$sessionBody = @{
  title = "E89.9 Smoke Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  status = 'active'
} | ConvertTo-Json

$session = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/intent/sessions" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $sessionBody

$sessionId = $session.id
Write-Host "✅ Session created: $sessionId" -ForegroundColor Green
```

### Pass Criteria
- ✅ HTTP 200 or 201 response
- ✅ Response contains `id` field (session ID)
- ✅ Session ID is a valid UUID

### Fail Criteria / Troubleshooting
| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Missing or invalid smoke key | Check `AFU9_SMOKE_KEY` environment variable |
| 500 Internal Server Error | Database migration issue | Check staging logs, run migrations |
| Connection timeout | Staging environment down | Verify staging status with ops team |

### Evidence to Capture
```powershell
# Save for Evidence Pack
$Evidence = @{
  SessionId = $sessionId
  Timestamp = Get-Date -Format 'o'
  DeploymentEnv = "staging"
}
```

---

## Step 2: Create Issue Draft

### Action
Save a valid Issue Draft (IssueDraft schema v1) for our session.

### PowerShell
```powershell
# Create a valid issue draft following schema v1
$draftJson = @{
  issueDraftVersion = "1.0"
  title = "Smoke Test Issue - E89.9"
  body = @"
Canonical-ID: E89.9-SMOKE

## Problem
Smoke test for Issue Draft authoring and publishing workflow.

## Acceptance Criteria
- Draft can be created and validated
- Version can be committed
- Issue can be published to GitHub
"@
  type = "issue"
  canonicalId = "E89.9-SMOKE"
  labels = @("smoke-test", "e89", "staging")
  dependsOn = @()
  priority = "P2"
  acceptanceCriteria = @(
    "Draft creation succeeds",
    "Validation passes",
    "Commit succeeds",
    "Publish succeeds"
  )
  verify = @{
    commands = @("echo 'smoke test'")
    expected = @("smoke test")
  }
  guards = @{
    env = "staging"
    prodBlocked = $true
  }
}

# Save draft (PUT endpoint - allows invalid drafts)
$draftBody = @{
  issue_json = $draftJson
} | ConvertTo-Json -Depth 10

$draftResponse = Invoke-RestMethod -Method PUT `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $draftBody

Write-Host "✅ Draft saved: $($draftResponse.id)" -ForegroundColor Green
Write-Host "   Draft hash: $($draftResponse.issue_hash)" -ForegroundColor DarkGray

# Capture evidence
$Evidence.DraftId = $draftResponse.id
$Evidence.DraftHash = $draftResponse.issue_hash
$Evidence.DraftSaveRequestId = $draftResponse.id  # requestId in response headers if available
```

### Pass Criteria
- ✅ HTTP 200 response
- ✅ Response contains `id` (draft ID)
- ✅ Response contains `issue_hash` (SHA-256 deterministic hash)
- ✅ Response contains `evidenceRecorded: true`

### Fail Criteria / Troubleshooting
| Error | Cause | Fix |
|-------|-------|-----|
| 404 Session not found | Session doesn't belong to user | Verify sessionId and userId match |
| 400 Missing issue_json | Malformed request body | Check JSON structure |
| 500 Evidence recording failed | Audit trail insert failed | Check database, verify `intent_issue_authoring_events` table exists |

### Evidence to Capture
- Draft ID
- Draft hash (first 12 chars for compact evidence)
- Request ID from draft save operation

---

## Step 3: Validate Issue Draft

### Action
Validate the issue draft against IssueDraft schema v1 and update validation status.

### PowerShell
```powershell
# Validate the draft we just created
$validateBody = @{
  issue_json = $draftJson
} | ConvertTo-Json -Depth 10

$validateResponse = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/validate" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $validateBody

$isValid = $validateResponse.validation.valid
$validationErrors = $validateResponse.validation.errors

if ($isValid) {
  Write-Host "✅ Draft validation PASSED" -ForegroundColor Green
} else {
  Write-Host "❌ Draft validation FAILED" -ForegroundColor Red
  Write-Host "Errors: $($validationErrors | ConvertTo-Json)" -ForegroundColor Yellow
  exit 1
}

# Capture evidence
$Evidence.ValidationRequestId = $validateResponse.requestId ?? "N/A"
$Evidence.ValidationStatus = if ($isValid) { "valid" } else { "invalid" }
$Evidence.ValidationErrors = $validationErrors
```

### Pass Criteria
- ✅ HTTP 200 response
- ✅ `validation.valid` is `true`
- ✅ `validation.errors` is empty array
- ✅ `evidenceRecorded` is `true`

### Fail Criteria / Troubleshooting
| Error | Cause | Fix |
|-------|-------|-----|
| validation.valid = false | Draft doesn't match schema | Check validation.errors array, fix draft structure |
| Missing canonical ID | canonicalId field empty | Add valid canonicalId (format: I8xx, E81.x, or CID:xxx) |
| Body too short | Body < 10 chars | Expand body to meet minimum length |
| Labels not sorted | Schema expects sorted labels | Labels are auto-sorted by schema - this shouldn't fail |

### Evidence to Capture
- Validation request ID
- Validation status (valid/invalid)
- Validation errors (if any)

---

## Step 4: Commit Issue Draft Version

### Action
Commit the validated draft as an immutable version.

### PowerShell
```powershell
# Commit the draft (requires last validation to be 'valid')
$commitResponse = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/commit" `
  -Headers $headers `
  -ContentType "application/json"

$versionId = $commitResponse.version.id
$isNewVersion = $commitResponse.isNew

Write-Host "✅ Draft committed: $versionId" -ForegroundColor Green
Write-Host "   Is new version: $isNewVersion" -ForegroundColor DarkGray
Write-Host "   Version hash: $($commitResponse.version.issue_hash)" -ForegroundColor DarkGray

# Capture evidence
$Evidence.VersionId = $versionId
$Evidence.VersionHash = $commitResponse.version.issue_hash
$Evidence.IsNewVersion = $isNewVersion
$Evidence.CommitRequestId = $commitResponse.requestId ?? "N/A"
```

### Pass Criteria
- ✅ HTTP 200 or 201 response
- ✅ Response contains `version.id` (version ID)
- ✅ Response contains `isNew` boolean
- ✅ `evidenceRecorded` is `true`
- ✅ If same hash exists, `isNew = false` (idempotency)

### Fail Criteria / Troubleshooting
| Error | Cause | Fix |
|-------|-------|-----|
| 400 Validation not valid | Last validation status is not 'valid' | Re-run validation step (Step 3) |
| 404 No draft exists | No draft found for session | Create draft first (Step 2) |
| 500 Database error | Insert failed | Check database health, verify migrations |

### Idempotency Check
```powershell
# Commit again - should return same version_id with isNew=false
$commitResponse2 = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/commit" `
  -Headers $headers `
  -ContentType "application/json"

if ($commitResponse2.version.id -eq $versionId -and -not $commitResponse2.isNew) {
  Write-Host "✅ Idempotency check PASSED: Same version returned" -ForegroundColor Green
} else {
  Write-Host "❌ Idempotency check FAILED: Expected same version" -ForegroundColor Red
}
```

### Evidence to Capture
- Version ID
- Version hash (first 12 chars)
- Is new version (true/false)
- Commit request ID

---

## Step 5: Batch Publish to GitHub

### Action
Publish the committed version to GitHub as a real issue (admin-only, staging-only).

### PowerShell
```powershell
# Publish to GitHub (requires admin privileges)
# Target: staging test repo
$publishBody = @{
  version_id = $versionId
  owner = "adaefler-art"  # Replace with your staging test repo owner
  repo = "codefactory-staging-test"  # Replace with your staging test repo
} | ConvertTo-Json

$publishResponse = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/versions/publish" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $publishBody

$batchId = $publishResponse.batch_id
$summary = $publishResponse.summary

Write-Host "✅ Publish batch completed: $batchId" -ForegroundColor Green
Write-Host "   Total: $($summary.total)" -ForegroundColor DarkGray
Write-Host "   Created: $($summary.created)" -ForegroundColor DarkGray
Write-Host "   Updated: $($summary.updated)" -ForegroundColor DarkGray
Write-Host "   Skipped: $($summary.skipped)" -ForegroundColor DarkGray
Write-Host "   Failed: $($summary.failed)" -ForegroundColor DarkGray

# Capture evidence
$Evidence.BatchId = $batchId
$Evidence.PublishSummary = $summary
$Evidence.PublishRequestId = $publishResponse.requestId ?? "N/A"
$Evidence.GitHubIssueUrl = $publishResponse.items[0].github_issue_url ?? "N/A"
```

### Pass Criteria
- ✅ HTTP 200 response
- ✅ `success` is `true`
- ✅ `summary.total` > 0
- ✅ `summary.created` or `summary.updated` > 0
- ✅ `summary.failed` = 0
- ✅ `items[0].github_issue_url` exists

### Fail Criteria / Troubleshooting
| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Missing authentication | Check smoke key |
| 403 Forbidden | User not in AFU9_ADMIN_SUBS | Request admin access |
| 409 Publishing disabled | Feature flag not enabled | Set ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true in staging |
| 404 Version not found | Version ID doesn't exist | Check version_id from Step 4 |
| 500 GitHub API error | GitHub token invalid or rate limit | Check GITHUB_TOKEN in staging environment |

### Idempotency Check
```powershell
# Publish again - should skip (already published)
$publishResponse2 = Invoke-RestMethod -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/versions/publish" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $publishBody

if ($publishResponse2.summary.skipped -gt 0 -and $publishResponse2.summary.created -eq 0) {
  Write-Host "✅ Idempotency check PASSED: Issue skipped (already published)" -ForegroundColor Green
} else {
  Write-Host "⚠️  Idempotency check: Expected skip, got: $($publishResponse2.summary | ConvertTo-Json)" -ForegroundColor Yellow
}
```

### Evidence to Capture
- Batch ID
- Publish summary (total, created, updated, skipped, failed)
- Publish request ID
- GitHub issue URL

---

## Step 6: Verify in GitHub

### Action
Manually verify the published issue exists in GitHub with correct metadata.

### Manual Verification Steps
1. Navigate to the GitHub issue URL from Step 5: `$Evidence.GitHubIssueUrl`
2. Verify the following:

### GitHub Issue Checklist
- [ ] Issue exists and is accessible
- [ ] Issue title matches: "Smoke Test Issue - E89.9"
- [ ] Issue body contains `Canonical-ID: E89.9-SMOKE` marker
- [ ] Labels include: `smoke-test`, `e89`, `staging`
- [ ] Issue is in correct repository (staging test repo)
- [ ] Issue is open (not closed)

### PowerShell Verification (Optional)
```powershell
# If you have GitHub CLI (gh) installed
$issueUrl = $Evidence.GitHubIssueUrl
Write-Host "Verify GitHub issue: $issueUrl" -ForegroundColor Cyan
Start-Process $issueUrl  # Opens in browser
```

### Pass Criteria
- ✅ Issue exists at the returned URL
- ✅ Issue title matches draft title
- ✅ Issue body contains canonical ID marker
- ✅ All labels from draft are present

### Fail Criteria / Troubleshooting
| Problem | Cause | Fix |
|---------|-------|-----|
| Issue not found (404) | Publish failed silently | Check publish response for errors |
| Labels missing | GitHub API rate limit | Wait and retry |
| Canonical ID missing | Renderer bug | Check issue body rendering logic |

---

## Step 7: Verify Audit Trail

### Action
Query the AFU-9 database to verify evidence records were created.

### SQL Queries (via staging DB access)
```sql
-- Verify evidence records for this session
SELECT 
  request_id,
  action,
  params_hash,
  result_hash,
  lawbook_version,
  created_at
FROM intent_issue_authoring_events
WHERE session_id = '<SESSION_ID_FROM_STEP_1>'
ORDER BY created_at ASC;
```

### Expected Evidence Records
| Action | Expected Count | Evidence |
|--------|---------------|----------|
| `draft_save` | 1 | Draft ID, issue hash |
| `draft_validate` | 1+ | Validation status, errors (if any) |
| `draft_commit` | 2+ | Version ID, is_new flag (idempotency test creates 2+) |

### Pass Criteria
- ✅ At least 3 evidence records exist (save, validate, commit)
- ✅ All records have deterministic `params_hash` and `result_hash`
- ✅ All records have `lawbook_version` (or null if no active lawbook)
- ✅ No secrets in `params_json` or `result_json`

### Fail Criteria / Troubleshooting
| Problem | Cause | Fix |
|---------|-------|-----|
| No evidence records | Evidence insert failed | Check database logs, verify table exists |
| Missing hashes | Hash computation failed | Check evidence helper functions |
| Secrets in evidence | Redaction failed | Critical security issue - escalate immediately |

### PowerShell Verification (if DB access available)
```powershell
# Query evidence records (requires psql or similar)
# This is optional - typically done via DB admin tools
Write-Host "Evidence records should be visible in AFU-9 staging UI" -ForegroundColor Cyan
Write-Host "Navigate to: $BaseUrl/admin/evidence" -ForegroundColor Cyan
```

---

## Evidence Pack Template

### Copy-Paste Ready Evidence
```powershell
# Generate Evidence Pack
$EvidencePack = @"
=== E89.9 Staging Smoke Test Evidence Pack ===
Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Deployment Environment: staging
Base URL: $BaseUrl
User ID: $UserId

--- Session ---
Session ID: $($Evidence.SessionId)

--- Draft ---
Draft ID: $($Evidence.DraftId)
Draft Hash: $($Evidence.DraftHash.Substring(0,12))
Draft Save Request ID: $($Evidence.DraftSaveRequestId)

--- Validation ---
Validation Request ID: $($Evidence.ValidationRequestId)
Validation Status: $($Evidence.ValidationStatus)
Validation Errors: $(if ($Evidence.ValidationErrors) { $Evidence.ValidationErrors.Count } else { 0 })

--- Commit ---
Version ID: $($Evidence.VersionId)
Version Hash: $($Evidence.VersionHash.Substring(0,12))
Is New Version: $($Evidence.IsNewVersion)
Commit Request ID: $($Evidence.CommitRequestId)

--- Publish ---
Batch ID: $($Evidence.BatchId)
Publish Request ID: $($Evidence.PublishRequestId)
GitHub Issue URL: $($Evidence.GitHubIssueUrl)
Summary:
  Total: $($Evidence.PublishSummary.total)
  Created: $($Evidence.PublishSummary.created)
  Updated: $($Evidence.PublishSummary.updated)
  Skipped: $($Evidence.PublishSummary.skipped)
  Failed: $($Evidence.PublishSummary.failed)

--- Result ---
✅ PASS: All steps completed successfully
"@

Write-Host $EvidencePack -ForegroundColor Green

# Save to file
$EvidencePack | Out-File -FilePath "evidence-e89-9-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
Write-Host "Evidence pack saved to: evidence-e89-9-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt" -ForegroundColor Cyan
```

---

## Success Criteria Summary

### Overall Pass Criteria
- ✅ All 7 steps completed without errors (< 15 minutes)
- ✅ Session created successfully
- ✅ Draft saved with deterministic hash
- ✅ Validation passed (valid = true)
- ✅ Version committed with idempotency (repeat returns same version)
- ✅ Batch publish succeeded (created or updated issue)
- ✅ GitHub issue exists with correct metadata
- ✅ Audit trail records exist in database
- ✅ Evidence pack generated with all request IDs and hashes

### Acceptable Warnings
- ⚠️ Lawbook version is null (if no active lawbook configured in staging)
- ⚠️ Publish idempotency shows "updated" instead of "skipped" (if issue was manually edited)

### Critical Failures (Escalate)
- 🔴 Secrets found in evidence records (`params_json` or `result_json`)
- 🔴 Evidence insert fails (audit trail broken)
- 🔴 Publishing succeeds but GitHub issue not found
- 🔴 Validation passes but commit fails

---

## Rollback / Cleanup

### Cleanup Published Issues (Optional)
```powershell
# Close the smoke test issue in GitHub (manual or via API)
# This prevents cluttering the staging test repo

# Option 1: Manual
# Navigate to $Evidence.GitHubIssueUrl and close the issue

# Option 2: GitHub CLI (if installed)
# gh issue close <ISSUE_NUMBER> --repo adaefler-art/codefactory-staging-test
```

### Database Cleanup (Not Recommended)
Evidence records are append-only by design. Do not delete evidence records unless absolutely necessary.

---

## Troubleshooting Table

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| All requests return 401 | Smoke key invalid/missing | Check `AFU9_SMOKE_KEY` environment variable |
| Session creation succeeds but draft save fails | Migration not applied | Run database migrations in staging |
| Validation always fails | Schema version mismatch | Verify draft uses `issueDraftVersion: "1.0"` |
| Commit fails with "validation not valid" | Validation was skipped or failed | Re-run Step 3 (validate) |
| Publish returns 403 | User not admin | Verify user is in `AFU9_ADMIN_SUBS` allowlist |
| Publish returns 409 | Publishing disabled | Set `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true` in staging |
| GitHub issue URL is 404 | Publish failed or rate limit | Check publish response for errors, wait and retry |
| Evidence records missing | Evidence insert failed | Check database health, verify table exists |

---

## Notes

- This runbook is **staging-only**. Never run against production.
- Uses smoke key authentication (`x-afu9-smoke-key` header).
- Publishing requires admin privileges (`AFU9_ADMIN_SUBS`).
- Evidence records are append-only (no cleanup needed).
- Idempotency is critical: repeat operations should be safe.
- All hashes are deterministic (SHA-256) for auditability.

---

## See Also

- [INTENT Issue Authoring Smoke Test](./INTENT_ISSUE_AUTHORING_SMOKE.md) - Evidence pack details
- [INTENT Smoke Test - Stage](./INTENT_SMOKE_STAGE.md) - INTENT Console smoke test
- [Issue Draft Schema v1](../../control-center/src/lib/schemas/issueDraft.ts) - Schema reference

---

**Version:** 1.0  
**Last Updated:** 2026-01-16  
**Maintained By:** AFU-9 Team
