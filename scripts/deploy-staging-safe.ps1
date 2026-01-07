Write-Host ""
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Red
Write-Host "║  ⚠️  SAFETY CHECK - STAGING ONLY ⚠️    ║" -ForegroundColor Red
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

cd C:\dev\codefactory\afu9-infrastructure

# ═══════════════════════════════════════
# 1. LIST ALL AVAILABLE STACKS
# ═══════════════════════════════════════

Write-Host "Available CDK Stacks in this app:" -ForegroundColor Cyan
Write-Host ""

cdk list --profile codefactory

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Gray
Write-Host ""

# ═══════════════════════════════════════
# 2. VERIFY WHICH STACK WE'LL DEPLOY
# ═══════════════════════════════════════

$TargetStack = "afu9-control-center-staging-stack"

Write-Host "Target Stack for Deployment:" -ForegroundColor Yellow
Write-Host "  $TargetStack" -ForegroundColor Cyan
Write-Host ""

# Check if this stack exists
$AllStacks = cdk list --profile codefactory 2>&1
if ($AllStacks -notcontains $TargetStack) {
    Write-Host "❌ ERROR: Stack '$TargetStack' not found in CDK app!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available stacks:" -ForegroundColor Yellow
    Write-Host $AllStacks
    exit 1
}

# ═══════════════════════════════════════
# 3. CHECK CURRENT AWS RESOURCES
# ═══════════════════════════════════════

Write-Host "Current AWS Resources:" -ForegroundColor Cyan
Write-Host ""

