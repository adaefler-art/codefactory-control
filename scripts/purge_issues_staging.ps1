<#
.SYNOPSIS
  Purge old/duplicate AFU-9 issues from the STAGING database (STAGING ONLY).

.DESCRIPTION
  This script is intentionally defensive:
  - Environment gate: requires AFU9_STAGE=staging OR NODE_ENV=staging
  - Default mode is DryRun (no deletes)
  - Delete mode requires -Confirm
  - Uses repo DB connection environment variables (DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD, ...)

.PARAMETER Mode
  DryRun | Delete

.PARAMETER OlderThanDays
  Select issues older than N days (based on created_at). Default: 14.

.PARAMETER Source
  Optional filter for source column. Note: DB schema enforces source='afu9' in most environments.

.PARAMETER Status
  Optional filter for status column.

.PARAMETER TitleContains
  Optional case-insensitive substring match against title.

.PARAMETER PublicId
  Optional 8-hex public id (derived from UUID prefix).

.PARAMETER Id
  Optional UUID.

.PARAMETER Confirm
  Required switch for Mode=Delete.
#>

[CmdletBinding()]
param(
  [ValidateSet('DryRun','Delete')]
  [string]$Mode = 'DryRun',

  [int]$OlderThanDays = 14,

  [string]$Source = 'afu9',

  [string]$Status,

  [string]$TitleContains,

  [string]$PublicId,

  [string]$Id,

  [switch]$Confirm
)

$ErrorActionPreference = 'Stop'

function Assert-StagingGate {
  $stage = ([string]$env:AFU9_STAGE).Trim()
  $nodeEnv = ([string]$env:NODE_ENV).Trim()

  if ($stage -ne 'staging' -and $nodeEnv -ne 'staging') {
    throw "Refusing to run: STAGING gate not satisfied. Set AFU9_STAGE=staging or NODE_ENV=staging. (AFU9_STAGE=$stage, NODE_ENV=$nodeEnv)"
  }
}

Assert-StagingGate

if ($Mode -eq 'Delete' -and -not $Confirm) {
  throw "Refusing to delete without -Confirm. Re-run with: -Mode Delete -Confirm"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifactsDir = Join-Path $repoRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null

$tsScript = Join-Path $repoRoot 'scripts' 'purge_issues_staging.ts'

if (-not (Test-Path $tsScript)) {
  throw "Missing TS implementation script: $tsScript"
}

$argsList = @(
  'tsx',
  (Resolve-Path $tsScript).Path,
  '--mode', $Mode,
  '--olderThanDays', $OlderThanDays
)

if ($Source) { $argsList += @('--source', $Source) }
if ($Status) { $argsList += @('--status', $Status) }
if ($TitleContains) { $argsList += @('--titleContains', $TitleContains) }
if ($PublicId) { $argsList += @('--publicId', $PublicId) }
if ($Id) { $argsList += @('--id', $Id) }

if ($Mode -eq 'Delete') {
  # TS layer requires confirm=true
  $argsList += @('--confirm', 'true')
}

Write-Host "[purge_issues_staging.ps1] Running" -ForegroundColor Cyan
Write-Host "  Mode=$Mode OlderThanDays=$OlderThanDays" -ForegroundColor Cyan
Write-Host "  ArtifactsDir=$artifactsDir" -ForegroundColor Cyan

# Use control-center's local devDependencies (tsx + pg)
Push-Location $repoRoot
try {
  & npx --prefix control-center @argsList
  if ($LASTEXITCODE -ne 0) {
    throw "purge_issues_staging.ts failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
