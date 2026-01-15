# E87.2: Automation Policy Verification Script
# 
# Verifies automation policy enforcement by:
# 1. Calling policy evaluation endpoint
# 2. Testing cooldown enforcement (second call should be denied)
# 3. Verifying idempotency and determinism

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$RequestId = "verify-e87-2-$(Get-Date -Format 'yyyyMMddHHmmss')"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "E87.2 Automation Policy Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$headers = @{
    "Content-Type" = "application/json"
    "x-request-id" = $RequestId
}

# Test 1: Evaluate policy for allowed action
Write-Host "Test 1: Evaluate policy (should be allowed)" -ForegroundColor Yellow

$body = @{
    actionType = "rerun_checks"
    targetType = "pr"
    targetIdentifier = "owner/repo#123"
    deploymentEnv = "staging"
    actionContext = @{
        owner = "owner"
        repo = "repo"
        prNumber = 123
        runId = 456
    }
} | ConvertTo-Json

try {
    $response1 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/automation/policy/evaluate" -Headers $headers -Body $body
    
    Write-Host "  Decision: $($response1.decision)" -ForegroundColor $(if ($response1.decision -eq "allowed") { "Green" } else { "Red" })
    Write-Host "  Reason: $($response1.reason)"
    Write-Host "  Policy: $($response1.policyName)"
    Write-Host "  Idempotency Key: $($response1.idempotencyKey)"
    Write-Host "  Lawbook Version: $($response1.lawbookVersion)"
    Write-Host ""
    
    if ($response1.decision -ne "allowed") {
        Write-Host "  UNEXPECTED: First call should be allowed" -ForegroundColor Red
        Write-Host "  Enforcement Data: $($response1.enforcementData | ConvertTo-Json -Depth 3)"
    }
    
    $idempotencyKey1 = $response1.idempotencyKey
    
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "  Response: $responseBody" -ForegroundColor Red
    }
}

# Test 2: Immediate second call (should be denied by cooldown)
Write-Host "Test 2: Immediate second call (should be denied by cooldown)" -ForegroundColor Yellow

Start-Sleep -Seconds 1 # Small delay to ensure timestamp differs

try {
    $headers["x-request-id"] = "$RequestId-2"
    $response2 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/automation/policy/evaluate" -Headers $headers -Body $body
    
    Write-Host "  Decision: $($response2.decision)" -ForegroundColor $(if ($response2.decision -eq "denied") { "Green" } else { "Red" })
    Write-Host "  Reason: $($response2.reason)"
    Write-Host "  Next Allowed At: $($response2.nextAllowedAt)"
    Write-Host ""
    
    if ($response2.decision -ne "denied") {
        Write-Host "  UNEXPECTED: Second call should be denied by cooldown" -ForegroundColor Red
    }
    
    if ($response2.reason -notlike "*cooldown*") {
        Write-Host "  WARNING: Expected cooldown reason, got: $($response2.reason)" -ForegroundColor Yellow
    }
    
    $idempotencyKey2 = $response2.idempotencyKey
    
    # Verify idempotency key is identical
    if ($idempotencyKey1 -eq $idempotencyKey2) {
        Write-Host "  ✓ Idempotency keys match (determinism verified)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Idempotency keys differ (determinism FAILED)" -ForegroundColor Red
        Write-Host "    Key 1: $idempotencyKey1"
        Write-Host "    Key 2: $idempotencyKey2"
    }
    
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "  Response: $responseBody" -ForegroundColor Red
    }
}

# Test 3: Different action context (should get different idempotency key)
Write-Host "Test 3: Different action context (should get different idempotency key)" -ForegroundColor Yellow

$body3 = @{
    actionType = "rerun_checks"
    targetType = "pr"
    targetIdentifier = "owner/repo#456" # Different PR
    deploymentEnv = "staging"
    actionContext = @{
        owner = "owner"
        repo = "repo"
        prNumber = 456 # Different PR number
        runId = 789
    }
} | ConvertTo-Json

try {
    $headers["x-request-id"] = "$RequestId-3"
    $response3 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/automation/policy/evaluate" -Headers $headers -Body $body3
    
    Write-Host "  Decision: $($response3.decision)"
    Write-Host "  Idempotency Key: $($response3.idempotencyKey)"
    Write-Host ""
    
    if ($response3.idempotencyKey -ne $idempotencyKey1) {
        Write-Host "  ✓ Idempotency key differs (as expected)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Idempotency key should differ for different PR" -ForegroundColor Red
    }
    
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Action not in policy (should be denied - fail-closed)
Write-Host "Test 4: Unknown action type (should be denied - fail-closed)" -ForegroundColor Yellow

$body4 = @{
    actionType = "unknown_action_xyz"
    targetType = "pr"
    targetIdentifier = "owner/repo#123"
    deploymentEnv = "staging"
    actionContext = @{
        owner = "owner"
        repo = "repo"
    }
} | ConvertTo-Json

try {
    $headers["x-request-id"] = "$RequestId-4"
    $response4 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/automation/policy/evaluate" -Headers $headers -Body $body4
    
    Write-Host "  Decision: $($response4.decision)" -ForegroundColor $(if ($response4.decision -eq "denied") { "Green" } else { "Red" })
    Write-Host "  Reason: $($response4.reason)"
    Write-Host ""
    
    if ($response4.decision -ne "denied") {
        Write-Host "  UNEXPECTED: Unknown action should be denied (fail-closed)" -ForegroundColor Red
    }
    
    if ($response4.reason -notlike "*No policy*") {
        Write-Host "  WARNING: Expected 'No policy' reason" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 5: Action requiring approval (should be denied without approval)
Write-Host "Test 5: Action requiring approval (should be denied without approval)" -ForegroundColor Yellow

$body5 = @{
    actionType = "merge_pr"
    targetType = "pr"
    targetIdentifier = "owner/repo#123"
    deploymentEnv = "staging"
    actionContext = @{
        owner = "owner"
        repo = "repo"
        prNumber = 123
    }
    hasApproval = $false
} | ConvertTo-Json

try {
    $headers["x-request-id"] = "$RequestId-5"
    $response5 = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/automation/policy/evaluate" -Headers $headers -Body $body5
    
    Write-Host "  Decision: $($response5.decision)" -ForegroundColor $(if ($response5.decision -eq "denied") { "Green" } else { "Red" })
    Write-Host "  Reason: $($response5.reason)"
    Write-Host "  Requires Approval: $($response5.requiresApproval)"
    Write-Host ""
    
    if ($response5.decision -ne "denied") {
        Write-Host "  UNEXPECTED: merge_pr without approval should be denied" -ForegroundColor Red
    }
    
    if ($response5.requiresApproval -ne $true) {
        Write-Host "  UNEXPECTED: requiresApproval should be true" -ForegroundColor Red
    }
    
} catch {
    Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Manual Review Checklist:" -ForegroundColor Yellow
Write-Host "  [ ] Test 1: First call allowed"
Write-Host "  [ ] Test 2: Second call denied by cooldown with nextAllowedAt"
Write-Host "  [ ] Test 2: Idempotency keys match (determinism)"
Write-Host "  [ ] Test 3: Different context = different idempotency key"
Write-Host "  [ ] Test 4: Unknown action denied (fail-closed)"
Write-Host "  [ ] Test 5: Approval required action denied without approval"
Write-Host ""
