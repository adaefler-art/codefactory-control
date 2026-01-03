param(
  [ValidateSet('all','github','deploy','observability','runner')]
  [string[]]$Servers = @('all'),

  [ValidateSet('stage','prod')]
  [string]$TagPrefix = 'stage',

  [ValidateSet('latest')]
  [string]$TagSuffix = 'latest',

  [switch]$Build,
  [switch]$Recreate,

  [int]$HealthTimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Command {
  param([Parameter(Mandatory=$true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Resolve-Servers {
  param([string[]]$InputServers)
  if ($InputServers -contains 'all') {
    return @('github','deploy','observability','runner')
  }
  # De-dup while preserving order
  $seen = @{}
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($s in $InputServers) {
    if (-not $seen.ContainsKey($s)) {
      $seen[$s] = $true
      $out.Add($s)
    }
  }
  return $out.ToArray()
}

function Get-Tag {
  param([Parameter(Mandatory=$true)][string]$Repo)
  return ('{0}:{1}-{2}' -f $Repo, $TagPrefix, $TagSuffix)
}

function Stop-If-Exists {
  param([Parameter(Mandatory=$true)][string]$ContainerName)
  try {
    docker rm -f $ContainerName | Out-Null
  } catch {
    # ignore
  }
}

function Start-Container {
  param(
    [Parameter(Mandatory=$true)][string]$ContainerName,
    [Parameter(Mandatory=$true)][string]$ImageTag,
    [Parameter(Mandatory=$true)][int]$Port,
    [string[]]$EnvArgs = @()
  )

  $args = @(
    'run',
    '-d',
    '--name', $ContainerName,
    '--restart', 'unless-stopped',
    '-e', "PORT=$Port",
    '-p', "${Port}:${Port}"
  ) + $EnvArgs + @($ImageTag)

  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker run failed for $ContainerName (exit=$LASTEXITCODE)" }
}

function Wait-For-Health {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][int]$Port,
    [int]$TimeoutSec = 60
  )

  $uri = "http://localhost:$Port/health"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastErr = $null

  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $uri -TimeoutSec 5 -UseBasicParsing
      if ($resp.StatusCode -eq 200) {
        Write-Host "✅ $Name healthy at $uri" -ForegroundColor Green
        return
      }
      $lastErr = "HTTP $($resp.StatusCode)"
    } catch {
      $lastErr = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
  }

  throw "Health check failed for $Name at $uri (timeout ${TimeoutSec}s). Last error: $lastErr"
}

Require-Command -Name docker

$repoRoot = Split-Path -Parent $PSScriptRoot
$serversToRun = Resolve-Servers -InputServers $Servers

Write-Host "MCP workflow: servers=$($serversToRun -join ', ') build=$Build recreate=$Recreate" -ForegroundColor Cyan

$defs = @{
  github = @{ repo = 'afu9/mcp-github'; container = 'afu9-mcp-github'; port = 3001; dockerfile = 'mcp-servers/github/Dockerfile'; context = 'mcp-servers' };
  deploy = @{ repo = 'afu9/mcp-deploy'; container = 'afu9-mcp-deploy'; port = 3002; dockerfile = 'mcp-servers/deploy/Dockerfile'; context = 'mcp-servers' };
  observability = @{ repo = 'afu9/mcp-observability'; container = 'afu9-mcp-observability'; port = 3003; dockerfile = 'mcp-servers/observability/Dockerfile'; context = 'mcp-servers' };
  runner = @{ repo = 'afu9/mcp-runner'; container = 'afu9-mcp-runner'; port = 3004; dockerfile = '.github/docker/mcp-runner.Dockerfile'; context = 'mcp-servers' };
}

foreach ($s in $serversToRun) {
  if (-not $defs.ContainsKey($s)) { throw "Unknown server: $s" }

  $def = $defs[$s]
  $tag = Get-Tag -Repo $def.repo

  if ($Build) {
    if ($s -eq 'runner') {
      & pwsh -File (Join-Path $repoRoot 'scripts/build-mcp-runner.ps1') -TagPrefix $TagPrefix -TagSuffix $TagSuffix -Repository $def.repo
      if ($LASTEXITCODE -ne 0) { throw "build-mcp-runner.ps1 failed (exit=$LASTEXITCODE)" }
    } else {
      Write-Host "Building $tag ..." -ForegroundColor Cyan
      docker build -f $def.dockerfile $def.context -t $tag
      if ($LASTEXITCODE -ne 0) { throw "docker build failed for $s (exit=$LASTEXITCODE)" }
    }
  }

  if ($Recreate) {
    Write-Host "Recreating container $($def.container) ..." -ForegroundColor Cyan
    Stop-If-Exists -ContainerName $def.container
  }

  # Optional env pass-through (no secrets stored in repo)
  $envArgs = @()
  if ($s -eq 'github') {
    if ($env:GITHUB_TOKEN) { $envArgs += @('-e', "GITHUB_TOKEN=$($env:GITHUB_TOKEN)") } else { Write-Host "⚠️  GITHUB_TOKEN not set (github tools may fail)" -ForegroundColor Yellow }
  }
  if ($s -eq 'deploy' -or $s -eq 'observability') {
    if ($env:AWS_REGION) { $envArgs += @('-e', "AWS_REGION=$($env:AWS_REGION)") }
    if ($env:AWS_ACCESS_KEY_ID) { $envArgs += @('-e', "AWS_ACCESS_KEY_ID=$($env:AWS_ACCESS_KEY_ID)") }
    if ($env:AWS_SECRET_ACCESS_KEY) { $envArgs += @('-e', "AWS_SECRET_ACCESS_KEY=$($env:AWS_SECRET_ACCESS_KEY)") }
    if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
      Write-Host "⚠️  AWS creds not set (deploy/observability tools may fail)" -ForegroundColor Yellow
    }
  }

  Write-Host "Starting $s ($tag) on port $($def.port) ..." -ForegroundColor Cyan
  Start-Container -ContainerName $def.container -ImageTag $tag -Port $def.port -EnvArgs $envArgs
  Wait-For-Health -Name $s -Port $def.port -TimeoutSec $HealthTimeoutSec
}

Write-Host "\n✅ MCP workflow complete" -ForegroundColor Green
Write-Host "docker ps --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\"" -ForegroundColor DarkGray
