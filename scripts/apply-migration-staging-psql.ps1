#!/usr/bin/env pwsh
# Apply Migration 049 to Staging - Using psql approach
# Creates SQL file in container and executes via psql

param(
    [string]$Region = "eu-central-1",
    [string]$Cluster = "afu9-cluster",
    [string]$ServiceName = "afu9-control-center-staging",
    [string]$Profile = "codefactory"
)

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

# Read migration file
$migrationContent = Get-Content "database/migrations/049_fix_github_mirror_status_constraint.sql" -Raw

Write-Host "🚀 Applying Migration 049..." -ForegroundColor Cyan
Write-Host "━" * 60
Write-Host ""

# Create heredoc-style SQL file in container
Write-Host "📄 Creating migration file in container..." -ForegroundColor Gray

# Escape single quotes in SQL for heredoc
$escapedSql = $migrationContent -replace "'", "'\''"

# Create file using cat with heredoc (sh -c required for proper heredoc handling)
$createFileCmd = @"
sh -c 'cat > /tmp/migration049.sql <<EOF
$migrationContent
EOF
echo File_Created'
"@

$result1 = aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command $createFileCmd `
    --interactive `
    --region $Region `
    --profile $Profile 2>&1

if ($result1 -match "File_Created") {
    Write-Host "  ✅ Migration file created" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to create file" -ForegroundColor Red
    Write-Host $result1 -ForegroundColor Red
    exit 1
}

# Execute SQL via psql using environment variables
Write-Host ""
Write-Host "💾 Executing SQL..." -ForegroundColor Gray

# psql connection string from env vars - wrapped in sh -c to properly handle env vars
$psqlCmd = "sh -c 'PGPASSWORD=`$DATABASE_PASSWORD psql -h `$DATABASE_HOST -p `$DATABASE_PORT -U `$DATABASE_USER -d `$DATABASE_NAME -f /tmp/migration049.sql && echo SQL_SUCCESS || echo SQL_FAILED'"

$result2 = aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command $psqlCmd `
    --interactive `
    --region $Region `
    --profile $Profile 2>&1

if ($result2 -match "SQL_SUCCESS") {
    Write-Host "  ✅ Migration executed" -ForegroundColor Green
} else {
    Write-Host "⚠️  SQL execution output:" -ForegroundColor Yellow
    Write-Host $result2 -ForegroundColor Yellow
    
    if ($result2 -match "SQL_FAILED") {
        Write-Host "❌ SQL execution failed!" -ForegroundColor Red
        exit 1
    }
}

# Clean up
Write-Host ""
Write-Host "🧹 Cleaning up..." -ForegroundColor Gray
aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command "rm -f /tmp/migration049.sql" `
    --interactive `
    --region $Region `
    --profile $Profile 2>&1 | Out-Null

Write-Host "✅ Done!" -ForegroundColor Green
Write-Host ""
Write-Host "🔄 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Trigger sync: .\scripts\trigger-staging-sync.ps1" -ForegroundColor Yellow
