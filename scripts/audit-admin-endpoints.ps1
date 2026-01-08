#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Audit admin endpoints for standardized authentication patterns
    
.DESCRIPTION
    Scans all /api/ops/* and /api/admin/* endpoints to verify they use
    standardized authentication patterns (checkProdWriteGuard or manual isAdminUser).
    
    Compliant patterns:
    - Uses checkProdWriteGuard() from @/lib/guards/prod-write-guard
    - OR implements local isAdminUser() function with fail-closed behavior
    
.PARAMETER Verbose
    Show detailed scan information
    
.EXAMPLE
    .\scripts\audit-admin-endpoints.ps1
    
.NOTES
    Exit codes:
    - 0: All endpoints compliant
    - 1: One or more endpoints non-compliant
#>

[CmdletBinding()]
param()

# ANSI color codes for output
$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

Write-Host "${Blue}=== Admin Endpoint Audit ===${Reset}"
Write-Host ""

# Define paths to scan
$controlCenterRoot = Resolve-Path (Join-Path $PSScriptRoot ".." "control-center")
$opsApiPath = Join-Path $controlCenterRoot "app" "api" "ops"
$adminApiPath = Join-Path $controlCenterRoot "app" "api" "admin"

# Check if paths exist
if (-not (Test-Path $opsApiPath)) {
    Write-Host "${Red}ERROR: ops API path not found: $opsApiPath${Reset}"
    exit 1
}

if (-not (Test-Path $adminApiPath)) {
    Write-Host "${Yellow}WARNING: admin API path not found: $adminApiPath${Reset}"
}

Write-Host "Scanning: control-center/app/api/ops/**"
Write-Host "Scanning: control-center/app/api/admin/**"
Write-Host ""

# Find all route.ts files in ops and admin directories
$routeFiles = @()
$routeFiles += Get-ChildItem -Path $opsApiPath -Filter "route.ts" -Recurse -File -ErrorAction SilentlyContinue
if (Test-Path $adminApiPath) {
    $routeFiles += Get-ChildItem -Path $adminApiPath -Filter "route.ts" -Recurse -File -ErrorAction SilentlyContinue
}

$totalEndpoints = 0
$compliantEndpoints = 0
$nonCompliantEndpoints = @()

foreach ($file in $routeFiles) {
    $totalEndpoints++
    
    # Get relative path from control-center root using Substring
    $fullPath = $file.FullName -replace '\\', '/'
    $ccRoot = $controlCenterRoot -replace '\\', '/'
    
    if ($fullPath.StartsWith($ccRoot)) {
        $relativePath = $fullPath.Substring($ccRoot.Length + 1)  # +1 to skip the leading slash
    } else {
        $relativePath = $fullPath  # Fallback if path doesn't start with control center root
    }
    
    # Convert file path to API route path
    $apiPath = $relativePath `
        -replace '^app/api/', '/api/' `
        -replace '/route\.ts$', '' `
        -replace '/route\.tsx$', ''
    
    # Read file content
    $content = Get-Content -Path $file.FullName -Raw
    
    # Check for compliant patterns
    $hasCheckProdWriteGuard = $content -match 'import.*checkProdWriteGuard.*from.*@/lib/guards/prod-write-guard'
    $hasIsAdminUser = $content -match 'function\s+isAdminUser\s*\('
    $hasManualAdminCheck = $content -match 'AFU9_ADMIN_SUBS'
    
    $isCompliant = $false
    $complianceReason = ""
    
    if ($hasCheckProdWriteGuard) {
        $isCompliant = $true
        $complianceReason = "Uses checkProdWriteGuard()"
    }
    elseif ($hasIsAdminUser) {
        $isCompliant = $true
        $complianceReason = "Uses manual isAdminUser() function"
    }
    elseif ($hasManualAdminCheck) {
        # Has AFU9_ADMIN_SUBS but no isAdminUser helper - check if it's inline
        $isCompliant = $true
        $complianceReason = "Uses inline AFU9_ADMIN_SUBS check"
    }
    else {
        # Check if it's a GET endpoint that might be read-only diagnostic
        $hasGetHandler = $content -match 'export\s+async\s+function\s+GET'
        
        # Special case: /api/whoami is a diagnostic endpoint
        if ($apiPath -match '/whoami$') {
            $isCompliant = $true
            $complianceReason = "Diagnostic endpoint (whoami)"
        }
        else {
            $isCompliant = $false
            $complianceReason = "Missing admin guard"
        }
    }
    
    if ($isCompliant) {
        $compliantEndpoints++
        Write-Host "${Green}✅${Reset} $apiPath - $complianceReason"
    }
    else {
        $nonCompliantEndpoints += @{
            Path = $apiPath
            File = $relativePath
            Reason = $complianceReason
        }
        Write-Host "${Red}❌${Reset} $apiPath - $complianceReason"
    }
}

Write-Host ""
Write-Host "Summary:"
Write-Host "- Total endpoints: $totalEndpoints"
Write-Host "- Compliant: $compliantEndpoints"
Write-Host "- Non-compliant: $($nonCompliantEndpoints.Count)"
Write-Host ""

if ($nonCompliantEndpoints.Count -gt 0) {
    Write-Host "${Red}FAIL: $($nonCompliantEndpoints.Count) endpoint(s) need standardization${Reset}"
    Write-Host ""
    Write-Host "Non-compliant endpoints:"
    foreach ($endpoint in $nonCompliantEndpoints) {
        Write-Host "  - $($endpoint.Path)"
        Write-Host "    File: $($endpoint.File)"
        Write-Host "    Issue: $($endpoint.Reason)"
    }
    Write-Host ""
    Write-Host "To fix: Add checkProdWriteGuard() or isAdminUser() check"
    Write-Host "See: docs/CONTRIBUTING.md for guidelines"
    exit 1
}
else {
    Write-Host "${Green}✅ PASS: All admin endpoints use standardized authentication${Reset}"
    exit 0
}