# Check CloudFormation Stacks
Write-Host "CloudFormation Stacks:" -ForegroundColor Yellow
$CfnStacks = aws cloudformation describe-stacks `
    --region eu-central-1 `
    --profile codefactory `
    --output json 2>&1

if ($LASTEXITCODE -eq 0) {
    ($CfnStacks | ConvertFrom-Json).Stacks | 
        Where-Object { $_.StackName -like '*afu9-control-center*' } |
        ForEach-Object {
            $EnvType = if ($_.StackName -like '*staging*') { 
                "STAGING" 
            } elseif ($_.StackName -like '*prod*') { 
                "PRODUCTION" 
            } else { 
                "UNKNOWN" 
            }
            
            $Color = if ($EnvType -eq "STAGING") { "Cyan" } else { "Red" }
            
            Write-Host "  [$EnvType] " -NoNewline -ForegroundColor $Color
            Write-Host "$($_.StackName)" -NoNewline -ForegroundColor White
            Write-Host " ($($_.StackStatus))" -ForegroundColor Gray
        }
}

Write-Host ""

# Check ECS Services
Write-Host "ECS Services:" -ForegroundColor Yellow
$EcsServices = aws ecs list-services `
    --cluster afu9-cluster `
    --region eu-central-1 `
    --profile codefactory `
    --output json 2>&1

if ($LASTEXITCODE -eq 0) {
    ($EcsServices | ConvertFrom-Json).serviceArns | ForEach-Object {
        $ServiceName = $_.Split('/')[-1]
        $EnvType = if ($ServiceName -like '*staging*') { 
            "STAGING" 
        } elseif ($ServiceName -like '*prod*') { 
            "PRODUCTION" 
        } else { 
            "UNKNOWN" 
        }
        
        $Color = if ($EnvType -eq "STAGING") { "Cyan" } else { "Red" }
        Write-Host "  [$EnvType] " -NoNewline -ForegroundColor $Color
        Write-Host "$ServiceName" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Gray
Write-Host ""

# ═══════════════════════════════════════
# 4. FINAL CONFIRMATION
# ═══════════════════════════════════════

Write-Host "⚠️  FINAL SAFETY CHECK ⚠️" -ForegroundColor Red
Write-Host ""
Write-Host "You are about to deploy:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Stack:         $TargetStack" -ForegroundColor Cyan
Write-Host "  Environment:  STAGING" -ForegroundColor Cyan
Write-Host "  Region:       eu-central-1" -ForegroundColor Cyan
Write-Host "  Profile:      codefactory" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will UPDATE the STAGING environment ONLY!" -ForegroundColor Yellow
Write-Host "Production will NOT be affected!" -ForegroundColor Green
Write-Host ""

$Confirm = Read-Host "Type 'STAGING' to confirm deployment to staging environment"

if ($Confirm -ne "STAGING") {
    Write-Host ""
    Write-Host "❌ Deployment cancelled - confirmation failed" -ForegroundColor Red
    Write-Host "   You typed: '$Confirm'" -ForegroundColor Gray
    Write-Host "   Expected:   'STAGING'" -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "✅ Safety check passed - proceeding with STAGING deployment" -ForegroundColor Green
Write-Host ""

# ═══════════════════════════════════════
# 5. CDK DIFF - SHOW WHAT WILL CHANGE
# ═══════════════════════════════════════

Write-Host "CDK Diff - Changes to be deployed:" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Gray
Write-Host ""

cdk diff $TargetStack --profile codefactory

Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Gray
Write-Host ""

$ProceedDeploy = Read-Host "Proceed with deployment? (yes/no)"

if ($ProceedDeploy -ne "yes") {
    Write-Host "❌ Deployment cancelled by user" -ForegroundColor Red
    exit 0
}

# ═══════════════════════════════════════
# 6. DEPLOY TO STAGING
# ═══════════════════════════════════════

Write-Host ""
Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  Starting STAGING Deployment...        ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Host "⏱️  This will take 5-10 minutes..." -ForegroundColor Yellow
Write-Host ""

cdk deploy $TargetStack `
    --profile codefactory `
    --require-approval never

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  ✅ STAGING DEPLOYMENT SUCCESSFUL!  ✅  ║" -ForegroundColor Green
    Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    
    # Verify deployment
    Write-Host "Verifying STAGING deployment..." -ForegroundColor Cyan
    Write-Host ""
    
    Start-Sleep -Seconds 10
    
    $StagingTask = aws ecs describe-task-definition `
        --task-definition afu9-control-center-staging `
        --region eu-central-1 `
        --profile codefactory `
        --output json 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $TaskDef = ($StagingTask | ConvertFrom-Json).taskDefinition
        $Container = $TaskDef.containerDefinitions[0]
        $AdminSubs = $Container.environment | Where-Object { $_.name -eq 'AFU9_ADMIN_SUBS' }
        
        Write-Host "Task Definition: $($TaskDef.family):$($TaskDef.revision)" -ForegroundColor White
        Write-Host ""
        
        if ($AdminSubs) {
            Write-Host "✅ AFU9_ADMIN_SUBS deployed successfully!" -ForegroundColor Green
            Write-Host "   Value: $($AdminSubs.value)" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Green
            Write-Host "║  🎉 DEPLOYMENT COMPLETE! 🎉            ║" -ForegroundColor Green
            Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Green
            Write-Host ""
            Write-Host "Next Steps:" -ForegroundColor Yellow
            Write-Host "  1. Wait for ECS service to stabilize (~2-3 minutes)" -ForegroundColor Gray
            Write-Host "  2. Test Migration Parity Check:" -ForegroundColor Gray
            Write-Host "     https://stage.afu-9.com/ops/migrations" -ForegroundColor Cyan
            Write-Host ""
        } else {
            Write-Host "⚠️  Deployment succeeded but AFU9_ADMIN_SUBS not found!" -ForegroundColor Yellow
            Write-Host "   This is unexpected - check your CDK code!" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Current environment variables:" -ForegroundColor Yellow
            $Container.environment | ForEach-Object {
                Write-Host "  - $($_.name)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "⚠️  Could not verify task definition" -ForegroundColor Yellow
        Write-Host $StagingTask -ForegroundColor Red
    }
    
} else {
    Write-Host ""
    Write-Host "❌ STAGING Deployment failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check CloudFormation console for details:" -ForegroundColor Yellow
    Write-Host "https://eu-central-1.console.aws.amazon.com/cloudformation/home?region=eu-central-1#/stacks" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Look for stack: $TargetStack" -ForegroundColor Gray
}
