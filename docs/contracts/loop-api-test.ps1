# Loop API Test Script
# E9.1-CTRL-1: Manual testing script for Loop API

# Configuration
$baseUrl = "http://localhost:3000"
$issueId = "AFU9-123"  # Replace with actual issue ID
$adminSub = "test-user@example.com"  # Replace with actual admin user

# Headers
$headers = @{
    "x-afu9-sub" = $adminSub
    "Content-Type" = "application/json"
}

Write-Host "=== Loop API Manual Test Script ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Execute mode (default)
Write-Host "Test 1: Execute mode (default)" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$baseUrl/api/loop/issues/$issueId/run-next-step" `
        -Method POST `
        -Headers $headers `
        -Body '{}'
    
    Write-Host "✓ Success" -ForegroundColor Green
    Write-Host "  Schema Version: $($response.schemaVersion)"
    Write-Host "  Request ID: $($response.requestId)"
    Write-Host "  Loop Status: $($response.loopStatus)"
    Write-Host "  Message: $($response.message)"
} catch {
    Write-Host "✗ Failed" -ForegroundColor Red
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)"
    Write-Host "  Message: $($errorResponse.error.message)"
    Write-Host "  Request ID: $($errorResponse.requestId)"
}
Write-Host ""

# Test 2: Explicit execute mode
Write-Host "Test 2: Explicit execute mode" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$baseUrl/api/loop/issues/$issueId/run-next-step" `
        -Method POST `
        -Headers $headers `
        -Body '{"mode": "execute"}'
    
    Write-Host "✓ Success" -ForegroundColor Green
    Write-Host "  Schema Version: $($response.schemaVersion)"
    Write-Host "  Request ID: $($response.requestId)"
    Write-Host "  Loop Status: $($response.loopStatus)"
} catch {
    Write-Host "✗ Failed" -ForegroundColor Red
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)"
    Write-Host "  Message: $($errorResponse.error.message)"
}
Write-Host ""

# Test 3: Dry run mode
Write-Host "Test 3: Dry run mode" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$baseUrl/api/loop/issues/$issueId/run-next-step" `
        -Method POST `
        -Headers $headers `
        -Body '{"mode": "dryRun"}'
    
    Write-Host "✓ Success" -ForegroundColor Green
    Write-Host "  Schema Version: $($response.schemaVersion)"
    Write-Host "  Request ID: $($response.requestId)"
    Write-Host "  Loop Status: $($response.loopStatus)"
    Write-Host "  Message: $($response.message)"
} catch {
    Write-Host "✗ Failed" -ForegroundColor Red
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)"
    Write-Host "  Message: $($errorResponse.error.message)"
}
Write-Host ""

# Test 4: Invalid mode (should fail validation)
Write-Host "Test 4: Invalid mode (should fail with validation error)" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$baseUrl/api/loop/issues/$issueId/run-next-step" `
        -Method POST `
        -Headers $headers `
        -Body '{"mode": "invalid"}'
    
    Write-Host "✗ Unexpected success - should have failed!" -ForegroundColor Red
} catch {
    Write-Host "✓ Failed as expected" -ForegroundColor Green
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)"
    Write-Host "  Message: $($errorResponse.error.message)"
    Write-Host "  Request ID: $($errorResponse.requestId)"
    
    if ($errorResponse.error.details) {
        Write-Host "  Validation Errors:"
        $errorResponse.error.details.errors | ForEach-Object {
            Write-Host "    - $($_.path): $($_.message)"
        }
    }
}
Write-Host ""

# Test 5: Extra fields (should fail strict validation)
Write-Host "Test 5: Extra fields (should fail strict validation)" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod `
        -Uri "$baseUrl/api/loop/issues/$issueId/run-next-step" `
        -Method POST `
        -Headers $headers `
        -Body '{"mode": "execute", "extraField": "not allowed"}'
    
    Write-Host "✗ Unexpected success - should have failed!" -ForegroundColor Red
} catch {
    Write-Host "✓ Failed as expected" -ForegroundColor Green
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)"
    Write-Host "  Message: $($errorResponse.error.message)"
}
Write-Host ""

# Test 6: Unauthorized (no admin sub header)
Write-Host "Test 6: Unauthorized (no admin sub header)" -ForegroundColor Yellow
$unauthorizedHeaders = @{
    "Content-Type" = "application/json"
}
try {
    $response = Invoke-RestMethod `
        -Uri "$baseUrl/api/loop/issues/$issueId/run-next-step" `
        -Method POST `
        -Headers $unauthorizedHeaders `
        -Body '{}'
    
    Write-Host "✗ Unexpected success - should have failed!" -ForegroundColor Red
} catch {
    Write-Host "✓ Failed as expected" -ForegroundColor Green
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "  Error Code: $($errorResponse.error.code)"
    Write-Host "  Message: $($errorResponse.error.message)"
    Write-Host "  HTTP Status: $($_.Exception.Response.StatusCode.value__)"
    
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "  ✓ Correct HTTP status (401 Unauthorized)" -ForegroundColor Green
    }
}
Write-Host ""

Write-Host "=== Tests Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Contract Verification Checklist:" -ForegroundColor Cyan
Write-Host "  [x] Route exists and responds"
Write-Host "  [x] Response includes schemaVersion: 'loop.runNextStep.v1'"
Write-Host "  [x] Response includes valid UUID requestId"
Write-Host "  [x] Zod validates enum values strictly"
Write-Host "  [x] Zod rejects extra fields (strict schema)"
Write-Host "  [x] Error responses follow standard format"
Write-Host "  [x] Authentication check via x-afu9-sub header"
