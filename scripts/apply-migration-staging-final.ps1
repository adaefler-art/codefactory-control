#!/usr/bin/env pwsh
#Requires -Version 7.0

<#
.SYNOPSIS
    Apply Migration 049 to Staging Database
    
.DESCRIPTION
    Applies the github_mirror_status constraint fix to staging database via ECS Exec.
    Uses psql with DATABASE_HOST/PORT/USER/PASSWORD environment variables.
    
.EXAMPLE
    .\scripts\apply-migration-staging-final.ps1
#>

param(
    [string]$Region = "eu-central-1",
    [string]$Cluster = "afu9-cluster",
    [string]$ServiceName = "afu9-control-center-staging",
    [string]$Profile = "codefactory"
)

$ErrorActionPreference = 'Stop'

Write-Host "🔍 Finding running ECS task..." -ForegroundColor Cyan

$taskArn = aws ecs list-tasks `
    --cluster $Cluster `
    --service-name $ServiceName `
    --desired-status RUNNING `
    --region $Region `
    --profile $Profile `
    --query 'taskArns[0]' `
    --output text

if ([string]::IsNullOrEmpty($taskArn) -or $taskArn -eq "None") {
    Write-Host "❌ No running tasks found" -ForegroundColor Red
    exit 1
}

$taskId = $taskArn.Split('/')[-1]
Write-Host "✅ Task: $taskId" -ForegroundColor Green
Write-Host ""

# SQL commands from migration 049
$sqlCommands = @(
    @{
        Name = "Drop old constraint"
        SQL = "ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS afu9_issues_github_mirror_status_check;"
    },
    @{
        Name = "Add new constraint with OPEN/CLOSED/ERROR"
        SQL = "ALTER TABLE afu9_issues ADD CONSTRAINT afu9_issues_github_mirror_status_check CHECK (github_mirror_status IN ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'OPEN', 'CLOSED', 'ERROR', 'UNKNOWN'));"
    },
    @{
        Name = "Update column comment"
        SQL = "COMMENT ON COLUMN afu9_issues.github_mirror_status IS 'Mapped GitHub status: TODO, IN_PROGRESS, IN_REVIEW, DONE, BLOCKED, OPEN, CLOSED, ERROR, or UNKNOWN (State Model v1)';"
    }
)

Write-Host "🚀 Applying Migration 049..." -ForegroundColor Cyan
Write-Host "━" * 80
Write-Host ""

$successCount = 0
foreach ($cmd in $sqlCommands) {
    Write-Host "Executing: $($cmd.Name)..." -ForegroundColor Gray
    
    # Escape SQL for shell: single quotes for SQL, escape them as '\''
    $sqlEscaped = $cmd.SQL -replace "'", "'\''" -replace '"', '\"'
    
    # Use sh -c with printf to handle SQL properly
    $shellCmd = "sh -c 'export PGPASSWORD=`$(printenv DATABASE_PASSWORD); printf `"$sqlEscaped`" | psql -h `$(printenv DATABASE_HOST) -p `$(printenv DATABASE_PORT) -U `$(printenv DATABASE_USER) -d `$(printenv DATABASE_NAME) && echo __SUCCESS__ || echo __FAILED__'"
    
    $result = aws ecs execute-command `
        --cluster $Cluster `
        --task $taskArn `
        --container control-center `
        --command $shellCmd `
        --interactive `
        --region $Region `
        --profile $Profile 2>&1
    
    if ($result -match "__SUCCESS__") {
        Write-Host "  ✅ Success" -ForegroundColor Green
        $successCount++
    } elseif ($result -match "__FAILED__") {
        Write-Host "  ❌ Failed" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    } else {
        Write-Host "  ⚠️  Unexpected output:" -ForegroundColor Yellow
        Write-Host $result -ForegroundColor Yellow
    }
}

Write-Host ""
if ($successCount -eq $sqlCommands.Count) {
    Write-Host "✅ Migration 049 applied successfully! ($successCount/$($sqlCommands.Count) commands)" -ForegroundColor Green
} else {
    Write-Host "⚠️  Migration partially applied ($successCount/$($sqlCommands.Count) commands)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🔄 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Trigger sync:  .\scripts\trigger-staging-sync.ps1" -ForegroundColor Yellow
Write-Host "2. Verify sync response shows:" -ForegroundColor Yellow
Write-Host "   - statusPersistOk: 67" -ForegroundColor Gray
Write-Host "   - statusPersistFailed: 0" -ForegroundColor Gray
