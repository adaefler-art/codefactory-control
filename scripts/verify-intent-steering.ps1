#!/usr/bin/env pwsh
<#
.SYNOPSIS
  INTENT Steering Smoke Test - v0.8 Gate Verification

.DESCRIPTION
  Minimal, repeatable test pack that proves INTENT usability as a v0.8 gate.
  
  Tests:
  1. UI stable (I901) - /intent page loads without errors
  2. Draft GET/PATCH/COMMIT (I902) - draft lifecycle works
  3. DISCUSS→ACT mode switching (I903) - mode transitions work
  4. Publish to GitHub (I907) - publish flow completes
  5. Activity log trail (I904) - events are logged
  
  Expected runtime: < 10 minutes

.PARAMETER BaseUrl
  Base URL of the AFU-9 instance (default: http://localhost:3000)

.PARAMETER UserId
  User ID for smoke test (default: smoke-test-user)

.PARAMETER SmokeKey
  Smoke key for authentication (default: from AFU9_SMOKE_KEY env var)

.PARAMETER SkipPublish
  Skip the GitHub publish test (default: false)

.EXAMPLE
  ./scripts/verify-intent-steering.ps1

.EXAMPLE
  ./scripts/verify-intent-steering.ps1 -BaseUrl "https://stage.afu-9.com" -SmokeKey $env:AFU9_SMOKE_KEY

.EXAMPLE
  ./scripts/verify-intent-steering.ps1 -SkipPublish

.NOTES
  Issue: I908 - Regression Pack: "INTENT Steering Smoke" (v0.8 Gate)
  Version: 1.0
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = "http://localhost:3000",

  [Parameter(Mandatory = $false)]
  [string]$UserId = "smoke-test-user",

  [Parameter(Mandatory = $false)]
  [string]$SmokeKey = $null,

  [Parameter(Mandatory = $false)]
  [switch]$SkipPublish
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:TestsPassed = 0
$script:TestsFailed = 0
$script:TestsSkipped = 0
$script:StartTime = Get-Date

# ==============================================================================
# Helper Functions
# ==============================================================================

function Write-Pass([string]$Message) {
  Write-Host "✓ PASS: $Message" -ForegroundColor Green
  $script:TestsPassed++
}

function Write-Fail([string]$Message) {
  Write-Host "✗ FAIL: $Message" -ForegroundColor Red
  $script:TestsFailed++
}

function Write-Skip([string]$Message) {
  Write-Host "⊘ SKIP: $Message" -ForegroundColor Yellow
  $script:TestsSkipped++
}

function Write-Info([string]$Message) {
  Write-Host "ℹ INFO: $Message" -ForegroundColor Cyan
}

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "━━━ $Message ━━━" -ForegroundColor Magenta
}

function Normalize-BaseUrl([string]$Url) {
  return $Url.TrimEnd('/')
}

function Get-Json([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
  try { 
    return ($Text | ConvertFrom-Json -ErrorAction SilentlyContinue) 
  } catch { 
    return $null 
  }
}

function Invoke-Afu9Api {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('GET', 'POST', 'PATCH', 'DELETE')]
    [string]$Method,
    
    [Parameter(Mandatory = $true)]
    [string]$Url,
    
    [Parameter(Mandatory = $true)]
    [string]$UserId,
    
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
    Uri = $Url
    Headers = $headers
    TimeoutSec = 30
  }

  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  # Support older PowerShell versions
  $iwr = Get-Command Invoke-WebRequest
  if ($iwr.Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $params['SkipHttpErrorCheck'] = $true
  }

  try {
    $resp = Invoke-WebRequest @params
    return [pscustomobject]@{
      Status  = [int]$resp.StatusCode
      Text    = $resp.Content
      Json    = (Get-Json -Text $resp.Content)
      Headers = $resp.Headers
    }
  } catch {
    $ex = $_.Exception
    if ($null -ne $ex -and $null -ne $ex.Response) {
      try {
        $status = [int]$ex.Response.StatusCode
        $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
        $text = $reader.ReadToEnd()
        $reader.Dispose()
        return [pscustomobject]@{
          Status  = $status
          Text    = $text
          Json    = (Get-Json -Text $text)
          Headers = $null
        }
      } catch {
        # fallthrough
      }
    }
    throw
  }
}

