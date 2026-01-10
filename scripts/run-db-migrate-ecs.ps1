#!/usr/bin/env pwsh
<
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
>

[CmdletBinding()]
param(
  [string]$Cluster = "afu9-cluster",
  [string]$ServiceName = "afu9-control-center-staging",
  [string]$Container = "control-center",
  [string]$Region = "eu-central-1",
  [string]$Profile = "codefactory",
  [string]$MigrationFile
)

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
Write-Host "- Container:   $Container" -ForegroundColor Gray
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

$netCfg = "awsvpcConfiguration={subnets=[{0}],securityGroups=[{1}],assignPublicIp={2}}" -f (
  ($subnets -join ','),
  ($securityGroups -join ','),
  ($assignPublicIp ?? 'DISABLED')
)

# Build container command
$cmd = "./scripts/db-migrate.sh"
if ($MigrationFile) {
  # db-migrate.sh accepts a single file only when called from control-center npm, but the shell runner
  # always runs all migrations. To keep behavior deterministic and simple, we filter at the shell level.
  $cmd = "set -euo pipefail; cd /app/control-center; ls -1 database/migrations/{0} >/dev/null; ./scripts/db-migrate.sh" -f $MigrationFile
}

$overridesObj = @{
  containerOverrides = @(
    @{
      name    = $Container
      command = @("sh", "-lc", $cmd)
    }
  )
}

$tmpOverrides = Join-Path $env:TEMP ("ecs-migrate-overrides-{0}.json" -f ([Guid]::NewGuid().ToString('N')))
($overridesObj | ConvertTo-Json -Depth 10) | Out-File -Encoding UTF8 $tmpOverrides

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
  $container = $task.containers | Where-Object { $_.name -eq $Container } | Select-Object -First 1
  $exitCode = $container.exitCode

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
    $cd = $td.containerDefinitions | Where-Object { $_.name -eq $Container } | Select-Object -First 1
    $opts = $cd.logConfiguration.options

    $logGroup = $opts.'awslogs-group'
    $streamPrefix = $opts.'awslogs-stream-prefix'

    if ($logGroup -and $streamPrefix) {
      $streamName = "$streamPrefix/$Container/$taskId"
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
      Write-Host "(Log config not found on task definition; skipping log tail)" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "(Could not tail logs: $($_.Exception.Message))" -ForegroundColor Yellow
  }

  if ($exitCode -ne 0) {
    throw "Migration task failed (exit code $exitCode). See logs above."
  }

  Write-Host "✅ DB migrations completed successfully." -ForegroundColor Green

} finally {
  Remove-Item $tmpOverrides -ErrorAction SilentlyContinue
}
