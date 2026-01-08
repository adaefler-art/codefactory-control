# Quick fix: Add 001_initial_schema.sql to migration ledger
# This allows the migration script to skip it since the schema already exists

Write-Host "🔧 Seeding migration ledger with existing schema..." -ForegroundColor Cyan
Write-Host ""

# Create overrides JSON
$overrides = @'
{
  "containerOverrides": [{
    "name": "control-center",
    "command": [
      "sh", "-c",
      "psql \"$DATABASE_URL\" -c \"INSERT INTO schema_migrations (filename, sha256, applied_at) VALUES ('001_initial_schema.sql', 'existing-schema', NOW()) ON CONFLICT (filename) DO UPDATE SET sha256 = 'existing-schema';\" && psql \"$DATABASE_URL\" -c \"SELECT filename, LEFT(sha256, 20) as hash, applied_at FROM schema_migrations ORDER BY filename;\""
    ]
  }]
}
'@

$overrides | Out-File -Encoding UTF8 seed-fix.json

Write-Host "Launching seed task..." -ForegroundColor Yellow
$taskArn = aws ecs run-task `
  --cluster afu9-cluster `
  --task-definition afu9-control-center:443 `
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-05db7bb0c4747cb95,subnet-0a462328a3577ebcb],securityGroups=[sg-07fab1a096304ccc0],assignPublicIp=DISABLED}' `
  --overrides file://seed-fix.json `
  --region eu-central-1 `
  --profile codefactory `
  --launch-type FARGATE `
  --query 'tasks[0].taskArn' `
  --output text

if (-not $taskArn) {
    Write-Host "❌ Failed to launch task" -ForegroundColor Red
    exit 1
}

$taskId = $taskArn.Split('/')[-1]
Write-Host "✅ Task launched: $taskId" -ForegroundColor Green
Write-Host ""
Write-Host "⏳ Waiting 30 seconds for task to complete..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

Write-Host ""
Write-Host "📋 Fetching results..." -ForegroundColor Cyan
Write-Host ""

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
aws logs tail Afu9EcsStack-ControlCenterLogGroupA723FDE1-dgUfZW6W84Hs `
  --log-stream-names "control-center/control-center/$taskId" `
  --profile codefactory `
  --region eu-central-1 `
  --format short `
  --since 5m

Write-Host ""
Write-Host "✅ Done! Retry the deployment now." -ForegroundColor Green
Write-Host "   The migration script will skip 001_initial_schema.sql" -ForegroundColor White

# Cleanup
Remove-Item seed-fix.json -ErrorAction SilentlyContinue
