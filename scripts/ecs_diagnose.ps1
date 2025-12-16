<#
.SYNOPSIS
    AFU-9 ECS Deployment Diagnostics Script

.DESCRIPTION
    Automates ECS deployment diagnostics for AFU-9 Control Center.
    Collects service events, task states, logs, target health, and secret validation.
    Produces a compact summary report with recommended next steps.

.PARAMETER ClusterName
    ECS cluster name (default: afu9-cluster)

.PARAMETER ServiceName
    ECS service name (default: afu9-control-center-stage)

.PARAMETER Region
    AWS region (default: eu-central-1)

.PARAMETER OutputFile
    Optional: Save report to file

.EXAMPLE
    .\ecs_diagnose.ps1
    
.EXAMPLE
    .\ecs_diagnose.ps1 -ServiceName afu9-control-center-prod -OutputFile ecs-report.txt
#>

param(
    [string]$ClusterName = "afu9-cluster",
    [string]$ServiceName = "afu9-control-center-stage",
    [string]$Region = "eu-central-1",
    [string]$OutputFile = ""
)

$ErrorActionPreference = "Continue"

# ANSI color codes for terminal output
$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Magenta = "`e[35m"
$Cyan = "`e[36m"
$Reset = "`e[0m"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-SubHeader {
    param([string]$Text)
    Write-Host ""
    Write-Host "─── $Text ───" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Text)
    Write-Host "${Green}✓${Reset} $Text"
}

function Write-Warning {
    param([string]$Text)
    Write-Host "${Yellow}⚠${Reset} $Text"
}

function Write-Error {
    param([string]$Text)
    Write-Host "${Red}✗${Reset} $Text"
}

function Write-Info {
    param([string]$Text)
    Write-Host "${Cyan}ℹ${Reset} $Text"
}

# Start diagnostics
Write-Header "AFU-9 ECS Deployment Diagnostics"
Write-Host "Cluster: $ClusterName" -ForegroundColor White
Write-Host "Service: $ServiceName" -ForegroundColor White
Write-Host "Region: $Region" -ForegroundColor White
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White

$report = @()
$report += "AFU-9 ECS Deployment Diagnostics"
$report += "Cluster: $ClusterName"
$report += "Service: $ServiceName"
$report += "Region: $Region"
$report += "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$report += ""

# ============================================
# 1. Check Service Status and Events
# ============================================
Write-Header "1. Service Status and Events"

try {
    $serviceJson = aws ecs describe-services `
        --cluster $ClusterName `
        --services $ServiceName `
        --region $Region `
        --output json | ConvertFrom-Json
    
    if ($serviceJson.services.Count -eq 0) {
        Write-Error "Service not found: $ServiceName"
        $report += "[ERROR] Service not found: $ServiceName"
        exit 1
    }
    
    $service = $serviceJson.services[0]
    
    Write-Info "Status: $($service.status)"
    Write-Info "Desired Count: $($service.desiredCount)"
    Write-Info "Running Count: $($service.runningCount)"
    Write-Info "Pending Count: $($service.pendingCount)"
    
    $report += "Status: $($service.status)"
    $report += "Desired Count: $($service.desiredCount)"
    $report += "Running Count: $($service.runningCount)"
    $report += "Pending Count: $($service.pendingCount)"
    
    if ($service.runningCount -lt $service.desiredCount) {
        Write-Warning "Service is not at desired capacity!"
        $report += "[WARNING] Service is not at desired capacity!"
    } else {
        Write-Success "Service is at desired capacity"
        $report += "[OK] Service is at desired capacity"
    }
    
    Write-SubHeader "Recent Events (last 5)"
    $report += ""
    $report += "Recent Events:"
    
    $events = $service.events | Select-Object -First 5
    foreach ($event in $events) {
        $message = $event.message
        $timestamp = $event.createdAt
        
        Write-Host "  [$timestamp] $message"
        $report += "  [$timestamp] $message"
        
        # Flag critical errors
        if ($message -match "circuit breaker") {
            Write-Error "  → Circuit breaker triggered! Deployment failed."
            $report += "  [ERROR] Circuit breaker triggered!"
        }
        elseif ($message -match "unable to place") {
            Write-Error "  → Unable to place task! Check VPC/subnets."
            $report += "  [ERROR] Unable to place task!"
        }
        elseif ($message -match "failed to launch") {
            Write-Error "  → Task launch failed! Check IAM/task definition."
            $report += "  [ERROR] Task launch failed!"
        }
    }
    
} catch {
    Write-Error "Failed to describe service: $_"
    $report += "[ERROR] Failed to describe service: $_"
}

