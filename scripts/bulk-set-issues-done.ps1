<#
.SYNOPSIS
    Bulk set AFU9 issues to DONE status in PostgreSQL database.

.DESCRIPTION
    Sets AFU9 issues to DONE status with safety checks, audit logging, and evidence generation.
    Default: Only sets CREATED and SPEC_READY issues to DONE.
    Use -AllNonDone to include all non-DONE statuses.

.PARAMETER AllNonDone
    If set, updates ALL issues with status != 'DONE' (not just CREATED/SPEC_READY).

.PARAMETER GithubIssueMin
    Optional: Minimum github_issue_number to include (inclusive).

.PARAMETER GithubIssueMax
    Optional: Maximum github_issue_number to include (inclusive).

.PARAMETER DryRun
    If set, shows analysis and affected rows but does NOT execute UPDATE.

.PARAMETER Confirm
    If set, executes UPDATE without interactive confirmation prompt.
    If not set, script will show preview and require confirmation.

.EXAMPLE
    # Dry run - see what would be updated (CREATED + SPEC_READY only)
    .\bulk-set-issues-done.ps1 -DryRun

.EXAMPLE
    # Update CREATED + SPEC_READY issues in range #100-200 (with confirmation)
    .\bulk-set-issues-done.ps1 -GithubIssueMin 100 -GithubIssueMax 200

.EXAMPLE
    # Update ALL non-DONE issues without confirmation
    .\bulk-set-issues-done.ps1 -AllNonDone -Confirm

.NOTES
    Author: AFU-9 Control Center
    Version: 1.0.0
    Requires: psql, DATABASE_* environment variables
#>

[CmdletBinding()]
param(
    [Parameter()]
    [switch]$AllNonDone,

    [Parameter()]
    [int]$GithubIssueMin,

    [Parameter()]
    [int]$GithubIssueMax,

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Confirm
)

# ==============================================================================
# CONFIGURATION
# ==============================================================================

$ErrorActionPreference = "Stop"
$requestId = [System.Guid]::NewGuid().ToString()
$evidenceFile = Join-Path $PSScriptRoot "..\docs\merge-evidence\V07_BULK_DONE_EVIDENCE.md"

# Allowed status transitions (whitelist for SQL safety)
$defaultStatuses = @('CREATED', 'SPEC_READY')
$allStatuses = @('CREATED', 'SPEC_READY', 'IMPLEMENTING', 'VERIFIED', 'MERGE_READY', 'HOLD', 'KILLED')

# ==============================================================================
# UTILITY FUNCTIONS
# ==============================================================================

function Write-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Blue
}

# ==============================================================================
# DATABASE VALIDATION
# ==============================================================================

Write-Header "Database Connection Validation"

$requiredVars = @('DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD')
$missingVars = @()

