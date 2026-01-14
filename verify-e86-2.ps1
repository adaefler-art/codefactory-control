# E86.2 Capability Manifest Endpoint - Verification Commands
# 
# Use these PowerShell commands to verify the implementation
# after the server is running (npm run dev in control-center)

# Set base URL (change if needed)
$BASE = "http://localhost:3000"

Write-Host "=== E86.2 Capability Manifest Verification ===" -ForegroundColor Cyan
Write-Host ""

# Test 1: Basic request (should fail without auth)
Write-Host "Test 1: Request without auth (should return 401)..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BASE/api/intent/capabilities" -ErrorAction Stop
    Write-Host "  ✗ FAIL: Should have returned 401" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        Write-Host "  ✓ PASS: Returns 401 Unauthorized" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Wrong status code: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    }
}
Write-Host ""

# Test 2: Authenticated request
Write-Host "Test 2: Authenticated request..." -ForegroundColor Yellow
$headers = @{
    "x-afu9-sub" = "test-user-verify"
}

try {
    $response = Invoke-RestMethod -Uri "$BASE/api/intent/capabilities" -Headers $headers -ErrorAction Stop
    
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
        $response.sources.featureFlags -ge 0) {
        Write-Host "  ✓ PASS: Sources structure correct" -ForegroundColor Green
        Write-Host "    - INTENT tools: $($response.sources.intentTools)" -ForegroundColor Gray
        Write-Host "    - MCP tools: $($response.sources.mcpTools)" -ForegroundColor Gray
        Write-Host "    - Feature flags: $($response.sources.featureFlags)" -ForegroundColor Gray
        Write-Host "    - Lawbook constraints: $($response.sources.lawbookConstraints)" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ FAIL: Sources structure incorrect" -ForegroundColor Red
    }
    
    # Store response for next test
    $manifest1 = $response
    
} catch {
    Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 3: Determinism (same request should return same hash)
Write-Host "Test 3: Determinism check..." -ForegroundColor Yellow
try {
    $response2 = Invoke-RestMethod -Uri "$BASE/api/intent/capabilities" -Headers $headers -ErrorAction Stop
    
    if ($response2.hash -eq $manifest1.hash) {
        Write-Host "  ✓ PASS: Hash is deterministic (identical across requests)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Hash changed between requests!" -ForegroundColor Red
        Write-Host "    Hash 1: $($manifest1.hash)" -ForegroundColor Gray
        Write-Host "    Hash 2: $($response2.hash)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 4: ETag caching (304 Not Modified)
Write-Host "Test 4: ETag caching (304 Not Modified)..." -ForegroundColor Yellow
try {
    $etag = $manifest1.hash
    $cacheHeaders = @{
        "x-afu9-sub" = "test-user-verify"
        "If-None-Match" = $etag
    }
    
    $webResponse = Invoke-WebRequest -Uri "$BASE/api/intent/capabilities" -Headers $cacheHeaders -ErrorAction Stop
    
    if ($webResponse.StatusCode -eq 304) {
        Write-Host "  ✓ PASS: Returns 304 Not Modified when ETag matches" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Expected 304, got $($webResponse.StatusCode)" -ForegroundColor Red
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 304) {
        Write-Host "  ✓ PASS: Returns 304 Not Modified when ETag matches" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Request failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}
Write-Host ""

# Test 5: Capability sorting
Write-Host "Test 5: Capability alphabetical sorting..." -ForegroundColor Yellow
try {
    $ids = $manifest1.capabilities | ForEach-Object { $_.id }
    $sortedIds = $ids | Sort-Object
    
    $isSorted = $true
    for ($i = 0; $i -lt $ids.Count; $i++) {
        if ($ids[$i] -ne $sortedIds[$i]) {
            $isSorted = $false
            break
        }
    }
    
    if ($isSorted) {
        Write-Host "  ✓ PASS: Capabilities are sorted alphabetically by id" -ForegroundColor Green
        Write-Host "    First 5 IDs:" -ForegroundColor Gray
        $ids | Select-Object -First 5 | ForEach-Object { Write-Host "      - $_" -ForegroundColor Gray }
    } else {
        Write-Host "  ✗ FAIL: Capabilities are not sorted!" -ForegroundColor Red
    }
} catch {
    Write-Host "  ✗ FAIL: Sorting check failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 6: Sample capability structure
Write-Host "Test 6: Sample capability structure..." -ForegroundColor Yellow
if ($manifest1.capabilities.Count -gt 0) {
    $sampleCap = $manifest1.capabilities[0]
    
    Write-Host "  Sample capability:" -ForegroundColor Gray
    Write-Host "    ID: $($sampleCap.id)" -ForegroundColor Gray
    Write-Host "    Kind: $($sampleCap.kind)" -ForegroundColor Gray
    Write-Host "    Source: $($sampleCap.source)" -ForegroundColor Gray
    if ($sampleCap.description) {
        Write-Host "    Description: $($sampleCap.description.Substring(0, [Math]::Min(50, $sampleCap.description.Length)))..." -ForegroundColor Gray
    }
    if ($sampleCap.constraints) {
        Write-Host "    Constraints: $($sampleCap.constraints -join ', ')" -ForegroundColor Gray
    }
    
    if ($sampleCap.id -and $sampleCap.kind -and $sampleCap.source) {
        Write-Host "  ✓ PASS: Capability has required fields" -ForegroundColor Green
    } else {
        Write-Host "  ✗ FAIL: Capability missing required fields" -ForegroundColor Red
    }
} else {
    Write-Host "  ✗ FAIL: No capabilities in response" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Full manifest available in `$manifest1 variable" -ForegroundColor Gray
Write-Host "Run 'npm test -- --testPathPattern=capability' to run unit tests" -ForegroundColor Gray
