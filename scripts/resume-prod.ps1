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
    [switch]$SkipConfirmation,

    [Parameter(Mandatory = $false)]
    [string]$DomainName
)

$ErrorActionPreference = "Stop"

Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  AFU-9 Low-Cost Pause Mode - RESUME PROD" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "bin/codefactory-control.ts")) {
    Write-Host "[ERROR] Must run from repository root directory" -ForegroundColor Red
    exit 1
}

# Check if CDK is available
try {
    $null = Get-Command cdk -ErrorAction Stop
    $cdkVersion = cdk --version 2>&1 | Out-String
    Write-Host "[OK] CDK is available: $($cdkVersion.Trim())" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] AWS CDK not found. Please install it first." -ForegroundColor Red
    Write-Host "   Install with: npm install -g aws-cdk" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "This will:" -ForegroundColor Yellow
Write-Host "  - Set PROD ECS desired count back to normal" -ForegroundColor Yellow
Write-Host "  - Remove PROD 503 fixed-response rule" -ForegroundColor Yellow
Write-Host "  - Restore normal PROD operations" -ForegroundColor Yellow
Write-Host ""
Write-Host "Expected resume time: 3-7 minutes" -ForegroundColor Cyan
Write-Host ""

if (-not $SkipConfirmation) {
    $confirmation = Read-Host "Resume PROD environment? (yes/no)"
    if ($confirmation -ne "yes") {
        Write-Host "[CANCELLED] Operation cancelled" -ForegroundColor Yellow
        exit 0
    }
}

function Get-CfnExportValue([string]$exportName) {
    $value = & aws cloudformation list-exports --query "Exports[?Name=='$exportName'].Value | [0]" --output text 2>&1
    if ($LASTEXITCODE -ne 0 -or -not $value -or $value -eq 'None') { return $null }
    return $value.Trim()
}

function Remove-FixedResponse503Rules([string]$listenerArn, [string[]]$hosts) {
    if (-not $listenerArn) { return }
    $rulesJson = & aws elbv2 describe-rules --listener-arn $listenerArn --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to describe listener rules: $rulesJson" }
    $rules = $rulesJson | ConvertFrom-Json

    foreach ($r in $rules.Rules) {
        if (-not $r.RuleArn) { continue }
        if ($r.IsDefault -eq $true) { continue }
        if (-not $r.Actions -or $r.Actions.Count -lt 1) { continue }
        if ($r.Actions[0].Type -ne 'fixed-response') { continue }
        if (-not $r.Actions[0].FixedResponseConfig) { continue }
        if ($r.Actions[0].FixedResponseConfig.StatusCode -ne '503') { continue }
        $hostCond = $r.Conditions | Where-Object { $_.Field -eq 'host-header' } | Select-Object -First 1
        if (-not $hostCond -or -not $hostCond.HostHeaderConfig -or -not $hostCond.HostHeaderConfig.Values) { continue }
        $existingHosts = @($hostCond.HostHeaderConfig.Values)
        $matches = $true
        foreach ($h in $hosts) {
            if ($existingHosts -notcontains $h) { $matches = $false; break }
        }
        if (-not $matches) { continue }

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'aws'
        $psi.Arguments = "elbv2 delete-rule --rule-arn $($r.RuleArn)"
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $p = New-Object System.Diagnostics.Process
        $p.StartInfo = $psi
        [void]$p.Start()
        $stdout = $p.StandardOutput.ReadToEnd()
        $stderr = $p.StandardError.ReadToEnd()
        $p.WaitForExit()

        if ($p.ExitCode -ne 0) {
            $msg = ($stderr + "\n" + $stdout).Trim()
            if (-not $msg) { $msg = "(no AWS CLI output captured)" }
            throw "Failed to delete rule $($r.RuleArn): $msg"
        }
    }
}

# Detect deployed mode: if multi-env stacks don't exist, resume using single-env AWS CLI path.
$multiEnvDeployed = $true
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& aws cloudformation describe-stacks --stack-name Afu9EcsProdStack --query 'Stacks[0].StackStatus' --output text 2>$null | Out-Null
$awsExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($awsExitCode -ne 0) { $multiEnvDeployed = $false }

if (-not $multiEnvDeployed) {
    Write-Host "[WARN] Multi-env stacks not deployed (Afu9EcsProdStack/Afu9RoutingStack missing)." -ForegroundColor Yellow
    Write-Host "[WARN] Using single-env resume: remove ALB 503 rule + set ECS desiredCount back to 1." -ForegroundColor Yellow

    $resolvedDomainName = if ($DomainName -and $DomainName.Trim()) { $DomainName.Trim() } else { $env:DOMAIN_NAME }
    if (-not $resolvedDomainName -or -not $resolvedDomainName.Trim()) {
        Write-Host "[ERROR] Missing required domain name." -ForegroundColor Red
        Write-Host "        Provide it via -DomainName <your-domain.com> or set env var DOMAIN_NAME." -ForegroundColor Red
        exit 1
    }

    $clusterName = (Get-CfnExportValue 'Afu9ClusterName')
    if (-not $clusterName) { $clusterName = 'afu9-cluster' }
    $serviceName = (Get-CfnExportValue 'Afu9ServiceName')
    if (-not $serviceName) { $serviceName = 'afu9-control-center' }

    $httpsListenerArn = $null
    $httpListenerArn = $null
    $networkOutputsJson = & aws cloudformation describe-stacks --stack-name Afu9NetworkStack --query 'Stacks[0].Outputs' --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Failed to read Afu9NetworkStack outputs: $networkOutputsJson" }
    $networkOutputs = $networkOutputsJson | ConvertFrom-Json
    foreach ($o in $networkOutputs) {
        if ($o.OutputKey -like 'ExportsOutputRefAfu9LoadBalancerHttpsListener*') { $httpsListenerArn = $o.OutputValue }
        if ($o.OutputKey -like 'ExportsOutputRefAfu9LoadBalancerHttpListener*') { $httpListenerArn = $o.OutputValue }
    }

    $hosts = @(
        $resolvedDomainName,
        "www.$resolvedDomainName",
        "prod.$resolvedDomainName"
    )

    Write-Host ""
    Write-Host "Removing ALB 503 fixed-response rule(s)..." -ForegroundColor Yellow
    Remove-FixedResponse503Rules $httpsListenerArn $hosts
    Remove-FixedResponse503Rules $httpListenerArn $hosts

    Write-Host ""
    Write-Host "Resuming ECS service..." -ForegroundColor Yellow
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & aws ecs update-service --cluster $clusterName --service $serviceName --desired-count 1 2>&1 | Out-Host
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($awsExitCode -ne 0) { throw "Failed to update ECS desired count (exit code $awsExitCode)." }

    Write-Host ""
    Write-Host "Waiting for ECS service to stabilize..." -ForegroundColor White
    & aws ecs wait services-stable --cluster $clusterName --services $serviceName 2>&1 | Out-Host

    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  [OK] PROD environment resume complete!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  - Verify PROD is responding: curl https://$resolvedDomainName/api/health" -ForegroundColor White
    Write-Host "  - Verify STAGE still works: curl https://stage.$resolvedDomainName/api/health" -ForegroundColor White
    Write-Host ""
    exit 0
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
