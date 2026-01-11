#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Runs the repo migration runner (scripts/db-migrate.sh) inside an ECS one-off task.

.DESCRIPTION
  This script is intended for staging/prod operations where the database is only reachable
  from inside the VPC. It:

  - Reads the ECS service's current task definition + VPC network config
  - Starts a one-off Fargate task using the same task definition
  - Overrides the container command to run ./scripts/db-migrate.sh
  - Waits for completion and prints the exit code
  - Best-effort tails the CloudWatch Logs stream for that task

  It does NOT print any secrets. DB credentials come from the task definition's Secrets Manager mappings.

.PARAMETER Cluster
  ECS cluster name (default: afu9-cluster)

.PARAMETER ServiceName
  ECS service name to clone network config from (default: afu9-control-center-staging)

.PARAMETER Container
  Container name inside the task definition that contains scripts/db-migrate.sh (default: control-center)

.PARAMETER Region
  AWS region (default: eu-central-1)

.PARAMETER Profile
  AWS CLI profile (default: codefactory)

.PARAMETER MigrationFile
  Optional: run only a single migration file (e.g., 055_cost_control.sql). If omitted, runs all.

.EXAMPLE
  .\scripts\run-db-migrate-ecs.ps1

.EXAMPLE
  .\scripts\run-db-migrate-ecs.ps1 -ServiceName afu9-control-center-staging -MigrationFile 055_cost_control.sql

.NOTES
  Requires:
  - aws CLI authenticated
  - ECS task definition uses awsvpc network mode
  - CloudWatch Logs enabled for the target container (for log tail)
#>


[CmdletBinding()]
param(
  [string]$Cluster = "afu9-cluster",
  [string]$ServiceName = "afu9-control-center-staging",
  [string]$Container = "control-center",
  [string]$Region = "eu-central-1",
  [string]$Profile = "codefactory",
  [string]$MigrationFile
)

$ContainerName = $Container

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found in PATH: $Name"
  }
}

Require-Command aws

Write-Host "Starting DB migration task..." -ForegroundColor Cyan
Write-Host "- Cluster:     $Cluster" -ForegroundColor Gray
Write-Host "- Service:     $ServiceName" -ForegroundColor Gray
Write-Host "- Container:   $ContainerName" -ForegroundColor Gray
Write-Host "- Region:      $Region" -ForegroundColor Gray
Write-Host "- Profile:     $Profile" -ForegroundColor Gray
if ($MigrationFile) {
  Write-Host "- Migration:   $MigrationFile" -ForegroundColor Gray
} else {
  Write-Host "- Migration:   (all)" -ForegroundColor Gray
}
Write-Host ""

