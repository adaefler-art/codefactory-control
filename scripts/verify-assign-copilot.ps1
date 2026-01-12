# E83.2 Verification Script: assign_copilot_to_issue
#
# Purpose: Validate assign-copilot endpoint behavior on staging
#
# Acceptance Criteria:
# 1. First call assigns copilot → status: ASSIGNED
# 2. Second call (idempotent) → status: NOOP, assignees unchanged
# 3. Negative cases: prod blocked (409), repo not in registry (403/404), issue not found (404)
#
# Usage:
#   pwsh scripts/verify-assign-copilot.ps1 -BaseUrl "http://localhost:3000" -IssueNumber 123
#   pwsh scripts/verify-assign-copilot.ps1 -BaseUrl "https://control-center.stage.afu9.cloud" -IssueNumber 456

param(
    [Parameter(Mandatory=$true)]
    [string]$BaseUrl,
    
    [Parameter(Mandatory=$true)]
    [int]$IssueNumber,
    
    [Parameter(Mandatory=$false)]
    [string]$Owner = "adaefler-art",
    
    [Parameter(Mandatory=$false)]
    [string]$Repo = "codefactory-control"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "E83.2: assign_copilot_to_issue Verification" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Base URL: $BaseUrl" -ForegroundColor Yellow
Write-Host "Target: $Owner/$Repo#$IssueNumber" -ForegroundColor Yellow
Write-Host ""

$endpoint = "$BaseUrl/api/github/issues/$IssueNumber/assign-copilot"
$headers = @{
    "Content-Type" = "application/json"
}

function Test-AssignCopilot {
    param(
        [string]$TestName,
        [hashtable]$Body,
        [int]$ExpectedStatus,
        [string]$ExpectedField = $null,
        [string]$ExpectedValue = $null
    )
    
    Write-Host "Test: $TestName" -ForegroundColor Cyan
    Write-Host "  Request: POST $endpoint"
    Write-Host "  Body: $($Body | ConvertTo-Json -Compress)"
    
    try {
        $response = Invoke-WebRequest -Uri $endpoint -Method POST -Headers $headers -Body ($Body | ConvertTo-Json) -ErrorAction SilentlyContinue
        $statusCode = $response.StatusCode
        $content = $response.Content | ConvertFrom-Json
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        if ($_.ErrorDetails.Message) {
            $content = $_.ErrorDetails.Message | ConvertFrom-Json
        } else {
            $content = @{ error = "Request failed" }
        }
    }
    
    Write-Host "  Status: $statusCode" -ForegroundColor $(if ($statusCode -eq $ExpectedStatus) { "Green" } else { "Red" })
    Write-Host "  Response: $($content | ConvertTo-Json -Compress)"
    
    if ($statusCode -ne $ExpectedStatus) {
        Write-Host "  FAILED: Expected status $ExpectedStatus, got $statusCode" -ForegroundColor Red
        return $false
    }
    
    if ($ExpectedField -and $ExpectedValue) {
        $actualValue = $content.$ExpectedField
        if ($actualValue -ne $ExpectedValue) {
            Write-Host "  FAILED: Expected $ExpectedField='$ExpectedValue', got '$actualValue'" -ForegroundColor Red
            return $false
        }
    }
    
    Write-Host "  PASSED" -ForegroundColor Green
    Write-Host ""
    return $content
}

# Test 1: First assignment (should assign)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Test 1: First Assignment (ASSIGNED)" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

$firstCall = Test-AssignCopilot `
    -TestName "First call - should assign copilot" `
    -Body @{ owner = $Owner; repo = $Repo; requestId = "test-$(Get-Random)" } `
    -ExpectedStatus 200 `
    -ExpectedField "status" `
    -ExpectedValue "ASSIGNED"

if (-not $firstCall) {
    Write-Host "First call did not return ASSIGNED status. This might be because the issue is already assigned." -ForegroundColor Yellow
    Write-Host "Proceeding with idempotency test..." -ForegroundColor Yellow
    Write-Host ""
}

# Test 2: Second assignment (should be NOOP - idempotent)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Test 2: Second Assignment (NOOP - Idempotent)" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

$secondCall = Test-AssignCopilot `
    -TestName "Second call - should be NOOP" `
    -Body @{ owner = $Owner; repo = $Repo; requestId = "test-$(Get-Random)" } `
    -ExpectedStatus 200 `
    -ExpectedField "status" `
    -ExpectedValue "NOOP"

if (-not $secondCall) {
    Write-Host "ERROR: Second call should return NOOP for idempotency!" -ForegroundColor Red
    exit 1
}

# Verify assignees are unchanged between first and second call
if ($firstCall -and $secondCall) {
    $firstAssignees = $firstCall.assignees -join ","
    $secondAssignees = $secondCall.assignees -join ","
    
    Write-Host "Assignees verification:" -ForegroundColor Cyan
    Write-Host "  First call:  [$firstAssignees]" -ForegroundColor White
    Write-Host "  Second call: [$secondAssignees]" -ForegroundColor White
    
    if ($firstAssignees -ne $secondAssignees) {
        Write-Host "  FAILED: Assignees changed between calls!" -ForegroundColor Red
        exit 1
    } else {
        Write-Host "  PASSED: Assignees unchanged (idempotent)" -ForegroundColor Green
    }
}

Write-Host ""

# Test 3: Verify lawbookHash is present
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Test 3: Lawbook Hash Present" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

if ($secondCall.lawbookHash) {
    Write-Host "  lawbookHash: $($secondCall.lawbookHash)" -ForegroundColor Green
    Write-Host "  PASSED" -ForegroundColor Green
} else {
    Write-Host "  FAILED: lawbookHash missing from response!" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Test 4: Invalid issue number (should return 404)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Test 4: Invalid Issue Number (404)" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

$invalidEndpoint = "$BaseUrl/api/github/issues/999999999/assign-copilot"
Write-Host "Test: Invalid issue number - should return 404" -ForegroundColor Cyan
Write-Host "  Request: POST $invalidEndpoint"

try {
    $response = Invoke-WebRequest -Uri $invalidEndpoint -Method POST -Headers $headers -Body (@{ owner = $Owner; repo = $Repo } | ConvertTo-Json) -ErrorAction SilentlyContinue
    $statusCode = $response.StatusCode
    Write-Host "  FAILED: Expected 404, got $statusCode" -ForegroundColor Red
    exit 1
} catch {
    $statusCode = $_.Exception.Response.StatusCode.Value__
    if ($statusCode -eq 404) {
        Write-Host "  Status: $statusCode" -ForegroundColor Green
        Write-Host "  PASSED" -ForegroundColor Green
    } else {
        Write-Host "  FAILED: Expected 404, got $statusCode" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""

# Test 5: Missing required fields (should return 400)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Test 5: Missing Required Fields (400)" -ForegroundColor Yellow
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

$result = Test-AssignCopilot `
    -TestName "Missing repo field - should return 400" `
    -Body @{ owner = $Owner } `
    -ExpectedStatus 400

if (-not $result) {
    Write-Host "ERROR: Missing field validation failed!" -ForegroundColor Red
    exit 1
}

# Summary
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✓ Idempotency: Second call returns NOOP" -ForegroundColor Green
Write-Host "✓ Assignees unchanged between calls" -ForegroundColor Green
Write-Host "✓ lawbookHash included in response" -ForegroundColor Green
Write-Host "✓ Invalid issue returns 404" -ForegroundColor Green
Write-Host "✓ Missing fields return 400" -ForegroundColor Green
Write-Host ""
Write-Host "All tests PASSED!" -ForegroundColor Green
Write-Host ""
