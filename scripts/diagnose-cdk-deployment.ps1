Write-Host ""
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  CDK Deployment Diagnose              ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ═══════════════════════════════════════
# 1. CHECK RECENT CLOUDFORMATION EVENTS
# ═══════════════════════════════════════

Write-Host "Step 1: Recent CloudFormation Stack Events (last 15 minutes)" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────" -ForegroundColor Gray
Write-Host ""

$Since = (Get-Date).AddMinutes(-15).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$RecentEvents = aws cloudformation describe-stack-events `
    --region eu-central-1 `
    --profile codefactory `
    --output json `
    --max-items 100 2>&1

if ($LASTEXITCODE -eq 0) {
    $Events = ($RecentEvents | ConvertFrom-Json).StackEvents | 
        Where-Object { $_.Timestamp -gt (Get-Date).AddMinutes(-15) } |
        Where-Object { $_.StackName -like '*afu9*' } |
        Sort-Object Timestamp -Descending
    
    if ($Events) {
        Write-Host "Recent AFU9 Stack Activity:" -ForegroundColor Green
        $Events | Select-Object -First 10 | ForEach-Object {
            $Color = switch ($_.ResourceStatus) {
                "CREATE_COMPLETE" { "Green" }
                "UPDATE_COMPLETE" { "Green" }
                "UPDATE_IN_PROGRESS" { "Yellow" }
                "CREATE_IN_PROGRESS" { "Yellow" }
                default { "Red" }
            }
            Write-Host "  $($_.Timestamp.ToString('HH:mm:ss'))" -NoNewline -ForegroundColor Gray
            Write-Host " | " -NoNewline
            Write-Host "$($_.StackName)" -NoNewline -ForegroundColor White
            Write-Host " | " -NoNewline
            Write-Host "$($_.ResourceStatus)" -ForegroundColor $Color
        }
    } else {
        Write-Host "⚠️  No recent AFU9 stack activity found!" -ForegroundColor Yellow
        Write-Host "   This suggests the deploy didn't happen or went to wrong region/account" -ForegroundColor Gray
    }
} else {
    Write-Host "❌ Failed to fetch CloudFormation events" -ForegroundColor Red
    Write-Host $RecentEvents -ForegroundColor Red
}

Write-Host ""

# ═══════════════════════════════════════
# 2. CHECK ALL AFU9 STACKS
# ═══════════════════════════════════════

Write-Host "Step 2: All AFU9 CloudFormation Stacks" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────" -ForegroundColor Gray
Write-Host ""

$AllStacks = aws cloudformation describe-stacks `
    --region eu-central-1 `
    --profile codefactory `
    --output json 2>&1

if ($LASTEXITCODE -eq 0) {
    $Afu9Stacks = ($AllStacks | ConvertFrom-Json).Stacks | 
        Where-Object { $_.StackName -like '*afu9*' } |
        Sort-Object LastUpdatedTime -Descending
    
    if ($Afu9Stacks) {
        $Afu9Stacks | ForEach-Object {
            $LastUpdated = if ($_.LastUpdatedTime) { $_.LastUpdatedTime } else { $_.CreationTime }
            $Age = (Get-Date) - [DateTime]$LastUpdated
            
            Write-Host "Stack: " -NoNewline
            Write-Host "$($_.StackName)" -ForegroundColor Cyan
            Write-Host "  Status:         $($_.StackStatus)" -ForegroundColor $(if ($_.StackStatus -like '*COMPLETE') {"Green"} else {"Yellow"})
            Write-Host "  Last Updated:  $LastUpdated" -NoNewline -ForegroundColor Gray
            Write-Host " ($([Math]::Round($Age.TotalMinutes, 1)) minutes ago)" -ForegroundColor DarkGray
            Write-Host ""
        }
    } else {
        Write-Host "❌ No AFU9 stacks found!" -ForegroundColor Red
    }
} else {
    Write-Host "❌ Failed to list stacks" -ForegroundColor Red
}

# ═══════════════════════════════════════
# 3. CHECK STAGING TASK DEFINITION
# ═══════════════════════════════════════

Write-Host "Step 3: Current Staging Task Definition" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────" -ForegroundColor Gray
Write-Host ""

$StagingTask = aws ecs describe-task-definition `
    --task-definition afu9-control-center-staging `
    --region eu-central-1 `
    --profile codefactory `
    --output json 2>&1

if ($LASTEXITCODE -eq 0) {
    $TaskDef = ($StagingTask | ConvertFrom-Json).taskDefinition
    $Container = $TaskDef.containerDefinitions[0]
    
    Write-Host "Task Family:     $($TaskDef.family)" -ForegroundColor White
    Write-Host "Revision:       $($TaskDef.revision)" -ForegroundColor White
    Write-Host "Registered at:  $($TaskDef.registeredAt)" -ForegroundColor Gray
    Write-Host ""
    
    $AdminSubsEnv = $Container.environment | Where-Object { $_.name -eq 'AFU9_ADMIN_SUBS' }
    
    if ($AdminSubsEnv) {
        Write-Host "✅ AFU9_ADMIN_SUBS found!" -ForegroundColor Green
        Write-Host "   Value: $($AdminSubsEnv.value)" -ForegroundColor Cyan
    } else {
        Write-Host "❌ AFU9_ADMIN_SUBS NOT FOUND!" -ForegroundColor Red
        Write-Host ""
        Write-Host "Current Environment Variables:" -ForegroundColor Yellow
        $Container.environment | ForEach-Object {
            Write-Host "  - $($_.name) = $($_.value)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "❌ Failed to describe task definition" -ForegroundColor Red
    Write-Host $StagingTask -ForegroundColor Red
}

Write-Host ""

# ═══════════════════════════════════════
# 4. CHECK RUNNING TASKS
# ═══════════════════════════════════════

Write-Host "Step 4: Running ECS Tasks" -ForegroundColor Yellow
Write-Host "────────────────────────────────────────" -ForegroundColor Gray
Write-Host ""

$RunningTasks = aws ecs list-tasks `
    --cluster afu9-cluster `
    --service-name afu9-control-center-staging `
    --region eu-central-1 `
    --profile codefactory `
    --output json 2>&1

if ($LASTEXITCODE -eq 0) {
    $TaskArns = ($RunningTasks | ConvertFrom-Json).taskArns
    
    if ($TaskArns -and $TaskArns.Count -gt 0) {
        $TaskDetails = aws ecs describe-tasks `
            --cluster afu9-cluster `
            --tasks $TaskArns `
            --region eu-central-1 `
            --profile codefactory `
            --output json | ConvertFrom-Json
        
        $TaskDetails.tasks | ForEach-Object {
            Write-Host "Task: $($_.taskArn.Split('/')[-1])" -ForegroundColor Cyan
            Write-Host "  Task Definition: $($_.taskDefinitionArn.Split('/')[-1])" -ForegroundColor White
            Write-Host "  Status:            $($_.lastStatus)" -ForegroundColor Green
            Write-Host "  Started:          $($_.startedAt)" -ForegroundColor Gray
            Write-Host ""
        }
    } else {
        Write-Host "⚠️  No running tasks found!" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Failed to list tasks" -ForegroundColor Red
}

Write-Host ""
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  Diagnosis Complete                   ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
