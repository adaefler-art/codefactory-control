param(
  [string]$Tag,
  [int]$DesiredCount = 1,
  [switch]$DeployCdk,
  [string]$Profile,
  [switch]$DebugMode
)

$ErrorActionPreference = 'Stop'

# Region/account/service constants
$Region = 'eu-central-1'
$Cluster = 'afu9-cluster'
$Service = 'afu9-control-center'
$AlbHost = 'afu9-alb-376872021.eu-central-1.elb.amazonaws.com'
$LogGroups = @(
  '/ecs/afu9/control-center',
  '/ecs/afu9/mcp-github',
  '/ecs/afu9/mcp-deploy',
  '/ecs/afu9/mcp-observability'
)

function Write-Section {
  param([string]$Message)
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-DebugLog {
  param([string]$Message)
  if ($DebugMode) {
    Write-Host $Message -ForegroundColor DarkGray
  }
}

function Get-ImageTag {
  param([string]$ProvidedTag)

  if ($ProvidedTag) {
    return $ProvidedTag
  }

  try {
    $sha = (git rev-parse --short HEAD).Trim()
    if ($sha) {
      return $sha
    }
  } catch {
    Write-Warning "git rev-parse failed; falling back to timestamp"
  }

  return (Get-Date -Format 'yyyyMMddHHmmss')
}

function Invoke-Docker {
  param([string[]]$Args)
  Write-Host "docker $($Args -join ' ')" -ForegroundColor DarkGray
  docker @Args
}

function Invoke-AwsJson {
  param(
    [string[]]$AwsArgs,
    [string]$Caller = 'Invoke-AwsJson'
  )

  Write-DebugLog "[Invoke-AwsJson] caller=${Caller} args=$($AwsArgs -join ' ')"
  Write-DebugLog "[Invoke-AwsJson] bound=$(ConvertTo-Json $PSBoundParameters -Compress)"

  if (-not $AwsArgs -or -not $AwsArgs[0]) {
    throw "Invoke-AwsJson called with empty args (would run 'aws' with no command). Caller=${Caller}"
  }

  $finalArgs = @()
  $finalArgs += $AwsArgs

  if (-not ($finalArgs -contains '--region') -and $Region) {
    $finalArgs += @('--region', $Region)
  }

  if ($Profile -and -not ($finalArgs -contains '--profile')) {
    $finalArgs += @('--profile', $Profile)
  }

  Write-DebugLog "aws $($finalArgs -join ' ')"

  $previousEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = (& aws @finalArgs 2>&1) | Out-String
    $exit = $LASTEXITCODE

    if ($exit -ne 0) {
      $joined = $finalArgs -join ' '
      throw "aws command failed (exit ${exit}): aws ${joined}`nOutput:`n${raw}"
    }

    if (-not $raw) {
      return $null
    }
  } finally {
    $ErrorActionPreference = $previousEap
  }

  $text = [string]$raw
  if ($text.TrimStart().StartsWith('{') -or $text.TrimStart().StartsWith('[')) {
    try {
      return $text | ConvertFrom-Json
    } catch {
      throw "aws output was not valid JSON for command: aws $($finalArgs -join ' ')`nOutput:`n${text}"
    }
  }

  return $text
}

function Build-Push {
  param(
    [string]$Name,
    [string]$Dockerfile,
    [string]$Context,
    [string]$ImageTag,
    [string]$RepoBase
  )

  $shaTag = "${RepoBase}/${Name}:${ImageTag}"
  $latestTag = "${RepoBase}/${Name}:staging-latest"

  Write-Host "Building ${shaTag} (context: ${Context}, file: ${Dockerfile})" -ForegroundColor Green
  Invoke-Docker @('build', '-f', $Dockerfile, '-t', $shaTag, $Context)

  Write-Host "Pushing ${shaTag}" -ForegroundColor Yellow
  Invoke-Docker @('push', $shaTag)

  Write-Host "Tagging ${shaTag} as ${latestTag}" -ForegroundColor Yellow
  Invoke-Docker @('tag', $shaTag, $latestTag)

  Write-Host "Pushing ${latestTag}" -ForegroundColor Yellow
  Invoke-Docker @('push', $latestTag)
}

function Get-TargetGroupArn {
  param([psobject]$ServiceDescription)
  if ($ServiceDescription.loadBalancers -and $ServiceDescription.loadBalancers.Count -gt 0) {
    return $ServiceDescription.loadBalancers[0].targetGroupArn
  }
  return $null
}

