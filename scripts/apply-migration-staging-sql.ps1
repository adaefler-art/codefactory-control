#!/usr/bin/env pwsh
# Apply Migration 049 via direct SQL execution
# Requires: Port forward or VPN access to RDS

param(
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$MigrationFile = "database/migrations/049_fix_github_mirror_status_constraint.sql"
)

if ([string]::IsNullOrEmpty($DatabaseUrl)) {
    Write-Host "❌ DATABASE_URL not set!" -ForegroundColor Red
    Write-Host "Set via: `$env:DATABASE_URL = 'postgresql://user:pass@host:5432/db'" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $MigrationFile)) {
    Write-Host "❌ Migration file not found: $MigrationFile" -ForegroundColor Red
    exit 1
}

Write-Host "🔍 Migration file: $MigrationFile" -ForegroundColor Cyan
Write-Host "🔗 Database: $($DatabaseUrl.Substring(0, [Math]::Min(50, $DatabaseUrl.Length)))..." -ForegroundColor Cyan

Write-Host "`n⚠️  WARNING: This will modify the staging database!" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to cancel, or any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Write-Host "`n🚀 Applying migration..." -ForegroundColor Green

try {
    # Execute migration SQL
    $result = & psql $DatabaseUrl -f $MigrationFile 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Migration applied successfully!" -ForegroundColor Green
        Write-Host $result -ForegroundColor Gray
        
        # Verify constraint
        Write-Host "`n📊 Verifying CHECK constraint..." -ForegroundColor Cyan
        $verifyResult = & psql $DatabaseUrl -t -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'afu9_issues_github_mirror_status_check';" 2>&1
        
        if ($verifyResult -match "OPEN" -and $verifyResult -match "CLOSED" -and $verifyResult -match "ERROR") {
            Write-Host "✅ Constraint now includes OPEN, CLOSED, ERROR" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Constraint verification failed:" -ForegroundColor Yellow
            Write-Host $verifyResult -ForegroundColor Gray
        }
        
    } else {
        Write-Host "❌ Migration failed!" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n🧪 Next steps:" -ForegroundColor Cyan
Write-Host "1. Test sync: curl -X POST https://stage.afu-9.com/api/ops/issues/sync -H 'x-afu9-sub: admin'" -ForegroundColor Yellow
Write-Host "2. Verify: https://stage.afu-9.com/api/admin/diagnose-mirror-status-test" -ForegroundColor Yellow
