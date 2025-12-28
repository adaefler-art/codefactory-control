# API Route Canonicalization Verification (PowerShell)
# Part of ISSUE 3 — API Route Canonicalization
#
# This is a PowerShell wrapper for the TypeScript verification script.
# Ensures cross-platform compatibility (Windows-first).
#
# Usage:
#   pwsh -File scripts/verify-routes.ps1
#   .\scripts\verify-routes.ps1

$ErrorActionPreference = "Stop"

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  AFU-9 API Route Canonicalization Verification" -ForegroundColor Cyan
Write-Host "  (PowerShell Wrapper)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is available
try {
    $nodeVersion = node --version
    Write-Host "✓ Node.js detected: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. Please install Node.js to run this verification." -ForegroundColor Red
    exit 1
}

# Check if TypeScript is available
try {
    $tsNodeVersion = npx ts-node --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ ts-node available" -ForegroundColor Green
    }
} catch {
    Write-Host "⚠  ts-node not found, will use npx" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Running verification script..." -ForegroundColor Cyan
Write-Host ""

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$verifyScript = Join-Path $scriptDir "verify-routes.js"

# Change to repository root
Push-Location $rootDir

try {
    # Run the JavaScript verification script
    node $verifyScript
    $exitCode = $LASTEXITCODE
    
    if ($exitCode -eq 0) {
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host "  ✅ VERIFICATION PASSED" -ForegroundColor Green
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
        Write-Host "  ❌ VERIFICATION FAILED" -ForegroundColor Red
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
    }
    
    exit $exitCode
} finally {
    Pop-Location
}
