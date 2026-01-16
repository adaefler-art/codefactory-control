#!/usr/bin/env pwsh
<#!
.SYNOPSIS
  Runs a DB “reality check” inside an ECS one-off task (no VPN required).

.DESCRIPTION
  Executes scripts/db-reality-check.sh inside the control-center container to print:
  - current_database/current_schema/search_path
  - presence of intent_issue_authoring_events (qualified and unqualified)
  - scan for the table across schemas
  - presence of afu9_migrations_ledger and entry for 054 (if ledger exists)

  Uses `aws ecs run-task --cli-input-json` to avoid quoting/parsing pitfalls.

.PARAMETER Env
  Target environment: staging|prod.

.PARAMETER Force
  Required to run in prod.

.EXAMPLE
  .\scripts\run-db-reality-check-ecs.ps1 -Env staging

.NOTES
  Requires:
  - aws CLI authenticated
  - ECS task definition uses awsvpc network mode
  - CloudWatch Logs enabled for the target container
#>

[CmdletBinding()]
param(
  [ValidateSet('staging', 'prod')]
  [string]$Env = 'staging',

  [switch]$Force
)

$ErrorActionPreference = 'Stop'

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
  throw 'Refusing to run prod DB reality check without -Force.'
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

Write-Host 'Starting DB reality-check task...' -ForegroundColor Cyan
Write-Host "- Env:       $Env" -ForegroundColor Gray
Write-Host "- Cluster:   $Cluster" -ForegroundColor Gray
Write-Host "- Service:   $ServiceName" -ForegroundColor Gray
Write-Host "- Region:    $Region" -ForegroundColor Gray
Write-Host "- Container: $Container" -ForegroundColor Gray
Write-Host ''

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

$containerOverrides = [ordered]@{
  name = $Container
  command = @('bash', '-lc', 'bash ./scripts/db-reality-check.sh')
}

$cliJsonObj = [ordered]@{
  cluster = $Cluster
  taskDefinition = $taskDefArn
  launchType = 'FARGATE'
  networkConfiguration = [ordered]@{
    awsvpcConfiguration = [ordered]@{
      subnets = $subnets
      securityGroups = $securityGroups
      assignPublicIp = $assignPublicIp
    }
  }
  overrides = [ordered]@{
    containerOverrides = @($containerOverrides)
  }
}

$cliJson = ($cliJsonObj | ConvertTo-Json -Depth 20 -Compress)

Write-Host 'Running one-off task from task definition:' -ForegroundColor Cyan
Write-Host "- $taskDefArn" -ForegroundColor Gray
Write-Host ''

$taskArn = aws ecs run-task `
  --cli-input-json $cliJson `
  --region $Region `
  --query 'tasks[0].taskArn' `
  --output text

if (-not $taskArn -or $taskArn -eq 'None') {
  throw 'Failed to start reality-check task'
}

$taskId = $taskArn.Split('/')[-1]
$logStream = if ($logGroup -and $streamPrefix) { "$streamPrefix/$Container/$taskId" } else { $null }

Write-Host 'Task started:' -ForegroundColor Green
Write-Host "- taskArn:   $taskArn" -ForegroundColor Gray
Write-Host "- logGroup:  $($logGroup ?? '(unknown)')" -ForegroundColor Gray
Write-Host "- logStream: $($logStream ?? '(unknown)')" -ForegroundColor Gray
Write-Host ''

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
    try {
      $container = $task.containers | Where-Object { $_.name -eq $Container } | Select-Object -First 1
      if ($container -and $container.exitCode -ne $null) {
        $finalExitCode = $container.exitCode
      }
      $finalStoppedReason = $task.stoppedReason
    } catch {
      # ignore
    }
    break
  }

  Start-Sleep -Seconds 2
}

Write-Host ''
Write-Host 'Task finished:' -ForegroundColor Cyan
Write-Host "- taskArn:       $taskArn" -ForegroundColor Gray
Write-Host "- exitCode:      $($finalExitCode ?? '(unknown)')" -ForegroundColor Gray
Write-Host "- stoppedReason: $($finalStoppedReason ?? '(unknown)')" -ForegroundColor Gray
