param(
    [Parameter(Mandatory = $true)][string]$Cluster,
    [Parameter(Mandatory = $true)][string]$Service,
    [string]$Region = "eu-central-1",
    [string]$Profile
)

function Invoke-Aws {
    param([string[]]$Args)
    & aws @Args
}

$common = @("--region", $Region)
if ($Profile) { $common += @("--profile", $Profile) }

Write-Host "# Service events (last 20)" -ForegroundColor Cyan
$svcArgs = @("ecs", "describe-services", "--cluster", $Cluster, "--services", $Service) + $common
$svcJson = Invoke-Aws -Args $svcArgs | ConvertFrom-Json
if ($svcJson.services.Count -eq 0) {
    Write-Warning "Service not found"
    exit 1
}
$svc = $svcJson.services[0]
$svc.events | Select-Object -First 20 | Select-Object createdAt, message | Format-Table -AutoSize

Write-Host "`n# Stopped tasks (last 10) with exit codes" -ForegroundColor Cyan
$listArgs = @("ecs", "list-tasks", "--cluster", $Cluster, "--service-name", $Service, "--desired-status", "STOPPED", "--max-items", "10") + $common + @("--query", "taskArns", "--output", "text")
$tasksText = Invoke-Aws -Args $listArgs
if ($tasksText) {
    $taskArns = $tasksText -split "\s+" | Where-Object { $_ }
    if ($taskArns.Count -gt 0) {
        $describeArgs = @("ecs", "describe-tasks", "--cluster", $Cluster, "--tasks") + $taskArns + $common + @("--query", "tasks[].{task:taskArn,stopped:stoppedReason,containers:containers[].{name:name,exit:exitCode,reason:reason}}", "--output", "table")
        Invoke-Aws -Args $describeArgs
    }
} else {
    Write-Host "No stopped tasks." -ForegroundColor DarkGray
}

Write-Host "`n# Target health" -ForegroundColor Cyan
$tgArn = $svc.loadBalancers | Select-Object -First 1 | ForEach-Object { $_.targetGroupArn }
if ($tgArn) {
    $tgArgs = @("elbv2", "describe-target-health", "--target-group-arn", $tgArn) + $common + @("--query", "TargetHealthDescriptions[].{target:Target.Id,state:TargetHealth.State,desc:TargetHealth.Description}", "--output", "table")
    Invoke-Aws -Args $tgArgs
} else {
    Write-Host "No target group attached." -ForegroundColor DarkGray
}

Write-Host "`n# Log groups from task definition" -ForegroundColor Cyan
$taskDefArn = $svc.taskDefinition
if ($taskDefArn) {
    $taskDefArgs = @("ecs", "describe-task-definition", "--task-definition", $taskDefArn) + $common + @("--query", "taskDefinition.containerDefinitions[].logConfiguration.options.'awslogs-group'", "--output", "text")
    Invoke-Aws -Args $taskDefArgs
} else {
    Write-Host "Task definition not found." -ForegroundColor DarkGray
}
