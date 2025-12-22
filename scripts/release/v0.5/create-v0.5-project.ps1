[CmdletBinding()]
param(
  [Parameter()] [string] $Owner = 'adaefler-art',
  [Parameter()] [int] $ProjectNumber = 13,
  [Parameter()] [string] $Repo = 'adaefler-art/codefactory-control',
  [Parameter()] [string] $ProjectTitle = 'AFU-9 Codefactory v0.5',
  [Parameter()] [switch] $Execute
)

$ErrorActionPreference = 'Stop'

function Write-Step([string] $Text) {
  Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Require-Gh {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) {
    throw "GitHub CLI 'gh' not found. Install gh or run manually via Web UI."
  }
}

function Get-IssueByExactTitle {
  param(
    [Parameter(Mandatory)] [string] $Repo,
    [Parameter(Mandatory)] [string] $Title
  )

  $json = & gh issue list --repo $Repo --state all --search "\"$Title\"" --json number,title,url 2>$null
  if (-not $json) { return $null }

  try {
    $items = $json | ConvertFrom-Json
  } catch {
    return $null
  }

  return ($items | Where-Object { $_.title -eq $Title } | Select-Object -First 1)
}

function Ensure-Issue {
  param(
    [Parameter(Mandatory)] [string] $Repo,
    [Parameter(Mandatory)] [string] $Title,
    [Parameter(Mandatory)] [string[]] $Labels,
    [Parameter(Mandatory)] [string] $Body,
    [Parameter()] [switch] $Execute
  )

  $existing = Get-IssueByExactTitle -Repo $Repo -Title $Title
  if ($existing) {
    return [pscustomobject]@{
      action = 'reused'
      number = $existing.number
      url = $existing.url
      title = $existing.title
    }
  }

  $labelsCsv = ($Labels -join ',')
  if (-not $Execute) {
    return [pscustomobject]@{
      action = 'would-create'
      number = $null
      url = $null
      title = $Title
      labels = $labelsCsv
    }
  }

  $createdUrl = (& gh issue create --repo $Repo --title $Title --body $Body --label $labelsCsv | Out-String).Trim()
  if (-not $createdUrl) {
    throw "Failed to create issue '$Title' (no URL returned)."
  }

  $viewJson = & gh issue view $createdUrl --repo $Repo --json number,title,url
  $view = $viewJson | ConvertFrom-Json
  return [pscustomobject]@{
    action = 'created'
    number = $view.number
    url = $view.url
    title = $view.title
  }
}

function Add-IssueToProject {
  param(
    [Parameter(Mandatory)] [string] $Owner,
    [Parameter(Mandatory)] [int] $ProjectNumber,
    [Parameter(Mandatory)] [string] $IssueUrl,
    [Parameter()] [switch] $Execute
  )

  if (-not $IssueUrl) {
    return [pscustomobject]@{ status = 'skipped'; detail = 'no issue url' }
  }

  if (-not $Execute) {
    return [pscustomobject]@{ status = 'would-add'; detail = $null }
  }

  $out = (& gh project item-add $ProjectNumber --owner $Owner --url $IssueUrl 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -eq 0) {
    return [pscustomobject]@{ status = 'added'; detail = $out }
  }

  if ($out -match '(already|exists)') {
    return [pscustomobject]@{ status = 'already-added'; detail = $out }
  }

  return [pscustomobject]@{ status = 'failed'; detail = $out }
}

Write-Host "This script prints (and optionally runs) GitHub CLI commands." -ForegroundColor Yellow
Write-Host "It is idempotent for issues by exact title match." -ForegroundColor Yellow

Write-Step "Validate prerequisites"
Require-Gh

if ($Execute) {
  & gh auth status | Out-Null
  & gh project view $ProjectNumber --owner $Owner --format json | Out-Null
}

Write-Step "Backlog definition (authoritative source: docs/v05/V05_RELEASE_PREP.md)"

$commonLabels = @('v0.5')

$issues = @(
  @{ title = '[v0.5 Epic] Self-Propelling'; priority = 'p1'; type = 'epic'; labels = @('self-propelling') },
  @{ title = 'Task: Make runtime artifact access explicit'; priority = 'p1'; type = 'task'; labels = @('self-propelling','hardening') },
  @{ title = 'Task: Add preflight runtime check + clear error'; priority = 'p1'; type = 'task'; labels = @('self-propelling','hardening') },
  @{ title = 'Task: Wire feature behind flag and document activation'; priority = 'p1'; type = 'task'; labels = @('self-propelling','docs') },
  @{ title = 'Finding 1: Enforce ECS healthcheck on task ENI IP'; priority = 'p1'; type = 'task'; labels = @('hardening','ops','ecs') },
  @{ title = 'Finding 2: Verify ALB healthcheck uses /api/health (already implemented on 22cdb6a4)'; priority = 'p2'; type = 'task'; labels = @('hardening','ops','ecs') },
  @{ title = 'Finding 3: Add CDK context validation for staging'; priority = 'p1'; type = 'task'; labels = @('hardening','ops','cdk') },
  @{ title = 'Finding 4: Strengthen DB secret validation'; priority = 'p1'; type = 'task'; labels = @('hardening','ops','security') },
  @{ title = 'Finding 5: Verify diff gate exclusively flag (already implemented on 22cdb6a4)'; priority = 'p2'; type = 'task'; labels = @('hardening','ops','cdk') }
)

Write-Step "Plan"
Write-Host "Repo: $Repo" -ForegroundColor Yellow
Write-Host "Project: $Owner #$ProjectNumber" -ForegroundColor Yellow
if (-not $Execute) {
  Write-Host "Mode: DRY RUN (no changes)" -ForegroundColor Yellow
} else {
  Write-Host "Mode: EXECUTE" -ForegroundColor Yellow
}

foreach ($i in $issues) {
  $labels = @($commonLabels + @($i.type, $i.priority) + $i.labels) | Select-Object -Unique
  $labelsCsv = ($labels -join ',')
  Write-Host "- $($i.title)" -ForegroundColor Cyan
  Write-Host "  labels: $labelsCsv"
  Write-Host "  add to project: $Owner #$ProjectNumber"
}

if (-not $Execute) {
  Write-Host "`nDry run only. Re-run with -Execute to run commands." -ForegroundColor Yellow
  exit 0
}

Write-Step "Create/reuse issues and add to project"
foreach ($i in $issues) {
  $labels = @($commonLabels + @($i.type, $i.priority) + $i.labels) | Select-Object -Unique
  $body = @(
    'Source: docs/v05/V05_RELEASE_PREP.md',
    "Project: $Owner #$ProjectNumber"
  ) -join "`n"

  $result = Ensure-Issue -Repo $Repo -Title $i.title -Labels $labels -Body $body -Execute:$Execute
  if (-not $result.number) {
    # Should not happen in -Execute mode, but keep safe output
    Write-Host "[unknown] $($result.action): $($i.title)" -ForegroundColor Yellow
    continue
  }

  $proj = Add-IssueToProject -Owner $Owner -ProjectNumber $ProjectNumber -IssueUrl $result.url -Execute:$Execute
  Write-Host "#$($result.number) $($result.action) — project: $($proj.status)" -ForegroundColor Green
  if ($proj.status -eq 'failed') {
    Write-Host "  detail: $($proj.detail)" -ForegroundColor Red
  }
}

