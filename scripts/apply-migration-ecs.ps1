#!/usr/bin/env pwsh
<
.SYNOPSIS
  Applies a single SQL migration file to a remote database by running psql inside an ECS task (via ECS Exec).

.DESCRIPTION
  - Fetches the first running task for the specified ECS service
  - Uploads the SQL file content via base64 into the container (/tmp/migration.sql)
  - Executes the file with psql using DATABASE_* env vars provided to the container

  This script does NOT print secrets. It relies on DATABASE_PASSWORD existing in the container env.

.PARAMETER MigrationFile
  Path to a .sql file in the repo (default: database/migrations/055_cost_control.sql)

.PARAMETER Cluster
  ECS cluster name (default: afu9-cluster)

.PARAMETER ServiceName
  ECS service name (default: afu9-control-center-staging)

.PARAMETER Container
  Container name inside the task that has psql + DB env vars (default: control-center)

.PARAMETER Region
  AWS region (default: eu-central-1)

.PARAMETER Profile
  AWS CLI profile (default: codefactory)

.EXAMPLE
  .\scripts\apply-migration-ecs.ps1 -MigrationFile database/migrations/055_cost_control.sql

.NOTES
  Requires:
  - aws CLI authenticated (and SSM Session Manager plugin)
  - ECS Exec enabled on the task
  - base64 + sh available in the container
  - psql available in the container
>

[CmdletBinding()]
param(
  [string]$MigrationFile = "database/migrations/055_cost_control.sql",
  [string]$Cluster = "afu9-cluster",
  [string]$ServiceName = "afu9-control-center-staging",
  [string]$Container = "control-center",
  [string]$Region = "eu-central-1",
  [string]$Profile = "codefactory"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $MigrationFile)) {
  throw "Migration file not found: $MigrationFile"
}

Write-Host "Applying migration via ECS Exec..." -ForegroundColor Cyan
Write-Host "- File:      $MigrationFile" -ForegroundColor Gray
Write-Host "- Cluster:   $Cluster" -ForegroundColor Gray
Write-Host "- Service:   $ServiceName" -ForegroundColor Gray
Write-Host "- Container: $Container" -ForegroundColor Gray
Write-Host "- Region:    $Region" -ForegroundColor Gray
Write-Host "- Profile:   $Profile" -ForegroundColor Gray
Write-Host "" 

$taskArn = (aws ecs list-tasks `
  --cluster $Cluster `
  --service-name $ServiceName `
  --region $Region `
  --profile $Profile `
  --query 'taskArns[0]' `
  --output text)

if (-not $taskArn -or $taskArn -eq "None") {
  throw "No running task found for service '$ServiceName' in cluster '$Cluster'"
}

Write-Host "Task: $taskArn" -ForegroundColor Gray
Write-Host "" 

$sql = Get-Content $MigrationFile -Raw
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sql))

# Remote command:
# - decode SQL into /tmp/migration.sql
# - execute with psql (non-interactive) using DATABASE_* env vars + PGPASSWORD
$remote = 'sh -lc "' +
  'echo ' + $b64 + ' | base64 -d > /tmp/migration.sql && ' +
  'PGPASSWORD=\"$DATABASE_PASSWORD\" ' +
  'psql -P pager=off -h \"$DATABASE_HOST\" -p \"$DATABASE_PORT\" -U \"$DATABASE_USER\" -d \"$DATABASE_NAME\" ' +
  '-v ON_ERROR_STOP=1 -f /tmp/migration.sql' +
'"'

aws ecs execute-command `
  --interactive `
  --cluster $Cluster `
  --task $taskArn `
  --container $Container `
  --region $Region `
  --profile $Profile `
  --command $remote

Write-Host "" 
Write-Host "✅ Migration applied (psql returned success)." -ForegroundColor Green
