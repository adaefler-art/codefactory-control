#!/usr/bin/env pwsh
# Apply Migration 049 to Staging - CORRECTED VERSION
# Uses DATABASE_HOST/PORT/etc instead of DATABASE_URL

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
    
    # Properly escaped SQL for node -e
    $escapedSql = $sql -replace "'", "'\''"  # Escape single quotes for SQL
    
    # Create Node.js one-liner using individual env vars (NOT DATABASE_URL)
    # Using template literals (backticks) to avoid quote issues
    $nodeScript = "const{Pool}=require('pg');new Pool({host:process.env.DATABASE_HOST,port:parseInt(process.env.DATABASE_PORT||'5432'),database:process.env.DATABASE_NAME||'afu9',user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,ssl:{rejectUnauthorized:false}}).query('$escapedSql').then(()=>console.log('OK')).catch(e=>{console.error('ERROR:',e.message);process.exit(1)}).finally(()=>process.exit(0))"
    
    $nodeCmd = "node -e `"$nodeScript`""
    
    $result = aws ecs execute-command `
        --cluster $Cluster `
        --task $taskArn `
        --container control-center `
        --command $nodeCmd `
        --interactive `
        --region $Region `
        --profile $Profile 2>&1
    
    # Check for errors in output
    if ($LASTEXITCODE -ne 0 -or $result -match "ERROR:|SyntaxError|ReferenceError|TypeError|connect ECONNREFUSED") {
        Write-Host "❌ Command failed" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        exit 1
    }
    
    # Check for "OK" in output
    if ($result -notmatch "OK") {
        Write-Host "⚠️  No 'OK' confirmation received" -ForegroundColor Yellow
        Write-Host $result -ForegroundColor Yellow
    } else {
        Write-Host "  ✅ Success" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "✅ Migration 049 applied successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Verifying..." -ForegroundColor Cyan

# Verify migration using same pattern
$verifyScript = "const{Pool}=require('pg');new Pool({host:process.env.DATABASE_HOST,port:parseInt(process.env.DATABASE_PORT||'5432'),database:process.env.DATABASE_NAME||'afu9',user:process.env.DATABASE_USER,password:process.env.DATABASE_PASSWORD,ssl:{rejectUnauthorized:false}}).query('SELECT filename, applied_at FROM schema_migrations WHERE filename LIKE ''%049%'' ORDER BY applied_at DESC LIMIT 1').then(r=>console.log(JSON.stringify(r.rows[0]))).catch(e=>console.error(e.message)).finally(()=>process.exit(0))"

Write-Host "Checking schema_migrations table..." -ForegroundColor Gray

aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command "node -e `"$verifyScript`"" `
    --interactive `
    --region $Region `
    --profile $Profile

Write-Host ""
Write-Host "🔄 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Trigger sync: .\scripts\trigger-staging-sync.ps1" -ForegroundColor Yellow
Write-Host "2. Query status: .\scripts\query-i691-status.ps1" -ForegroundColor Yellow
