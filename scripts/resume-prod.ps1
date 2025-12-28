#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Resume PROD environment (Disable Low-Cost Mode)

.DESCRIPTION
    This script disables Low-Cost Pause Mode for the PROD environment by:
    - Setting ECS desired count back to 2
    - Enabling PROD ALB routing (forward to target group)
    - Restoring normal PROD operations

    This reverses the changes made by pause-prod.ps1.

.PARAMETER SkipConfirmation
    Skip confirmation prompt and proceed immediately

.EXAMPLE
    .\scripts\resume-prod.ps1
    # Prompts for confirmation before resuming

.EXAMPLE
    .\scripts\resume-prod.ps1 -SkipConfirmation
    # Resumes PROD without confirmation

.NOTES
    Version: 1.0
    Author: AFU-9 Team
    Requires: AWS CDK, valid AWS credentials
#>

param(
    [switch]$SkipConfirmation
)

$ErrorActionPreference = "Stop"

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  AFU-9 Low-Cost Pause Mode - RESUME PROD" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "bin/codefactory-control.ts")) {
    Write-Host "❌ Error: Must run from repository root directory" -ForegroundColor Red
    exit 1
}

# Check if CDK is available
try {
    $null = Get-Command cdk -ErrorAction Stop
    $cdkVersion = cdk --version 2>&1 | Out-String
    Write-Host "✓ CDK is available: $($cdkVersion.Trim())" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: AWS CDK not found. Please install it first." -ForegroundColor Red
    Write-Host "   Install with: npm install -g aws-cdk" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "This will:" -ForegroundColor Yellow
Write-Host "  • Set PROD ECS desired count to 2 (start tasks)" -ForegroundColor Yellow
Write-Host "  • Configure PROD ALB to forward traffic to tasks" -ForegroundColor Yellow
Write-Host "  • Restore normal PROD operations" -ForegroundColor Yellow
Write-Host "  • Increase PROD costs back to normal levels" -ForegroundColor Yellow
Write-Host ""
Write-Host "Expected resume time: 3-7 minutes" -ForegroundColor Cyan
Write-Host ""

if (-not $SkipConfirmation) {
    $confirmation = Read-Host "Resume PROD environment? (yes/no)"
    if ($confirmation -ne "yes") {
        Write-Host "❌ Operation cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 1: Previewing changes with CDK diff" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

try {
    Write-Host "Checking PROD ECS stack changes..." -ForegroundColor White
    cdk diff Afu9EcsProdStack -c afu9-prod-paused=false -c afu9-multi-env=true

    Write-Host ""
    Write-Host "Checking routing stack changes..." -ForegroundColor White
    cdk diff Afu9RoutingStack -c afu9-prod-paused=false -c afu9-multi-env=true

    Write-Host ""
    Write-Host "✓ Diff preview complete" -ForegroundColor Green
} catch {
    Write-Host "❌ Error during diff preview: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
if (-not $SkipConfirmation) {
    $proceedDeploy = Read-Host "Proceed with deployment? (yes/no)"
    if ($proceedDeploy -ne "yes") {
        Write-Host "❌ Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 2: Deploying resume configuration" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

try {
    cdk deploy Afu9EcsProdStack Afu9RoutingStack `
        -c afu9-prod-paused=false `
        -c afu9-multi-env=true `
        --require-approval never

    Write-Host ""
    Write-Host "✓ Deployment complete" -ForegroundColor Green
} catch {
    Write-Host "❌ Error during deployment: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "  1. Check CloudFormation console for detailed errors" -ForegroundColor Yellow
    Write-Host "  2. Verify AWS credentials are valid" -ForegroundColor Yellow
    Write-Host "  3. Check if ECR images are available" -ForegroundColor Yellow
    Write-Host "  4. See docs/runbooks/LOW_COST_MODE.md for troubleshooting" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 3: Waiting for tasks to start" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "Waiting for ECS service to stabilize (this may take 3-7 minutes)..." -ForegroundColor White

try {
    aws ecs wait services-stable `
        --cluster afu9-cluster `
        --services afu9-control-center-prod

    Write-Host "✓ ECS service is stable" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Warning: Timeout waiting for service to stabilize" -ForegroundColor Yellow
    Write-Host "   Service may still be starting up. Check status manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 4: Verifying resume state" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

try {
    Write-Host "Checking ECS service status..." -ForegroundColor White
    $ecsStatus = aws ecs describe-services `
        --cluster afu9-cluster `
        --services afu9-control-center-prod `
        --query 'services[0].[desiredCount,runningCount]' `
        --output json | ConvertFrom-Json

    Write-Host "  Desired count: $($ecsStatus[0])" -ForegroundColor $(if ($ecsStatus[0] -eq 2) { "Green" } else { "Yellow" })
    Write-Host "  Running count: $($ecsStatus[1])" -ForegroundColor $(if ($ecsStatus[1] -eq 2) { "Green" } else { "Yellow" })

    if ($ecsStatus[0] -ne 2 -or $ecsStatus[1] -ne 2) {
        Write-Host "  ⚠️  Warning: Expected 2/2 tasks. Service may still be starting." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Could not verify ECS status: $_" -ForegroundColor Yellow
}

Write-Host ""
try {
    Write-Host "Checking PROD endpoint health..." -ForegroundColor White
    
    # Give ALB a moment to update health checks
    Start-Sleep -Seconds 10
    
    $healthResponse = Invoke-WebRequest -Uri "https://prod.afu-9.com/api/health" -Method GET -UseBasicParsing -ErrorAction SilentlyContinue
    
    if ($healthResponse.StatusCode -eq 200) {
        Write-Host "  ✓ PROD health check passed (HTTP 200)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Health check returned: $($healthResponse.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Could not reach PROD endpoint. It may still be warming up." -ForegroundColor Yellow
    Write-Host "     Wait a few more minutes and check manually: curl https://prod.afu-9.com/api/health" -ForegroundColor Gray
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✓ PROD environment resume complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  • Verify PROD is responding: curl https://prod.afu-9.com/api/health" -ForegroundColor White
Write-Host "  • Check application logs for any startup issues" -ForegroundColor White
Write-Host "  • Monitor CloudWatch alarms for the next hour" -ForegroundColor White
Write-Host "  • Test PROD functionality to ensure everything works" -ForegroundColor White
Write-Host ""
Write-Host "If PROD is not responding:" -ForegroundColor Yellow
Write-Host "  1. Wait 5-10 more minutes for full warmup" -ForegroundColor Gray
Write-Host "  2. Check ECS task logs in CloudWatch" -ForegroundColor Gray
Write-Host "  3. Review ALB target health status" -ForegroundColor Gray
Write-Host "  4. See docs/runbooks/LOW_COST_MODE.md for troubleshooting" -ForegroundColor Gray
Write-Host ""
Write-Host "See docs/runbooks/LOW_COST_MODE.md for more information" -ForegroundColor Gray
Write-Host ""
