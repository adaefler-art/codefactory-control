#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Migration Parity Check - Automated verification of DB vs Repo migrations

.DESCRIPTION
    This script provides automated migration parity checking for local development
    with the following features:
    
    - Auto-fix admin permissions for local testing (AFU9_ADMIN_SUBS)
    - Database connection verification (PostgreSQL)
    - Ledger table existence check
    - Repository migration counting
    - Idempotent migration execution
    - API parity check with formatted output
    - Detailed discrepancy reporting
    
    The script implements E80.1 migration parity verification and automates
    manual steps from docs/runbooks/MIGRATION_PARITY_CHECK.md.

.PARAMETER Environment
    Target environment for parity check.
    Valid values: local, stage, prod
    Default: local

.PARAMETER FixAdmin
    Automatically set AFU9_ADMIN_SUBS for local testing.
    Only works in 'local' environment.
    Sets a test admin user ID for bypassing admin checks.

.EXAMPLE
    .\scripts\check-migration-parity.ps1
    Run parity check on local environment

.EXAMPLE
    .\scripts\check-migration-parity.ps1 -FixAdmin
    Run with automatic admin privilege fix for local testing

.EXAMPLE
    .\scripts\check-migration-parity.ps1 -Environment stage
    Run parity check against staging environment

.NOTES
    Version: 1.0
    Author: AFU-9 Team
    Related: E80.1 Implementation Summary, MIGRATION_PARITY_CHECK.md
    
    Exit Codes:
    - 0: PASS (migrations in sync)
    - 1: FAIL (discrepancies found or errors)
#>

[CmdletBinding()]
param(
    [ValidateSet('local', 'stage', 'prod')]
    [string]$Environment = 'local',
    
    [switch]$FixAdmin
)

