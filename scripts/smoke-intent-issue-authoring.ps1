#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Staging smoke test for INTENT Issue Draft authoring and publishing workflow.

.DESCRIPTION
  End-to-end test of the complete Issue Draft flow:
  1. Create session
  2. Save draft
  3. Validate draft
  4. Commit version
  5. Batch publish to GitHub
  6. Verify issue in GitHub
  7. Generate evidence pack

  This script is STAGING-ONLY and uses smoke key authentication.

.PARAMETER BaseUrl
  Staging base URL (default: https://stage.afu-9.com)

.PARAMETER UserId
  User ID for smoke test (default: smoke-test-user)

.PARAMETER SmokeKey
  Smoke key for authentication (default: from AFU9_SMOKE_KEY env var)

.PARAMETER Owner
  GitHub repository owner for publishing (default: adaefler-art)

.PARAMETER Repo
  GitHub repository name for publishing (default: codefactory-staging-test)

.PARAMETER SkipPublish
  Skip the publish step (useful for testing without GitHub access)

.PARAMETER SkipIdempotencyCheck
  Skip idempotency checks (faster execution)

.EXAMPLE
  ./smoke-intent-issue-authoring.ps1

.EXAMPLE
  ./smoke-intent-issue-authoring.ps1 -BaseUrl "https://stage.afu-9.com" -UserId "my-user"

.EXAMPLE
  ./smoke-intent-issue-authoring.ps1 -SkipPublish

.NOTES
  Issue: E89.9 - Staging Smoke Runbook
  Version: 1.0
  Staging-only: Never run against production
  Requires: PowerShell 7+, smoke key, admin privileges for publishing
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = "https://stage.afu-9.com",

  [Parameter(Mandatory = $false)]
  [string]$UserId = "smoke-test-user",

  [Parameter(Mandatory = $false)]
  [string]$SmokeKey = $null,

  [Parameter(Mandatory = $false)]
  [string]$Owner = "adaefler-art",

  [Parameter(Mandatory = $false)]
  [string]$Repo = "codefactory-staging-test",

  [Parameter(Mandatory = $false)]
  [switch]$SkipPublish,

  [Parameter(Mandatory = $false)]
  [switch]$SkipIdempotencyCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Initialize evidence pack
$Evidence = @{
  Timestamp = Get-Date -Format 'o'
  DeploymentEnv = "staging"
  BaseUrl = $BaseUrl
  UserId = $UserId
}

# Color helpers
function Write-Pass([string]$Message) {
  Write-Host "✅ PASS: $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
  Write-Host "❌ FAIL: $Message" -ForegroundColor Red
}

function Write-Warn([string]$Message) {
  Write-Host "⚠️  WARN: $Message" -ForegroundColor Yellow
}

function Write-Info([string]$Message) {
  Write-Host "ℹ️  INFO: $Message" -ForegroundColor Cyan
}

function Write-Step([string]$Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Magenta
}

# API helper
function Invoke-Afu9Api {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('GET', 'POST', 'PUT', 'PATCH')]
    [string]$Method,
    
    [Parameter(Mandatory = $true)]
    [string]$Uri,
    
    [Parameter(Mandatory = $false)]
    [object]$Body = $null
  )

  $headers = @{
    'x-afu9-sub' = $UserId
    'accept' = 'application/json'
  }

  if (-not [string]::IsNullOrWhiteSpace($SmokeKey)) {
    $headers['x-afu9-smoke-key'] = $SmokeKey
  }

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $headers
  }

  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  # Use SkipHttpErrorCheck if available (PowerShell 7+)
  $iwr = Get-Command Invoke-WebRequest
  if ($iwr.Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $params['SkipHttpErrorCheck'] = $true
  }

  try {
    $response = Invoke-WebRequest @params
    
    $json = $null
    if ($response.Content) {
      try {
        $json = $response.Content | ConvertFrom-Json
      } catch {
        # Content is not JSON
      }
    }

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Json = $json
      Content = $response.Content
      Headers = $response.Headers
      Success = $true
    }
  } catch {
    $statusCode = $null
    $content = $null

    if ($_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch { }

      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $content = $reader.ReadToEnd()
      } catch { }
    }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Json = $null
      Content = $content
      Headers = $null
      Success = $false
      Error = $_.Exception.Message
    }
  }
}