function Wait-ForService {
  param(
    [string]$Cluster,
    [string]$Service,
    [int]$DesiredCount,
    [int]$TimeoutSeconds = 900
  )

  $previousEap = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Stop'

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
      try {
        $desc = Invoke-AwsJson -AwsArgs @('ecs', 'describe-services', '--cluster', $Cluster, '--services', $Service, '--output', 'json') -Caller 'wait-for-service'
        if (-not $desc -or -not $desc.services -or $desc.services.Count -eq 0) {
          Dump-Diagnostics -Cluster $Cluster -Service $Service -LogGroups $LogGroups
          throw "ecs describe-services returned no data for service ${Service} in cluster ${Cluster}"
        }

        $svc = $desc.services[0]
        $running = [int]$svc.runningCount
        $pending = [int]$svc.pendingCount
        $desired = [int]$svc.desiredCount
        $status = $svc.status
        $latestEvents = $svc.events | Select-Object -First 3

        Write-Host "Service status: status=${status} desired=${desired} running=${running} pending=${pending} deployments=${($svc.deployments.Count)}" -ForegroundColor Gray
        if ($latestEvents) {
          $latestEvents | ForEach-Object { Write-Host "Event: $($_.createdAt) $($_.message)" -ForegroundColor DarkGray }
        }

        if ($running -eq $DesiredCount -and $pending -eq 0) {
          return $svc
        }

        Start-Sleep -Seconds 10
      } catch {
        $msg = $_.Exception.Message
        if (-not $msg) { $msg = ($_ | Out-String) }
        if (-not $msg) { $msg = 'Unknown error in Wait-ForService' }
        throw $msg
      }
    }

    throw "ECS service did not reach desiredCount ${DesiredCount} within timeout (Cluster=${Cluster}, Service=${Service})"
  }
  finally {
    $ErrorActionPreference = $previousEap
  }
}

function Wait-ForTargetGroupHealthy {
  param(
    [string]$TargetGroupArn,
    [int]$DesiredCount,
    [int]$TimeoutSeconds = 600
  )

  if (-not $TargetGroupArn) {
    Write-Warning 'No target group ARN found; skipping target health wait.'
    return
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $health = Invoke-AwsJson -AwsArgs @('elbv2', 'describe-target-health', '--target-group-arn', $TargetGroupArn, '--output', 'json') -Caller 'wait-for-target-group'
    $states = $health.TargetHealthDescriptions
    if (-not $states) {
      Write-Host 'Target health not yet available' -ForegroundColor Gray
      Start-Sleep -Seconds 5
      continue
    }

    $healthy = @($states | Where-Object { $_.TargetHealth.State -eq 'healthy' }).Count

    Write-Host "Target group health: healthy=${healthy} / desired=${DesiredCount}" -ForegroundColor Gray

    if ($healthy -ge $DesiredCount -and $healthy -gt 0) {
      return
    }

    Start-Sleep -Seconds 10
  }

  throw "Target group did not become healthy (desired ${DesiredCount}) within timeout"
}

function Invoke-HttpJson {
  param([string]$Path)
  $uri = "http://${AlbHost}${Path}"
  Write-Host "GET ${uri}" -ForegroundColor Gray
  try {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 15
  } catch {
    throw "HTTP check failed for ${uri}: $($_.Exception.Message)"
  }

  try {
    return $resp.Content | ConvertFrom-Json
  } catch {
    throw "HTTP response from ${uri} was not valid JSON: $($_.Exception.Message)"
  }
}

