#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Runs the repo migration runner (scripts/db-migrate.sh) inside an ECS one-off task.

.DESCRIPTION
  This script is intended for staging/prod operations where the database is only reachable
  from inside the VPC (no VPN). It:
  - Resolves ECS cluster/service/taskDefinition + awsvpc networking
  - Starts a one-off Fargate task
  - Overrides the container command to run: bash ./scripts/db-migrate.sh
  - Tails CloudWatch Logs until STOPPED
  - Prints minimal verification output (taskArn/logGroup/logStream/exitCode)

  It does NOT print any secrets. DB credentials come from the task definition's Secrets Manager mappings.

.PARAMETER Env
  Target environment: staging|prod.

.PARAMETER Force
  Required to run in prod.

.PARAMETER MigrationFile
  Optional: run only a single migration file (e.g., 054_intent_issue_authoring_events.sql).
  If omitted, runs all migrations.

.EXAMPLE
  .\scripts\run-db-migrate-ecs.ps1 -Env staging

.EXAMPLE
  .\scripts\run-db-migrate-ecs.ps1 -Env staging -MigrationFile 054_intent_issue_authoring_events.sql

.NOTES
  Requires:
  - aws CLI authenticated
  - ECS task definition uses awsvpc network mode
  - CloudWatch Logs enabled for the target container (for log tail)
#>

[CmdletBinding()]
param(
  [ValidateSet('staging', 'prod')]
  [string]$Env = 'staging',

  [switch]$Force,

  [string]$MigrationFile
)

$ErrorActionPreference = "Stop"

# Ensure Unicode output (CloudWatch logs may contain emoji from shell scripts).
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # best-effort
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found in PATH: $Name"
  }
}

Require-Command aws

if ($Env -eq 'prod' -and -not $Force) {
  throw "Refusing to run prod migrations without -Force."
}

$Region = if ([string]::IsNullOrWhiteSpace($env:AWS_REGION)) { 'eu-central-1' } else { $env:AWS_REGION }
$Cluster = 'afu9-cluster'
$Container = 'control-center'

$ServiceName = switch ($Env) {
  'staging' { 'afu9-control-center-staging' }
  'prod' { 'afu9-control-center' }
}

# Staging: prefer pinned task definition ARN to match the known-good runner.
$TaskDefinitionOverride = switch ($Env) {
  'staging' { 'arn:aws:ecs:eu-central-1:313095875771:task-definition/afu9-control-center:493' }
  default { $null }
}

# Staging fallback network config (used only if service config is missing).
$StagingFallbackSubnets = @('subnet-05db7bb0c4747cb95', 'subnet-0a462328a3577ebcb')
$StagingFallbackSecurityGroups = @('sg-07fab1a096304ccc0')
$StagingFallbackAssignPublicIp = 'DISABLED'

Write-Host "Starting DB migration task..." -ForegroundColor Cyan
Write-Host "- Env:         $Env" -ForegroundColor Gray
Write-Host "- Cluster:     $Cluster" -ForegroundColor Gray
Write-Host "- Service:     $ServiceName" -ForegroundColor Gray
Write-Host "- Region:      $Region" -ForegroundColor Gray
Write-Host "- Container:   $Container" -ForegroundColor Gray
$migrationLabel = if ($MigrationFile) { $MigrationFile } else { '(all)' }
Write-Host "- Migration:   $migrationLabel" -ForegroundColor Gray
Write-Host ""

# Resolve service details (task definition + network config)
$serviceJson = aws ecs describe-services `
  --cluster $Cluster `
  --services $ServiceName `
  --region $Region `
  --output json

$service = ($serviceJson | ConvertFrom-Json).services | Select-Object -First 1
if (-not $service -or $service.status -ne 'ACTIVE') {
  throw "ECS service not found or not ACTIVE: $ServiceName"
}

$taskDefArn = if ($TaskDefinitionOverride) { $TaskDefinitionOverride } else { $service.taskDefinition }
if (-not $taskDefArn) {
  throw 'Could not resolve task definition ARN'
}

$awsvpc = $service.networkConfiguration.awsvpcConfiguration
if (-not $awsvpc -and $Env -eq 'staging') {
  $awsvpc = [pscustomobject]@{
    subnets        = $StagingFallbackSubnets
    securityGroups = $StagingFallbackSecurityGroups
    assignPublicIp = $StagingFallbackAssignPublicIp
  }
}
if (-not $awsvpc) {
  throw 'Service networkConfiguration.awsvpcConfiguration missing; cannot run one-off task safely'
}

$subnets = @($awsvpc.subnets)
$securityGroups = @($awsvpc.securityGroups)
$assignPublicIp = if ([string]::IsNullOrWhiteSpace($awsvpc.assignPublicIp)) { 'DISABLED' } else { $awsvpc.assignPublicIp }

if ($subnets.Count -lt 1 -or $securityGroups.Count -lt 1) {
  throw 'Service awsvpc config missing subnets/securityGroups'
}

$netCfg = "awsvpcConfiguration={subnets=[$($subnets -join ',')],securityGroups=[$($securityGroups -join ',')],assignPublicIp=$assignPublicIp}"

