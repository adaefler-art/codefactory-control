#!/usr/bin/env pwsh
<#
.SYNOPSIS
  v0.9.3 end-to-end guardrail for S1-S3 (pick, spec, implement).

.DESCRIPTION
  Staging-only smoke test using the smoke-key allowlist.
  Steps:
    1) Seed allowlist
    2) Pick issue (S1)
    3) Spec ready (S2)
    4) Implement (S3)

.PARAMETER BaseUrl
  Control-center base URL (default: https://stage.afu-9.com)

.PARAMETER SmokeKey
  Smoke key for staging allowlist (default: AFU9_SMOKE_KEY env var)

.PARAMETER UserId
  User identity for audit trail (default: AFU9_SMOKE_USER_ID env var or smoke-test-user)

.PARAMETER Repo
  GitHub repo in owner/repo format (default: AFU9_SMOKE_REPO env var or adaefler-art/codefactory-staging-test)

.PARAMETER IssueNumber
  GitHub issue number to pick (default: AFU9_SMOKE_ISSUE_NUMBER env var)

.PARAMETER CanonicalId
  Optional canonical id (e.g. E91.2) for the pick payload

.PARAMETER AcceptanceCriteria
  Array of acceptance criteria for S2 spec

.PARAMETER SkipImplement
  Skip S3 implement step (useful for local smoke runs)
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$BaseUrl = $null,

  [Parameter(Mandatory = $false)]
  [string]$SmokeKey = $null,

  [Parameter(Mandatory = $false)]
  [string]$UserId = $null,

  [Parameter(Mandatory = $false)]
  [string]$Repo = $null,

  [Parameter(Mandatory = $false)]
  [int]$IssueNumber = 0,

  [Parameter(Mandatory = $false)]
  [string]$CanonicalId = $null,

  [Parameter(Mandatory = $false)]
  [string[]]$AcceptanceCriteria = @(),

  [Parameter(Mandatory = $false)]
  [switch]$SkipImplement
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Value {
  param(
    [string]$Name,
    [string]$Value
  )
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name is required"
  }
}

function Invoke-Afu9Api {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('GET', 'POST')]
    [string]$Method,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $false)]
    [object]$Body = $null
  )

  $uri = "${BaseUrl}${Path}"
  $headers = @{
    'accept' = 'application/json'
    'x-afu9-sub' = $UserId
  }

  if (-not [string]::IsNullOrWhiteSpace($SmokeKey)) {
    $headers['x-afu9-smoke-key'] = $SmokeKey
  }

  $params = @{
    Method = $Method
    Uri = $uri
    Headers = $headers
  }

  if ($null -ne $Body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  $iwr = Get-Command Invoke-WebRequest
  if ($iwr.Parameters.ContainsKey('SkipHttpErrorCheck')) {
    $params['SkipHttpErrorCheck'] = $true
  }

  try {
    $response = Invoke-WebRequest @params
    $json = $null
    if ($response.Content) {
      try {
        $json = $response.Content | ConvertFrom-Json
      } catch {
        $json = $null
      }
    }

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Json = $json
      Content = $response.Content
      Headers = $response.Headers
      Success = $true
    }
  } catch {
    $statusCode = $null
    $content = $null

    if ($_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch { }

      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $content = $reader.ReadToEnd()
      } catch { }
    }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Json = $null
      Content = $content
      Headers = $null
      Success = $false
      Error = $_.Exception.Message
    }
  }
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = $env:AFU9_SMOKE_BASE_URL
}
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = 'https://stage.afu-9.com'
}
if ([string]::IsNullOrWhiteSpace($SmokeKey)) {
  $SmokeKey = $env:AFU9_SMOKE_KEY
}
if ([string]::IsNullOrWhiteSpace($UserId)) {
  $UserId = if ([string]::IsNullOrWhiteSpace($env:AFU9_SMOKE_USER_ID)) { 'smoke-test-user' } else { $env:AFU9_SMOKE_USER_ID }
}
if ([string]::IsNullOrWhiteSpace($Repo)) {
  $Repo = if ([string]::IsNullOrWhiteSpace($env:AFU9_SMOKE_REPO)) { 'adaefler-art/codefactory-staging-test' } else { $env:AFU9_SMOKE_REPO }
}
if ($IssueNumber -le 0) {
  if (-not [string]::IsNullOrWhiteSpace($env:AFU9_SMOKE_ISSUE_NUMBER)) {
    $IssueNumber = [int]$env:AFU9_SMOKE_ISSUE_NUMBER
  }
}
if ([string]::IsNullOrWhiteSpace($CanonicalId)) {
  $CanonicalId = $env:AFU9_SMOKE_CANONICAL_ID
}
if ($AcceptanceCriteria.Count -eq 0) {
  $AcceptanceCriteria = @(
    'Smoke guardrail: acceptance criteria present',
    'Smoke guardrail: SPEC_READY reached'
  )
}

