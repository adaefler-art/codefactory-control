#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Pause PROD environment (Low-Cost Mode)

.DESCRIPTION
    This script enables Low-Cost Pause Mode for the PROD environment by:
    - Setting ECS desired count to 0
    - Disabling PROD ALB routing (returns 503)
    - Keeping STAGE and RDS fully operational

    This is a reversible operation. Use resume-prod.ps1 to restore PROD.

.PARAMETER SkipConfirmation
    Skip confirmation prompt and proceed immediately

.EXAMPLE
    .\scripts\pause-prod.ps1
    # Prompts for confirmation before pausing

.EXAMPLE
    .\scripts\pause-prod.ps1 -SkipConfirmation
    # Pauses PROD without confirmation

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
Write-Host "  AFU-9 Low-Cost Pause Mode - PAUSE PROD" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "bin/codefactory-control.ts")) {
    Write-Host "❌ Error: Must run from repository root directory" -ForegroundColor Red
    exit 1
}

# Check if CDK is available
try {
    $cdkVersion = cdk --version 2>&1 | Out-String
    Write-Host "✓ CDK is available: $($cdkVersion.Trim())" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: AWS CDK not found. Please install it first." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "This will:" -ForegroundColor Yellow
Write-Host "  • Set PROD ECS desired count to 0 (stop all tasks)" -ForegroundColor Yellow
Write-Host "  • Configure PROD ALB to return HTTP 503" -ForegroundColor Yellow
Write-Host "  • Reduce PROD costs by ~90-95%" -ForegroundColor Yellow
Write-Host ""
Write-Host "This will NOT affect:" -ForegroundColor Green
Write-Host "  • STAGE environment (continues running normally)" -ForegroundColor Green
Write-Host "  • RDS database (remains active)" -ForegroundColor Green
Write-Host "  • Network infrastructure (VPC, subnets, etc.)" -ForegroundColor Green
Write-Host ""

if (-not $SkipConfirmation) {
    $confirmation = Read-Host "Pause PROD environment? (yes/no)"
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
    cdk diff Afu9EcsProdStack -c afu9-prod-paused=true -c afu9-multi-env=true

    Write-Host ""
    Write-Host "Checking routing stack changes..." -ForegroundColor White
    cdk diff Afu9RoutingStack -c afu9-prod-paused=true -c afu9-multi-env=true

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
Write-Host "Step 2: Deploying pause configuration" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

try {
    cdk deploy Afu9EcsProdStack Afu9RoutingStack `
        -c afu9-prod-paused=true `
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
    Write-Host "  3. Review CDK diff output for unexpected changes" -ForegroundColor Yellow
    Write-Host "  4. See docs/runbooks/LOW_COST_MODE.md for troubleshooting" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 3: Verifying pause state" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Start-Sleep -Seconds 5

try {
    Write-Host "Checking ECS service status..." -ForegroundColor White
    $ecsStatus = aws ecs describe-services `
        --cluster afu9-cluster `
        --services afu9-control-center-prod `
        --query 'services[0].[desiredCount,runningCount]' `
        --output json | ConvertFrom-Json

    Write-Host "  Desired count: $($ecsStatus[0])" -ForegroundColor $(if ($ecsStatus[0] -eq 0) { "Green" } else { "Yellow" })
    Write-Host "  Running count: $($ecsStatus[1])" -ForegroundColor $(if ($ecsStatus[1] -eq 0) { "Green" } else { "Yellow" })

    if ($ecsStatus[0] -ne 0) {
        Write-Host "  ⚠️  Warning: Desired count is not 0. Tasks may still be running." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠️  Could not verify ECS status: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✓ PROD environment paused successfully!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  • Verify PROD returns 503: curl -I https://prod.afu-9.com" -ForegroundColor White
Write-Host "  • Verify STAGE still works: curl -I https://stage.afu-9.com" -ForegroundColor White
Write-Host "  • Monitor AWS costs over the next few days" -ForegroundColor White
Write-Host "  • To resume PROD, run: .\scripts\resume-prod.ps1" -ForegroundColor White
Write-Host ""
Write-Host "See docs/runbooks/LOW_COST_MODE.md for more information" -ForegroundColor Gray
Write-Host ""