# Resolve CloudWatch Logs config from task definition
$tdJson = aws ecs describe-task-definition `
  --task-definition $taskDefArn `
  --region $Region `
  --output json

$td = ($tdJson | ConvertFrom-Json).taskDefinition
$cd = $td.containerDefinitions | Where-Object { $_.name -eq $Container } | Select-Object -First 1
if (-not $cd) {
  throw "Container '$Container' not found in task definition."
}

$logGroup = $null
$streamPrefix = $null
try {
  $opts = $cd.logConfiguration.options
  $logGroup = $opts.'awslogs-group'
  $streamPrefix = $opts.'awslogs-stream-prefix'
} catch {
  # ignore
}

# Build overrides: keep the same migration command as deploy workflow.
$containerOverrides = [ordered]@{
  name = $Container
  command = @('bash', '-lc', 'bash ./scripts/db-migrate.sh')
  environment = @()
}
if ($MigrationFile) {
  $containerOverrides.environment += [ordered]@{ name = 'AFU9_MIGRATION_FILE'; value = $MigrationFile }
}

$overridesObj = [ordered]@{ containerOverrides = @($containerOverrides) }
$overridesJson = ($overridesObj | ConvertTo-Json -Depth 10 -Compress)

Write-Host 'Running one-off task from task definition:' -ForegroundColor Cyan
Write-Host "- $taskDefArn" -ForegroundColor Gray
Write-Host ""

$taskArn = aws ecs run-task `
  --cluster $Cluster `
  --task-definition $taskDefArn `
  --launch-type FARGATE `
  --network-configuration $netCfg `
  --overrides $overridesJson `
  --region $Region `
  --query 'tasks[0].taskArn' `
  --output text

if (-not $taskArn -or $taskArn -eq 'None') {
  throw 'Failed to start migration task'
}

$taskId = $taskArn.Split('/')[-1]
$logStream = if ($logGroup -and $streamPrefix) { "$streamPrefix/$Container/$taskId" } else { $null }

Write-Host 'Task started:' -ForegroundColor Green
Write-Host "- taskArn:    $taskArn" -ForegroundColor Gray
Write-Host "- logGroup:   $($logGroup ?? '(unknown)')" -ForegroundColor Gray
Write-Host "- logStream:  $($logStream ?? '(unknown)')" -ForegroundColor Gray
Write-Host ""

function Get-TaskState {
  param([string]$TaskArn)

  $taskDescJson = aws ecs describe-tasks `
    --cluster $Cluster `
    --tasks $TaskArn `
    --region $Region `
    --output json

  return (($taskDescJson | ConvertFrom-Json).tasks | Select-Object -First 1)
}

Write-Host 'Tailing logs until task STOPPED...' -ForegroundColor Yellow

$nextToken = $null
$printedAnyLogs = $false
$finalExitCode = $null
$finalStoppedReason = $null

while ($true) {
  if ($logGroup -and $logStream) {
    try {
      $args = @(
        'logs', 'get-log-events',
        '--log-group-name', $logGroup,
        '--log-stream-name', $logStream,
        '--start-from-head',
        '--region', $Region,
        '--output', 'json'
      )

      if ($nextToken) {
        $args += @('--next-token', $nextToken)
      }

      $logsJson = & aws @args 2>$null
      if ($LASTEXITCODE -ne 0) {
        continue
      }
      $logs = $logsJson | ConvertFrom-Json

      foreach ($e in @($logs.events)) {
        $printedAnyLogs = $true
        Write-Host $e.message
      }

      if ($logs.nextForwardToken -and $logs.nextForwardToken -ne $nextToken) {
        $nextToken = $logs.nextForwardToken
      }
    } catch {
      # Stream might not exist yet; keep polling.
    }
  }

  $task = Get-TaskState -TaskArn $taskArn
  if (-not $task) {
    throw "Could not describe task: $taskArn"
  }

  if ($task.lastStatus -eq 'STOPPED') {
    $finalStoppedReason = $task.stoppedReason
    $containerState = $task.containers | Where-Object { $_.name -eq $Container } | Select-Object -First 1
    $finalExitCode = $containerState.exitCode
    break
  }

  Start-Sleep -Seconds 3
}

if (-not $printedAnyLogs -and $logGroup -and $logStream) {
  Write-Host '(No log events captured during tail; you can re-run tail manually if needed.)' -ForegroundColor Yellow
}

Write-Host ""
Write-Host 'Task finished.' -ForegroundColor Cyan
Write-Host "- taskArn:       $taskArn" -ForegroundColor Gray
Write-Host "- logGroup:      $($logGroup ?? '(unknown)')" -ForegroundColor Gray
Write-Host "- logStream:     $($logStream ?? '(unknown)')" -ForegroundColor Gray
Write-Host "- stoppedReason: $($finalStoppedReason ?? '(none)')" -ForegroundColor Gray
Write-Host "- exitCode:      $($finalExitCode ?? 'null')" -ForegroundColor Gray

if ($finalExitCode -ne 0) {
  throw "Migration task failed (exit code $finalExitCode)."
}

Write-Host '✅ DB migrations completed successfully.' -ForegroundColor Green