foreach ($var in $requiredVars) {
    if (-not (Test-Path "env:$var") -or [string]::IsNullOrWhiteSpace((Get-Item "env:$var").Value)) {
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Error-Custom "Missing required environment variables:"
    foreach ($var in $missingVars) {
        Write-Host "  - $var" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Required variables: DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD"
    exit 1
}

Write-Success "All required database environment variables present"

# Detect environment
$dbHost = $env:DATABASE_HOST
$environment = if ($dbHost -like "*-staging*" -or $dbHost -like "*stage*") {
    "STAGING"
} elseif ($env:NODE_ENV -eq "production" -or $dbHost -like "*-prod*") {
    "PRODUCTION"
} else {
    "DEVELOPMENT"
}

Write-Info "Detected environment: $environment"
Write-Info "Database host: $dbHost"

# ==============================================================================
# OPERATION CONFIGURATION
# ==============================================================================

Write-Header "Operation Configuration"

# Determine which statuses to update
$targetStatuses = if ($AllNonDone) {
    $allStatuses
} else {
    $defaultStatuses
}

Write-Info "Target statuses: $($targetStatuses -join ', ')"

# Build WHERE clause for status filter (SQL-safe: using whitelisted literals)
$statusConditions = $targetStatuses | ForEach-Object { "status = '$_'" }
$statusWhereClause = "(" + ($statusConditions -join " OR ") + ")"

# Build WHERE clause for github_issue_number range (SQL-safe: numeric params only)
$rangeWhereClause = ""
if ($PSBoundParameters.ContainsKey('GithubIssueMin') -and $PSBoundParameters.ContainsKey('GithubIssueMax')) {
    if ($GithubIssueMin -gt $GithubIssueMax) {
        Write-Error-Custom "GithubIssueMin ($GithubIssueMin) cannot be greater than GithubIssueMax ($GithubIssueMax)"
        exit 1
    }
    $rangeWhereClause = "AND github_issue_number BETWEEN $GithubIssueMin AND $GithubIssueMax"
    Write-Info "GitHub issue range filter: #$GithubIssueMin - #$GithubIssueMax"
} elseif ($PSBoundParameters.ContainsKey('GithubIssueMin')) {
    $rangeWhereClause = "AND github_issue_number >= $GithubIssueMin"
    Write-Info "GitHub issue range filter: >= #$GithubIssueMin"
} elseif ($PSBoundParameters.ContainsKey('GithubIssueMax')) {
    $rangeWhereClause = "AND github_issue_number <= $GithubIssueMax"
    Write-Info "GitHub issue range filter: <= #$GithubIssueMax"
} else {
    Write-Info "GitHub issue range filter: NONE (all issues)"
}

Write-Info "Request ID: $requestId"

if ($DryRun) {
    Write-Warning-Custom "DRY RUN MODE - No changes will be made"
}

# ==============================================================================
# PRE-UPDATE ANALYSIS
# ==============================================================================

Write-Header "Pre-Update Analysis"

# Set PGPASSWORD for psql (process-scoped)
$env:PGPASSWORD = $env:DATABASE_PASSWORD

# Query 1: Overall status distribution
$statusDistQuery = @"
SELECT status, COUNT(*) as count
FROM afu9_issues
GROUP BY status
ORDER BY status;
"@

Write-Info "Querying overall status distribution..."
$statusDistResult = psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c $statusDistQuery

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Failed to connect to database"
    exit 1
}

Write-Host ""
Write-Host "Current Issue Status Distribution:" -ForegroundColor White
Write-Host $statusDistResult
Write-Host ""

# Query 2: Count of issues to be updated
$countQuery = @"
SELECT COUNT(*) as affected_count
FROM afu9_issues
WHERE $statusWhereClause $rangeWhereClause;
"@

Write-Info "Counting affected issues..."
$affectedCount = psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -t -c $countQuery

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "Failed to query affected count"
    exit 1
}

$affectedCount = $affectedCount.Trim()

Write-Host ""
Write-Success "Issues to be updated: $affectedCount"
Write-Host ""

# Query 3: Preview first 20 affected issues
if ([int]$affectedCount -gt 0) {
    $previewQuery = @"
SELECT id, github_issue_number, title, status
FROM afu9_issues
WHERE $statusWhereClause $rangeWhereClause
ORDER BY github_issue_number
LIMIT 20;
"@

    Write-Info "Preview of affected issues (first 20):"
    Write-Host ""
    $previewResult = psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c $previewQuery
    Write-Host $previewResult
    Write-Host ""

    if ([int]$affectedCount -gt 20) {
        Write-Info "... and $([int]$affectedCount - 20) more issue(s)"
        Write-Host ""
    }
} else {
    Write-Warning-Custom "No issues match the criteria - nothing to update"
    exit 0
}

# ==============================================================================
# CONFIRMATION GATE
# ==============================================================================

if (-not $DryRun) {
    Write-Header "Confirmation Gate"

    if (-not $Confirm) {
        Write-Host ""
        Write-Host "About to update $affectedCount issue(s) to DONE status" -ForegroundColor Yellow
        Write-Host "Environment: $environment" -ForegroundColor Yellow
        Write-Host "Request ID: $requestId" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Type 'CONFIRM' to proceed (or Ctrl+C to abort): " -NoNewline -ForegroundColor Cyan
        $userInput = Read-Host

        if ($userInput -ne 'CONFIRM') {
            Write-Warning-Custom "Operation cancelled by user (input was '$userInput', expected 'CONFIRM')"
            exit 1
        }

        Write-Success "Confirmation received"
    } else {
        Write-Info "Auto-confirm mode enabled (-Confirm flag)"
    }
}

