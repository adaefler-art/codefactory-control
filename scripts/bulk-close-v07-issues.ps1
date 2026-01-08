#!/usr/bin/env pwsh
<#
.SYNOPSIS
Bulk close all v0.7 AFU-9 issues to DONE status.

.DESCRIPTION
This script sets all non-DONE v0.7 issues (E70-E79) to DONE status via direct database UPDATE.
- Admin-only operation (requires AFU9_ADMIN_SUBS environment variable)
- Idempotent: Only updates issues not already in DONE status
- Evidence-first: Reports before/after counts and sample IDs

.PARAMETER DryRun
If specified, shows what would be updated without making changes.

.PARAMETER Force
Skip confirmation prompts (use with caution).

.EXAMPLE
.\scripts\bulk-close-v07-issues.ps1 -DryRun
Shows what would be updated without making changes.

.EXAMPLE
.\scripts\bulk-close-v07-issues.ps1
Prompts for confirmation before updating.

.EXAMPLE
.\scripts\bulk-close-v07-issues.ps1 -Force
Updates without confirmation (production use).

.NOTES
Package 2 of v0.7 Release Process
Requires: psql, AWS CLI, AFU9_ADMIN_SUBS env var
#>

param(
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ============================================
# SECTION 1: Admin Gate - Environment Check
# ============================================

Write-Host "`n=== ADMIN GATE CHECK ===" -ForegroundColor Cyan

# Check for AFU9_ADMIN_SUBS environment variable
if (-not $env:AFU9_ADMIN_SUBS) {
    Write-Host "❌ FAILED: AFU9_ADMIN_SUBS environment variable not set" -ForegroundColor Red
    Write-Host "This is an admin-only operation requiring elevated permissions." -ForegroundColor Yellow
    Write-Host "`nSet the variable with:" -ForegroundColor Yellow
    Write-Host '  $env:AFU9_ADMIN_SUBS = "your-admin-sub-id"' -ForegroundColor Gray
    exit 1
}

Write-Host "✅ Admin credentials detected (AFU9_ADMIN_SUBS present)" -ForegroundColor Green

# Determine environment (staging vs production)
$environment = if ($env:DATABASE_HOST -like "*staging*" -or $env:NODE_ENV -eq "staging") {
    "STAGING"
} elseif ($env:DATABASE_HOST -like "*prod*" -or $env:NODE_ENV -eq "production") {
    "PRODUCTION"
} else {
    "DEVELOPMENT"
}

Write-Host "🔍 Detected environment: $environment" -ForegroundColor Cyan

# ============================================
# SECTION 2: Database Connection Validation
# ============================================

Write-Host "`n=== DATABASE CONNECTION CHECK ===" -ForegroundColor Cyan

# Check for required environment variables
$requiredVars = @("DATABASE_HOST", "DATABASE_PORT", "DATABASE_NAME", "DATABASE_USER", "DATABASE_PASSWORD")
$missingVars = $requiredVars | Where-Object { -not (Test-Path "env:$_") }

if ($missingVars.Count -gt 0) {
    Write-Host "❌ Missing required environment variables:" -ForegroundColor Red
    $missingVars | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host "`nLoad environment with:" -ForegroundColor Yellow
    Write-Host '  Get-Content .env | ForEach-Object { if ($_ -match "^([^=]+)=(.*)$") { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }' -ForegroundColor Gray
    exit 1
}

Write-Host "✅ All required DATABASE_* variables present" -ForegroundColor Green
Write-Host "   Host: $env:DATABASE_HOST" -ForegroundColor Gray
Write-Host "   Database: $env:DATABASE_NAME" -ForegroundColor Gray

# Test database connection
Write-Host "`n🔍 Testing database connection..." -ForegroundColor Cyan

$testQuery = "SELECT COUNT(*) as count FROM afu9_issues;"
$connectionTest = $null

try {
    $connectionTest = & psql `
        -h $env:DATABASE_HOST `
        -p $env:DATABASE_PORT `
        -U $env:DATABASE_USER `
        -d $env:DATABASE_NAME `
        -c $testQuery `
        -t `
        -A `
        2>&1
    
    if ($LASTEXITCODE -ne 0) {
        throw "psql connection failed with exit code $LASTEXITCODE"
    }
    
    $totalIssues = [int]($connectionTest -replace '\s+', '')
    Write-Host "✅ Database connection successful ($totalIssues total issues)" -ForegroundColor Green
} catch {
    Write-Host "❌ Database connection failed: $_" -ForegroundColor Red
    exit 1
}

# ============================================
# SECTION 3: Pre-Update Analysis
# ============================================

Write-Host "`n=== PRE-UPDATE ANALYSIS ===" -ForegroundColor Cyan

# Query for v0.7 issues (GitHub issue numbers 70-79, corresponding to E70-E79)
$preCountQuery = @"
SELECT 
    status,
    COUNT(*) as count
FROM afu9_issues
WHERE github_issue_number BETWEEN 70 AND 79
GROUP BY status
ORDER BY status;
"@

Write-Host "🔍 Querying v0.7 issue status distribution..." -ForegroundColor Cyan

$preCountResult = & psql `
    -h $env:DATABASE_HOST `
    -p $env:DATABASE_PORT `
    -U $env:DATABASE_USER `
    -d $env:DATABASE_NAME `
    -c $preCountQuery `
    -A `
    -t `
    2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Pre-count query failed: $preCountResult" -ForegroundColor Red
    exit 1
}