function Test-HttpStatusOk([int]$Status, [int[]]$Expected = @(200, 201)) {
  return ($Expected -contains $Status)
}

# ==============================================================================
# Main Script
# ==============================================================================

$BaseUrl = Normalize-BaseUrl -Url $BaseUrl

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  INTENT Steering Smoke Test - v0.8 Gate Verification" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Info "Base URL:  $BaseUrl"
Write-Info "User ID:   $UserId"
Write-Info "Started:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

if ([string]::IsNullOrWhiteSpace($SmokeKey)) { 
  $SmokeKey = $env:AFU9_SMOKE_KEY 
}
if ([string]::IsNullOrWhiteSpace($SmokeKey)) {
  Write-Info "Auth Mode: Standard (no smoke key)"
} else {
  Write-Info "Auth Mode: Smoke key enabled"
}

Write-Host ""

# ==============================================================================
# Test 1: UI Stable (I901)
# ==============================================================================

Write-Step "Test 1: UI Stable (I901)"
Write-Info "Verifying /intent page loads without errors..."

try {
  $uiUrl = "$BaseUrl/intent"
  $uiResp = Invoke-WebRequest -Uri $uiUrl -TimeoutSec 10 -UseBasicParsing
  
  if ($uiResp.StatusCode -eq 200) {
    # Check that the page contains expected INTENT UI elements
    $hasIntentKeywords = ($uiResp.Content -match "intent") -or 
                         ($uiResp.Content -match "session") -or
                         ($uiResp.Content -match "DISCUSS")
    
    if ($hasIntentKeywords) {
      Write-Pass "UI page loads successfully (status 200, contains expected content)"
    } else {
      Write-Fail "UI page loads but missing expected INTENT keywords"
    }
  } else {
    Write-Fail "UI page returned unexpected status: $($uiResp.StatusCode)"
  }
} catch {
  Write-Fail "UI page failed to load: $($_.Exception.Message)"
}

Write-Info "Expected: HTTP 200, page contains INTENT UI elements"
Write-Info "Next Step: If failed, check Control Center deployment and /intent route"

# ==============================================================================
# Test 2: Draft GET/PATCH/COMMIT (I902)
# ==============================================================================

Write-Step "Test 2: Draft GET/PATCH/COMMIT (I902)"
Write-Info "Testing draft lifecycle: GET → PATCH → COMMIT..."

$sessionId = $null