# ============================================
# 2. Check Stopped Tasks
# ============================================
Write-Header "2. Stopped Tasks Analysis"

try {
    $stoppedTasksJson = aws ecs list-tasks `
        --cluster $ClusterName `
        --service-name $ServiceName `
        --desired-status STOPPED `
        --region $Region `
        --max-items 5 `
        --output json | ConvertFrom-Json
    
    $stoppedTaskArns = $stoppedTasksJson.taskArns
    
    if ($stoppedTaskArns.Count -eq 0) {
        Write-Info "No stopped tasks found (service may be healthy)"
        $report += "[INFO] No stopped tasks found"
    } else {
        Write-Warning "Found $($stoppedTaskArns.Count) stopped tasks"
        $report += ""
        $report += "Stopped Tasks Analysis:"
        
        foreach ($taskArn in $stoppedTaskArns | Select-Object -First 3) {
            Write-SubHeader "Task: $($taskArn.Split('/')[-1])"
            
            $taskJson = aws ecs describe-tasks `
                --cluster $ClusterName `
                --tasks $taskArn `
                --region $Region `
                --output json | ConvertFrom-Json
            
            $task = $taskJson.tasks[0]
            $stoppedReason = $task.stoppedReason
            
            Write-Info "Stopped Reason: $stoppedReason"
            $report += "  Task: $($taskArn.Split('/')[-1])"
            $report += "    Stopped Reason: $stoppedReason"
            
            foreach ($container in $task.containers) {
                $exitCode = $container.exitCode
                $reason = $container.reason
                
                Write-Host "    Container: $($container.name)"
                Write-Host "      Exit Code: $exitCode"
                Write-Host "      Reason: $reason"
                
                $report += "    Container: $($container.name)"
                $report += "      Exit Code: $exitCode"
                $report += "      Reason: $reason"
                
                # Interpret exit codes
                if ($exitCode -eq 137) {
                    Write-Error "      → OOM (Out of Memory)! Increase task memory."
                    $report += "      [ERROR] OOM - Increase task memory!"
                }
                elseif ($exitCode -eq 1) {
                    Write-Warning "      → Generic error. Check logs."
                    $report += "      [WARNING] Generic error - Check logs"
                }
                elseif ($null -eq $exitCode -and $reason -match "health check") {
                    Write-Error "      → Health checks failed!"
                    $report += "      [ERROR] Health checks failed!"
                }
                elseif ($reason -match "CannotPullContainerError") {
                    Write-Error "      → Cannot pull image! Check ECR."
                    $report += "      [ERROR] Cannot pull image - Check ECR"
                }
                elseif ($reason -match "ResourceInitializationError") {
                    Write-Error "      → Resource init failed! Check secrets/IAM."
                    $report += "      [ERROR] Resource init failed - Check secrets/IAM"
                }
            }
        }
    }
    
} catch {
    Write-Error "Failed to list stopped tasks: $_"
    $report += "[ERROR] Failed to list stopped tasks: $_"
}

# ============================================
# 3. Check CloudWatch Logs (Recent Errors)
# ============================================
Write-Header "3. Recent CloudWatch Logs (Errors)"