# Get service details (task definition + network config)
$serviceJson = aws ecs describe-services `
  --cluster $Cluster `
  --services $ServiceName `
  --region $Region `
  --profile $Profile `
  --output json

$service = ($serviceJson | ConvertFrom-Json).services | Select-Object -First 1
if (-not $service -or $service.status -ne "ACTIVE") {
  throw "ECS service not found or not ACTIVE: $ServiceName"
}

$taskDefArn = $service.taskDefinition
if (-not $taskDefArn) {
  throw "Could not resolve service taskDefinition"
}

$awsvpc = $service.networkConfiguration.awsvpcConfiguration
if (-not $awsvpc) {
  throw "Service networkConfiguration.awsvpcConfiguration missing; cannot run one-off task safely"
}

$subnets = @($awsvpc.subnets)
$securityGroups = @($awsvpc.securityGroups)
$assignPublicIp = $awsvpc.assignPublicIp

if ($subnets.Count -lt 1 -or $securityGroups.Count -lt 1) {
  throw "Service awsvpc config missing subnets/securityGroups"
}

$netCfg = "awsvpcConfiguration={{subnets=[{0}],securityGroups=[{1}],assignPublicIp={2}}}" -f (
  ($subnets -join ','),
  ($securityGroups -join ','),
  ($assignPublicIp ?? 'DISABLED')
)

# Build container command
$cmd = "./scripts/db-migrate.sh"
if ($MigrationFile) {
  # Deterministic, safe: run only the requested migration file.
  # Note: The deployed container image may not yet include a db-migrate.sh that supports single-file mode.
  # So we execute the SQL directly via psql (using task definition secrets for DB credentials).
  $cmd = @"
cd /app/control-center

echo "Applying single migration: $MigrationFile"
ls -1 database/migrations/$MigrationFile >/dev/null

psql -v ON_ERROR_STOP=1 -f database/migrations/$MigrationFile

echo "Migration applied successfully: $MigrationFile"
"@
}

$overridesObj = @{
  containerOverrides = @(
    @{
      name    = $ContainerName
      command = @("sh", "-lc", $cmd)
    }
  )
}

$tmpOverrides = Join-Path $env:TEMP ("ecs-migrate-overrides-{0}.json" -f ([Guid]::NewGuid().ToString('N')))
$overridesJson = ($overridesObj | ConvertTo-Json -Depth 10)
[System.IO.File]::WriteAllText(
  $tmpOverrides,
  $overridesJson,
  [System.Text.UTF8Encoding]::new($false)
)

try {
  Write-Host "Running one-off task from task definition:" -ForegroundColor Cyan
  Write-Host "- $taskDefArn" -ForegroundColor Gray
  Write-Host ""

  $taskArn = aws ecs run-task `
    --cluster $Cluster `
    --task-definition $taskDefArn `
    --launch-type FARGATE `
    --network-configuration $netCfg `
    --overrides "file://$tmpOverrides" `
    --region $Region `
    --profile $Profile `
    --query 'tasks[0].taskArn' `
    --output text

  if (-not $taskArn -or $taskArn -eq "None") {
    throw "Failed to start migration task"
  }

  $taskId = $taskArn.Split('/')[-1]
  Write-Host "Task started: $taskArn" -ForegroundColor Green
  Write-Host "Waiting for task to stop..." -ForegroundColor Yellow

  aws ecs wait tasks-stopped `
    --cluster $Cluster `
    --tasks $taskArn `
    --region $Region `
    --profile $Profile

  $taskDescJson = aws ecs describe-tasks `
    --cluster $Cluster `
    --tasks $taskArn `
    --region $Region `
    --profile $Profile `
    --output json

  $task = ($taskDescJson | ConvertFrom-Json).tasks | Select-Object -First 1
  $taskContainer = $task.containers | Where-Object { ($_.name ?? '').Trim().ToLowerInvariant() -eq $ContainerName.Trim().ToLowerInvariant() } | Select-Object -First 1
  $exitCode = if ($null -ne $taskContainer) { $taskContainer.exitCode } else { $null }

  # Eventual consistency: sometimes exitCode is not populated immediately after tasks-stopped.
  if ($null -eq $exitCode) {
    for ($i = 0; $i -lt 15 -and $null -eq $exitCode; $i++) {
      Start-Sleep -Seconds 2
      $taskDescJson = aws ecs describe-tasks `
        --cluster $Cluster `
        --tasks $taskArn `
        --region $Region `
        --profile $Profile `
        --output json

      $task = ($taskDescJson | ConvertFrom-Json).tasks | Select-Object -First 1
      $taskContainer = $task.containers | Where-Object { ($_.name ?? '').Trim().ToLowerInvariant() -eq $ContainerName.Trim().ToLowerInvariant() } | Select-Object -First 1
      $exitCode = if ($null -ne $taskContainer) { $taskContainer.exitCode } else { $null }
    }
  }

  Write-Host "" 
  Write-Host "Task finished." -ForegroundColor Cyan
  Write-Host "- ExitCode: $exitCode" -ForegroundColor Gray

  # Best-effort: tail logs
  try {
    $tdJson = aws ecs describe-task-definition `
      --task-definition $taskDefArn `
      --region $Region `
      --profile $Profile `
      --output json

    $td = ($tdJson | ConvertFrom-Json).taskDefinition
    $cd = $td.containerDefinitions | Where-Object { ($_.name ?? '').Trim().ToLowerInvariant() -eq $ContainerName.Trim().ToLowerInvariant() } | Select-Object -First 1
    $logCfg = $cd.logConfiguration

    $logGroup = $null
    $streamPrefix = $null
    if ($null -ne $logCfg -and $logCfg.logDriver -eq 'awslogs' -and $null -ne $logCfg.options) {
      $logGroup = $logCfg.options.'awslogs-group'
      $streamPrefix = $logCfg.options.'awslogs-stream-prefix'
    }

    if ($logGroup -and $streamPrefix -and $taskId) {
      $streamName = "$streamPrefix/$ContainerName/$taskId"
      Write-Host "" 
      Write-Host "CloudWatch Logs (tail):" -ForegroundColor Cyan
      Write-Host "- Group:  $logGroup" -ForegroundColor Gray
      Write-Host "- Stream: $streamName" -ForegroundColor Gray
      Write-Host "" 

      aws logs tail $logGroup `
        --log-stream-names $streamName `
        --region $Region `
        --profile $Profile `
        --format short `
        --since 15m
    } else {
      Write-Host "(CloudWatch log config missing; skipping log tail)" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "(Could not tail logs: $($_.Exception.Message))" -ForegroundColor Yellow
  }

  if ($null -eq $exitCode) {
    $containerNames = @($task.containers | ForEach-Object { $_.name }) -join ', '
    throw "Migration task finished but exit code was not available for container '$ContainerName'. Containers: $containerNames"
  }

  if ($exitCode -ne 0) {
    $reason = if ($null -ne $taskContainer -and $taskContainer.reason) { $taskContainer.reason } else { $task.stoppedReason }
    throw "Migration task failed (exit code $exitCode). Reason: $reason"
  }

  Write-Host "✅ DB migrations completed successfully." -ForegroundColor Green

} finally {
  Remove-Item $tmpOverrides -ErrorAction SilentlyContinue
}