function Dump-Diagnostics {
  param(
    [string]$Cluster,
    [string]$Service,
    [string[]]$LogGroups
  )

  Write-Section 'Diagnostics: ECS service events'
  $svcDesc = Invoke-AwsJson -AwsArgs @('ecs', 'describe-services', '--cluster', $Cluster, '--services', $Service, '--include', 'EVENTS', '--output', 'json') -Caller 'diagnostics-service-events'
  if ($svcDesc -and $svcDesc.services -and $svcDesc.services.Count -gt 0) {
    $events = $svcDesc.services[0].events | Select-Object -First 10
    $events | Format-Table -Property createdAt,message -AutoSize
  } else {
    Write-Host 'No service events found'
  }

  Write-Section 'Diagnostics: ECS tasks'
  $taskArns = Invoke-AwsJson -AwsArgs @('ecs', 'list-tasks', '--cluster', $Cluster, '--service-name', $Service, '--output', 'json') -Caller 'diagnostics-list-running-tasks'
  if ($taskArns -and $taskArns.taskArns.Count -gt 0) {
    $taskArgs = @('ecs', 'describe-tasks', '--cluster', $Cluster, '--tasks') + $taskArns.taskArns
    $tasks = Invoke-AwsJson -AwsArgs $taskArgs -Caller 'describe-running-tasks'
  }
  if ($tasks -and $tasks.tasks) {
    $tasks.tasks | Select-Object taskArn,lastStatus,desiredStatus,stoppedReason,healthStatus | Format-Table -AutoSize
  } else {
    Write-Host 'No tasks found'
  }

  $stoppedArns = Invoke-AwsJson -AwsArgs @('ecs', 'list-tasks', '--cluster', $Cluster, '--service-name', $Service, '--desired-status', 'STOPPED', '--max-results', '5', '--output', 'json') -Caller 'diagnostics-list-stopped-tasks'
  if ($stoppedArns -and $stoppedArns.taskArns.Count -gt 0) {
    $stoppedArgs = @('ecs', 'describe-tasks', '--cluster', $Cluster, '--tasks') + $stoppedArns.taskArns
    $stoppedTasks = Invoke-AwsJson -AwsArgs $stoppedArgs -Caller 'describe-stopped-tasks'
    if ($stoppedTasks -and $stoppedTasks.tasks) {
      Write-Section 'Diagnostics: recent stopped tasks'
      $stoppedTasks.tasks | Select-Object taskArn,stoppedReason,stoppedAt,lastStatus,containers | Format-Table -AutoSize
    }
  }

  foreach ($lg in $LogGroups) {
    Write-Section "Diagnostics: logs ${lg} (latest stream, last 20 lines)"
    try {
      $streams = Invoke-AwsJson -AwsArgs @('logs', 'describe-log-streams', '--log-group-name', $lg, '--order-by', 'LastEventTime', '--descending', '--max-items', '1', '--output', 'json') -Caller "diagnostics-describe-log-streams:${lg}"
      $stream = $streams.logStreams[0].logStreamName
      if ($stream) {
        $events = Invoke-AwsJson -AwsArgs @('logs', 'get-log-events', '--log-group-name', $lg, '--log-stream-name', $stream, '--limit', '20', '--output', 'json') -Caller "diagnostics-get-log-events:${lg}"
        if ($events -and $events.events) {
          $events.events | Select-Object -ExpandProperty message
        } else {
          Write-Host 'No log events returned'
        }
      } else {
        Write-Host 'No log streams found'
      }
    } catch {
      Write-Warning "Failed to read logs for ${lg}: ${_}"
    }
  }
}