$logGroups = @(
    "/ecs/afu9/control-center",
    "/ecs/afu9/mcp-github",
    "/ecs/afu9/mcp-deploy",
    "/ecs/afu9/mcp-observability"
)

$report += ""
$report += "Recent CloudWatch Logs (Errors):"

foreach ($logGroup in $logGroups) {
    Write-SubHeader "Log Group: $logGroup"
    
    try {
        # Get logs from last 15 minutes with error patterns
        $startTime = [Math]::Floor((Get-Date).AddMinutes(-15).ToUniversalTime().Subtract((Get-Date "1970-01-01")).TotalMilliseconds)
        
        $logsJson = aws logs filter-log-events `
            --log-group-name $logGroup `
            --start-time $startTime `
            --filter-pattern "?error ?exception ?fail ?Error ?Exception ?FATAL" `
            --region $Region `
            --max-items 5 `
            --output json 2>$null | ConvertFrom-Json
        
        if ($logsJson.events.Count -eq 0) {
            Write-Success "No errors found in last 15 minutes"
            $report += "  ${logGroup}: No errors"
        } else {
            Write-Warning "Found $($logsJson.events.Count) error events"
            $report += "  ${logGroup}: $($logsJson.events.Count) errors found"
            
            foreach ($event in $logsJson.events | Select-Object -First 3) {
                $message = $event.message.Substring(0, [Math]::Min(200, $event.message.Length))
                Write-Host "    $message" -ForegroundColor Yellow
                $report += "    $message"
            }
        }
    } catch {
        Write-Info "Log group not found or no access: $logGroup"
        $report += "  ${logGroup}: Not found or no access"
    }
}

# ============================================
# 4. Check Target Group Health
# ============================================
Write-Header "4. Target Group Health"

try {
    # Get target group ARN from service
    $targetGroupArn = $service.loadBalancers[0].targetGroupArn
    
    if ($null -ne $targetGroupArn) {
        Write-Info "Target Group: $targetGroupArn"
        
        $targetHealthJson = aws elbv2 describe-target-health `
            --target-group-arn $targetGroupArn `
            --region $Region `
            --output json | ConvertFrom-Json
        
        $report += ""
        $report += "Target Group Health:"
        
        foreach ($target in $targetHealthJson.targetHealthDescriptions) {
            $targetId = "$($target.target.id):$($target.target.port)"
            $state = $target.targetHealth.state
            $reason = $target.targetHealth.reason
            
            Write-Host "  Target: $targetId"
            Write-Host "    State: $state"
            
            $report += "  Target: $targetId"
            $report += "    State: $state"
            
            if ($state -eq "healthy") {
                Write-Success "    Status: Healthy"
                $report += "    Status: Healthy"
            } elseif ($state -eq "unhealthy") {
                Write-Error "    Status: Unhealthy - $reason"
                $report += "    [ERROR] Unhealthy - $reason"
            } elseif ($state -eq "draining") {
                Write-Warning "    Status: Draining"
                $report += "    [WARNING] Draining"
            } else {
                Write-Info "    Status: $state"
                $report += "    Status: $state"
            }
            
            if ($null -ne $reason) {
                Write-Host "    Reason: $reason"
                $report += "    Reason: $reason"
            }
        }
    } else {
        Write-Info "No target group attached"
        $report += "[INFO] No target group attached"
    }
} catch {
    Write-Warning "Failed to check target health: $_"
    $report += "[WARNING] Failed to check target health: $_"
}

# ============================================
# 5. Validate Secrets
# ============================================
Write-Header "5. Secrets Validation"

$secrets = @(
    @{Name="afu9/github"; RequiredKeys=@("token","owner","repo")},
    @{Name="afu9/llm"; RequiredKeys=@("openai_api_key","anthropic_api_key","deepseek_api_key")},
    @{Name="afu9/database"; RequiredKeys=@("host","port","database","username","password")}
)

$report += ""
$report += "Secrets Validation:"

foreach ($secret in $secrets) {
    Write-SubHeader "Secret: $($secret.Name)"
    
    try {
        # Check if secret exists
        $secretJson = aws secretsmanager describe-secret `
            --secret-id $secret.Name `
            --region $Region `
            --output json 2>$null | ConvertFrom-Json
        
        if ($null -eq $secretJson) {
            Write-Error "Secret not found: $($secret.Name)"
            $report += "  $($secret.Name): [ERROR] Not found"
            continue
        }
        
        Write-Success "Secret exists: $($secret.Name)"
        $report += "  $($secret.Name): Exists"
        
        # Validate keys
        $secretValueJson = aws secretsmanager get-secret-value `
            --secret-id $secret.Name `
            --region $Region `
            --query 'SecretString' `
            --output text 2>$null | ConvertFrom-Json
        
        $missingKeys = @()
        foreach ($key in $secret.RequiredKeys) {
            if (-not $secretValueJson.PSObject.Properties[$key]) {
                $missingKeys += $key
            }
        }
        
        if ($missingKeys.Count -gt 0) {
            Write-Error "  Missing keys: $($missingKeys -join ', ')"
            $report += "    [ERROR] Missing keys: $($missingKeys -join ', ')"
        } else {
            Write-Success "  All required keys present"
            $report += "    All required keys present"
        }
        
    } catch {
        if ($secret.Name -eq "afu9/database") {
            Write-Warning "Database secret not found (may be disabled)"
            $report += "  $($secret.Name): [WARNING] Not found (may be disabled)"
        } else {
            Write-Error "Failed to validate secret: $_"
            $report += "  $($secret.Name): [ERROR] Failed to validate: $_"
        }
    }
}