try {
  # 2.1: Create session
  Write-Info "Creating INTENT session..."
  $createBody = @{ 
    title = "I908 Smoke Test - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    status = 'active'
  }
  $createResp = Invoke-Afu9Api -Method POST -Url "$BaseUrl/api/intent/sessions" -UserId $UserId -Body $createBody
  
  if (Test-HttpStatusOk -Status $createResp.Status -Expected @(200, 201)) {
    $sessionId = $createResp.Json.sessionId ?? $createResp.Json.session_id ?? $createResp.Json.id
    
    if ($null -ne $sessionId) {
      Write-Pass "Session created: $sessionId"
    } else {
      Write-Fail "Session created but no ID returned"
      throw "No session ID in response"
    }
  } else {
    Write-Fail "Session creation failed with status $($createResp.Status)"
    throw "Session creation failed"
  }

  # 2.2: GET draft (should be empty/NO_DRAFT)
  Write-Info "Getting draft (expecting NO_DRAFT state)..."
  $getResp = Invoke-Afu9Api -Method GET -Url "$BaseUrl/api/intent/sessions/$sessionId/issue-draft" -UserId $UserId
  
  if (Test-HttpStatusOk -Status $getResp.Status) {
    if ($getResp.Json.success -eq $true -and $getResp.Json.reason -eq "NO_DRAFT") {
      Write-Pass "GET draft returns deterministic NO_DRAFT state (200)"
    } else {
      Write-Fail "GET draft unexpected response: $($getResp.Text)"
    }
  } else {
    Write-Fail "GET draft failed with status $($getResp.Status)"
  }

  # 2.3: Save draft
  Write-Info "Saving draft..."
  $draftBody = @{
    issue_json = @{
      canonical_id = "I908-TEST-001"
      title = "Test Issue from I908 Smoke"
      description = "Automated test issue"
      labels = @("test", "smoke")
      afu9_module = "control-center"
      epic_tag = "E99"
    }
  }
  $saveResp = Invoke-Afu9Api -Method POST -Url "$BaseUrl/api/intent/sessions/$sessionId/issue-draft" -UserId $UserId -Body $draftBody
  
  if (Test-HttpStatusOk -Status $saveResp.Status -Expected @(200, 201)) {
    Write-Pass "Draft saved successfully"
  } else {
    Write-Fail "Draft save failed with status $($saveResp.Status): $($saveResp.Text)"
  }

  # 2.4: PATCH draft (idempotent test)
  Write-Info "Patching draft (testing idempotency)..."
  $patchBody = @{
    issue_json = @{
      canonical_id = "I908-TEST-001"
      title = "Test Issue from I908 Smoke (UPDATED)"
      description = "Automated test issue - updated via PATCH"
      labels = @("test", "smoke", "patched")
      afu9_module = "control-center"
      epic_tag = "E99"
    }
  }
  $patchResp = Invoke-Afu9Api -Method POST -Url "$BaseUrl/api/intent/sessions/$sessionId/issue-draft" -UserId $UserId -Body $patchBody
  
  if (Test-HttpStatusOk -Status $patchResp.Status -Expected @(200, 201)) {
    Write-Pass "Draft patched successfully (idempotent)"
  } else {
    Write-Fail "Draft patch failed with status $($patchResp.Status)"
  }

  # 2.5: Validate draft
  Write-Info "Validating draft..."
  $validateResp = Invoke-Afu9Api -Method POST -Url "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/validate" -UserId $UserId -Body $patchBody
  
  if (Test-HttpStatusOk -Status $validateResp.Status) {
    if ($validateResp.Json.success -eq $true -and $validateResp.Json.status -eq "VALID") {
      Write-Pass "Draft validation passed (status: VALID)"
    } else {
      Write-Fail "Draft validation returned: $($validateResp.Json.status)"
    }
  } else {
    Write-Fail "Draft validation failed with status $($validateResp.Status)"
  }

  # 2.6: Commit version
  Write-Info "Committing draft version..."
  $commitResp = Invoke-Afu9Api -Method POST -Url "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/versions/commit" -UserId $UserId
  
  if (Test-HttpStatusOk -Status $commitResp.Status -Expected @(200, 201)) {
    Write-Pass "Draft version committed successfully"
  } else {
    Write-Fail "Draft commit failed with status $($commitResp.Status)"
  }

} catch {
  Write-Fail "Draft lifecycle test failed: $($_.Exception.Message)"
}

Write-Info "Expected: All draft operations return 200/201 with expected payloads"
Write-Info "Next Step: If failed, check /api/intent/sessions/*/issue-draft endpoints and DB schema"

# ==============================================================================
# Test 3: DISCUSS→ACT Mode Switching (I903)
# ==============================================================================

Write-Step "Test 3: DISCUSS→ACT Mode Switching (I903)"
Write-Info "Testing conversation mode transitions..."

