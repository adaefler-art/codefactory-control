#!/usr/bin/env pwsh
# Apply Migration 049 to Staging - Simplified approach
# Executes SQL commands one by one via ECS exec

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

# SQL commands to execute
$sqlCommands = @(
    "ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS afu9_issues_github_mirror_status_check;",
    "ALTER TABLE afu9_issues ADD CONSTRAINT afu9_issues_github_mirror_status_check CHECK (github_mirror_status IN ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', 'OPEN', 'CLOSED', 'ERROR', 'UNKNOWN'));",
    "INSERT INTO schema_migrations (filename, applied_at) VALUES ('049_fix_github_mirror_status_constraint.sql', NOW()) ON CONFLICT (filename) DO NOTHING;"
)

Write-Host "🚀 Applying Migration 049..." -ForegroundColor Cyan
Write-Host "━" * 60
Write-Host ""

foreach ($sql in $sqlCommands) {
    Write-Host "Executing: $($sql.Substring(0, [Math]::Min(80, $sql.Length)))..." -ForegroundColor Gray
    
    # Create Node.js one-liner to execute SQL
    $nodeCmd = "node -p `"require('pg').Pool`" > /dev/null 2>&1 && node -e `"new (require('pg').Pool)({connectionString:process.env.DATABASE_URL}).query('$sql').then(()=>console.log('OK')).catch(e=>{console.error(e.message);process.exit(1)})`" || echo 'FAILED'"
    
    $result = aws ecs execute-command `
        --cluster $Cluster `
        --task $taskArn `
        --container control-center `
        --command $nodeCmd `
        --interactive `
        --region $Region `
        --profile $Profile 2>&1
    
    if ($LASTEXITCODE -ne 0 -or $result -match "FAILED|Error|error") {
        Write-Host "❌ Command failed" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
    
    Write-Host "  ✅ Success" -ForegroundColor Green
}

Write-Host ""
Write-Host "✅ Migration 049 applied successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Verifying..." -ForegroundColor Cyan

# Verify migration
$verifyCmd = "node -e `"new (require('pg').Pool)({connectionString:process.env.DATABASE_URL}).query('SELECT filename, applied_at FROM schema_migrations WHERE filename LIKE \`'%049%\`' ORDER BY applied_at DESC LIMIT 1').then(r=>console.log(JSON.stringify(r.rows[0]))).catch(e=>console.error(e.message))`""

Write-Host "Checking schema_migrations table..." -ForegroundColor Gray
aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command $verifyCmd `
    --interactive `
    --region $Region `
    --profile $Profile

Write-Host ""
Write-Host "🔄 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Test sync: curl -X POST https://stage.afu-9.com/api/ops/issues/sync" -ForegroundColor Yellow
Write-Host "2. Check diagnostic: https://stage.afu-9.com/api/admin/diagnose-mirror-status-test" -ForegroundColor Yellow