# ============================================
# Summary and Recommendations
# ============================================
Write-Header "Summary and Recommendations"

$report += ""
$report += "═══════════════════════════════════════════════════════════════"
$report += "Summary and Recommendations"
$report += "═══════════════════════════════════════════════════════════════"

Write-Info "Analysis complete. Review the diagnostics above."
$report += "Analysis complete."

# Analyze and provide recommendations
$recommendations = @()

if ($service.runningCount -lt $service.desiredCount) {
    $recommendations += "• Service is not at desired capacity. Check stopped tasks and logs."
}

if ($stoppedTaskArns.Count -gt 0) {
    $recommendations += "• Recent task failures detected. Review stopped task exit codes and reasons."
}

if ($targetHealthJson.targetHealthDescriptions | Where-Object { $_.targetHealth.state -eq "unhealthy" }) {
    $recommendations += "• Unhealthy targets detected. Check /api/ready endpoint and application logs."
}

# Check for common patterns in events
$circuitBreakerTriggered = $service.events | Where-Object { $_.message -match "circuit breaker" } | Select-Object -First 1
if ($null -ne $circuitBreakerTriggered) {
    $recommendations += "• Circuit breaker triggered. Review health checks and container logs."
}

if ($recommendations.Count -eq 0) {
    Write-Success "No critical issues detected. Service appears healthy."
    $report += ""
    $report += "[OK] No critical issues detected."
} else {
    Write-Warning "Recommendations:"
    $report += ""
    $report += "Recommendations:"
    
    foreach ($rec in $recommendations) {
        Write-Host "  $rec" -ForegroundColor Yellow
        $report += "  $rec"
    }
}

Write-Info ""
Write-Info "For detailed troubleshooting steps, see: docs/RUNBOOK_ECS_DEPLOY.md"
$report += ""
$report += "For detailed troubleshooting steps, see: docs/RUNBOOK_ECS_DEPLOY.md"

# ============================================
# Output to File
# ============================================
if ($OutputFile -ne "") {
    $report | Out-File -FilePath $OutputFile -Encoding UTF8
    Write-Success "Report saved to: $OutputFile"
}

Write-Host ""