Write-Host "`nCurrent v0.7 Issue Status Distribution:" -ForegroundColor Yellow
Write-Host "Status       | Count" -ForegroundColor Gray
Write-Host "-------------|------" -ForegroundColor Gray

$preCountMap = @{}
$totalV07Issues = 0

if ($preCountResult) {
    $preCountResult -split "`n" | Where-Object { $_ -match '\S' } | ForEach-Object {
        $parts = $_ -split '\|'
        if ($parts.Count -eq 2) {
            $status = $parts[0].Trim()
            $count = [int]$parts[1].Trim()
            $preCountMap[$status] = $count
            $totalV07Issues += $count
            Write-Host ("{0,-12} | {1,5}" -f $status, $count) -ForegroundColor White
        }
    }
}

if ($totalV07Issues -eq 0) {
    Write-Host "`n⚠️  No v0.7 issues found (github_issue_number 70-79)" -ForegroundColor Yellow
    Write-Host "This might indicate:" -ForegroundColor Yellow
    Write-Host "  - Issues already migrated to DONE" -ForegroundColor Gray
    Write-Host "  - Different issue numbering scheme" -ForegroundColor Gray
    Write-Host "  - Wrong database connection" -ForegroundColor Gray
    exit 0
}

# Count non-DONE issues
$nonDoneCount = $totalV07Issues - ($preCountMap["DONE"] -or 0)

Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "  Total v0.7 issues: $totalV07Issues" -ForegroundColor White
Write-Host "  Already DONE: $($preCountMap['DONE'] -or 0)" -ForegroundColor Green
Write-Host "  To be updated: $nonDoneCount" -ForegroundColor $(if ($nonDoneCount -gt 0) { "Yellow" } else { "Green" })

# Get sample IDs of issues to be updated
if ($nonDoneCount -gt 0) {
    $sampleQuery = @"
SELECT id, github_issue_number, title, status
FROM afu9_issues
WHERE github_issue_number BETWEEN 70 AND 79
  AND status != 'DONE'
ORDER BY github_issue_number
LIMIT 5;
"@

    Write-Host "`n📋 Sample issues to be updated (first 5):" -ForegroundColor Cyan
    
    $sampleResult = & psql `
        -h $env:DATABASE_HOST `
        -p $env:DATABASE_PORT `
        -U $env:DATABASE_USER `
        -d $env:DATABASE_NAME `
        -c $sampleQuery `
        2>&1
    
    Write-Host $sampleResult -ForegroundColor Gray
}

# ============================================
# SECTION 4: Confirmation Gate
# ============================================

if ($DryRun) {
    Write-Host "`n🔍 DRY RUN MODE - No changes will be made" -ForegroundColor Yellow
    Write-Host "Would update $nonDoneCount issue(s) to DONE status" -ForegroundColor Yellow
    exit 0
}

if ($nonDoneCount -eq 0) {
    Write-Host "`n✅ All v0.7 issues already in DONE status - nothing to update" -ForegroundColor Green
    exit 0
}

