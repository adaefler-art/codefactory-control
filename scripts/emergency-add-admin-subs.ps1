Write-Host ""
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  Emergency Fix: Add AFU9_ADMIN_SUBS    ║" -ForegroundColor Magenta
Write-Host "║  (Affects BOTH Staging & Production)   ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ═══════════════════════════════════════
# 1. GET CURRENT TASK DEFINITION
# ═══════════════════════════════════════

Write-Host "Step 1: Fetching current Task Definition :430" -ForegroundColor Cyan
Write-Host ""

$CurrentTask = aws ecs describe-task-definition `
    --task-definition afu9-control-center:430 `
    --region eu-central-1 `
    --profile codefactory `
    --output json 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to fetch task definition" -ForegroundColor Red
    Write-Host $CurrentTask -ForegroundColor Red
    exit 1
}

$TaskDef = ($CurrentTask | ConvertFrom-Json).taskDefinition
$Container = $TaskDef.containerDefinitions[0]

Write-Host "Current Task Definition:" -ForegroundColor Green
Write-Host "  Family:    $($TaskDef.family)" -ForegroundColor White
Write-Host "  Revision:   $($TaskDef.revision)" -ForegroundColor White
Write-Host "  Used by:   Staging + Production" -ForegroundColor Yellow
Write-Host ""

# Check if AFU9_ADMIN_SUBS already exists
$ExistingAdminSubs = $Container.environment | Where-Object { $_.name -eq 'AFU9_ADMIN_SUBS' }

if ($ExistingAdminSubs) {
    Write-Host "✅ AFU9_ADMIN_SUBS already exists!" -ForegroundColor Green
    Write-Host "   Value: $($ExistingAdminSubs.value)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "No update needed - service just needs restart!" -ForegroundColor Yellow
    $NeedsUpdate = $false
} else {
    Write-Host "❌ AFU9_ADMIN_SUBS is missing" -ForegroundColor Red
    Write-Host ""
    Write-Host "Current environment variables:" -ForegroundColor Yellow
    $Container.environment | ForEach-Object {
        Write-Host "  - $($_.name)" -ForegroundColor Gray
    }
    Write-Host ""
    $NeedsUpdate = $true
}

# ═══════════════════════════════════════
# 2. CREATE NEW TASK DEFINITION
# ═══════════════════════════════════════

if ($NeedsUpdate) {
    Write-Host "Step 2: Creating new Task Definition with AFU9_ADMIN_SUBS" -ForegroundColor Cyan
    Write-Host ""
    
    # Add AFU9_ADMIN_SUBS to environment
    $Container.environment = @($Container.environment) + @{
        name = "AFU9_ADMIN_SUBS"
        value = "53b438e2-a081-7015-2a67-998775513d15"
    }
    
    # Build new task definition payload
    $NewTaskDefPayload = @{
        family = $TaskDef.family
        containerDefinitions = @($Container)
        taskRoleArn = $TaskDef.taskRoleArn
        executionRoleArn = $TaskDef.executionRoleArn
        networkMode = $TaskDef.networkMode
        requiresCompatibilities = $TaskDef.requiresCompatibilities
        cpu = $TaskDef.cpu
        memory = $TaskDef.memory
    }
    
    # Write to temp file
    $TempFile = Join-Path $env:TEMP "new-task-def.json"
    $NewTaskDefPayload | ConvertTo-Json -Depth 10 | Out-File -FilePath $TempFile -Encoding UTF8
    
    Write-Host "Registering new task definition revision..." -ForegroundColor Gray
    
    $RegisterResult = aws ecs register-task-definition `
        --cli-input-json "file://$TempFile" `
        --region eu-central-1 `
        --profile codefactory `
        --output json 2>&1
    
    Remove-Item $TempFile -ErrorAction SilentlyContinue
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to register new task definition" -ForegroundColor Red
        Write-Host $RegisterResult -ForegroundColor Red
        exit 1
    }
    
    $NewTaskDef = ($RegisterResult | ConvertFrom-Json).taskDefinition
    Write-Host "✅ New Task Definition registered!" -ForegroundColor Green
    Write-Host "   Revision: $($NewTaskDef.revision)" -ForegroundColor Cyan
    Write-Host ""
}

