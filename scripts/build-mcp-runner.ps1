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

# Runner Dockerfile expects the build context to be ./mcp-servers
$dockerfile = 'mcp-servers/afu9-runner/Dockerfile'
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