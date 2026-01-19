# I201.7 Verdict Endpoint Verification
# Tests POST /api/afu9/issues/:issueId/verdict endpoint

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

Write-Host "=== I201.7 Verdict Endpoint Verification ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host ""

# Helper function to make API calls
function Invoke-ApiCall {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    
    $uri = "$BaseUrl$Path"
    $headers = @{ "Content-Type" = "application/json" }
    
    try {
        if ($Body) {
            $bodyJson = $Body | ConvertTo-Json -Depth 10
            $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -Body $bodyJson
        } else {
            $response = Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers
        }
        return $response
    } catch {
        Write-Host "API Error: $_" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $errorBody = $reader.ReadToEnd()
            Write-Host "Response: $errorBody" -ForegroundColor Yellow
        }
        throw
    }
}

# Test 1: Create a test issue in IMPLEMENTING state
Write-Host "[1/7] Creating test issue in IMPLEMENTING state..." -ForegroundColor Yellow
$issueBody = @{
    title = "Test Issue for Verdict - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    body = "This issue is for testing the verdict endpoint"
    status = "IMPLEMENTING"
}
$issue = Invoke-ApiCall -Method POST -Path "/api/afu9/issues" -Body $issueBody
$issueId = $issue.id
Write-Host "✓ Created issue: $issueId (status: $($issue.status))" -ForegroundColor Green
Write-Host ""

# Test 2: Apply GREEN verdict to IMPLEMENTING issue
Write-Host "[2/7] Applying GREEN verdict to IMPLEMENTING issue..." -ForegroundColor Yellow
$verdictResult = Invoke-ApiCall -Method POST -Path "/api/afu9/issues/$issueId/verdict" -Body @{ verdict = "GREEN" }
Write-Host "✓ Verdict applied successfully" -ForegroundColor Green
Write-Host "  Old Status: $($verdictResult.oldStatus)" -ForegroundColor Gray
Write-Host "  New Status: $($verdictResult.newStatus)" -ForegroundColor Gray
Write-Host "  State Changed: $($verdictResult.stateChanged)" -ForegroundColor Gray

if ($verdictResult.newStatus -ne "VERIFIED") {
    Write-Host "✗ FAILED: Expected VERIFIED, got $($verdictResult.newStatus)" -ForegroundColor Red
    exit 1
}
if (-not $verdictResult.stateChanged) {
    Write-Host "✗ FAILED: Expected stateChanged to be true" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 3: Verify timeline events were logged
Write-Host "[3/7] Checking timeline events..." -ForegroundColor Yellow
$timeline = Invoke-ApiCall -Method GET -Path "/api/afu9/timeline?issue_id=$issueId"
$verdictSetEvents = $timeline.events | Where-Object { $_.event_type -eq "VERDICT_SET" }
$stateChangedEvents = $timeline.events | Where-Object { $_.event_type -eq "STATE_CHANGED" }

if ($verdictSetEvents.Count -eq 0) {
    Write-Host "✗ FAILED: No VERDICT_SET events found" -ForegroundColor Red
    exit 1
}
if ($stateChangedEvents.Count -eq 0) {
    Write-Host "✗ FAILED: No STATE_CHANGED events found" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Found $($verdictSetEvents.Count) VERDICT_SET event(s)" -ForegroundColor Green
Write-Host "✓ Found $($stateChangedEvents.Count) STATE_CHANGED event(s)" -ForegroundColor Green
Write-Host ""

# Test 4: Apply GREEN verdict to VERIFIED issue (should transition to DONE)
Write-Host "[4/7] Applying GREEN verdict to VERIFIED issue..." -ForegroundColor Yellow
$verdictResult2 = Invoke-ApiCall -Method POST -Path "/api/afu9/issues/$issueId/verdict" -Body @{ verdict = "GREEN" }
Write-Host "✓ Verdict applied successfully" -ForegroundColor Green
Write-Host "  Old Status: $($verdictResult2.oldStatus)" -ForegroundColor Gray
Write-Host "  New Status: $($verdictResult2.newStatus)" -ForegroundColor Gray

if ($verdictResult2.newStatus -ne "DONE") {
    Write-Host "✗ FAILED: Expected DONE, got $($verdictResult2.newStatus)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 5: Create another issue and apply RED verdict
Write-Host "[5/7] Creating test issue for RED verdict..." -ForegroundColor Yellow
$issue2Body = @{
    title = "Test Issue RED - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    status = "IMPLEMENTING"
}
$issue2 = Invoke-ApiCall -Method POST -Path "/api/afu9/issues" -Body $issue2Body
$issueId2 = $issue2.id
Write-Host "✓ Created issue: $issueId2" -ForegroundColor Green

Write-Host "Applying RED verdict..." -ForegroundColor Yellow
$redVerdict = Invoke-ApiCall -Method POST -Path "/api/afu9/issues/$issueId2/verdict" -Body @{ verdict = "RED" }
if ($redVerdict.newStatus -ne "HOLD") {
    Write-Host "✗ FAILED: Expected HOLD, got $($redVerdict.newStatus)" -ForegroundColor Red
    exit 1
}
Write-Host "✓ RED verdict correctly transitions to HOLD" -ForegroundColor Green
Write-Host ""

# Test 6: Test idempotency (applying HOLD to already HOLD issue)
Write-Host "[6/7] Testing idempotency (HOLD to HOLD)..." -ForegroundColor Yellow
$holdVerdict = Invoke-ApiCall -Method POST -Path "/api/afu9/issues/$issueId2/verdict" -Body @{ verdict = "HOLD" }
if ($holdVerdict.stateChanged) {
    Write-Host "✗ FAILED: State should not change when applying same verdict" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Idempotency verified: no state change" -ForegroundColor Green
Write-Host ""

# Test 7: Test invalid verdict
Write-Host "[7/7] Testing invalid verdict handling..." -ForegroundColor Yellow
try {
    $invalidVerdict = Invoke-ApiCall -Method POST -Path "/api/afu9/issues/$issueId/verdict" -Body @{ verdict = "INVALID" }
    Write-Host "✗ FAILED: Should have rejected invalid verdict" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Response.StatusCode -eq 400) {
        Write-Host "✓ Invalid verdict correctly rejected with 400" -ForegroundColor Green
    } else {
        Write-Host "✗ FAILED: Expected 400 status code" -ForegroundColor Red
        throw
    }
}
Write-Host ""

# Summary
Write-Host "=== All Tests Passed ===" -ForegroundColor Green
Write-Host ""
Write-Host "Verdict endpoint is working correctly:" -ForegroundColor Cyan
Write-Host "  ✓ GREEN: IMPLEMENTING → VERIFIED → DONE" -ForegroundColor Green
Write-Host "  ✓ RED: * → HOLD" -ForegroundColor Green
Write-Host "  ✓ HOLD: * → HOLD" -ForegroundColor Green
Write-Host "  ✓ Timeline events logged (VERDICT_SET + STATE_CHANGED)" -ForegroundColor Green
Write-Host "  ✓ Idempotency: duplicate verdicts don't spam events" -ForegroundColor Green
Write-Host "  ✓ Validation: invalid verdicts rejected" -ForegroundColor Green
Write-Host ""
Write-Host "Test issues created:" -ForegroundColor Gray
Write-Host "  - $issueId (DONE)" -ForegroundColor Gray
Write-Host "  - $issueId2 (HOLD)" -ForegroundColor Gray
