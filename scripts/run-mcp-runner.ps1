param(
  [int]$Port = 3004,
  [ValidateSet('stage','prod')]
  [string]$TagPrefix = 'stage',

  [ValidateSet('latest')]
  [string]$TagSuffix = 'latest',

  [string]$Repository = 'afu9/mcp-runner',

  [string]$ContainerName = 'mcp-runner',

  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$tag = ('{0}:{1}-{2}' -f $Repository, $TagPrefix, $TagSuffix)

if ($Rebuild) {
  Write-Host "Rebuilding runner image: $tag" -ForegroundColor Cyan
  & pwsh -File (Join-Path $repoRoot 'scripts/build-mcp-runner.ps1') -TagPrefix $TagPrefix -TagSuffix $TagSuffix -Repository $Repository
  if ($LASTEXITCODE -ne 0) { throw "build-mcp-runner.ps1 failed (exit=$LASTEXITCODE)" }
}

Write-Host "Stopping any existing container: $ContainerName" -ForegroundColor Cyan
try { docker rm -f $ContainerName | Out-Null } catch { }

Write-Host "Starting MCP runner on http://localhost:$Port (container $tag)" -ForegroundColor Cyan

# The image exposes PORT=3002 by default; override to match the repo-wide MCP catalog expectation (3004).
# Map host:container port equally so health checks hit /health on the same port.
$runArgs = @(
  'run',
  '-d',
  '--name', $ContainerName,
  '--restart', 'unless-stopped',
  '-e', "PORT=$Port",
  '-p', "${Port}:${Port}",
  $tag
)

& docker @runArgs
if ($LASTEXITCODE -ne 0) {
  throw "docker run failed with exit code $LASTEXITCODE"
}

Write-Host "Runner container started. Quick checks:" -ForegroundColor Green
Write-Host "  - docker logs -n 50 $ContainerName" -ForegroundColor Green
Write-Host "  - curl http://localhost:$Port/health" -ForegroundColor Green
