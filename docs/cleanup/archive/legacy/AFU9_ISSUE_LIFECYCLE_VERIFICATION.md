# AFU-9 Issue Lifecycle - Verification Commands

This document contains PowerShell commands to verify the AFU-9 Issue lifecycle implementation.

## Prerequisites

- AFU-9 Control Center running on staging environment
- Valid authentication token (x-afu9-sub header)
- Admin user privileges (AFU9_ADMIN_SUBS)

## Environment Setup

```powershell
$BaseUrl = "https://stage.afu-9.com"  # or http://localhost:3000 for local
$AuthToken = "your-sub-id-here"
$Headers = @{
    "x-afu9-sub" = $AuthToken
    "Content-Type" = "application/json"
}
```

## 1. Create AFU-9 Issue (via INTENT)

```powershell
# Create an INTENT session first (existing functionality)
$sessionBody = @{
    user_id = $AuthToken
    mode = "issue"
} | ConvertTo-Json

$session = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/sessions" `
    -Headers $Headers `
    -Body $sessionBody

$sessionId = $session.id
Write-Host "Created session: $sessionId"
```

## 2. Create Issue Draft and Commit

```powershell
# Create issue draft (existing INTENT functionality)
$draftBody = @{
    title = "Test AFU-9 Issue Lifecycle"
    description = "Testing canonical Issue → CR → Publish → GH Mirror → CP Assign flow"
    type = "issue"
    priority = "P1"
} | ConvertTo-Json

$draft = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft" `
    -Headers $Headers `
    -Body $draftBody

Write-Host "Created draft"

# Commit draft
Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/commit" `
    -Headers $Headers
```

## 3. Create and Bind CR

```powershell
# Create CR (existing INTENT functionality)
$crBody = @{
    description = "Test CR for AFU-9 lifecycle"
    changes = @(
        @{
            type = "add"
            path = "test/file.ts"
            content = "console.log('test');"
        }
    )
} | ConvertTo-Json

$cr = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/sessions/$sessionId/cr" `
    -Headers $Headers `
    -Body $crBody

# Commit CR to create version
$crVersion = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/sessions/$sessionId/cr/commit" `
    -Headers $Headers

$crId = $crVersion.id
Write-Host "Created CR version: $crId"

# Get AFU-9 issue ID (from session or issue list)
# For this example, we'll assume it's created automatically
# You may need to query /api/issues to find the issue ID