# ==============================================================================
# EXECUTE UPDATE
# ==============================================================================

if ($DryRun) {
    Write-Header "Dry Run Complete"
    Write-Success "Dry run completed - no changes made"
    Write-Info "Remove -DryRun flag to execute the update"
    exit 0
}

Write-Header "Executing UPDATE"

# Build UPDATE query with RETURNING clause for audit trail
$updateQuery = @"
UPDATE afu9_issues
SET 
    status = 'DONE',
    updated_at = NOW()
WHERE $statusWhereClause $rangeWhereClause
RETURNING id, github_issue_number, title, status;
"@

Write-Info "Executing UPDATE query..."
Write-Host ""

$updateResult = psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c $updateQuery

if ($LASTEXITCODE -ne 0) {
    Write-Error-Custom "UPDATE failed - database error"
    exit 1
}

Write-Host $updateResult
Write-Host ""
Write-Success "UPDATE completed successfully"

# ==============================================================================
# POST-UPDATE VERIFICATION
# ==============================================================================

Write-Header "Post-Update Verification"

Write-Info "Querying updated status distribution..."
$postStatusDistResult = psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -c $statusDistQuery

Write-Host ""
Write-Host "Updated Issue Status Distribution:" -ForegroundColor White
Write-Host $postStatusDistResult
Write-Host ""

# Verify all targeted issues are now DONE
$verifyQuery = @"
SELECT COUNT(*) as remaining
FROM afu9_issues
WHERE $statusWhereClause $rangeWhereClause;
"@

$remainingCount = psql -h $env:DATABASE_HOST -p $env:DATABASE_PORT -U $env:DATABASE_USER -d $env:DATABASE_NAME -t -c $verifyQuery
$remainingCount = $remainingCount.Trim()

if ([int]$remainingCount -eq 0) {
    Write-Success "Verification PASSED: All targeted issues updated to DONE"
} else {
    Write-Error-Custom "Verification FAILED: $remainingCount issues still match criteria (expected 0)"
    exit 1
}

# ==============================================================================
# EVIDENCE LOGGING
# ==============================================================================

Write-Header "Evidence Logging"

# Create evidence directory if it doesn't exist
$evidenceDir = Split-Path $evidenceFile -Parent
if (-not (Test-Path $evidenceDir)) {
    New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
}

# Create evidence file with header if it doesn't exist
if (-not (Test-Path $evidenceFile)) {
    $header = @"
# Bulk Set Issues DONE - Evidence Log

This file contains an append-only audit log of bulk DONE status operations.

---

"@
    Set-Content -Path $evidenceFile -Value $header -Encoding UTF8
}

# Append evidence entry
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss UTC"
$evidenceEntry = @"

## Operation: $timestamp

**Request ID**: $requestId  
**Environment**: $environment  
**Database Host**: $dbHost  
**Executed By**: $env:USERNAME  

**Parameters**:
- AllNonDone: $AllNonDone
- GithubIssueMin: $(if ($PSBoundParameters.ContainsKey('GithubIssueMin')) { $GithubIssueMin } else { 'N/A' })
- GithubIssueMax: $(if ($PSBoundParameters.ContainsKey('GithubIssueMax')) { $GithubIssueMax } else { 'N/A' })
- Target Statuses: $($targetStatuses -join ', ')

**Results**:
- Issues Updated: $affectedCount
- Verification: PASSED (0 remaining)

**Status**: ✅ COMPLETE

---

"@

Add-Content -Path $evidenceFile -Value $evidenceEntry -Encoding UTF8

Write-Success "Evidence logged to: $evidenceFile"

# ==============================================================================
# FINAL SUMMARY
# ==============================================================================

Write-Header "Final Summary"

Write-Success "Operation completed successfully"
Write-Info "Request ID: $requestId"
Write-Info "Issues updated: $affectedCount"
Write-Info "Environment: $environment"
Write-Info "Evidence file: $evidenceFile"

Write-Host ""