# ═══════════════════════════════════════
# 3. UPDATE STAGING SERVICE
# ═══════════════════════════════════════

Write-Host "Step 3: Updating STAGING Service" -ForegroundColor Cyan
Write-Host ""

Write-Host "⚠️  This will restart the Staging service!" -ForegroundColor Yellow
$Confirm = Read-Host "Proceed with Staging update? (yes/no)"

if ($Confirm -eq "yes") {
    aws ecs update-service `
        --cluster afu9-cluster `
        --service afu9-control-center-staging `
        --force-new-deployment `
        --region eu-central-1 `
        --profile codefactory
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Staging service update triggered!" -ForegroundColor Green
        Write-Host "⏱️  Waiting for service to stabilize (2-5 minutes)..." -ForegroundColor Yellow
        Write-Host ""
        
        aws ecs wait services-stable `
            --cluster afu9-cluster `
            --services afu9-control-center-staging `
            --region eu-central-1 `
            --profile codefactory
        
        Write-Host ""
        Write-Host "✅ Staging service is STABLE!" -ForegroundColor Green
        Write-Host ""
        
        # Verify new task is running with correct revision
        $RunningTasks = aws ecs list-tasks `
            --cluster afu9-cluster `
            --service-name afu9-control-center-staging `
            --region eu-central-1 `
            --profile codefactory `
            --output json | ConvertFrom-Json
        
        if ($RunningTasks.taskArns.Count -gt 0) {
            $TaskDetails = aws ecs describe-tasks `
                --cluster afu9-cluster `
                --tasks $RunningTasks.taskArns[0] `
                --region eu-central-1 `
                --profile codefactory `
                --output json | ConvertFrom-Json
            
            $RunningRevision = $TaskDetails.tasks[0].taskDefinitionArn.Split(':')[-1]
            Write-Host "Running Task Definition: :$RunningRevision" -ForegroundColor Cyan
        }
        
        Write-Host ""
        Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "║  ✅ STAGING SERVICE UPDATED!   ✅       ║" -ForegroundColor Green
        Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Green
        Write-Host ""
        Write-Host "🧪 Test now: https://stage.afu-9.com/ops/migrations" -ForegroundColor Cyan
        Write-Host ""
    } else {
        Write-Host "❌ Failed to update Staging service" -ForegroundColor Red
    }
} else {
    Write-Host "⏭️  Skipping Staging update" -ForegroundColor Gray
}

Write-Host ""

# ═══════════════════════════════════════
# 4. UPDATE PRODUCTION SERVICE (OPTIONAL)
# ═══════════════════════════════════════

Write-Host "Step 4: Update PRODUCTION Service (Optional)" -ForegroundColor Cyan
Write-Host ""

Write-Host "⚠️  WARNING: This will restart the PRODUCTION service!" -ForegroundColor Red
Write-Host "   Production users may experience brief downtime!" -ForegroundColor Yellow
Write-Host ""

$ConfirmProd = Read-Host "Update Production service? (yes/no)"

if ($ConfirmProd -eq "yes") {
    aws ecs update-service `
        --cluster afu9-cluster `
        --service afu9-control-center `
        --force-new-deployment `
        --region eu-central-1 `
        --profile codefactory
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Production service update triggered!" -ForegroundColor Green
        Write-Host "⏱️  Waiting for service to stabilize..." -ForegroundColor Yellow
        Write-Host ""
        
        aws ecs wait services-stable `
            --cluster afu9-cluster `
            --services afu9-control-center `
            --region eu-central-1 `
            --profile codefactory
        
        Write-Host ""
        Write-Host "✅ Production service is STABLE!" -ForegroundColor Green
    }
} else {
    Write-Host "⏭️  Skipping Production update" -ForegroundColor Gray
    Write-Host "   (You can update Production later)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "Emergency Fix Complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