Require-Value -Name 'SmokeKey' -Value $SmokeKey
Require-Value -Name 'Repo' -Value $Repo
if ($IssueNumber -le 0) {
  throw 'IssueNumber is required (set -IssueNumber or AFU9_SMOKE_ISSUE_NUMBER)'
}

$BaseUrl = $BaseUrl.TrimEnd('/')

Write-Host "v0.9.3 guardrail smoke test"
Write-Host "BaseUrl: $BaseUrl"
Write-Host "Repo: $Repo"
Write-Host "IssueNumber: $IssueNumber"
Write-Host "UserId: $UserId"
Write-Host "SkipImplement: $SkipImplement"

if ($BaseUrl -notmatch 'stage\.') {
  Write-Host "WARNING: BaseUrl does not look like staging. Verify before running." -ForegroundColor Yellow
}

Write-Host "Step 1: Seed smoke allowlist"
$seed = Invoke-Afu9Api -Method 'POST' -Path '/api/diagnostics/smoke-key/allowlist/seed'
if ($seed.StatusCode -ne 200) {
  Write-Host "Allowlist seed failed (status $($seed.StatusCode))" -ForegroundColor Red
  if ($seed.Content) { Write-Host $seed.Content }
  exit 1
}

Write-Host "Step 2: Pick issue (S1)"
$pickBody = @{
  repo = $Repo
  issueNumber = $IssueNumber
  owner = $UserId
}
if (-not [string]::IsNullOrWhiteSpace($CanonicalId)) {
  $pickBody.canonicalId = $CanonicalId
}
$pick = Invoke-Afu9Api -Method 'POST' -Path '/api/afu9/s1s3/issues/pick' -Body $pickBody
if ($pick.StatusCode -ne 201) {
  Write-Host "Pick failed (status $($pick.StatusCode))" -ForegroundColor Red
  if ($pick.Content) { Write-Host $pick.Content }
  exit 1
}
$issueId = $pick.Json.issue.id
if ([string]::IsNullOrWhiteSpace($issueId)) {
  Write-Host 'Pick response missing issue id' -ForegroundColor Red
  exit 1
}
Write-Host "Picked issue id: $issueId"

Write-Host "Step 3: Issue detail (GET)"
$detail = Invoke-Afu9Api -Method 'GET' -Path "/api/afu9/s1s3/issues/$issueId"
if ($detail.StatusCode -ne 200) {
  Write-Host "Issue detail failed (status $($detail.StatusCode))" -ForegroundColor Red
  if ($detail.Content) { Write-Host $detail.Content }
  exit 1
}

Write-Host "Step 4: Spec ready (S2)"
$specBody = @{
  acceptanceCriteria = $AcceptanceCriteria
  problem = 'v0.9.3 smoke guardrail spec'
  scope = 'guardrail'
}
$spec = Invoke-Afu9Api -Method 'POST' -Path "/api/afu9/s1s3/issues/$issueId/spec" -Body $specBody
if ($spec.StatusCode -ne 200) {
  Write-Host "Spec ready failed (status $($spec.StatusCode))" -ForegroundColor Red
  if ($spec.Content) { Write-Host $spec.Content }
  exit 1
}

if (-not $SkipImplement) {
  Write-Host "Step 5: Implement (S3)"
  $implementBody = @{
    baseBranch = 'main'
  }
  $implement = Invoke-Afu9Api -Method 'POST' -Path "/api/afu9/s1s3/issues/$issueId/implement" -Body $implementBody
  if ($implement.StatusCode -ne 200) {
    Write-Host "Implement failed (status $($implement.StatusCode))" -ForegroundColor Red
    if ($implement.Content) { Write-Host $implement.Content }
    exit 1
  }
  if ($implement.Json.pr) {
    Write-Host "Implement PR: $($implement.Json.pr.url)"
  }
}

Write-Host 'Guardrail completed successfully.'