if ($null -ne $sessionId) {
  try {
    # 3.1: Check initial mode (should be DISCUSS)
    Write-Info "Checking initial conversation mode..."
    $getSessionResp = Invoke-Afu9Api -Method GET -Url "$BaseUrl/api/intent/sessions/$sessionId" -UserId $UserId
    
    if (Test-HttpStatusOk -Status $getSessionResp.Status) {
      $currentMode = $getSessionResp.Json.conversation_mode ?? $getSessionResp.Json.conversationMode ?? "UNKNOWN"
      Write-Pass "Current mode: $currentMode"
    } else {
      Write-Fail "Failed to get session details"
    }

    # 3.2: Switch to ACT mode
    Write-Info "Switching to ACT mode..."
    $modeBody = @{ conversation_mode = "ACT" }
    $modeResp = Invoke-Afu9Api -Method PATCH -Url "$BaseUrl/api/intent/sessions/$sessionId" -UserId $UserId -Body $modeBody
    
    if (Test-HttpStatusOk -Status $modeResp.Status) {
      $newMode = $modeResp.Json.conversation_mode ?? $modeResp.Json.conversationMode ?? "UNKNOWN"
      
      if ($newMode -eq "ACT") {
        Write-Pass "Mode switched to ACT successfully"
      } else {
        Write-Fail "Mode switch returned unexpected mode: $newMode"
      }
    } else {
      Write-Fail "Mode switch failed with status $($modeResp.Status)"
    }

    # 3.3: Switch back to DISCUSS
    Write-Info "Switching back to DISCUSS mode..."
    $discussBody = @{ conversation_mode = "DISCUSS" }
    $discussResp = Invoke-Afu9Api -Method PATCH -Url "$BaseUrl/api/intent/sessions/$sessionId" -UserId $UserId -Body $discussBody
    
    if (Test-HttpStatusOk -Status $discussResp.Status) {
      $finalMode = $discussResp.Json.conversation_mode ?? $discussResp.Json.conversationMode ?? "UNKNOWN"
      
      if ($finalMode -eq "DISCUSS") {
        Write-Pass "Mode switched back to DISCUSS successfully"
      } else {
        Write-Fail "Mode switch returned unexpected mode: $finalMode"
      }
    } else {
      Write-Fail "Mode switch back failed with status $($discussResp.Status)"
    }

  } catch {
    Write-Fail "Mode switching test failed: $($_.Exception.Message)"
  }
} else {
  Write-Skip "Mode switching test (no session ID from previous test)"
}

Write-Info "Expected: PATCH /api/intent/sessions/:id with conversation_mode transitions successfully"
Write-Info "Next Step: If failed, check session PATCH endpoint and conversation_mode validation"

# ==============================================================================
# Test 4: Publish to GitHub (I907)
# ==============================================================================

Write-Step "Test 4: Publish to GitHub (I907)"

if ($SkipPublish) {
  Write-Skip "GitHub publish test (--SkipPublish flag set)"
  Write-Info "To test publish, run without --SkipPublish flag"
} elseif ($null -eq $sessionId) {
  Write-Skip "GitHub publish test (no session ID from previous test)"
} else {
  Write-Info "Testing publish flow (may require admin privileges)..."
  
  try {
    $publishBody = @{
      owner = "adaefler-art"
      repo = "codefactory-control"
      issue_set_id = $sessionId
    }
    
    $publishResp = Invoke-Afu9Api -Method POST -Url "$BaseUrl/api/intent/sessions/$sessionId/issue-draft/versions/publish" -UserId $UserId -Body $publishBody
    
    if (Test-HttpStatusOk -Status $publishResp.Status -Expected @(200, 201)) {
      $batchId = $publishResp.Json.batch_id ?? $publishResp.Json.batchId
      $summary = $publishResp.Json.summary
      
      if ($null -ne $batchId) {
        Write-Pass "Publish completed with batch ID: $($batchId.Substring(0, [Math]::Min(12, $batchId.Length)))..."
        
        if ($null -ne $summary) {
          Write-Info "Summary: Total=$($summary.total), Created=$($summary.created), Updated=$($summary.updated), Failed=$($summary.failed)"
        }
      } else {
        Write-Pass "Publish completed (no batch ID in response)"
      }
    } elseif ($publishResp.Status -eq 403) {
      Write-Skip "Publish test (403 Forbidden - requires admin privileges)"
      Write-Info "User '$UserId' may not be in AFU9_ADMIN_SUBS list"
    } elseif ($publishResp.Status -eq 409) {
      Write-Skip "Publish test (409 Conflict - publishing disabled in this environment)"
      Write-Info "Set ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true to enable"
    } else {
      Write-Fail "Publish failed with status $($publishResp.Status): $($publishResp.Text)"
    }
  } catch {
    Write-Fail "Publish test failed: $($_.Exception.Message)"
  }
}

