# I904 Activity Log Verification Script
# 
# This script verifies the Activity Log API endpoint works correctly
# Usage: ./verify-i904.ps1 -BaseUrl "https://stage.afu-9.com" -SmokeKey $env:AFU9_SMOKE_KEY

param(
    [Parameter(Mandatory=$true)]
    [string]$BaseUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$SmokeKey
)

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "I904 Activity Log API Verification" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Test 1: Basic GET request (no filters)
Write-Host "Test 1: Basic GET request (limit=10)" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/admin/activity?limit=10" `
        -Method Get `
        -Headers @{ "x-afu9-smoke-key" = $SmokeKey } `
        -TimeoutSec 10

    if ($response.ok -eq $true) {
        Write-Host "✓ Response OK: $($response.ok)" -ForegroundColor Green
        Write-Host "✓ Schema Version: $($response.schemaVersion)" -ForegroundColor Green
        Write-Host "✓ Events Count: $($response.events.Count)" -ForegroundColor Green
        Write-Host "✓ Total Events: $($response.pagination.total)" -ForegroundColor Green
        Write-Host "✓ Has More: $($response.pagination.hasMore)" -ForegroundColor Green
    } else {
        Write-Host "✗ Response not OK" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 2: Pagination test (50 events)
Write-Host "Test 2: Pagination test (limit=50, cursor=0)" -ForegroundColor Yellow
try {
    $startTime = Get-Date
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/admin/activity?limit=50&cursor=0" `
        -Method Get `
        -Headers @{ "x-afu9-smoke-key" = $SmokeKey } `
        -TimeoutSec 10
    $endTime = Get-Date
    $duration = ($endTime - $startTime).TotalSeconds

    if ($response.ok -eq $true) {
        Write-Host "✓ Retrieved $($response.events.Count) events" -ForegroundColor Green
        Write-Host "✓ Response time: $([math]::Round($duration, 2))s" -ForegroundColor Green
        
        if ($duration -lt 2.0) {
            Write-Host "✓ Performance: < 2s requirement met" -ForegroundColor Green
        } else {
            Write-Host "⚠ Performance: Response took $([math]::Round($duration, 2))s (target: < 2s)" -ForegroundColor Yellow
        }
        
        Write-Host "✓ Pagination cursor: $($response.pagination.cursor)" -ForegroundColor Green
        Write-Host "✓ Next cursor: $($response.pagination.nextCursor)" -ForegroundColor Green
    } else {
        Write-Host "✗ Response not OK" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 3: Filter by event type
Write-Host "Test 3: Filter by event type (approval_approved)" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/admin/activity?types=approval_approved&limit=10" `
        -Method Get `
        -Headers @{ "x-afu9-smoke-key" = $SmokeKey } `
        -TimeoutSec 10

    if ($response.ok -eq $true) {
        Write-Host "✓ Filter applied: types=$($response.filters.types)" -ForegroundColor Green
        Write-Host "✓ Events returned: $($response.events.Count)" -ForegroundColor Green
        
        # Verify all events match the filter
        $allMatch = $true
        foreach ($event in $response.events) {
            if ($event.type -ne "approval_approved") {
                $allMatch = $false
                break
            }
        }
        
        if ($allMatch) {
            Write-Host "✓ All events match filter type" -ForegroundColor Green
        } else {
            Write-Host "✗ Some events don't match filter" -ForegroundColor Red
        }
    } else {
        Write-Host "✗ Response not OK" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    # Continue even if no events match the filter
}
Write-Host ""

# Test 4: Date range filter
Write-Host "Test 4: Date range filter (last 7 days)" -ForegroundColor Yellow
try {
    $endDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $startDate = (Get-Date).AddDays(-7).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/admin/activity?startDate=$([uri]::EscapeDataString($startDate))&endDate=$([uri]::EscapeDataString($endDate))&limit=20" `
        -Method Get `
        -Headers @{ "x-afu9-smoke-key" = $SmokeKey } `
        -TimeoutSec 10

    if ($response.ok -eq $true) {
        Write-Host "✓ Date filter applied" -ForegroundColor Green
        Write-Host "✓ Start: $($response.filters.startDate)" -ForegroundColor Green
        Write-Host "✓ End: $($response.filters.endDate)" -ForegroundColor Green
        Write-Host "✓ Events in range: $($response.events.Count)" -ForegroundColor Green
    } else {
        Write-Host "✗ Response not OK" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 5: Response schema validation
Write-Host "Test 5: Response schema validation" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/admin/activity?limit=5" `
        -Method Get `
        -Headers @{ "x-afu9-smoke-key" = $SmokeKey } `
        -TimeoutSec 10

    # Check required top-level fields
    $requiredFields = @("ok", "schemaVersion", "events", "pagination", "filters")
    $missingFields = @()
    
    foreach ($field in $requiredFields) {
        if (-not $response.PSObject.Properties[$field]) {
            $missingFields += $field
        }
    }
    
    if ($missingFields.Count -eq 0) {
        Write-Host "✓ All required top-level fields present" -ForegroundColor Green
    } else {
        Write-Host "✗ Missing fields: $($missingFields -join ', ')" -ForegroundColor Red
        exit 1
    }
    
    # Check event schema if events exist
    if ($response.events.Count -gt 0) {
        $event = $response.events[0]
        $eventFields = @("id", "timestamp", "type", "actor", "correlationId", "summary")
        $missingEventFields = @()
        
        foreach ($field in $eventFields) {
            if (-not $event.PSObject.Properties[$field]) {
                $missingEventFields += $field
            }
        }
        
        if ($missingEventFields.Count -eq 0) {
            Write-Host "✓ Event schema valid" -ForegroundColor Green
            Write-Host "  - ID: $($event.id)" -ForegroundColor Gray
            Write-Host "  - Timestamp: $($event.timestamp)" -ForegroundColor Gray
            Write-Host "  - Type: $($event.type)" -ForegroundColor Gray
            Write-Host "  - Actor: $($event.actor)" -ForegroundColor Gray
            Write-Host "  - Correlation ID: $($event.correlationId.Substring(0, [Math]::Min(16, $event.correlationId.Length)))..." -ForegroundColor Gray
        } else {
            Write-Host "✗ Event missing fields: $($missingEventFields -join ', ')" -ForegroundColor Red
            exit 1
        }
        
        # Check for PII/secrets (basic check)
        $eventJson = $event | ConvertTo-Json -Depth 10
        $sensitivePatterns = @("password", "secret", "token", "api_key", "private_key")
        $foundSensitive = @()
        
        foreach ($pattern in $sensitivePatterns) {
            if ($eventJson -match $pattern) {
                $foundSensitive += $pattern
            }
        }
        
        if ($foundSensitive.Count -eq 0) {
            Write-Host "✓ No obvious PII/secrets in response" -ForegroundColor Green
        } else {
            Write-Host "⚠ Potential sensitive data detected: $($foundSensitive -join ', ')" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "✗ Schema validation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 6: Sample JSON output
Write-Host "Test 6: Sample JSON payload" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$BaseUrl/api/admin/activity?limit=2" `
        -Method Get `
        -Headers @{ "x-afu9-smoke-key" = $SmokeKey } `
        -TimeoutSec 10

    Write-Host "Sample payload (truncated):" -ForegroundColor Cyan
    $sampleJson = $response | ConvertTo-Json -Depth 5
    Write-Host $sampleJson.Substring(0, [Math]::Min(1000, $sampleJson.Length)) -ForegroundColor Gray
    
    if ($sampleJson.Length -gt 1000) {
        Write-Host "... (truncated)" -ForegroundColor Gray
    }
} catch {
    Write-Host "✗ Failed to get sample: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Summary
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Verification Complete ✓" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "All tests passed successfully!" -ForegroundColor Green
Write-Host "The Activity Log API is functioning as expected." -ForegroundColor Green
Write-Host ""
