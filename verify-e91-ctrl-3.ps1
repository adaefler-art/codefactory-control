# E9.1-CTRL-3 Verification Script
# Tests locking and idempotency behavior for loop execution

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$IssueId = "AFU9-TEST-LOCK",
    [string]$ActorId = "test@example.com"
)

Write-Host "=== E9.1-CTRL-3 Locking + Idempotency Verification ===" -ForegroundColor Cyan
Write-Host ""

# Set up headers
$headers = @{
    "x-afu9-sub" = $ActorId
    "Content-Type" = "application/json"
}

$endpoint = "$BaseUrl/api/loop/issues/$IssueId/run-next-step"

Write-Host "Test 1: First execution (should succeed with 200)" -ForegroundColor Yellow
try {
    $response1 = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body '{"mode": "execute"}' -ResponseHeadersVariable responseHeaders1
    Write-Host "✓ First request succeeded" -ForegroundColor Green
    Write-Host "  Schema Version: $($response1.schemaVersion)" -ForegroundColor Gray
    Write-Host "  Request ID: $($response1.requestId)" -ForegroundColor Gray
    Write-Host "  Run ID: $($response1.runId)" -ForegroundColor Gray
    Write-Host "  Loop Status: $($response1.loopStatus)" -ForegroundColor Gray
    $runId1 = $response1.runId
} catch {
    Write-Host "✗ First request failed" -ForegroundColor Red
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)" -ForegroundColor Red
    Write-Host "  Message: $($errorResponse.error.message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Test 2: Immediate second execution (should return 200 replay from cache)" -ForegroundColor Yellow
Start-Sleep -Milliseconds 100  # Small delay to ensure first request completes
try {
    $response2 = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body '{"mode": "execute"}' -ResponseHeadersVariable responseHeaders2
    Write-Host "✓ Second request succeeded (idempotent replay)" -ForegroundColor Green
    Write-Host "  Schema Version: $($response2.schemaVersion)" -ForegroundColor Gray
    Write-Host "  Request ID: $($response2.requestId)" -ForegroundColor Gray
    Write-Host "  Run ID: $($response2.runId)" -ForegroundColor Gray
    Write-Host "  Loop Status: $($response2.loopStatus)" -ForegroundColor Gray
    
    if ($response2.runId -eq $runId1) {
        Write-Host "✓ Run ID matches first execution (idempotent)" -ForegroundColor Green
    } else {
        Write-Host "✗ Run ID differs from first execution (not idempotent!)" -ForegroundColor Red
        exit 1
    }
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "✗ Second request failed" -ForegroundColor Red
    Write-Host "  Error Code: $($errorResponse.error.code)" -ForegroundColor Red
    Write-Host "  Message: $($errorResponse.error.message)" -ForegroundColor Red
    
    # This is acceptable if we got a 409 conflict (still locked)
    if ($errorResponse.error.code -eq "LOOP_CONFLICT") {
        Write-Host "  Note: Lock conflict is acceptable if first request still running" -ForegroundColor Yellow
    } else {
        exit 1
    }
}

Write-Host ""
Write-Host "Test 3: Concurrent execution (simulate two quick clicks)" -ForegroundColor Yellow
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$issueId2 = "AFU9-TEST-CONCURRENT-$timestamp"
$endpoint2 = "$BaseUrl/api/loop/issues/$issueId2/run-next-step"

# Start two requests in parallel using background jobs
$job1 = Start-Job -ScriptBlock {
    param($url, $hdrs)
    try {
        $resp = Invoke-RestMethod -Uri $url -Method POST -Headers $hdrs -Body '{"mode": "execute"}'
        return @{ success = $true; runId = $resp.runId; status = $resp.loopStatus }
    } catch {
        $err = $_.ErrorDetails.Message | ConvertFrom-Json
        return @{ success = $false; errorCode = $err.error.code; message = $err.error.message }
    }
} -ArgumentList $endpoint2, $headers

$job2 = Start-Job -ScriptBlock {
    param($url, $hdrs)
    Start-Sleep -Milliseconds 50  # Tiny offset to simulate near-concurrent
    try {
        $resp = Invoke-RestMethod -Uri $url -Method POST -Headers $hdrs -Body '{"mode": "execute"}'
        return @{ success = $true; runId = $resp.runId; status = $resp.loopStatus }
    } catch {
        $err = $_.ErrorDetails.Message | ConvertFrom-Json
        return @{ success = $false; errorCode = $err.error.code; message = $err.error.message }
    }
} -ArgumentList $endpoint2, $headers

# Wait for jobs to complete
$result1 = Receive-Job -Job $job1 -Wait
$result2 = Receive-Job -Job $job2 -Wait
Remove-Job -Job $job1, $job2

Write-Host "  Job 1 Result:" -ForegroundColor Gray
if ($result1.success) {
    Write-Host "    ✓ Succeeded - Run ID: $($result1.runId)" -ForegroundColor Green
} else {
    Write-Host "    ✗ Failed - $($result1.errorCode): $($result1.message)" -ForegroundColor Red
}

Write-Host "  Job 2 Result:" -ForegroundColor Gray
if ($result2.success) {
    Write-Host "    ✓ Succeeded (replay) - Run ID: $($result2.runId)" -ForegroundColor Green
} else {
    Write-Host "    ✗ Failed - $($result2.errorCode): $($result2.message)" -ForegroundColor Red
}

# Verify behavior: One should succeed, one should either conflict or replay
$hasSuccess = $result1.success -or $result2.success
$hasConflictOrReplay = (!$result1.success -and $result1.errorCode -eq "LOOP_CONFLICT") -or 
                       (!$result2.success -and $result2.errorCode -eq "LOOP_CONFLICT") -or
                       ($result1.success -and $result2.success -and $result1.runId -eq $result2.runId)

if ($hasSuccess) {
    Write-Host "✓ At least one execution succeeded" -ForegroundColor Green
} else {
    Write-Host "✗ Both executions failed" -ForegroundColor Red
    exit 1
}

if ($hasConflictOrReplay) {
    Write-Host "✓ Locking/idempotency behavior verified" -ForegroundColor Green
} else {
    Write-Host "✗ No lock conflict or idempotent replay detected" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Test 4: Database tables verification" -ForegroundColor Yellow
Write-Host "  Run the following SQL to verify tables exist:" -ForegroundColor Gray
Write-Host "    SELECT COUNT(*) FROM loop_locks;" -ForegroundColor Gray
Write-Host "    SELECT COUNT(*) FROM loop_idempotency;" -ForegroundColor Gray
Write-Host "    SELECT COUNT(*) FROM loop_runs WHERE issue_id LIKE 'AFU9-TEST-%';" -ForegroundColor Gray

Write-Host ""
Write-Host "=== All Tests Completed ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Verify database migration: npm run db:migrate" -ForegroundColor Gray
Write-Host "  2. Check lock TTL (5 min) and idempotency TTL (1 hour)" -ForegroundColor Gray
Write-Host "  3. Verify cleanup runs: Check expired records are removed" -ForegroundColor Gray
Write-Host ""