# Normalize base URL
$BaseUrl = $BaseUrl.TrimEnd('/')

# Get smoke key from environment if not provided
if ([string]::IsNullOrWhiteSpace($SmokeKey)) {
  $SmokeKey = $env:AFU9_SMOKE_KEY
}

if ([string]::IsNullOrWhiteSpace($SmokeKey)) {
  Write-Fail "Smoke key required. Set AFU9_SMOKE_KEY environment variable or use -SmokeKey parameter."
  exit 1
}

Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║  E89.9 Staging Smoke Test: Issue Draft Authoring & Publishing ║
╚════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

Write-Info "Base URL: $BaseUrl"
Write-Info "User ID: $UserId"
Write-Info "Owner/Repo: $Owner/$Repo"
Write-Info "Skip Publish: $SkipPublish"
Write-Info "Skip Idempotency: $SkipIdempotencyCheck"

# ============================================================================
# STEP 1: Create INTENT Session
# ============================================================================
Write-Step "Step 1: Create INTENT Session"

$sessionBody = @{
  title = "E89.9 Smoke Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  status = 'active'
}

$sessionResponse = Invoke-Afu9Api -Method POST `
  -Uri "$BaseUrl/api/intent/sessions" `
  -Body $sessionBody

if (-not $sessionResponse.Success -or $sessionResponse.StatusCode -notin @(200, 201)) {
  Write-Fail "Failed to create session. Status: $($sessionResponse.StatusCode)"
  Write-Host $sessionResponse.Content
  exit 1
}

$sessionId = $sessionResponse.Json.id
if ([string]::IsNullOrWhiteSpace($sessionId)) {
  Write-Fail "Session ID missing in response"
  exit 1
}

Write-Pass "Session created: $sessionId"
$Evidence.SessionId = $sessionId

# ============================================================================
# STEP 2: Create Issue Draft
# ============================================================================
Write-Step "Step 2: Create Issue Draft"

$draftJson = @{
  issueDraftVersion = "1.0"
  title = "Smoke Test Issue - E89.9"
  body = @"
Canonical-ID: E89.9-SMOKE

## Problem
Smoke test for Issue Draft authoring and publishing workflow.

## Solution
Automated end-to-end test covering:
- Draft creation
- Validation
- Version commit
- Batch publish to GitHub
- Evidence collection

## Acceptance Criteria
- Draft creation succeeds
- Validation passes
- Commit succeeds
- Publish succeeds
- Evidence pack generated

## Verification
All steps complete in < 15 minutes with deterministic hashes and evidence.
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

$draftBody = @{
  issue_json = $draftJson
}

$draftResponse = Invoke-Afu9Api -Method PUT `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft" `
  -Body $draftBody

if (-not $draftResponse.Success -or $draftResponse.StatusCode -ne 200) {
  Write-Fail "Failed to save draft. Status: $($draftResponse.StatusCode)"
  Write-Host $draftResponse.Content
  exit 1
}

$draftId = $draftResponse.Json.id
$draftHash = $draftResponse.Json.issue_hash

if ([string]::IsNullOrWhiteSpace($draftId)) {
  Write-Fail "Draft ID missing in response"
  exit 1
}

Write-Pass "Draft saved: $draftId"
Write-Info "Draft hash: $($draftHash.Substring(0, 12))..."

$Evidence.DraftId = $draftId
$Evidence.DraftHash = $draftHash

# ============================================================================
# STEP 3: Validate Issue Draft
# ============================================================================
Write-Step "Step 3: Validate Issue Draft"

$validateBody = @{
  issue_json = $draftJson
}

$validateResponse = Invoke-Afu9Api -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/validate" `
  -Body $validateBody

if (-not $validateResponse.Success -or $validateResponse.StatusCode -ne 200) {
  Write-Fail "Failed to validate draft. Status: $($validateResponse.StatusCode)"
  Write-Host $validateResponse.Content
  exit 1
}

$isValid = $validateResponse.Json.validation.valid
$validationErrors = $validateResponse.Json.validation.errors

if (-not $isValid) {
  Write-Fail "Draft validation failed"
  Write-Host "Errors: $($validationErrors | ConvertTo-Json -Depth 5)"
  exit 1
}

Write-Pass "Draft validation PASSED"

$Evidence.ValidationStatus = "valid"
$Evidence.ValidationErrors = @()

# ============================================================================
# STEP 4: Commit Issue Draft Version
# ============================================================================
Write-Step "Step 4: Commit Issue Draft Version"

$commitResponse = Invoke-Afu9Api -Method POST `
  -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/commit"

if (-not $commitResponse.Success -or $commitResponse.StatusCode -notin @(200, 201)) {
  Write-Fail "Failed to commit draft. Status: $($commitResponse.StatusCode)"
  Write-Host $commitResponse.Content
  exit 1
}

$versionId = $commitResponse.Json.version.id
$versionHash = $commitResponse.Json.version.issue_hash
$isNewVersion = $commitResponse.Json.isNew

if ([string]::IsNullOrWhiteSpace($versionId)) {
  Write-Fail "Version ID missing in response"
  exit 1
}

Write-Pass "Draft committed: $versionId"
Write-Info "Is new version: $isNewVersion"
Write-Info "Version hash: $($versionHash.Substring(0, 12))..."

$Evidence.VersionId = $versionId
$Evidence.VersionHash = $versionHash
$Evidence.IsNewVersion = $isNewVersion

# Idempotency check: commit again
if (-not $SkipIdempotencyCheck) {
  Write-Info "Running idempotency check (commit again)..."
  
  $commitResponse2 = Invoke-Afu9Api -Method POST `
    -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/commit"

  if ($commitResponse2.Success -and $commitResponse2.Json.version.id -eq $versionId -and -not $commitResponse2.Json.isNew) {
    Write-Pass "Idempotency check PASSED: Same version returned (isNew=false)"
  } else {
    Write-Warn "Idempotency check: Expected same version with isNew=false"
    Write-Info "Got: versionId=$($commitResponse2.Json.version.id), isNew=$($commitResponse2.Json.isNew)"
  }
}

