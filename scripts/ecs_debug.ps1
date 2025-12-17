#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Epic-4 ECS Debug Harness: Service diagnostics and log analysis

.DESCRIPTION
    This script provides comprehensive debugging for AFU-9 ECS deployments:
    - Lists recent service events
    - Shows stopped tasks with exit codes and failure reasons
    - Displays target health status from ALB
    - Tails recent logs from /ecs/afu9/* log groups
    - Provides actionable diagnostics for common issues

.PARAMETER Cluster
    ECS cluster name (default: afu9-cluster)

.PARAMETER Service
    ECS service name (e.g., afu9-service-stage or afu9-service-prod)

.PARAMETER Region
    AWS region (default: eu-central-1)

.PARAMETER Profile
    Optional AWS CLI profile name

.PARAMETER LogLines
    Number of log lines to retrieve from each log group (default: 50)

.PARAMETER ShowFullLogs
    Show full logs instead of summary. Use with caution in production.

.EXAMPLE
    .\scripts\ecs_debug.ps1 -Service afu9-service-stage
    Debug the stage service in default cluster

.EXAMPLE
    .\scripts\ecs_debug.ps1 -Service afu9-service-prod -Profile codefactory
    Debug production service with AWS profile

.EXAMPLE
    .\scripts\ecs_debug.ps1 -Service afu9-service-stage -LogLines 100
    Debug with extended log output (100 lines per container)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Cluster = "afu9-cluster",
    
    [Parameter(Mandatory=$true)]
    [string]$Service,
    
    [Parameter(Mandatory=$false)]
    [string]$Region = "eu-central-1",
    
    [Parameter(Mandatory=$false)]
    [string]$Profile,
    
    [Parameter(Mandatory=$false)]
    [int]$LogLines = 50,
    
    [Parameter(Mandatory=$false)]
    [switch]$ShowFullLogs
)

$ErrorActionPreference = "Stop"

# Color output helpers
function Write-Section { param([string]$Message) Write-Host "`n========================================" -ForegroundColor Cyan; Write-Host $Message -ForegroundColor Cyan; Write-Host "========================================" -ForegroundColor Cyan }
function Write-Success { param([string]$Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Failure { param([string]$Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }

# Build AWS CLI common arguments
$awsCommon = @("--region", $Region, "--output", "json")
if ($Profile) {
    $awsCommon = @("--profile", $Profile) + $awsCommon
}

function Invoke-AwsCommand {
    param(
        [string[]]$Arguments
    )
    
    $fullArgs = $Arguments + $awsCommon
    $result = aws @fullArgs 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI command failed: aws $($Arguments -join ' '). Error: $result"
    }
    
    return $result
}

function Get-ServiceInfo {
    Write-Section "SERVICE INFORMATION"
    
    try {
        $svcJson = Invoke-AwsCommand -Arguments @("ecs", "describe-services", "--cluster", $Cluster, "--services", $Service)
        $svc = ($svcJson | ConvertFrom-Json).services[0]
        
        if (-not $svc) {
            Write-Failure "Service '$Service' not found in cluster '$Cluster'"
            exit 1
        }
        
        Write-Info "Service: $($svc.serviceName)"
        Write-Info "Status: $($svc.status)"
        Write-Info "Running Tasks: $($svc.runningCount)"
        Write-Info "Desired Tasks: $($svc.desiredCount)"
        Write-Info "Pending Tasks: $($svc.pendingCount)"
        Write-Info "Task Definition: $($svc.taskDefinition)"
        
        if ($svc.deployments.Count -gt 0) {
            Write-Host "`nDeployments:" -ForegroundColor White
            $svc.deployments | ForEach-Object {
                $status = $_.status
                $statusColor = switch ($status) {
                    "PRIMARY" { "Green" }
                    "ACTIVE" { "Yellow" }
                    default { "Gray" }
                }
                Write-Host "  - Status: $status, Running: $($_.runningCount), Desired: $($_.desiredCount), Pending: $($_.pendingCount)" -ForegroundColor $statusColor
                Write-Host "    Task Definition: $($_.taskDefinition)" -ForegroundColor Gray
            }
        }
        
        return $svc
    } catch {
        Write-Failure "Failed to retrieve service information: $($_.Exception.Message)"
        exit 1
    }
}

function Get-ServiceEvents {
    param([object]$Service)
    
    Write-Section "SERVICE EVENTS (Last 20)"
    
    try {
        if ($Service.events.Count -eq 0) {
            Write-Info "No service events found"
            return
        }
        
        $Service.events | Select-Object -First 20 | ForEach-Object {
            $createdAt = $_.createdAt
            $message = $_.message
            
            # Color code based on message content
            $color = "White"
            if ($message -match "failed|error|unable|unhealthy") {
                $color = "Red"
            } elseif ($message -match "warning|stopping") {
                $color = "Yellow"
            } elseif ($message -match "started|healthy|reached") {
                $color = "Green"
            }
            
            Write-Host "$createdAt - $message" -ForegroundColor $color
        }
    } catch {
        Write-Warning "Failed to display service events: $($_.Exception.Message)"
    }
}

function Get-StoppedTasks {
    Write-Section "STOPPED TASKS (Last 10)"
    
    try {
        $tasksJson = Invoke-AwsCommand -Arguments @(
            "ecs", "list-tasks",
            "--cluster", $Cluster,
            "--service-name", $Service,
            "--desired-status", "STOPPED",
            "--max-items", "10"
        )
        
        $taskArns = ($tasksJson | ConvertFrom-Json).taskArns
        
        if (-not $taskArns -or $taskArns.Count -eq 0) {
            Write-Success "No stopped tasks (this is good!)"
            return
        }
        
        Write-Warning "Found $($taskArns.Count) stopped tasks"
        
        # Describe stopped tasks
        $tasksDetailJson = Invoke-AwsCommand -Arguments @(
            "ecs", "describe-tasks",
            "--cluster", $Cluster,
            "--tasks"
        ) + $taskArns
        
        $tasks = ($tasksDetailJson | ConvertFrom-Json).tasks
        
        $tasks | ForEach-Object {
            $task = $_
            $taskId = ($task.taskArn -split '/')[-1]
            
            Write-Host "`nTask: $taskId" -ForegroundColor Yellow
            Write-Host "  Stopped: $($task.stoppedAt)" -ForegroundColor Gray
            Write-Host "  Reason: $($task.stoppedReason)" -ForegroundColor $(if ($task.stoppedReason -match "Essential container") { "Red" } else { "Yellow" })
            
            if ($task.containers) {
                Write-Host "  Containers:" -ForegroundColor Gray
                $task.containers | ForEach-Object {
                    $container = $_
                    $exitCode = if ($null -ne $container.exitCode) { $container.exitCode } else { "N/A" }
                    $exitColor = if ($exitCode -eq 0) { "Green" } elseif ($exitCode -eq "N/A") { "Gray" } else { "Red" }
                    
                    Write-Host "    - $($container.name): Exit Code $exitCode" -ForegroundColor $exitColor
                    if ($container.reason) {
                        Write-Host "      Reason: $($container.reason)" -ForegroundColor Red
                    }
                }
            }
            
            if ($task.stopCode) {
                Write-Host "  Stop Code: $($task.stopCode)" -ForegroundColor Red
            }
        }
        
    } catch {
        Write-Warning "Failed to retrieve stopped tasks: $($_.Exception.Message)"
    }
}

function Get-TargetHealth {
    param([object]$Service)
    
    Write-Section "TARGET HEALTH (ALB)"
    
    try {
        if (-not $Service.loadBalancers -or $Service.loadBalancers.Count -eq 0) {
            Write-Info "No load balancers attached to this service"
            return
        }
        
        $targetGroupArn = $Service.loadBalancers[0].targetGroupArn
        
        if (-not $targetGroupArn) {
            Write-Info "No target group ARN found"
            return
        }
        
        Write-Info "Target Group: $targetGroupArn"
        
        $healthJson = Invoke-AwsCommand -Arguments @(
            "elbv2", "describe-target-health",
            "--target-group-arn", $targetGroupArn
        )
        
        $targets = ($healthJson | ConvertFrom-Json).TargetHealthDescriptions
        
        if ($targets.Count -eq 0) {
            Write-Warning "No targets registered in target group"
            return
        }
        
        $targets | ForEach-Object {
            $target = $_
            $state = $target.TargetHealth.State
            $stateColor = switch ($state) {
                "healthy" { "Green" }
                "unhealthy" { "Red" }
                "initial" { "Yellow" }
                "draining" { "Yellow" }
                default { "Gray" }
            }
            
            Write-Host "  Target: $($target.Target.Id):$($target.Target.Port)" -ForegroundColor White
            Write-Host "    State: $state" -ForegroundColor $stateColor
            if ($target.TargetHealth.Reason) {
                Write-Host "    Reason: $($target.TargetHealth.Reason)" -ForegroundColor Gray
            }
            if ($target.TargetHealth.Description) {
                Write-Host "    Description: $($target.TargetHealth.Description)" -ForegroundColor Gray
            }
        }
        
    } catch {
        Write-Warning "Failed to retrieve target health: $($_.Exception.Message)"
    }
}

function Get-LogGroups {
    param([object]$Service)
    
    Write-Section "LOG GROUPS"
    
    try {
        # Get task definition to extract log group names
        $taskDefArn = $Service.taskDefinition
        $taskDefJson = Invoke-AwsCommand -Arguments @(
            "ecs", "describe-task-definition",
            "--task-definition", $taskDefArn
        )
        
        $taskDef = ($taskDefJson | ConvertFrom-Json).taskDefinition
        $logGroups = @()
        
        $taskDef.containerDefinitions | ForEach-Object {
            $container = $_
            if ($container.logConfiguration -and $container.logConfiguration.options.'awslogs-group') {
                $logGroup = $container.logConfiguration.options.'awslogs-group'
                $logGroups += @{
                    Container = $container.name
                    LogGroup = $logGroup
                }
            }
        }
        
        if ($logGroups.Count -eq 0) {
            Write-Warning "No CloudWatch log groups found in task definition"
            return
        }
        
        $logGroups | ForEach-Object {
            Write-Info "$($_.Container): $($_.LogGroup)"
        }
        
        return $logGroups
        
    } catch {
        Write-Warning "Failed to retrieve log groups: $($_.Exception.Message)"
        return @()
    }
}

function Get-RecentLogs {
    param(
        [array]$LogGroups,
        [int]$Lines
    )
    
    Write-Section "RECENT LOGS (Last $Lines lines per container)"
    
    if ($LogGroups.Count -eq 0) {
        Write-Warning "No log groups to query"
        return
    }
    
    foreach ($logInfo in $LogGroups) {
        $logGroup = $logInfo.LogGroup
        $container = $logInfo.Container
        
        Write-Host "`n--- $container ($logGroup) ---" -ForegroundColor White
        
        try {
            # Get the most recent log stream
            $streamsJson = Invoke-AwsCommand -Arguments @(
                "logs", "describe-log-streams",
                "--log-group-name", $logGroup,
                "--order-by", "LastEventTime",
                "--descending",
                "--max-items", "1"
            )
            
            $streams = ($streamsJson | ConvertFrom-Json).logStreams
            
            if (-not $streams -or $streams.Count -eq 0) {
                Write-Info "No log streams found"
                continue
            }
            
            $latestStream = $streams[0].logStreamName
            Write-Host "Latest stream: $latestStream" -ForegroundColor Gray
            
            # Get recent log events
            $logsJson = Invoke-AwsCommand -Arguments @(
                "logs", "get-log-events",
                "--log-group-name", $logGroup,
                "--log-stream-name", $latestStream,
                "--limit", $Lines.ToString()
            )
            
            $events = ($logsJson | ConvertFrom-Json).events
            
            if (-not $events -or $events.Count -eq 0) {
                Write-Info "No log events found"
                continue
            }
            
            # Display log events
            $events | ForEach-Object {
                $event = $_
                $timestamp = [DateTimeOffset]::FromUnixTimeMilliseconds($event.timestamp).ToString("yyyy-MM-dd HH:mm:ss")
                $message = $event.message
                
                # Color code based on log level
                $color = "White"
                if ($message -match "ERROR|FATAL|Exception") {
                    $color = "Red"
                } elseif ($message -match "WARN|WARNING") {
                    $color = "Yellow"
                } elseif ($message -match "INFO") {
                    $color = "Cyan"
                } elseif ($message -match "DEBUG|TRACE") {
                    $color = "Gray"
                }
                
                Write-Host "[$timestamp] $message" -ForegroundColor $color
            }
            
        } catch {
            Write-Warning "Failed to retrieve logs for $logGroup : $($_.Exception.Message)"
        }
    }
}

function Get-DiagnosticSummary {
    param([object]$Service)
    
    Write-Section "DIAGNOSTIC SUMMARY"
    
    $issues = @()
    $recommendations = @()
    
    # Check running vs desired count
    if ($Service.runningCount -lt $Service.desiredCount) {
        $issues += "⚠️  Running tasks ($($Service.runningCount)) less than desired ($($Service.desiredCount))"
        $recommendations += "Check stopped tasks for exit codes and container errors"
    }
    
    # Check for active deployments
    if ($Service.deployments.Count -gt 1) {
        $issues += "⚠️  Multiple deployments in progress ($($Service.deployments.Count))"
        $recommendations += "Wait for deployment to complete or check for rollback"
    }
    
    # Check service status
    if ($Service.status -ne "ACTIVE") {
        $issues += "❌ Service status is $($Service.status) (expected ACTIVE)"
        $recommendations += "Check service events for error messages"
    }
    
    if ($issues.Count -eq 0) {
        Write-Success "No critical issues detected"
        Write-Info "Service appears to be healthy"
    } else {
        Write-Host "Issues Found:" -ForegroundColor Yellow
        $issues | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
        Write-Host "`nRecommendations:" -ForegroundColor Cyan
        $recommendations | ForEach-Object { Write-Host "  • $_" -ForegroundColor Cyan }
    }
}

# Main execution
try {
    Write-Section "AFU-9 ECS Debug Harness"
    Write-Host "Cluster: $Cluster" -ForegroundColor White
    Write-Host "Service: $Service" -ForegroundColor White
    Write-Host "Region: $Region" -ForegroundColor White
    if ($Profile) {
        Write-Host "Profile: $Profile" -ForegroundColor White
    }
    
    # 1. Get service information
    $svc = Get-ServiceInfo
    
    # 2. Display service events
    Get-ServiceEvents -Service $svc
    
    # 3. Check stopped tasks
    Get-StoppedTasks
    
    # 4. Check target health
    Get-TargetHealth -Service $svc
    
    # 5. Get log groups
    $logGroups = Get-LogGroups -Service $svc
    
    # 6. Display recent logs
    if ($logGroups.Count -gt 0) {
        Get-RecentLogs -LogGroups $logGroups -Lines $LogLines
    }
    
    # 7. Diagnostic summary
    Get-DiagnosticSummary -Service $svc
    
    Write-Section "DEBUG COMPLETE"
    Write-Success "ECS debug harness completed successfully"
    Write-Info "For more details, check CloudWatch Logs console or use AWS CLI directly"
    
} catch {
    Write-Failure "Debug harness failed"
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    exit 1
}