$ErrorActionPreference = "Stop"

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error-Message {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning-Message {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Cyan
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host "  $Message" -ForegroundColor Magenta
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host ""
}

function Write-Box {
    param(
        [string]$Title,
        [string[]]$Lines,
        [string]$Color = "White"
    )
    $maxLength = ($Lines | Measure-Object -Property Length -Maximum).Maximum
    $maxLength = [Math]::Max($maxLength, $Title.Length)
    $boxWidth = $maxLength + 4
    
    Write-Host ""
    Write-Host ("┌" + ("─" * $boxWidth) + "┐") -ForegroundColor $Color
    Write-Host ("│  " + $Title.PadRight($maxLength) + "  │") -ForegroundColor $Color
    Write-Host ("├" + ("─" * $boxWidth) + "┤") -ForegroundColor $Color
    foreach ($line in $Lines) {
        Write-Host ("│  " + $line.PadRight($maxLength) + "  │") -ForegroundColor $Color
    }
    Write-Host ("└" + ("─" * $boxWidth) + "┘") -ForegroundColor $Color
    Write-Host ""
}

# ============================================================================
# Main Script
# ============================================================================

Write-Header "Migration Parity Check (E80.1)"

Write-Info "Environment: $Environment"
Write-Info "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

# ============================================================================
# Step 1: Admin Permission Fix (Local Only)
# ============================================================================

if ($FixAdmin -and $Environment -eq 'local') {
    Write-Header "Step 1: Setting Admin Permissions (Local)"
    
    $testAdminSub = "test-admin-user-local-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $env:AFU9_ADMIN_SUBS = $testAdminSub
    
    Write-Success "Set AFU9_ADMIN_SUBS = $testAdminSub"
    Write-Warning-Message "This is for local testing only - not for production use"
} elseif ($FixAdmin -and $Environment -ne 'local') {
    Write-Warning-Message "FixAdmin flag ignored for non-local environment"
}

# ============================================================================
# Step 2: Database Connection Check
# ============================================================================

Write-Header "Step 2: Database Connection Check"

# Check if psql is available
try {
    $null = Get-Command psql -ErrorAction Stop
    Write-Success "PostgreSQL client (psql) is available"
} catch {
    Write-Error-Message "PostgreSQL client (psql) not found in PATH"
    Write-Info "Install PostgreSQL client to use this script"
    exit 1
}

# Check database environment variables
$dbHost = $env:DATABASE_HOST ?? "localhost"
$dbPort = $env:DATABASE_PORT ?? "5432"
$dbName = $env:DATABASE_NAME ?? "afu9"
$dbUser = $env:DATABASE_USER ?? "postgres"
$dbPassword = $env:DATABASE_PASSWORD

if (-not $dbPassword) {
    Write-Warning-Message "DATABASE_PASSWORD not set - connection may fail"
}

Write-Info "Database: $dbName @ ${dbHost}:${dbPort}"
Write-Info "User: $dbUser"

# Test database connection
try {
    $env:PGPASSWORD = $dbPassword
    $testQuery = "SELECT 1 as test;"
    $result = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c $testQuery 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Database connection successful"
    } else {
        Write-Error-Message "Database connection failed"
        Write-Host $result -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Error-Message "Database connection error: $_"
    exit 1
}

# ============================================================================
# Step 3: Ledger Table Check
# ============================================================================

Write-Header "Step 3: Schema Migrations Ledger Check"

try {
    $env:PGPASSWORD = $dbPassword
    $ledgerQuery = "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'schema_migrations';"
    $ledgerExists = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c $ledgerQuery 2>&1
    
    if ($LASTEXITCODE -eq 0 -and $ledgerExists.Trim() -eq "1") {
        Write-Success "schema_migrations table exists"
        
        # Count applied migrations
        $countQuery = "SELECT COUNT(*) FROM schema_migrations;"
        $appliedCount = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c $countQuery 2>&1
        Write-Info "Applied migrations in DB: $($appliedCount.Trim())"
    } else {
        Write-Warning-Message "schema_migrations table not found"
        Write-Info "Table will be created when migrations run"
    }
} catch {
    Write-Warning-Message "Could not check ledger table: $_"
}

# ============================================================================
# Step 4: Repository Migration Count
# ============================================================================

Write-Header "Step 4: Repository Migration Analysis"

$migrationDir = Join-Path $PSScriptRoot ".." "database" "migrations"
if (Test-Path $migrationDir) {
    $sqlFiles = Get-ChildItem -Path $migrationDir -Filter "*.sql" | Sort-Object Name
    $repoCount = $sqlFiles.Count
    
    Write-Success "Found $repoCount migration files in repository"
    
    if ($repoCount -gt 0) {
        $latestMigration = $sqlFiles[-1].Name
        Write-Info "Latest migration: $latestMigration"
    }
} else {
    Write-Error-Message "Migration directory not found: $migrationDir"
    exit 1
}

# ============================================================================
# Step 5: Run Migrations (Idempotent)
# ============================================================================

if ($Environment -eq 'local') {
    Write-Header "Step 5: Running Database Migrations"
    
    Write-Info "Executing: npm --prefix control-center run db:migrate"
    Write-Host ""
    
    try {
        Push-Location (Join-Path $PSScriptRoot "..")
        
        # Run migrations
        npm --prefix control-center run db:migrate
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Success "Migration run completed"
        } else {
            Write-Host ""
            Write-Error-Message "Migration run failed with exit code $LASTEXITCODE"
            Pop-Location
            exit 1
        }
        
        Pop-Location
    } catch {
        Pop-Location
        Write-Error-Message "Migration execution error: $_"
        exit 1
    }
} else {
    Write-Info "Skipping migration execution (non-local environment)"
}

# ============================================================================
# Step 6: API Parity Check
# ============================================================================

Write-Header "Step 6: API Parity Check"

# Determine base URL
$baseUrl = switch ($Environment) {
    'local' { "http://localhost:3000" }
    'stage' { "https://stage.afu-9.com" }
    'prod'  { "https://afu-9.com" }
}

Write-Info "API URL: $baseUrl/api/ops/db/migrations"

# Prepare headers
$headers = @{
    "Content-Type" = "application/json"
}

# For local environment with FixAdmin
if ($Environment -eq 'local' -and $FixAdmin) {
    $headers["x-afu9-sub"] = $env:AFU9_ADMIN_SUBS
}

# For stage/prod, would need smoke key (not implemented here)
if ($Environment -ne 'local') {
    Write-Warning-Message "Stage/Prod parity check requires smoke key authentication"
    Write-Info "Use the GitHub Actions workflow or manual API calls with proper auth"
    Write-Info "See docs/runbooks/MIGRATION_PARITY_CHECK.md for details"
    exit 0
}