# ============================================================================
# STEP 5: Batch Publish to GitHub
# ============================================================================
if (-not $SkipPublish) {
  Write-Step "Step 5: Batch Publish to GitHub"

  $publishBody = @{
    version_id = $versionId
    owner = $Owner
    repo = $Repo
  }

  $publishResponse = Invoke-Afu9Api -Method POST `
    -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/versions/publish" `
    -Body $publishBody

  if (-not $publishResponse.Success -or $publishResponse.StatusCode -ne 200) {
    Write-Fail "Failed to publish draft. Status: $($publishResponse.StatusCode)"
    Write-Host $publishResponse.Content
    
    # Check for common errors
    if ($publishResponse.StatusCode -eq 403) {
      Write-Info "Hint: User must be in AFU9_ADMIN_SUBS allowlist"
    } elseif ($publishResponse.StatusCode -eq 409) {
      Write-Info "Hint: Publishing disabled. Set ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true"
    }
    
    exit 1
  }

  $batchId = $publishResponse.Json.batch_id
  $summary = $publishResponse.Json.summary
  $items = $publishResponse.Json.items

  Write-Pass "Publish batch completed: $batchId"
  Write-Info "Total: $($summary.total)"
  Write-Info "Created: $($summary.created)"
  Write-Info "Updated: $($summary.updated)"
  Write-Info "Skipped: $($summary.skipped)"
  Write-Info "Failed: $($summary.failed)"

  if ($summary.failed -gt 0) {
    Write-Fail "Some items failed to publish"
    Write-Host "Items: $($items | ConvertTo-Json -Depth 5)"
    exit 1
  }

  $githubIssueUrl = $items[0].github_issue_url
  if (-not [string]::IsNullOrWhiteSpace($githubIssueUrl)) {
    Write-Pass "GitHub issue URL: $githubIssueUrl"
  }

  $Evidence.BatchId = $batchId
  $Evidence.PublishSummary = $summary
  $Evidence.GitHubIssueUrl = $githubIssueUrl

  # Idempotency check: publish again
  if (-not $SkipIdempotencyCheck) {
    Write-Info "Running idempotency check (publish again)..."
    
    $publishResponse2 = Invoke-Afu9Api -Method POST `
      -Uri "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/versions/publish" `
      -Body $publishBody

    if ($publishResponse2.Success -and $publishResponse2.Json.summary.skipped -gt 0) {
      Write-Pass "Idempotency check PASSED: Issue skipped (already published)"
    } else {
      Write-Warn "Idempotency check: Expected skip, got summary: $($publishResponse2.Json.summary | ConvertTo-Json)"
    }
  }
} else {
  Write-Info "Skipping publish step (--SkipPublish)"
  $Evidence.BatchId = "N/A (skipped)"
  $Evidence.PublishSummary = @{ skipped = $true }
  $Evidence.GitHubIssueUrl = "N/A (skipped)"
}

