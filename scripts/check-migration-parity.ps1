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
    
    # Use cryptographically secure random GUID for test admin sub
    $testAdminSub = "test-admin-user-local-$([Guid]::NewGuid().ToString())"
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

# Check database environment variables and validate them
$dbHost = $env:DATABASE_HOST ?? "localhost"
$dbPort = $env:DATABASE_PORT ?? "5432"
$dbName = $env:DATABASE_NAME ?? "afu9"
$dbUser = $env:DATABASE_USER ?? "postgres"
$dbPassword = $env:DATABASE_PASSWORD

# Validate database parameters to prevent command injection
if ($dbHost -match '[;&|`$]' -or $dbPort -match '[^0-9]' -or $dbName -match '[;&|`$]' -or $dbUser -match '[;&|`$]') {
    Write-Error-Message "Invalid database connection parameters detected"
    Write-Info "Database parameters must not contain special shell characters"
    exit 1
}

if (-not $dbPassword) {
    Write-Warning-Message "DATABASE_PASSWORD not set - connection may fail"
}

Write-Info "Database: $dbName @ ${dbHost}:${dbPort}"
Write-Info "User: $dbUser"

# Test database connection
# Note: PGPASSWORD is used for automated scripts. For production use,
# prefer .pgpass file or connection service files for better security.
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
} finally {
    # Clear password from environment
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# ============================================================================
# Step 3: Ledger Table Check
# ============================================================================

Write-Header "Step 3: Schema Migrations Ledger Check"

try {
    $env:PGPASSWORD = $dbPassword
    $ledgerQuery = "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'afu9_migrations_ledger';"
    $ledgerExists = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c $ledgerQuery 2>&1
    
    if ($LASTEXITCODE -eq 0 -and $ledgerExists.Trim() -eq "1") {
        Write-Success "afu9_migrations_ledger table exists"
        
        # Count applied migrations
        $countQuery = "SELECT COUNT(*) FROM afu9_migrations_ledger;"
        $appliedCount = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -c $countQuery 2>&1
        Write-Info "Applied migrations in DB: $($appliedCount.Trim())"
    } else {
        Write-Warning-Message "afu9_migrations_ledger table not found"
        Write-Info "Table will be created when migrations run"
    }
} catch {
    Write-Warning-Message "Could not check ledger table: $_"
} finally {
    # Clear password from environment
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
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
        $repoRoot = Join-Path $PSScriptRoot ".."
        $controlCenterPath = Join-Path $repoRoot "control-center"
        
        # Validate control-center directory exists
        if (-not (Test-Path $controlCenterPath)) {
            Write-Error-Message "control-center directory not found at: $controlCenterPath"
            exit 1
        }
        
        # Validate package.json exists
        if (-not (Test-Path (Join-Path $controlCenterPath "package.json"))) {
            Write-Error-Message "package.json not found in control-center directory"
            exit 1
        }
        
        Push-Location $repoRoot
        
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

    # Local fallback: if the API isn't reachable (e.g., Control Center not running),
    # perform parity directly by comparing repo migrations vs afu9_migrations_ledger.
    if ($Environment -eq 'local' -and -not $_.Exception.Response) {
        Write-Warning-Message "Falling back to direct DB parity check (API unavailable)"

        try {
            $env:PGPASSWORD = $dbPassword

            # Load ledger rows (filename|sha256)
            $ledgerRows = psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -A -t -F "|" -c "SELECT filename, sha256 FROM afu9_migrations_ledger ORDER BY filename;" 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Error-Message "Failed to read afu9_migrations_ledger via psql"
                Write-Host $ledgerRows -ForegroundColor Red
                exit 1
            }

            $ledgerMap = @{}
            foreach ($line in ($ledgerRows -split "`n")) {
                $trimmed = $line.Trim()
                if (-not $trimmed) { continue }
                $parts = $trimmed -split "\|", 2
                if ($parts.Count -lt 1) { continue }
                $fname = $parts[0].Trim()
                $hash = if ($parts.Count -gt 1) { $parts[1].Trim() } else { "" }
                if ($fname) { $ledgerMap[$fname] = $hash }
            }

            $repoMap = @{}
            foreach ($file in $sqlFiles) {
                $repoMap[$file.Name] = (Get-FileHash -Algorithm SHA256 -Path $file.FullName).Hash.ToLowerInvariant()
            }

            $missingInDb = @()
            foreach ($k in $repoMap.Keys) {
                if (-not $ledgerMap.ContainsKey($k)) { $missingInDb += $k }
            }

            $extraInDb = @()
            foreach ($k in $ledgerMap.Keys) {
                if (-not $repoMap.ContainsKey($k)) { $extraInDb += $k }
            }

            $hashMismatches = @()
            foreach ($k in $repoMap.Keys) {
                if (-not $ledgerMap.ContainsKey($k)) { continue }
                $dbHash = ($ledgerMap[$k] ?? "").ToLowerInvariant()
                if (-not $dbHash) { continue }
                if ($dbHash -ne $repoMap[$k]) {
                    $hashMismatches += @{
                        filename = $k
                        repoHash = $repoMap[$k]
                        dbHash   = $dbHash
                    }
                }
            }

            $status = if ($missingInDb.Count -eq 0 -and $extraInDb.Count -eq 0 -and $hashMismatches.Count -eq 0) { "PASS" } else { "FAIL" }
            $statusColor = if ($status -eq "PASS") { "Green" } else { "Red" }

            $latestRepo = if ($sqlFiles.Count -gt 0) { $sqlFiles[-1].Name } else { "(none)" }
            $latestDb = if ($ledgerMap.Keys.Count -gt 0) { ($ledgerMap.Keys | Sort-Object | Select-Object -Last 1) } else { "(none)" }

            $resultLines = @(
                "Status: $status",
                "",
                "Repository Migrations: $($repoMap.Keys.Count)",
                "Database Applied:      $($ledgerMap.Keys.Count)",
                "Latest (Repo):         $latestRepo",
                "Latest (DB):           $latestDb",
                "",
                "Discrepancies:",
                "  Missing in DB:       $($missingInDb.Count)",
                "  Extra in DB:         $($extraInDb.Count)",
                "  Hash Mismatches:     $($hashMismatches.Count)"
            )

            Write-Box -Title "MIGRATION PARITY RESULT (DB FALLBACK)" -Lines $resultLines -Color $statusColor

            if ($status -ne "PASS") {
                Write-Header "Discrepancy Details"

                if ($missingInDb.Count -gt 0) {
                    Write-Host "Missing in Database (repo has, DB doesn't):" -ForegroundColor Yellow
                    foreach ($m in ($missingInDb | Sort-Object)) { Write-Host "  - $m" -ForegroundColor Yellow }
                    Write-Host ""
                }

                if ($extraInDb.Count -gt 0) {
                    Write-Host "Extra in Database (DB has, repo doesn't):" -ForegroundColor DarkYellow
                    foreach ($e in ($extraInDb | Sort-Object)) { Write-Host "  - $e" -ForegroundColor DarkYellow }
                    Write-Host ""
                }

                if ($hashMismatches.Count -gt 0) {
                    Write-Host "Hash Mismatches (file modified after application):" -ForegroundColor Red
                    foreach ($mm in $hashMismatches) {
                        Write-Host "  - $($mm.filename)" -ForegroundColor Red
                        Write-Host "    Repo hash: $($mm.repoHash)" -ForegroundColor Gray
                        Write-Host "    DB hash:   $($mm.dbHash)" -ForegroundColor Gray
                    }
                    Write-Host ""
                }

                Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
                Write-Host "  PARITY CHECK FAILED" -ForegroundColor Red
                Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
                Write-Host ""
                Write-Host "Next steps:" -ForegroundColor Yellow
                Write-Host "  1. Start Control Center: npm --prefix control-center run dev" -ForegroundColor Yellow
                Write-Host "  2. Re-run this script to verify API parity" -ForegroundColor Yellow
                Write-Host ""
                exit 1
            }

            Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
            Write-Host "  ✅ PARITY CHECK PASSED (DB FALLBACK)" -ForegroundColor Green
            Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
            Write-Host ""
            Write-Host "Note: Control Center API was not reachable; run it to verify API parity." -ForegroundColor Yellow
            Write-Host ""
            exit 0
        } catch {
            Write-Error-Message "Fallback parity check failed: $_"
            exit 1
        } finally {
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        }
    }
    
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
