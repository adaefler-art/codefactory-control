#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Add AFU9_ADMIN_SUBS to staging task definition

.DESCRIPTION
    Updates the staging ECS task definition to include AFU9_ADMIN_SUBS environment variable
    with the admin canonical ID for privilege checks.

.PARAMETER AdminSub
    The canonical_id (sub) to grant admin privileges. 
    Default: 53b438e2-a081-7015-2a67-998775513d15 (adaefler-art)

.EXAMPLE
    .\scripts\add-admin-sub-staging.ps1
    .\scripts\add-admin-sub-staging.ps1 -AdminSub "your-canonical-id"
#>

param(
    [string]$AdminSub = "53b438e2-a081-7015-2a67-998775513d15",
    [string]$Region = "eu-central-1",
    [string]$Profile = "codefactory"
)

$ErrorActionPreference = "Stop"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Add AFU9_ADMIN_SUBS to Staging" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# 1. Get current staging task definition
Write-Host "1. Fetching current staging task definition..." -ForegroundColor Yellow
$serviceName = "afu9-control-center-staging"
$clusterName = "afu9-cluster"

$currentTaskDefArn = aws ecs describe-services `
    --cluster $clusterName `
    --services $serviceName `
    --region $Region `
    --profile $Profile `
    --query 'services[0].taskDefinition' `
    --output text

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to get service info" -ForegroundColor Red
    exit 1
}

Write-Host "   Current task definition: $currentTaskDefArn" -ForegroundColor Gray

# 2. Download current task definition
Write-Host "2. Downloading task definition..." -ForegroundColor Yellow
$taskDefJson = aws ecs describe-task-definition `
    --task-definition $currentTaskDefArn `
    --region $Region `
    --profile $Profile `
    --output json

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to describe task definition" -ForegroundColor Red
    exit 1
}

$taskDef = $taskDefJson | ConvertFrom-Json

# 3. Extract and modify the task definition
Write-Host "3. Modifying task definition..." -ForegroundColor Yellow

# Find the control-center container (index 3)
$allContainers = $taskDef.taskDefinition.containerDefinitions
$controlCenterContainer = $allContainers | Where-Object { $_.name -eq "control-center" }

if (-not $controlCenterContainer) {
    Write-Host "❌ control-center container not found" -ForegroundColor Red
    exit 1
}

# Check if AFU9_ADMIN_SUBS already exists
$existingAdminSubs = $controlCenterContainer.environment | Where-Object { $_.name -eq "AFU9_ADMIN_SUBS" }

if ($existingAdminSubs) {
    Write-Host "   ⚠️  AFU9_ADMIN_SUBS already exists: $($existingAdminSubs.value)" -ForegroundColor Yellow
    Write-Host "   Current value will be replaced with: $AdminSub" -ForegroundColor Yellow
    $controlCenterContainer.environment = $controlCenterContainer.environment | Where-Object { $_.name -ne "AFU9_ADMIN_SUBS" }
}

# Add the new environment variable
$controlCenterContainer.environment += @{
    name  = "AFU9_ADMIN_SUBS"
    value = $AdminSub
}

Write-Host "   ✅ Added AFU9_ADMIN_SUBS=$AdminSub to control-center container" -ForegroundColor Green

# 4. Create new task definition JSON (remove read-only fields, keep ALL containers)
$newTaskDef = @{
    family                  = $taskDef.taskDefinition.family
    taskRoleArn             = $taskDef.taskDefinition.taskRoleArn
    executionRoleArn        = $taskDef.taskDefinition.executionRoleArn
    networkMode             = $taskDef.taskDefinition.networkMode
    containerDefinitions    = $allContainers
    requiresCompatibilities = $taskDef.taskDefinition.requiresCompatibilities
    cpu                     = $taskDef.taskDefinition.cpu
    memory                  = $taskDef.taskDefinition.memory
}

# Add runtime platform if it exists
if ($taskDef.taskDefinition.runtimePlatform) {
    $newTaskDef.runtimePlatform = $taskDef.taskDefinition.runtimePlatform
}

# 5. Save to temp file
$tempFile = [System.IO.Path]::GetTempFileName()
$newTaskDef | ConvertTo-Json -Depth 10 | Set-Content -Path $tempFile -Encoding UTF8

Write-Host "4. Registering new task definition..." -ForegroundColor Yellow

# 6. Register new task definition
$registerResult = aws ecs register-task-definition `
    --cli-input-json "file://$tempFile" `
    --region $Region `
    --profile $Profile `
    --output json

Remove-Item -Path $tempFile -Force

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to register task definition" -ForegroundColor Red
    exit 1
}

$newTaskDefArn = ($registerResult | ConvertFrom-Json).taskDefinition.taskDefinitionArn
$newRevision = ($registerResult | ConvertFrom-Json).taskDefinition.revision

Write-Host "   ✅ Registered: $newTaskDefArn" -ForegroundColor Green

# 7. Update service
Write-Host "5. Updating staging service..." -ForegroundColor Yellow

$updateResult = aws ecs update-service `
    --cluster $clusterName `
    --service $serviceName `
    --task-definition $newTaskDefArn `
    --region $Region `
    --profile $Profile `
    --force-new-deployment `
    --output json

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to update service" -ForegroundColor Red
    exit 1
}

Write-Host "   ✅ Service updated" -ForegroundColor Green

# 8. Summary
Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Deployment Complete" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Task Definition: $newTaskDefArn" -ForegroundColor Gray
Write-Host "Admin Sub: $AdminSub" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Wait for deployment to complete (~2 minutes)" -ForegroundColor White
Write-Host "2. Test admin endpoint:" -ForegroundColor White
Write-Host "   curl https://stage.afu-9.com/api/whoami" -ForegroundColor Gray
Write-Host "3. Test bulk operation:" -ForegroundColor White
Write-Host "   curl https://stage.afu-9.com/api/ops/db/issues/preview-set-done" -ForegroundColor Gray
Write-Host ""
