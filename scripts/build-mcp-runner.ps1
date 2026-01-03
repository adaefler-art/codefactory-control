param(
  [ValidateSet('stage','prod')]
  [string]$TagPrefix = 'stage',

  [ValidateSet('latest')]
  [string]$TagSuffix = 'latest',

  [string]$Repository = 'afu9/mcp-runner',

  # Optional: if set, tag the image for ECR (e.g. 3130....dkr.ecr.eu-central-1.amazonaws.com)
  [string]$EcrRegistry = ''
)

$ErrorActionPreference = 'Stop'

# Runner build must use the hardened Dockerfile that materializes the local file:../base dependency.
# The plain mcp-servers/afu9-runner/Dockerfile can produce runtime images where deep imports like
# '@afu9/mcp-base/src/server' fail (no /src/*.js in the installed package layout), causing the
# container to exit and the MCP catalog gate to fail.
$dockerfile = '.github/docker/mcp-runner.Dockerfile'
$context = 'mcp-servers'
$tag = ('{0}:{1}-{2}' -f $Repository, $TagPrefix, $TagSuffix)

Write-Host "Building $tag using context '$context' and Dockerfile '$dockerfile'..."

docker build -f $dockerfile $context -t $tag

if ($LASTEXITCODE -ne 0) {
  throw "docker build failed with exit code $LASTEXITCODE"
}

Write-Host "Built: $tag"

if ($EcrRegistry) {
  $ecrTag = "$EcrRegistry/$tag"
  Write-Host "Tagging for ECR: $ecrTag"
  docker tag $tag $ecrTag

  if ($LASTEXITCODE -ne 0) {
    throw "docker tag failed with exit code $LASTEXITCODE"
  }

  Write-Host "ECR tag ready: $ecrTag"
}