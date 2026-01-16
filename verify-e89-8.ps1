# E89.8 Capabilities Registry + "Tools" UI - Verification Commands
# 
# Use these PowerShell commands to verify the implementation
# after the server is running (npm run dev in control-center)

# Set base URL (change if needed)
$BASE = "http://localhost:3000"

Write-Host "=== E89.8 Capabilities Registry Verification ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Manifest endpoint - Basic request (should fail without auth)
Write-Host "Test 1: Manifest endpoint without auth (should return 401)..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/manifest" -ErrorAction Stop
    Write-Host "  ✗ FAIL: Should have returned 401" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "  ✓ PASS: Returns 401 Unauthorized" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Wrong status code: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}
Write-Host ""

# Test 2: Manifest endpoint - Authenticated request
Write-Host "Test 2: Manifest endpoint with authentication..." -ForegroundColor Yellow
$headers = @{
    "x-afu9-sub" = "test-user-verify"
}

try {
    $response = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/manifest" -Headers $headers -ErrorAction Stop
    
    # Verify version format (YYYY-MM-DD)
    if ($response.version -match '^\d{4}-\d{2}-\d{2}$') {
        Write-Host "  ✓ PASS: Version format correct: $($response.version)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Invalid version format: $($response.version)" -ForegroundColor Red
    }
    
    # Verify hash format (sha256:...)
    if ($response.hash -match '^sha256:[0-9a-f]{64}$') {
        Write-Host "  ✓ PASS: Hash format correct: $($response.hash.Substring(0,20))..." -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Invalid hash format: $($response.hash)" -ForegroundColor Red
    }
    
    # Verify capabilities array exists
    if ($response.capabilities -is [Array]) {
        Write-Host "  ✓ PASS: Capabilities is an array with $($response.capabilities.Count) items" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Capabilities is not an array" -ForegroundColor Red
    }
    
    # Verify sources object
    if ($response.sources.intentTools -ge 0 -and 
        $response.sources.mcpTools -ge 0 -and 
        $response.sources.featureFlags -ge 0 -and
        $response.sources.lawbookConstraints -ge 0) {
        Write-Host "  ✓ PASS: Sources structure correct" -ForegroundColor Green
        Write-Host "    - Intent Tools: $($response.sources.intentTools)" -ForegroundColor Gray
        Write-Host "    - MCP Tools: $($response.sources.mcpTools)" -ForegroundColor Gray
        Write-Host "    - Feature Flags: $($response.sources.featureFlags)" -ForegroundColor Gray
        Write-Host "    - Lawbook Constraints: $($response.sources.lawbookConstraints)" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ FAIL: Sources structure incorrect" -ForegroundColor Red
    }
    
    # Check for probe data in capabilities (may not exist yet)
    $probedCaps = $response.capabilities | Where-Object { $_.lastProbeAt -ne $null }
    if ($probedCaps.Count -gt 0) {
        Write-Host "  ✓ INFO: Found $($probedCaps.Count) capabilities with probe data" -ForegroundColor Cyan
        $sample = $probedCaps[0]
        Write-Host "    Sample: $($sample.id) - Status: $($sample.lastProbeStatus), Latency: $($sample.lastProbeLatencyMs)ms" -ForegroundColor Gray
    } else {
        Write-Host "  ℹ INFO: No capabilities have been probed yet" -ForegroundColor Gray
    }
    
    # Verify capability structure
    if ($response.capabilities.Count -gt 0) {
        $cap = $response.capabilities[0]
        $requiredFields = @('id', 'kind', 'source', 'enabled')
        $hasAllFields = $true
        foreach ($field in $requiredFields) {
            if (-not $cap.PSObject.Properties.Name.Contains($field)) {
                Write-Host "  ✗ FAIL: Capability missing field: $field" -ForegroundColor Red
                $hasAllFields = $false
            }
        }
        if ($hasAllFields) {
            Write-Host "  ✓ PASS: Capability structure has all required fields" -ForegroundColor Green
        }
    }
    
} catch {
    Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 3: Probe endpoint - Production guard (should fail in production)
Write-Host "Test 3: Probe endpoint production guard..." -ForegroundColor Yellow
Write-Host "  ℹ INFO: Skipping - requires DEPLOYMENT_ENV=production to test" -ForegroundColor Gray
Write-Host ""

# Test 4: Probe endpoint - Staging/Development (should succeed)
Write-Host "Test 4: Probe endpoint in staging/dev..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/probe" `
        -Method Post `
        -Headers $headers `
        -ErrorAction Stop
    
    if ($response.ok -eq $true) {
        Write-Host "  ✓ PASS: Probe triggered successfully" -ForegroundColor Green
        Write-Host "    - Total Probed: $($response.summary.totalProbed)" -ForegroundColor Gray
        Write-Host "    - Success: $($response.summary.successCount)" -ForegroundColor Gray
        Write-Host "    - Errors: $($response.summary.errorCount)" -ForegroundColor Gray
        Write-Host "    - Timeouts: $($response.summary.timeoutCount)" -ForegroundColor Gray
        Write-Host "    - Unreachable: $($response.summary.unreachableCount)" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ FAIL: Probe did not return ok=true" -ForegroundColor Red
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 403) {
        Write-Host "  ℹ INFO: Probe blocked (403) - might be running in production" -ForegroundColor Gray
    } elseif ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "  ✗ FAIL: Authentication failed" -ForegroundColor Red
    } else {
        Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}
Write-Host ""

# Test 5: Manifest determinism (same request should return same hash)
Write-Host "Test 5: Manifest determinism (hash stability)..." -ForegroundColor Yellow
try {
    $response1 = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/manifest" -Headers $headers -ErrorAction Stop
    Start-Sleep -Seconds 1
    $response2 = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/manifest" -Headers $headers -ErrorAction Stop
    
    if ($response1.hash -eq $response2.hash) {
        Write-Host "  ✓ PASS: Hash is stable across requests" -ForegroundColor Green
        Write-Host "    Hash: $($response1.hash.Substring(0,20))..." -ForegroundColor Gray
    } else {
        Write-Host "  ✗ FAIL: Hash changed between requests" -ForegroundColor Red
        Write-Host "    First:  $($response1.hash.Substring(0,20))..." -ForegroundColor Gray
        Write-Host "    Second: $($response2.hash.Substring(0,20))..." -ForegroundColor Gray
    }
} catch {
    Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 6: ETag caching
Write-Host "Test 6: ETag caching (304 Not Modified)..." -ForegroundColor Yellow
try {
    # First request to get ETag
    $response = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/manifest" -Headers $headers -ErrorAction Stop
    $etag = $response.hash
    
    # Second request with If-None-Match header
    $headersWithETag = $headers.Clone()
    $headersWithETag["If-None-Match"] = $etag
    
    try {
        $response2 = Invoke-RestMethod -Uri "$BASE/api/ops/capabilities/manifest" -Headers $headersWithETag -ErrorAction Stop
        Write-Host "  ℹ INFO: Server returned 200 (might have new data)" -ForegroundColor Gray
    } catch {
        if ($_.Exception.Response.StatusCode -eq 304) {
            Write-Host "  ✓ PASS: Server returned 304 Not Modified with matching ETag" -ForegroundColor Green
        } else {
            Write-Host "  ✗ FAIL: Unexpected status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 7: UI page accessibility
Write-Host "Test 7: Tools UI page accessibility..." -ForegroundColor Yellow
try {
    $uiResponse = Invoke-WebRequest -Uri "$BASE/ops/capabilities" -ErrorAction Stop
    if ($uiResponse.StatusCode -eq 200) {
        Write-Host "  ✓ PASS: UI page is accessible (HTTP 200)" -ForegroundColor Green
        
        # Check for key UI elements
        $content = $uiResponse.Content
        if ($content -match "Tools & Capabilities") {
            Write-Host "  ✓ PASS: Page title found" -ForegroundColor Green
        }
        if ($content -match "Manifest Hash") {
            Write-Host "  ✓ PASS: Manifest hash section found" -ForegroundColor Green
        }
        if ($content -match "Probe Now") {
            Write-Host "  ✓ PASS: Probe button found" -ForegroundColor Green
        }
    } else {
        Write-Host "  ✗ FAIL: UI page returned status: $($uiResponse.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ FAIL: UI page not accessible: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Open http://localhost:3000/ops/capabilities in browser" -ForegroundColor Gray
Write-Host "2. Click 'Probe Now' to populate probe data" -ForegroundColor Gray
Write-Host "3. Verify table shows capabilities with probe status" -ForegroundColor Gray
Write-Host "4. Test filters (enabled/disabled, status, source)" -ForegroundColor Gray
Write-Host "5. Copy manifest hash and verify it's stable" -ForegroundColor Gray
Write-Host ""

# Optional: Test with smoke key (if running on stage.afu-9.com)
if ($env:AFU9_SMOKE_KEY) {
    Write-Host "=== Testing with AFU9_SMOKE_KEY ===" -ForegroundColor Cyan
    $smokeHeaders = @{
        "x-afu9-smoke-key" = $env:AFU9_SMOKE_KEY
    }
    
    try {
        $response = Invoke-RestMethod -Uri "https://stage.afu-9.com/api/ops/capabilities/manifest" -Headers $smokeHeaders -ErrorAction Stop
        Write-Host "✓ PASS: Smoke test successful on stage.afu-9.com" -ForegroundColor Green
        Write-Host "  Hash: $($response.hash)" -ForegroundColor Gray
        Write-Host "  Capabilities: $($response.capabilities.Count)" -ForegroundColor Gray
    } catch {
        Write-Host "✗ FAIL: Smoke test failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host ""
}