try {
  Write-Section 'Resolve image tag'
  $ImageTag = Get-ImageTag -ProvidedTag $Tag
  Write-Host "Using tag: ${ImageTag}" -ForegroundColor Green

  Write-Section 'Resolve AWS account/registry'
  $stsArgs = @('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text')
  if ($Region) { $stsArgs += @('--region', $Region) }
  if ($Profile) { $stsArgs += @('--profile', $Profile) }
  $AccountIdOutput = & aws @stsArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "aws sts get-caller-identity failed: ${AccountIdOutput}"
  }
  $AccountId = $AccountIdOutput.Trim()
  $Registry = "${AccountId}.dkr.ecr.${Region}.amazonaws.com"
  $RepoBase = "${Registry}/afu9"
  Write-Host "Registry: ${Registry}" -ForegroundColor Green

  Write-Section 'ECR login'
  $loginArgs = @('ecr', 'get-login-password', '--region', $Region)
  if ($Profile) { $loginArgs += @('--profile', $Profile) }
  $pwd = & aws @loginArgs 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "aws ecr get-login-password failed: ${pwd}"
  }
  $pwd | docker login --username AWS --password-stdin $Registry

  Write-Section 'Build and push images'
  Build-Push -Name 'control-center' -Dockerfile 'control-center/Dockerfile' -Context 'control-center' -ImageTag $ImageTag -RepoBase $RepoBase
  Build-Push -Name 'mcp-github' -Dockerfile 'mcp-servers/github/Dockerfile' -Context '.' -ImageTag $ImageTag -RepoBase $RepoBase
  Build-Push -Name 'mcp-deploy' -Dockerfile 'mcp-servers/deploy/Dockerfile' -Context '.' -ImageTag $ImageTag -RepoBase $RepoBase
  Build-Push -Name 'mcp-observability' -Dockerfile 'mcp-servers/observability/Dockerfile' -Context '.' -ImageTag $ImageTag -RepoBase $RepoBase

  if ($DeployCdk) {
    Write-Section 'Deploy CDK'
    if ($Profile) { $env:AWS_PROFILE = $Profile }
    if ($Region) { $env:AWS_REGION = $Region; $env:AWS_DEFAULT_REGION = $Region }

    $cdkArgs = @('cdk', 'deploy', 'Afu9EcsStack', '--require-approval', 'never', '-c', "imageTag=${ImageTag}", '-c', "desiredCount=${DesiredCount}")
    if ($Profile) { $cdkArgs += @('--profile', $Profile) }

    $cdkOutput = & npx @cdkArgs 2>&1
    $cdkExit = $LASTEXITCODE

    if ($cdkExit -ne 0) {
      throw "cdk deploy failed (exit ${cdkExit}): ${cdkOutput}"
    }
  }

  Write-Section 'Force ECS deployment'
  if ([string]::IsNullOrWhiteSpace($Cluster) -or [string]::IsNullOrWhiteSpace($Service)) {
    throw "Cluster and Service must be set before update-service (Cluster='${Cluster}' Service='${Service}')"
  }

  $updateArgs = @(
    'ecs', 'update-service',
    '--cluster', $Cluster,
    '--service', $Service,
    '--force-new-deployment',
    '--desired-count', "$DesiredCount",
    '--output', 'json'
  )

  Write-DebugLog "update-service args count=$($updateArgs.Count) args=$($updateArgs -join ' | ')"

  Invoke-AwsJson -AwsArgs $updateArgs -Caller 'update-service' | Out-Null

  Write-Section 'Wait for ECS service running'
  try {
    $svc = Wait-ForService -Cluster $Cluster -Service $Service -DesiredCount $DesiredCount
  } catch {
    Write-Warning "Wait-ForService failed: $($_.Exception.Message)"
    Write-Host "Exception details:" -ForegroundColor Yellow
    $_.Exception | Format-List * -Force
    throw
  }

  $targetGroupArn = Get-TargetGroupArn -ServiceDescription $svc
  if ($targetGroupArn) {
    Write-Host "Target group: ${targetGroupArn}" -ForegroundColor Green
  }

  $targetHealthState = 'unknown'
  Write-Section 'Wait for target group healthy'
  if ($targetGroupArn) {
    Wait-ForTargetGroupHealthy -TargetGroupArn $targetGroupArn -DesiredCount $DesiredCount
    $targetHealthState = 'healthy'
  } else {
    $targetHealthState = 'skipped'
  }

  Write-Section 'HTTP checks'
  $ready = Invoke-HttpJson -Path '/api/ready'
  $health = Invoke-HttpJson -Path '/api/health'

  $readyVersion = $ready.version
  $healthVersion = $health.version

  if ($ready.ready -ne $true) {
    throw "Readiness check returned ready=$($ready.ready)"
  }

  if ($health.status -ne 'ok') {
    throw "Health check returned status=$($health.status)"
  }

  if ($readyVersion -ne $healthVersion) {
    Write-Warning "Version mismatch: ready=${readyVersion} health=${healthVersion}. Continuing, but verify ALB routing and image versions."
  }

  Write-Host "Ready: version=${readyVersion} ready=$($ready.ready)" -ForegroundColor Green
  Write-Host "Health: version=${healthVersion} status=$($health.status)" -ForegroundColor Green

  $success = @{
    service = $Service
    cluster = $Cluster
    desired = $DesiredCount
    running = $svc.runningCount
    pending = $svc.pendingCount
    targetGroup = $targetGroupArn
    targetHealth = $targetHealthState
    readyVersion = $readyVersion
    healthVersion = $healthVersion
  }

  Write-Section 'SUCCESS'
  $success.GetEnumerator() | Sort-Object Name | Format-Table -HideTableHeaders
  Write-Host "Target group healthy; /api/ready and /api/health aligned." -ForegroundColor Green
} catch {
  Write-Error $_
  Dump-Diagnostics -Cluster $Cluster -Service $Service -LogGroups $LogGroups
  exit 1
}
