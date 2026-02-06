# V09-I01: Navigation Management - Verification Script
#
# This script verifies the navigation management API endpoints.
# Prerequisites:
# - Database migration 092_navigation_items.sql applied
# - AFU9_ADMIN_SUBS environment variable set with admin user ID
# - Control center running locally or accessible

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$AdminSub = $env:AFU9_ADMIN_SUBS
)

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "V09-I01 Navigation Management Verification" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $AdminSub) {
    Write-Host "❌ AFU9_ADMIN_SUBS environment variable not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:AFU9_ADMIN_SUBS = 'your-admin-sub'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Admin Sub: $AdminSub" -ForegroundColor Gray
Write-Host ""

# Test 1: GET /api/admin/navigation/admin (should return navigation items)
Write-Host "Test 1: GET /api/admin/navigation/admin" -ForegroundColor Yellow
try {
    $headers = @{
        "x-afu9-sub" = $AdminSub
        "x-request-id" = "verify-nav-get-1"
    }
    
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/navigation/admin" -Headers $headers -UseBasicParsing
    $body = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -and $body.ok -eq $true) {
        Write-Host "✅ GET /api/admin/navigation/admin returned 200" -ForegroundColor Green
        Write-Host "   Items count: $($body.items.Count)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Unexpected response: $($response.StatusCode)" -ForegroundColor Red
        Write-Host $response.Content -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Request failed: $_" -ForegroundColor Red
}
Write-Host ""

# Test 2: PUT /api/admin/navigation/admin (should update navigation items)
Write-Host "Test 2: PUT /api/admin/navigation/admin" -ForegroundColor Yellow
try {
    $headers = @{
        "x-afu9-sub" = $AdminSub
        "x-request-id" = "verify-nav-put-1"
        "Content-Type" = "application/json"
    }
    
    $body = @{
        items = @(
            @{ href = "/intent"; label = "INTENT"; position = 0; enabled = $true }
            @{ href = "/issues"; label = "Issues"; position = 1; enabled = $true }
            @{ href = "/admin/lawbook"; label = "Admin"; position = 2; enabled = $true }
        )
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/navigation/admin" -Method PUT -Headers $headers -Body $body -UseBasicParsing
    $responseBody = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -and $responseBody.ok -eq $true) {
        Write-Host "✅ PUT /api/admin/navigation/admin returned 200" -ForegroundColor Green
        Write-Host "   Updated items count: $($responseBody.items.Count)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Unexpected response: $($response.StatusCode)" -ForegroundColor Red
        Write-Host $response.Content -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Request failed: $_" -ForegroundColor Red
}
Write-Host ""

# Test 3: GET /api/admin/navigation/* (wildcard items)
Write-Host "Test 3: GET /api/admin/navigation/* (wildcard items)" -ForegroundColor Yellow
try {
    $headers = @{
        "x-afu9-sub" = $AdminSub
        "x-request-id" = "verify-nav-get-wildcard"
    }
    
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/navigation/*" -Headers $headers -UseBasicParsing
    $body = $response.Content | ConvertFrom-Json
    
    if ($response.StatusCode -eq 200 -and $body.ok -eq $true) {
        Write-Host "✅ GET /api/admin/navigation/* returned 200" -ForegroundColor Green
        Write-Host "   Wildcard items count: $($body.items.Count)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Unexpected response: $($response.StatusCode)" -ForegroundColor Red
        Write-Host $response.Content -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Request failed: $_" -ForegroundColor Red
}
Write-Host ""

# Test 4: Verify 405 error is fixed
Write-Host "Test 4: Verify 405 error is fixed (original issue)" -ForegroundColor Yellow
try {
    $headers = @{
        "x-afu9-sub" = $AdminSub
        "x-request-id" = "verify-nav-405-fix"
        "Content-Type" = "application/json"
    }
    
    $body = @{
        items = @(
            @{ href = "/test"; label = "Test"; position = 0; enabled = $true }
        )
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-WebRequest -Uri "$BaseUrl/api/admin/navigation/admin" -Method PUT -Headers $headers -Body $body -UseBasicParsing
    
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ 405 error fixed! PUT now returns 200" -ForegroundColor Green
    } elseif ($response.StatusCode -eq 405) {
        Write-Host "❌ Still returns 405 (Method Not Allowed)" -ForegroundColor Red
    } else {
        Write-Host "⚠️  Unexpected status code: $($response.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    if ($_.Exception.Response.StatusCode -eq 405) {
        Write-Host "❌ Still returns 405 (Method Not Allowed)" -ForegroundColor Red
    } else {
        Write-Host "❌ Request failed: $_" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Verification Complete" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Review database: SELECT * FROM navigation_items;" -ForegroundColor Gray
Write-Host "2. Check API routes registry: grep -n 'navigation' control-center/src/lib/api-routes.ts" -ForegroundColor Gray
Write-Host "3. Run tests: npm --prefix control-center test __tests__/api/admin-navigation.test.ts" -ForegroundColor Gray
Write-Host "4. Build: npm --prefix control-center run build" -ForegroundColor Gray
