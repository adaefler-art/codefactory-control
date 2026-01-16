# V09-I01: Session Conversation Mode Verification Script
# 
# This script verifies the conversation mode functionality through API and manual UI testing.
# 
# Prerequisites:
# - Control Center running (npm run dev:control-center or deployed)
# - User authenticated and has a session
#
# Usage:
#   pwsh verify-v09-i01.ps1 -BaseUrl http://localhost:3000 -SessionId <session-id>

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$SessionId = ""
)

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "V09-I01: Session Conversation Mode Verification" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if session ID is provided
if ([string]::IsNullOrWhiteSpace($SessionId)) {
    Write-Host "❌ Error: SessionId parameter is required" -ForegroundColor Red
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  pwsh verify-v09-i01.ps1 -BaseUrl http://localhost:3000 -SessionId <your-session-id>" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To get a session ID:" -ForegroundColor Yellow
    Write-Host "  1. Navigate to $BaseUrl/intent" -ForegroundColor Yellow
    Write-Host "  2. Create or select a session" -ForegroundColor Yellow
    Write-Host "  3. Copy the session ID from the URL or browser console" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "Target URL: $BaseUrl" -ForegroundColor Green
Write-Host "Session ID: $SessionId" -ForegroundColor Green
Write-Host ""

# Test 1: GET conversation mode
Write-Host "Test 1: GET conversation mode" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $getModeUrl = "$BaseUrl/api/intent/sessions/$SessionId/mode"
    Write-Host "GET $getModeUrl" -ForegroundColor Cyan
    
    $response = Invoke-WebRequest -Uri $getModeUrl -Method GET -UseBasicParsing -SessionVariable webSession
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    Write-Host ($data | ConvertTo-Json -Depth 3) -ForegroundColor Gray
    Write-Host ""
    
    # Validate schema
    if ($data.version -and $data.mode -and $data.updatedAt) {
        Write-Host "✅ Schema validation passed (version, mode, updatedAt present)" -ForegroundColor Green
    } else {
        Write-Host "❌ Schema validation failed (missing required fields)" -ForegroundColor Red
    }
    
    if ($data.mode -eq "FREE" -or $data.mode -eq "DRAFTING") {
        Write-Host "✅ Mode is valid: $($data.mode)" -ForegroundColor Green
    } else {
        Write-Host "❌ Invalid mode value: $($data.mode)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ GET request failed" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host ""

# Test 2: PUT conversation mode to DRAFTING
Write-Host "Test 2: PUT conversation mode to DRAFTING" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $putModeUrl = "$BaseUrl/api/intent/sessions/$SessionId/mode"
    $body = @{ mode = "DRAFTING" } | ConvertTo-Json
    
    Write-Host "PUT $putModeUrl" -ForegroundColor Cyan
    Write-Host "Body: $body" -ForegroundColor Gray
    
    $response = Invoke-WebRequest -Uri $putModeUrl -Method PUT -Body $body -ContentType "application/json" -UseBasicParsing -WebSession $webSession
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    Write-Host ($data | ConvertTo-Json -Depth 3) -ForegroundColor Gray
    Write-Host ""
    
    if ($data.mode -eq "DRAFTING") {
        Write-Host "✅ Mode successfully changed to DRAFTING" -ForegroundColor Green
    } else {
        Write-Host "❌ Mode was not changed to DRAFTING: $($data.mode)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ PUT request failed" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host ""

# Test 3: GET conversation mode again (verify persistence)
Write-Host "Test 3: GET conversation mode (verify persistence)" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $getModeUrl = "$BaseUrl/api/intent/sessions/$SessionId/mode"
    Write-Host "GET $getModeUrl" -ForegroundColor Cyan
    
    $response = Invoke-WebRequest -Uri $getModeUrl -Method GET -UseBasicParsing -WebSession $webSession
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    Write-Host ($data | ConvertTo-Json -Depth 3) -ForegroundColor Gray
    Write-Host ""
    
    if ($data.mode -eq "DRAFTING") {
        Write-Host "✅ Mode persisted correctly: DRAFTING" -ForegroundColor Green
    } else {
        Write-Host "❌ Mode was not persisted: $($data.mode)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ GET request failed" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host ""

# Test 4: PUT conversation mode back to FREE
Write-Host "Test 4: PUT conversation mode back to FREE" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $putModeUrl = "$BaseUrl/api/intent/sessions/$SessionId/mode"
    $body = @{ mode = "FREE" } | ConvertTo-Json
    
    Write-Host "PUT $putModeUrl" -ForegroundColor Cyan
    Write-Host "Body: $body" -ForegroundColor Gray
    
    $response = Invoke-WebRequest -Uri $putModeUrl -Method PUT -Body $body -ContentType "application/json" -UseBasicParsing -WebSession $webSession
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Gray
    Write-Host ($data | ConvertTo-Json -Depth 3) -ForegroundColor Gray
    Write-Host ""
    
    if ($data.mode -eq "FREE") {
        Write-Host "✅ Mode successfully changed back to FREE" -ForegroundColor Green
    } else {
        Write-Host "❌ Mode was not changed to FREE: $($data.mode)" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ PUT request failed" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host ""

# Test 5: PUT invalid mode (should fail with 400)
Write-Host "Test 5: PUT invalid mode (should fail with 400)" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Gray

try {
    $putModeUrl = "$BaseUrl/api/intent/sessions/$SessionId/mode"
    $body = @{ mode = "INVALID_MODE" } | ConvertTo-Json
    
    Write-Host "PUT $putModeUrl" -ForegroundColor Cyan
    Write-Host "Body: $body" -ForegroundColor Gray
    
    $response = Invoke-WebRequest -Uri $putModeUrl -Method PUT -Body $body -ContentType "application/json" -UseBasicParsing -WebSession $webSession -ErrorAction Stop
    
    Write-Host "❌ Request should have failed but returned: $($response.StatusCode)" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 400) {
        Write-Host "✅ Request correctly rejected with 400 Bad Request" -ForegroundColor Green
    } else {
        Write-Host "❌ Unexpected error status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "API Tests Complete" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Manual UI Testing Steps:" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────────────────────────────" -ForegroundColor Gray
Write-Host "1. Navigate to: $BaseUrl/intent" -ForegroundColor White
Write-Host "2. Select the session with ID: $SessionId" -ForegroundColor White
Write-Host "3. Verify that a mode badge (FREE or DRAFTING) is displayed in the header" -ForegroundColor White
Write-Host "4. Click the mode badge to toggle between FREE and DRAFTING" -ForegroundColor White
Write-Host "5. Verify the badge updates immediately" -ForegroundColor White
Write-Host "6. Reload the page (F5) and verify the mode persists" -ForegroundColor White
Write-Host "7. Hover over the mode badge and verify the tooltip appears" -ForegroundColor White
Write-Host ""
Write-Host "Expected UI Behavior:" -ForegroundColor Yellow
Write-Host "  - FREE mode: Green badge with tooltip explaining unrestricted conversation" -ForegroundColor White
Write-Host "  - DRAFTING mode: Purple badge with tooltip explaining focused drafting mode" -ForegroundColor White
Write-Host "  - Badge is clickable and toggles smoothly" -ForegroundColor White
Write-Host "  - Mode persists after page reload" -ForegroundColor White
Write-Host ""