# Bind CR to AFU-9 Issue
$bindBody = @{
    cr_id = $crId
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/issues/$issueId/bind-cr" `
    -Headers $Headers `
    -Body $bindBody

Write-Host "CR bound to issue"
```

## 4. Publish AFU-9 Issue (Canonical Orchestrator)

```powershell
# Publish via AFU-9 orchestrator (NEW)
$publishBody = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    labels = @("afu-9:auto", "test")
} | ConvertTo-Json

$publishResult = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/issues/$issueId/publish" `
    -Headers $Headers `
    -Body $publishBody

Write-Host "Publish result:"
$publishResult | ConvertTo-Json -Depth 10
```

## 5. Verify GitHub Mirror

```powershell
# Check AFU-9 Issue was mirrored to GitHub
$issue = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/issues/$issueId" `
    -Headers $Headers

Write-Host "GitHub mirror status:"
Write-Host "  Issue number: $($issue.github_issue_number)"
Write-Host "  GitHub URL: $($issue.github_url)"
Write-Host "  Status: $($issue.status)"
Write-Host "  Handoff state: $($issue.handoff_state)"
Write-Host "  Synced at: $($issue.github_synced_at)"
```

## 6. Verify Timeline Events

```powershell
# Get timeline events
$timeline = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/intent/issues/$issueId/timeline" `
    -Headers $Headers

Write-Host "Timeline events ($($timeline.count)):"
$timeline.events | ForEach-Object {
    Write-Host "  - $($_.event_type) at $($_.created_at) by $($_.actor)"
}

# Expected events:
# - ISSUE_CREATED
# - CR_BOUND
# - PUBLISHING_STARTED
# - PUBLISHED
# - GITHUB_MIRRORED
# - CP_ASSIGNED
```

## 7. Verify Evidence Records

```powershell
# Get evidence records
$evidence = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/intent/issues/$issueId/evidence" `
    -Headers $Headers

Write-Host "Evidence records ($($evidence.count)):"
$evidence.evidence | ForEach-Object {
    Write-Host "  - $($_.evidence_type) at $($_.created_at)"
}

# Expected evidence:
# - PUBLISH_RECEIPT
# - GITHUB_MIRROR_RECEIPT
# - CR_BINDING_RECEIPT
```

## 8. Verify Control Pack Assignment

```powershell
# Get issue with CP assignments
$issueWithCp = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/issues/$issueId" `
    -Headers $Headers

Write-Host "Control Pack assignments:"
# Check for default CP assignment (cp:intent-issue-authoring)
```

## 9. Test Idempotency (Re-publish)

```powershell
# Publish again - should update existing GitHub issue
$republishResult = Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/api/intent/issues/$issueId/publish" `
    -Headers $Headers `
    -Body $publishBody

Write-Host "Re-publish result:"
Write-Host "  Action: $($republishResult.action)"  # Should be "updated"
Write-Host "  Issue number: $($republishResult.github_issue_number)"  # Same as before
```

## 10. Test Error Cases

### Publish without CR binding

```powershell
# Create a new issue without CR binding
$newIssueId = "new-issue-id-here"

try {
    Invoke-RestMethod -Method Post `
        -Uri "$BaseUrl/api/intent/issues/$newIssueId/publish" `
        -Headers $Headers `
        -Body $publishBody
} catch {
    Write-Host "Expected error: $($_.Exception.Message)"
    # Should be 409 - No active CR bound
}
```

## Verification Checklist

- [ ] AFU-9 Issue created with canonical ID
- [ ] CR successfully bound to issue (active_cr_id set)
- [ ] Publish executed via AFU-9 orchestrator (not direct GH)
- [ ] GitHub issue created/updated (idempotent)
- [ ] AFU-9 Issue updated with mirror fields (github_issue_number, github_url, github_synced_at)
- [ ] Timeline contains: ISSUE_CREATED, CR_BOUND, PUBLISHING_STARTED, PUBLISHED, GITHUB_MIRRORED, CP_ASSIGNED
- [ ] Evidence contains: PUBLISH_RECEIPT, GITHUB_MIRROR_RECEIPT, CR_BINDING_RECEIPT
- [ ] Default Control Pack assigned (cp:intent-issue-authoring)
- [ ] Re-publish updates existing GitHub issue (no duplicate)
- [ ] Publish without CR returns 409 error

## KPI Verification

After publish, check KPI context:

```powershell
$issue = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/issues/$issueId" `
    -Headers $Headers

Write-Host "KPI context:"
$issue.kpi_context | ConvertTo-Json -Depth 5
```

Expected KPI fields:
- D2D (Days to Deploy)
- HSH (Human-in-the-loop Hours)
- AVS (Automated Verification Score)
- AutoFixRate
- IncidentRate

## Database Verification (Direct SQL)

If you have direct database access:

```sql
-- Verify issue exists with lifecycle fields
SELECT id, title, status, active_cr_id, github_issue_number, github_synced_at
FROM afu9_issues
WHERE id = 'your-issue-id';

-- Verify timeline events
SELECT event_type, created_at, actor
FROM issue_timeline
WHERE issue_id = 'your-issue-id'
ORDER BY created_at ASC;

-- Verify evidence records
SELECT evidence_type, created_at, request_id
FROM issue_evidence
WHERE issue_id = 'your-issue-id'
ORDER BY created_at ASC;

-- Verify CP assignments
SELECT control_pack_id, control_pack_name, status
FROM control_pack_assignments
WHERE issue_id = 'your-issue-id';
```