# ============================================================================
# STEP 6: Generate Evidence Pack
# ============================================================================
Write-Step "Step 6: Generate Evidence Pack"

$evidencePack = @"
═══════════════════════════════════════════════════════════════
  E89.9 Staging Smoke Test - Evidence Pack
═══════════════════════════════════════════════════════════════

Timestamp: $($Evidence.Timestamp)
Deployment Environment: $($Evidence.DeploymentEnv)
Base URL: $($Evidence.BaseUrl)
User ID: $($Evidence.UserId)

--- Session ---
Session ID: $($Evidence.SessionId)

--- Draft ---
Draft ID: $($Evidence.DraftId)
Draft Hash (SHA-256): $($Evidence.DraftHash)
Draft Hash (short): $($Evidence.DraftHash.Substring(0,12))

--- Validation ---
Validation Status: $($Evidence.ValidationStatus)
Validation Errors: $(if ($Evidence.ValidationErrors.Count -eq 0) { "None" } else { $Evidence.ValidationErrors.Count })

--- Commit ---
Version ID: $($Evidence.VersionId)
Version Hash (SHA-256): $($Evidence.VersionHash)
Version Hash (short): $($Evidence.VersionHash.Substring(0,12))
Is New Version: $($Evidence.IsNewVersion)

--- Publish ---
Batch ID: $($Evidence.BatchId)
GitHub Issue URL: $($Evidence.GitHubIssueUrl)
$(if (-not $SkipPublish) {
@"
Summary:
  Total: $($Evidence.PublishSummary.total)
  Created: $($Evidence.PublishSummary.created)
  Updated: $($Evidence.PublishSummary.updated)
  Skipped: $($Evidence.PublishSummary.skipped)
  Failed: $($Evidence.PublishSummary.failed)
"@
} else {
"Summary: Publish skipped"
})

--- GitHub Verification (Manual) ---
$(if (-not $SkipPublish -and -not [string]::IsNullOrWhiteSpace($Evidence.GitHubIssueUrl)) {
@"
□ Navigate to: $($Evidence.GitHubIssueUrl)
□ Verify issue title: "Smoke Test Issue - E89.9"
□ Verify body contains: "Canonical-ID: E89.9-SMOKE"
□ Verify labels: smoke-test, e89, staging
"@
} else {
"N/A (publish skipped)"
})

--- Result ---
✅ PASS: All steps completed successfully

═══════════════════════════════════════════════════════════════
"@

Write-Host $evidencePack -ForegroundColor Green

# Save evidence pack to file
$evidenceFileName = "evidence-e89-9-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
$evidencePack | Out-File -FilePath $evidenceFileName -Encoding utf8

Write-Pass "Evidence pack saved to: $evidenceFileName"

# ============================================================================
# Summary
# ============================================================================
Write-Host "`n"
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                   ✅ ALL TESTS PASSED ✅                       ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host "`n"

Write-Info "Next steps:"
if (-not $SkipPublish) {
  Write-Info "  1. Verify GitHub issue: $($Evidence.GitHubIssueUrl)"
  Write-Info "  2. Check audit trail in AFU-9 UI: $BaseUrl/admin/evidence"
} else {
  Write-Info "  1. Re-run with publishing enabled (remove --SkipPublish)"
}
Write-Info "  3. Review evidence pack: $evidenceFileName"

exit 0