if (-not $Force) {
    Write-Host "`n⚠️  CONFIRMATION REQUIRED" -ForegroundColor Yellow
    Write-Host "This will update $nonDoneCount v0.7 issue(s) to DONE status in $environment environment." -ForegroundColor Yellow
    Write-Host "This operation is IRREVERSIBLE (no automated rollback)." -ForegroundColor Red
    
    $confirmation = Read-Host "`nType 'CONFIRM' to proceed"
    
    if ($confirmation -ne "CONFIRM") {
        Write-Host "❌ Operation cancelled by user" -ForegroundColor Red
        exit 1
    }
}

# ============================================
# SECTION 5: Bulk Update Execution
# ============================================

Write-Host "`n=== EXECUTING BULK UPDATE ===" -ForegroundColor Cyan

$updateQuery = @"
UPDATE afu9_issues
SET 
    status = 'DONE',
    updated_at = NOW()
WHERE 
    github_issue_number BETWEEN 70 AND 79
    AND status != 'DONE'
RETURNING id, github_issue_number, title;
"@

Write-Host "🔄 Updating v0.7 issues to DONE status..." -ForegroundColor Cyan

$updateResult = & psql `
    -h $env:DATABASE_HOST `
    -p $env:DATABASE_PORT `
    -U $env:DATABASE_USER `
    -d $env:DATABASE_NAME `
    -c $updateQuery `
    2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Bulk update failed: $updateResult" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Bulk update completed successfully" -ForegroundColor Green
Write-Host $updateResult -ForegroundColor Gray

# ============================================
# SECTION 6: Post-Update Verification
# ============================================

Write-Host "`n=== POST-UPDATE VERIFICATION ===" -ForegroundColor Cyan

$postCountResult = & psql `
    -h $env:DATABASE_HOST `
    -p $env:DATABASE_PORT `
    -U $env:DATABASE_USER `
    -d $env:DATABASE_NAME `
    -c $preCountQuery `
    -A `
    -t `
    2>&1

Write-Host "`nPost-Update v0.7 Issue Status Distribution:" -ForegroundColor Yellow
Write-Host "Status       | Count" -ForegroundColor Gray
Write-Host "-------------|------" -ForegroundColor Gray

$postCountMap = @{}
$totalPostIssues = 0

if ($postCountResult) {
    $postCountResult -split "`n" | Where-Object { $_ -match '\S' } | ForEach-Object {
        $parts = $_ -split '\|'
        if ($parts.Count -eq 2) {
            $status = $parts[0].Trim()
            $count = [int]$parts[1].Trim()
            $postCountMap[$status] = $count
            $totalPostIssues += $count
            Write-Host ("{0,-12} | {1,5}" -f $status, $count) -ForegroundColor White
        }
    }
}

$finalDoneCount = $postCountMap["DONE"] -or 0
$updatedCount = $finalDoneCount - ($preCountMap["DONE"] -or 0)

Write-Host "`n=== FINAL SUMMARY ===" -ForegroundColor Cyan
Write-Host "✅ Operation completed successfully" -ForegroundColor Green
Write-Host "   Environment: $environment" -ForegroundColor Gray
Write-Host "   Total v0.7 issues: $totalV07Issues" -ForegroundColor White
Write-Host "   Previously DONE: $($preCountMap['DONE'] -or 0)" -ForegroundColor White
Write-Host "   Now DONE: $finalDoneCount" -ForegroundColor Green
Write-Host "   Updated in this run: $updatedCount" -ForegroundColor Yellow

# Verification check
if ($finalDoneCount -ne $totalV07Issues) {
    Write-Host "`n⚠️  WARNING: Not all v0.7 issues are DONE" -ForegroundColor Yellow
    Write-Host "Expected: $totalV07Issues | Actual: $finalDoneCount" -ForegroundColor Yellow
} else {
    Write-Host "`n✅ VERIFICATION PASSED: All v0.7 issues now in DONE status" -ForegroundColor Green
}

Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Review docs/merge-evidence/V07_ISSUES_DONE_EVIDENCE.md" -ForegroundColor Gray
Write-Host "2. Run: npm run repo:verify" -ForegroundColor Gray
Write-Host "3. Run: npm --prefix control-center test" -ForegroundColor Gray
Write-Host "4. Proceed to Package 3 (Git tag + GitHub release)" -ForegroundColor Gray

exit 0
