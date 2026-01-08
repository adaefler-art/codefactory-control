# Seed schema_migrations ledger on staging database
# This is a ONE-TIME operation to bootstrap the ledger for existing schema

param(
    [string]$Cluster = "afu9-cluster",
    [string]$Service = "afu9-control-center-staging",
    [string]$TaskDef = "afu9-control-center-staging",
    [string]$Profile = "codefactory",
    [string]$Region = "eu-central-1"
)

Write-Host "🔧 Preparing to seed schema_migrations ledger on staging..." -ForegroundColor Cyan
Write-Host ""

# Get network configuration from the existing service
Write-Host "📡 Fetching network configuration from service..." -ForegroundColor Yellow
$networkConfig = aws ecs describe-services `
    --cluster $Cluster `
    --services $Service `
    --region $Region `
    --profile $Profile `
    --query 'services[0].networkConfiguration.awsvpcConfiguration' `
    --output json | ConvertFrom-Json

if (-not $networkConfig) {
    Write-Host "❌ Could not retrieve network configuration from service" -ForegroundColor Red
    exit 1
}

$subnets = $networkConfig.subnets -join ","
$securityGroups = $networkConfig.securityGroups -join ","
$assignPublicIp = if ($networkConfig.assignPublicIp) { $networkConfig.assignPublicIp } else { "DISABLED" }

Write-Host "   Subnets: $subnets" -ForegroundColor Gray
Write-Host "   Security Groups: $securityGroups" -ForegroundColor Gray
Write-Host "   Assign Public IP: $assignPublicIp" -ForegroundColor Gray
Write-Host ""

# Get latest task definition revision
Write-Host "📋 Getting latest task definition revision..." -ForegroundColor Yellow
$latestRevision = aws ecs describe-task-definition `
    --task-definition $TaskDef `
    --region $Region `
    --profile $Profile `
    --query 'taskDefinition.revision' `
    --output text

$taskDefArn = "${TaskDef}:${latestRevision}"
Write-Host "   Using: $taskDefArn" -ForegroundColor Gray
Write-Host ""

Write-Host "⚠️  WARNING: This will populate schema_migrations ledger with ALL migration files" -ForegroundColor Yellow
Write-Host "   Only run this ONCE when the database schema exists but the ledger is empty" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Continue? (yes/no)"

if ($confirm -ne "yes") {
    Write-Host "Aborted." -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "🚀 Launching seeding task..." -ForegroundColor Cyan

# Run one-off task with seed-migration-ledger.sh command
$taskArn = aws ecs run-task `
    --cluster $Cluster `
    --task-definition $taskDefArn `
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$securityGroups],assignPublicIp=$assignPublicIp}" `
    --overrides '{\"containerOverrides\":[{\"name\":\"control-center\",\"command\":[\"bash\",\"-lc\",\"bash ./scripts/seed-migration-ledger.sh\"]}]}' `
    --region $Region `
    --profile $Profile `
    --launch-type FARGATE `
    --query 'tasks[0].taskArn' `
    --output text

if (-not $taskArn) {
    Write-Host "❌ Failed to launch task" -ForegroundColor Red
    exit 1
}

$taskId = $taskArn.Split("/")[-1]
Write-Host "✅ Task launched: $taskId" -ForegroundColor Green
Write-Host "   ARN: $taskArn" -ForegroundColor Gray
Write-Host ""

Write-Host "⏳ Waiting for task to complete (polling every 10s)..." -ForegroundColor Yellow

$maxWait = 180  # 3 minutes
$elapsed = 0

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 10
    $elapsed += 10
    
    $taskStatus = aws ecs describe-tasks `
        --cluster $Cluster `
        --tasks $taskArn `
        --region $Region `
        --profile $Profile `
        --query 'tasks[0].lastStatus' `
        --output text
    
    Write-Host "   Status: $taskStatus (${elapsed}s elapsed)" -ForegroundColor Gray
    
    if ($taskStatus -eq "STOPPED") {
        break
    }
}

if ($taskStatus -ne "STOPPED") {
    Write-Host "⚠️  Task still running after ${maxWait}s" -ForegroundColor Yellow
    Write-Host "   Task ARN: $taskArn" -ForegroundColor Gray
    Write-Host "   Check logs manually or wait longer" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "📋 Task stopped. Fetching details..." -ForegroundColor Cyan

# Get exit code and stopped reason
$taskDetails = aws ecs describe-tasks `
    --cluster $Cluster `
    --tasks $taskArn `
    --region $Region `
    --profile $Profile `
    --output json | ConvertFrom-Json

$exitCode = $taskDetails.tasks[0].containers[0].exitCode
$stoppedReason = $taskDetails.tasks[0].stoppedReason

Write-Host "   Exit code: $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
Write-Host "   Stopped reason: $stoppedReason" -ForegroundColor Gray
Write-Host ""

# Fetch logs
Write-Host "📜 Fetching task logs..." -ForegroundColor Cyan
$logGroupName = "Afu9EcsStack-ControlCenterLogGroupA723FDE1-dgUfZW6W84Hs"
$logStreamName = "control-center/control-center/$taskId"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
aws logs tail $logGroupName `
    --log-stream-names $logStreamName `
    --profile $Profile `
    --region $Region `
    --format short `
    --since 10m 2>&1 | Out-String

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "✅ Schema migrations ledger seeded successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Retry the failed deployment (will now skip existing migrations)" -ForegroundColor White
    Write-Host "  2. Future migrations will be tracked automatically" -ForegroundColor White
} else {
    Write-Host "❌ Seeding failed (exit code: $exitCode)" -ForegroundColor Red
    Write-Host "   Review logs above for details" -ForegroundColor Yellow
}
