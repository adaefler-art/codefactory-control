#!/usr/bin/env pwsh
#
# AFU-9 Runner MCP Server - Regression Guard Script
#
# Purpose: Ensure naming, contract version, toolset, and error formats remain consistent
# Trigger: Run in CI on PR/push to detect accidental regressions
# Exit Codes:
#   0 = All checks passed
#   1 = At least one check failed
#

param(
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

# Color output helpers
function Write-Success { param([string]$Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Failure { param([string]$Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Info { param([string]$Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }

$failCount = 0

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host " AFU-9 Runner MCP Server - Regression Guard" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host ""

# =============================================================================
# CHECK 1: Catalog Existence and Structure
# =============================================================================
Write-Info "Check 1: Verifying catalog.json exists and is valid JSON"

$catalogPath = Join-Path $repoRoot "docs/mcp/catalog.json"
if (-not (Test-Path $catalogPath)) {
    Write-Failure "catalog.json not found at: $catalogPath"
    $failCount++
    exit 1
}

try {
    $catalog = Get-Content $catalogPath -Raw | ConvertFrom-Json
    Write-Success "catalog.json is valid JSON"
} catch {
    Write-Failure "catalog.json is not valid JSON: $_"
    $failCount++
    exit 1
}

# =============================================================================
# CHECK 2: Server Name Verification
# =============================================================================
Write-Info "Check 2: Verifying server name is exactly 'afu9-runner'"

$afu9Server = $catalog.servers | Where-Object { $_.name -eq "afu9-runner" }

if (-not $afu9Server) {
    Write-Failure "Server 'afu9-runner' not found in catalog"
    $failCount++
} else {
    Write-Success "Server 'afu9-runner' found in catalog"
}

# =============================================================================
# CHECK 3: Contract Version Verification
# =============================================================================
Write-Info "Check 3: Verifying contractVersion is '0.6.0'"

if ($afu9Server -and $afu9Server.contractVersion -ne "0.6.0") {
    Write-Failure "Expected contractVersion '0.6.0', got '$($afu9Server.contractVersion)'"
    $failCount++
} elseif ($afu9Server) {
    Write-Success "contractVersion is '0.6.0'"
}

# =============================================================================
# CHECK 4: Tool Set Verification
# =============================================================================
Write-Info "Check 4: Verifying exact toolset (6 tools, no extras)"

$expectedTools = @(
    "run.create",
    "run.execute",
    "run.status",
    "run.read",
    "playbook.list",
    "playbook.get"
)

if ($afu9Server) {
    $actualTools = $afu9Server.tools | ForEach-Object { $_.name }
    
    # Check count
    if ($actualTools.Count -ne 6) {
        Write-Failure "Expected 6 tools, found $($actualTools.Count)"
        $failCount++
    } else {
        Write-Success "Tool count is correct (6)"
    }
    
    # Check each expected tool exists
    $missing = @()
    foreach ($tool in $expectedTools) {
        if ($tool -notin $actualTools) {
            $missing += $tool
        }
    }
    
    if ($missing.Count -gt 0) {
        Write-Failure "Missing tools: $($missing -join ', ')"
        $failCount++
    } else {
        Write-Success "All expected tools present"
    }
    
    # Check for unexpected tools
    $extra = @()
    foreach ($tool in $actualTools) {
        if ($tool -notin $expectedTools) {
            $extra += $tool
        }
    }
    
    if ($extra.Count -gt 0) {
        Write-Failure "Unexpected extra tools: $($extra -join ', ')"
        $failCount++
    } else {
        Write-Success "No unexpected tools"
    }
}

# =============================================================================
# CHECK 5: Legacy String Detection
# =============================================================================
Write-Info "Check 5: Scanning for forbidden legacy strings"

$forbiddenStrings = @{
    "afu9-mcp-runner" = "Old server name variant"
    "@afu9/mcp-runner" = "Old package name"
}

$excludePaths = @(
    "node_modules",
    ".git",
    "dist",
    ".next",
    "build",
    "coverage",
    "*.log",
    "package-lock.json",
    "npm-debug.log*"
)

$foundForbidden = $false

foreach ($forbidden in $forbiddenStrings.Keys) {
    $description = $forbiddenStrings[$forbidden]
    
    if ($Verbose) {
        Write-Host "  Searching for: '$forbidden' ($description)"
    }
    
    # Build ripgrep command with exclusions
    $rgArgs = @(
        $forbidden,
        $repoRoot,
        "--type-not", "lock",
        "--glob", "!node_modules/**",
        "--glob", "!.git/**",
        "--glob", "!dist/**",
        "--glob", "!.next/**",
        "--glob", "!build/**",
        "--glob", "!coverage/**",
        "--glob", "!**/*.log",
        "--glob", "!**/package-lock.json",
        "--glob", "!**/.worktrees/**",
        "--glob", "!**/standalone/**",
        "--glob", "!scripts/verify-afu9-runner.ps1",  # Exclude this script itself
        "--ignore-case"
    )
    
    try {
        $matches = & rg @rgArgs 2>$null
        if ($LASTEXITCODE -eq 0 -and $matches) {
            # Filter out matches from this script itself
            $filteredMatches = $matches | Where-Object { $_ -notmatch "verify-afu9-runner\.ps1" }
            
            if ($filteredMatches) {
                Write-Failure "Found forbidden string '$forbidden' ($description):"
                $filteredMatches | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
                $foundForbidden = $true
                $failCount++
            }
        }
    } catch {
        # ripgrep might not be installed, fall back to Select-String
        if ($Verbose) {
            Write-Host "  (ripgrep not available, using Select-String)"
        }
        
        $files = Get-ChildItem -Path $repoRoot -Recurse -File -Exclude $excludePaths -ErrorAction SilentlyContinue |
            Where-Object {
                $_.FullName -notmatch "node_modules" -and
                $_.FullName -notmatch "\.git" -and
                $_.FullName -notmatch "dist" -and
                $_.FullName -notmatch "\.next" -and
                $_.FullName -notmatch "package-lock\.json"
            }
        
        $matches = $files | Select-String -Pattern $forbidden -SimpleMatch -ErrorAction SilentlyContinue
        
        if ($matches) {
            # Filter out matches from this script itself
            $filteredMatches = $matches | Where-Object { $_.Path -notmatch "verify-afu9-runner\.ps1" }
            
            if ($filteredMatches) {
                Write-Failure "Found forbidden string '$forbidden' ($description):"
                $filteredMatches | ForEach-Object { Write-Host "    $($_.Path):$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow }
                $foundForbidden = $true
                $failCount++
            }
        }
    }
}

if (-not $foundForbidden) {
    Write-Success "No forbidden legacy strings found"
}

# =============================================================================
# CHECK 6: Package.json Name Verification
# =============================================================================
Write-Info "Check 6: Verifying package.json has correct name"

$packageJsonPath = Join-Path $repoRoot "mcp-servers/afu9-runner/package.json"
if (Test-Path $packageJsonPath) {
    $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
    
    if ($packageJson.name -ne "@afu9/afu9-runner") {
        Write-Failure "package.json name should be '@afu9/afu9-runner', got '$($packageJson.name)'"
        $failCount++
    } else {
        Write-Success "package.json name is correct"
    }
} else {
    Write-Failure "package.json not found at: $packageJsonPath"
    $failCount++
}

# =============================================================================
# CHECK 7: Documentation Exists
# =============================================================================
Write-Info "Check 7: Verifying documentation files exist"

$docsToCheck = @{
    "Central Documentation" = "docs/mcp/servers/afu9-runner.md"
    "README" = "mcp-servers/afu9-runner/README.md"
}

foreach ($docName in $docsToCheck.Keys) {
    $docPath = Join-Path $repoRoot $docsToCheck[$docName]
    if (Test-Path $docPath) {
        Write-Success "$docName exists"
    } else {
        Write-Failure "$docName not found at: $docPath"
        $failCount++
    }
}

# =============================================================================
# Summary
# =============================================================================
Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Magenta

if ($failCount -eq 0) {
    Write-Host " PASSED: All checks passed ✅" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host ""
    exit 0
} else {
    Write-Host " FAILED: $failCount check(s) failed ❌" -ForegroundColor Red
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Please fix the above issues before merging." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
