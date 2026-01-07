#!/usr/bin/env pwsh
# Apply Migration 049 to Staging Database via ECS Exec
# Issue #624: GitHub Mirror Status Persistierung

param(
    [string]$Region = "eu-central-1",
    [string]$Cluster = "afu9-cluster",
    [string]$ServiceName = "afu9-control-center-staging",
    [string]$Profile = "codefactory"
)

Write-Host "🔍 Finding running ECS task..." -ForegroundColor Cyan

# Get running task ARN
$taskArn = aws ecs list-tasks `
    --cluster $Cluster `
    --service-name $ServiceName `
    --desired-status RUNNING `
    --region $Region `
    --profile $Profile `
    --query 'taskArns[0]' `
    --output text

if ([string]::IsNullOrEmpty($taskArn) -or $taskArn -eq "None") {
    Write-Host "❌ No running tasks found in service $ServiceName" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Found task: $taskArn" -ForegroundColor Green

# Extract short task ID
$taskId = $taskArn.Split('/')[-1]
Write-Host "📋 Task ID: $taskId" -ForegroundColor Blue

Write-Host "`n🚀 Applying Migration 049..." -ForegroundColor Cyan
Write-Host "━" * 60

# Step 1: Create migration SQL in container
Write-Host "Step 1: Creating migration SQL file in container..." -ForegroundColor Gray

$createFileCmd = "cat > /tmp/migration_049.sql << 'EOFMIGRATION'
ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS afu9_issues_github_mirror_status_check;
ALTER TABLE afu9_issues ADD CONSTRAINT afu9_issues_github_mirror_status_check CHECK (github_mirror_status = ANY (ARRAY['UNKNOWN'::text, 'NOT_PERSISTED'::text, 'PERSIST_SUCCESS'::text, 'PERSIST_FAILED'::text, 'RETRY_EXHAUSTED'::text, 'VALIDATION_ERROR'::text, 'OPEN'::text, 'CLOSED'::text, 'ERROR'::text]));
INSERT INTO schema_migrations (filename, applied_at) VALUES ('049_fix_github_mirror_status_constraint.sql', NOW()) ON CONFLICT (filename) DO NOTHING;
EOFMIGRATION"

aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command "/bin/sh -c `"$createFileCmd`"" `
    --interactive `
    --region $Region `
    --profile $Profile | Out-Null

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to create migration file" -ForegroundColor Red
    exit 1
}

# Step 2: Execute migration using Node.js
Write-Host "Step 2: Executing migration..." -ForegroundColor Gray

$command = "node -e `"const{Pool}=require('pg');const fs=require('fs');const pool=new Pool({connectionString:process.env.DATABASE_URL});const sql=fs.readFileSync('/tmp/migration_049.sql','utf8');pool.query(sql).then(()=>{console.log('✅ Migration 049 applied');process.exit(0);}).catch(e=>{console.error('❌',e.message);process.exit(1);});`""

Write-Host "Executing: $command" -ForegroundColor Gray

aws ecs execute-command `
    --cluster $Cluster `
    --task $taskArn `
    --container control-center `
    --command "/bin/sh -c `"$command`"" `
    --interactive `
    --region $Region `
    --profile $Profile

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Migration applied successfully!" -ForegroundColor Green
    Write-Host "`n📊 Verifying migration..." -ForegroundColor Cyan
    
    # Verify migration was applied using Node.js
    $verifyCommand = "cd /app && node -e `"const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL }); pool.query('SELECT filename, applied_at FROM schema_migrations WHERE filename LIKE \`'%049%\`' ORDER BY applied_at DESC LIMIT 1').then(r => { console.log(r.rows[0] || 'Not found'); process.exit(0); }).catch(e => { console.error(e.message); process.exit(1); });`""
    
    aws ecs execute-command `
        --cluster $Cluster `
        --task $taskArn `
        --container control-center `
        --command "/bin/sh -c `"$verifyCommand`"" `
        --interactive `
        --region $Region `
        --profile $Profile
    
    Write-Host "`n🔄 Triggering sync to test fix..." -ForegroundColor Cyan
    Write-Host "Run: curl -X POST https://stage.afu-9.com/api/ops/issues/sync -H 'x-afu9-sub: admin'" -ForegroundColor Yellow
    
    Write-Host "`n🧪 Run diagnostic to verify:" -ForegroundColor Cyan
    Write-Host "Browser: https://stage.afu-9.com/api/admin/diagnose-mirror-status-test" -ForegroundColor Yellow
} else {
    Write-Host "`n❌ Migration failed!" -ForegroundColor Red
    Write-Host "Check ECS task logs for details" -ForegroundColor Yellow
    exit 1
}