# Call the API
try {
    Write-Info "Calling migration parity API..."
    
    $response = Invoke-RestMethod -Method Get `
        -Uri "$baseUrl/api/ops/db/migrations?limit=500" `
        -Headers $headers `
        -ErrorAction Stop
    
    Write-Success "API call successful"
    Write-Host ""
    
    # ========================================================================
    # Display Parity Results
    # ========================================================================
    
    $status = $response.parity.status
    $statusColor = if ($status -eq "PASS") { "Green" } else { "Red" }
    
    # Build result box
    $resultLines = @(
        "Status: $status",
        "",
        "Repository Migrations: $($response.repo.migrationCount)",
        "Database Applied:      $($response.ledger.appliedCount)",
        "Latest (Repo):         $($response.repo.latest)",
        "Latest (DB):           $($response.ledger.lastApplied)",
        "",
        "Discrepancies:",
        "  Missing in DB:       $($response.parity.missingInDb.Count)",
        "  Extra in DB:         $($response.parity.extraInDb.Count)",
        "  Hash Mismatches:     $($response.parity.hashMismatches.Count)"
    )
    
    Write-Box -Title "MIGRATION PARITY RESULT" -Lines $resultLines -Color $statusColor
    
    # ========================================================================
    # Display Detailed Discrepancies
    # ========================================================================
    
    if ($status -ne "PASS") {
        Write-Header "Discrepancy Details"
        
        if ($response.parity.missingInDb.Count -gt 0) {
            Write-Host "Missing in Database (repo has, DB doesn't):" -ForegroundColor Yellow
            foreach ($missing in $response.parity.missingInDb) {
                Write-Host "  - $missing" -ForegroundColor Yellow
            }
            Write-Host ""
        }
        
        if ($response.parity.extraInDb.Count -gt 0) {
            Write-Host "Extra in Database (DB has, repo doesn't):" -ForegroundColor DarkYellow
            foreach ($extra in $response.parity.extraInDb) {
                Write-Host "  - $extra" -ForegroundColor DarkYellow
            }
            Write-Host ""
        }
        
        if ($response.parity.hashMismatches.Count -gt 0) {
            Write-Host "Hash Mismatches (file modified after application):" -ForegroundColor Red
            foreach ($mismatch in $response.parity.hashMismatches) {
                Write-Host "  - $($mismatch.filename)" -ForegroundColor Red
                Write-Host "    Repo hash: $($mismatch.repoHash)" -ForegroundColor Gray
                Write-Host "    DB hash:   $($mismatch.dbHash)" -ForegroundColor Gray
            }
            Write-Host ""
        }
        
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
        Write-Host "  PARITY CHECK FAILED" -ForegroundColor Red
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "  1. Review discrepancies above" -ForegroundColor Yellow
        Write-Host "  2. Run migrations: npm --prefix control-center run db:migrate" -ForegroundColor Yellow
        Write-Host "  3. Re-run this script to verify" -ForegroundColor Yellow
        Write-Host "  4. See docs/runbooks/MIGRATION_PARITY_CHECK.md for guidance" -ForegroundColor Yellow
        Write-Host ""
        
        exit 1
    } else {
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host "  ✅ PARITY CHECK PASSED" -ForegroundColor Green
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
        Write-Host ""
        
        exit 0
    }
    
} catch {
    Write-Error-Message "API call failed: $_"
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Info "HTTP Status Code: $statusCode"
        
        switch ($statusCode) {
            401 {
                Write-Host ""
                Write-Host "Authentication required. Possible causes:" -ForegroundColor Yellow
                Write-Host "  - Missing x-afu9-sub header" -ForegroundColor Yellow
                Write-Host "  - Invalid JWT token" -ForegroundColor Yellow
                Write-Host "  - Try running with -FixAdmin flag" -ForegroundColor Yellow
            }
            403 {
                Write-Host ""
                Write-Host "Admin permission denied. Possible causes:" -ForegroundColor Yellow
                Write-Host "  - User not in AFU9_ADMIN_SUBS allowlist" -ForegroundColor Yellow
                Write-Host "  - Try running with -FixAdmin flag" -ForegroundColor Yellow
            }
            404 {
                Write-Host ""
                Write-Host "API endpoint not found. Possible causes:" -ForegroundColor Yellow
                Write-Host "  - Control Center not running" -ForegroundColor Yellow
                Write-Host "  - Wrong base URL" -ForegroundColor Yellow
                Write-Host "  - Start with: npm --prefix control-center run dev" -ForegroundColor Yellow
            }
        }
    }
    
    Write-Host ""
    exit 1
}
