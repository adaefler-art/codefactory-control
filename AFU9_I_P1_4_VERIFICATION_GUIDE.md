# AFU9-I-P1.4 Implementation Verification Guide

## Overview
This document provides PowerShell commands to verify the implementation of canonical AFU-9 Issue creation on committed IssueDraft.

## Prerequisites
- Staging environment with valid authentication
- INTENT session with committed issue drafts
- Database access for verification queries

## Verification Steps

### 1. Create and Commit Issue Draft

```powershell
# Set base URL and auth headers
$baseUrl = "https://your-staging-url.com"
$headers = @{
    "Authorization" = "Bearer YOUR_TOKEN"
    "Content-Type" = "application/json"
}

# Create INTENT session
$session = Invoke-RestMethod -Uri "$baseUrl/api/intent/sessions" -Method POST -Headers $headers
$sessionId = $session.id

# Generate issue set (assuming you have a briefing)
$briefing = @{
    briefingText = "Create a test issue for AFU9-I-P1.4 verification"
} | ConvertTo-Json

$issueSet = Invoke-RestMethod `
    -Uri "$baseUrl/api/intent/sessions/$sessionId/issue-set/generate" `
    -Method POST `
    -Headers $headers `
    -Body $briefing

Write-Host "Issue Set ID: $($issueSet.id)"

# Commit the issue set
$commitResult = Invoke-RestMethod `
    -Uri "$baseUrl/api/intent/sessions/$sessionId/issue-set/commit" `
    -Method POST `
    -Headers $headers

Write-Host "Commit Result:"
$commitResult | ConvertTo-Json -Depth 10
```

### 2. Verify AFU-9 Issue Creation

```powershell
# Check response contains AFU-9 Issue details
if ($commitResult.createdIssues -and $commitResult.createdIssues.Count -gt 0) {
    Write-Host "✓ AFU-9 Issues created: $($commitResult.createdIssues.Count)" -ForegroundColor Green
    
    foreach ($issue in $commitResult.createdIssues) {
        Write-Host "  - Canonical ID: $($issue.canonicalId)"
        Write-Host "    Issue ID: $($issue.issueId)"
        Write-Host "    Public ID: $($issue.publicId)"
        Write-Host "    State: $($issue.state)"
        Write-Host "    Is New: $($issue.isNew)"
    }
} else {
    Write-Host "✗ No AFU-9 Issues created" -ForegroundColor Red
}

# Verify state is CREATED
$allCreated = $commitResult.createdIssues | Where-Object { $_.state -eq "CREATED" }
if ($allCreated.Count -eq $commitResult.createdIssues.Count) {
    Write-Host "✓ All issues have state=CREATED" -ForegroundColor Green
} else {
    Write-Host "✗ Some issues do not have state=CREATED" -ForegroundColor Red
}
```

### 3. Test Idempotency

```powershell
# Commit the same issue set again (should be idempotent)
try {
    $secondCommit = Invoke-RestMethod `
        -Uri "$baseUrl/api/intent/sessions/$sessionId/issue-set/commit" `
        -Method POST `
        -Headers $headers
    
    Write-Host "✗ Second commit should have failed (already committed)" -ForegroundColor Red
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($errorResponse.error -match "already committed") {
        Write-Host "✓ Idempotency check passed: Cannot commit twice" -ForegroundColor Green
    } else {
        Write-Host "✗ Unexpected error: $($errorResponse.error)" -ForegroundColor Red
    }
}

# Verify issue IDs remain stable
# Get the same canonical ID and verify it returns the same issue
$firstIssue = $commitResult.createdIssues[0]
$canonicalId = $firstIssue.canonicalId

# Query by canonical ID (if API endpoint exists)
# This demonstrates that the same canonical ID returns the same issue
Write-Host "`nVerifying stable issue ID for canonical ID: $canonicalId"
Write-Host "Expected Issue ID: $($firstIssue.issueId)"
```

### 4. Verify Timeline Events

```powershell
# Get timeline events for created issue
$issueId = $commitResult.createdIssues[0].issueId

$timeline = Invoke-RestMethod `
    -Uri "$baseUrl/api/issues/$issueId/timeline" `
    -Method GET `
    -Headers $headers

# Count ISSUE_CREATED events
$createdEvents = $timeline | Where-Object { $_.event_type -eq "ISSUE_CREATED" }

if ($createdEvents.Count -eq 1) {
    Write-Host "✓ Exactly one ISSUE_CREATED event exists" -ForegroundColor Green
    Write-Host "  Event ID: $($createdEvents[0].id)"
    Write-Host "  Event Data: $($createdEvents[0].event_data | ConvertTo-Json)"
} elseif ($createdEvents.Count -eq 0) {
    Write-Host "✗ No ISSUE_CREATED event found" -ForegroundColor Red
} else {
    Write-Host "✗ Multiple ISSUE_CREATED events found ($($createdEvents.Count))" -ForegroundColor Red
}
```

### 5. Database Verification (Optional)

If you have direct database access:

```sql
-- Verify canonical_id unique constraint
SELECT canonical_id, COUNT(*) as count
FROM afu9_issues
WHERE canonical_id IS NOT NULL AND deleted_at IS NULL
GROUP BY canonical_id
HAVING COUNT(*) > 1;
-- Should return 0 rows

-- Verify issue creation
SELECT 
    id,
    canonical_id,
    status,
    source_session_id,
    current_draft_id,
    created_at
FROM afu9_issues
WHERE canonical_id = 'YOUR_CANONICAL_ID';

-- Verify timeline events
SELECT 
    event_type,
    COUNT(*) as event_count
FROM issue_timeline
WHERE issue_id = 'YOUR_ISSUE_ID'
GROUP BY event_type;
-- ISSUE_CREATED should appear exactly once
```

## Expected Results

### Pass Criteria
1. ✅ `commitResult.createdIssues` array is not empty
2. ✅ Each issue has `issueId`, `publicId`, `canonicalId`, `state`, and `isNew` fields
3. ✅ All issues have `state = "CREATED"`
4. ✅ Second commit fails with "already committed" error
5. ✅ Each issue has exactly one `ISSUE_CREATED` timeline event
6. ✅ `publicId` is first 8 characters of `issueId`
7. ✅ Database unique constraint prevents duplicate canonical_ids

### Fail Criteria
- ❌ No issues created on commit
- ❌ Duplicate issues with same canonical_id
- ❌ Multiple ISSUE_CREATED events for same issue
- ❌ Issues created with state other than CREATED
- ❌ Missing required fields in response

## Troubleshooting

### Issue: No AFU-9 Issues created
- Check that issue set items are valid (validation status)
- Verify commit was successful (check response status)
- Check server logs for errors during ensureIssueForCommittedDraft

### Issue: Duplicate canonical_id constraint violation
- Verify migration 080 was applied
- Check unique index exists: `idx_afu9_issues_canonical_id_unique`
- Verify retry logic handles constraint violations properly

### Issue: Multiple ISSUE_CREATED events
- Check transaction handling in ensureIssueForCommittedDraft
- Verify event is only created when `isNew = true`
- Check for race conditions in concurrent commits

## Notes

- This implementation explicitly does NOT create GitHub issues
- Control pack assignment is out of scope
- CR binding is out of scope
- UI changes beyond returning fields are out of scope