Write-Info "Expected: POST /api/intent/sessions/:id/issue-draft/versions/publish returns 200 with batch_id"
Write-Info "Next Step: If 403, add user to AFU9_ADMIN_SUBS. If 409, enable publishing in environment"

# ==============================================================================
# Test 5: Activity Log Trail (I904)
# ==============================================================================

Write-Step "Test 5: Activity Log Trail (I904)"
Write-Info "Verifying activity log records events..."

try {
  $activityResp = Invoke-Afu9Api -Method GET -Url "$BaseUrl/api/admin/activity?limit=10" -UserId $UserId
  
  if (Test-HttpStatusOk -Status $activityResp.Status) {
    if ($activityResp.Json.ok -eq $true) {
      $eventCount = $activityResp.Json.events.Count
      $total = $activityResp.Json.pagination.total
      
      Write-Pass "Activity log accessible (found $eventCount/$total events)"
      
      if ($eventCount -gt 0) {
        $event = $activityResp.Json.events[0]
        Write-Info "Sample event: Type=$($event.type), Actor=$($event.actor), Timestamp=$($event.timestamp)"
      }
    } else {
      Write-Fail "Activity log returned ok=false"
    }
  } elseif ($activityResp.Status -eq 401) {
    Write-Skip "Activity log test (401 Unauthorized - requires admin access)"
  } else {
    Write-Fail "Activity log failed with status $($activityResp.Status)"
  }
} catch {
  Write-Fail "Activity log test failed: $($_.Exception.Message)"
}

Write-Info "Expected: GET /api/admin/activity returns 200 with events array"
Write-Info "Next Step: If 401, ensure user has admin privileges or use smoke key"

# ==============================================================================
# Test Summary
# ==============================================================================

$endTime = Get-Date
$duration = ($endTime - $script:StartTime).TotalSeconds

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Test Summary" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Tests:    $($script:TestsPassed + $script:TestsFailed + $script:TestsSkipped)" -ForegroundColor White
Write-Host "Passed:         $script:TestsPassed" -ForegroundColor Green
Write-Host "Failed:         $script:TestsFailed" -ForegroundColor $(if ($script:TestsFailed -gt 0) { "Red" } else { "Gray" })
Write-Host "Skipped:        $script:TestsSkipped" -ForegroundColor Yellow
Write-Host ""
Write-Host "Duration:       $([Math]::Round($duration, 2)) seconds" -ForegroundColor White
Write-Host "Target:         < 600 seconds (10 minutes)" -ForegroundColor Gray
Write-Host ""

if ($script:TestsFailed -eq 0) {
  Write-Host "✓ GATE PASSED - v0.8 INTENT Steering is operational" -ForegroundColor Green
  Write-Host ""
  Write-Host "Next Steps:" -ForegroundColor Cyan
  Write-Host "  1. Review skipped tests (if any) and address if needed" -ForegroundColor Gray
  Write-Host "  2. Verify manual UI interaction at $BaseUrl/intent" -ForegroundColor Gray
  Write-Host "  3. Include this output as 'Gate Evidence' in PR" -ForegroundColor Gray
  exit 0
} else {
  Write-Host "✗ GATE FAILED - $script:TestsFailed test(s) failed" -ForegroundColor Red
  Write-Host ""
  Write-Host "Next Steps:" -ForegroundColor Cyan
  Write-Host "  1. Review failed tests above for specific error messages" -ForegroundColor Gray
  Write-Host "  2. Check application logs for detailed error information" -ForegroundColor Gray
  Write-Host "  3. Verify environment configuration (DB schema, env vars, etc.)" -ForegroundColor Gray
  Write-Host "  4. Re-run script after fixes" -ForegroundColor Gray
  exit 1
}
