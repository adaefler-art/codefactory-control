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
    [switch]$SkipConfirmation,
    [Parameter(Mandatory = $false)]
    [string]$DomainName
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  AFU-9 Low-Cost Pause Mode - PAUSE PROD" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
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
Write-Host "  - Set PROD ECS desired count to 0 (stop all tasks)" -ForegroundColor Yellow
Write-Host "  - Configure PROD ALB to return HTTP 503" -ForegroundColor Yellow
Write-Host "  - Reduce PROD costs by ~90-95%" -ForegroundColor Yellow
Write-Host ""
Write-Host "This will NOT affect:" -ForegroundColor Green
Write-Host "  - STAGE environment (continues running normally)" -ForegroundColor Green
Write-Host "  - RDS database (remains active)" -ForegroundColor Green
Write-Host "  - Network infrastructure (VPC, subnets, etc.)" -ForegroundColor Green
Write-Host ""

if (-not $SkipConfirmation) {
    $confirmation = Read-Host "Pause PROD environment? (yes/no)"
    if ($confirmation -ne "yes") {
        Write-Host "[CANCELLED] Operation cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Step 1: Previewing changes with CDK diff" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

function Get-CfnExportValue([string]$exportName) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $value = & aws cloudformation list-exports --query "Exports[?Name=='$exportName'].Value | [0]" --output text 2>&1
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($awsExitCode -ne 0 -or -not $value -or $value -eq 'None') { return $null }
    return $value.Trim()
}

function Get-AvailableListenerPriority([string]$listenerArn) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $raw = & aws elbv2 describe-rules --listener-arn $listenerArn --query 'Rules[].Priority' --output text 2>&1
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($awsExitCode -ne 0) { return 1 }
    $used = @{}
    foreach ($p in ($raw -split "\s+")) {
        if ($p -and $p -ne 'default') {
            $n = 0
            if ([int]::TryParse($p, [ref]$n)) { $used[$n] = $true }
        }
    }
    for ($i = 1; $i -le 50000; $i++) {
        if (-not $used.ContainsKey($i)) { return $i }
    }
    return 50000
}

function Ensure-FixedResponse503Rule([string]$listenerArn, [string[]]$hosts) {
    if (-not $listenerArn) { return $null }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $rulesJson = & aws elbv2 describe-rules --listener-arn $listenerArn --output json 2>&1
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($awsExitCode -ne 0) { throw "Failed to describe listener rules: $rulesJson" }
    $rules = $rulesJson | ConvertFrom-Json

    foreach ($r in $rules.Rules) {
        if (-not $r.RuleArn) { continue }
        if ($r.IsDefault -eq $true) { continue }
        if (-not $r.Actions -or $r.Actions.Count -lt 1) { continue }
        if ($r.Actions[0].Type -ne 'fixed-response') { continue }
        if (-not $r.Actions[0].FixedResponseConfig) { continue }
        if ($r.Actions[0].FixedResponseConfig.StatusCode -ne '503') { continue }
        if (-not $r.Conditions -or $r.Conditions.Count -lt 1) { continue }
        $hostCond = $r.Conditions | Where-Object { $_.Field -eq 'host-header' } | Select-Object -First 1
        if (-not $hostCond -or -not $hostCond.HostHeaderConfig -or -not $hostCond.HostHeaderConfig.Values) { continue }

        $existingHosts = @($hostCond.HostHeaderConfig.Values)
        $matches = $true
        foreach ($h in $hosts) {
            if ($existingHosts -notcontains $h) { $matches = $false; break }
        }
        if ($matches) {
            return $r.RuleArn
        }
    }

    $priority = Get-AvailableListenerPriority $listenerArn

    $payload = @{
        ListenerArn = $listenerArn
        Priority = $priority
        Conditions = @(
            @{ Field = 'host-header'; HostHeaderConfig = @{ Values = $hosts } }
        )
        Actions = @(
            @{ Type = 'fixed-response'; FixedResponseConfig = @{ StatusCode = '503'; ContentType = 'text/plain'; MessageBody = 'AFU-9 PROD paused' } }
        )
    }

    $tempFile = Join-Path $env:TEMP ("afu9-create-rule-" + [Guid]::NewGuid().ToString() + ".json")
    $payloadJson = $payload | ConvertTo-Json -Depth 10
    # PowerShell 5.1's Set-Content -Encoding UTF8 writes a BOM; AWS CLI JSON parsing can choke on it.
    [System.IO.File]::WriteAllText($tempFile, $payloadJson, (New-Object System.Text.UTF8Encoding($false)))

    try {
        $cliInput = "file://" + $tempFile

        # Run AWS CLI as a real process to reliably capture stdout/stderr in Windows PowerShell.
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'aws'
        $psi.Arguments = "elbv2 create-rule --cli-input-json `"$cliInput`" --output json"
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
            throw "Failed to create 503 rule: $msg"
        }

        $created = $stdout | ConvertFrom-Json
        return $created.Rules[0].RuleArn
    } finally {
        Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
    }
}

# Detect deployed mode: if multi-env stacks don't exist, fall back to single-env pause via AWS CLI.
$multiEnvDeployed = $true
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& aws cloudformation describe-stacks --stack-name Afu9EcsProdStack --query 'Stacks[0].StackStatus' --output text 2>$null | Out-Null
$awsExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($awsExitCode -ne 0) { $multiEnvDeployed = $false }

if (-not $multiEnvDeployed) {
    Write-Host "[WARN] Multi-env stacks not deployed (Afu9EcsProdStack/Afu9RoutingStack missing)." -ForegroundColor Yellow
    Write-Host "[WARN] Using single-env pause: ECS desiredCount=0 + ALB fixed-response 503 for prod host." -ForegroundColor Yellow

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
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $networkOutputsJson = & aws cloudformation describe-stacks --stack-name Afu9NetworkStack --query 'Stacks[0].Outputs' --output json 2>&1
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($awsExitCode -ne 0) { throw "Failed to read Afu9NetworkStack outputs: $networkOutputsJson" }
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
    Write-Host "Pausing ECS service..." -ForegroundColor Yellow
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & aws ecs update-service --cluster $clusterName --service $serviceName --desired-count 0 2>&1 | Out-Host
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($awsExitCode -ne 0) { throw "Failed to update ECS desired count (exit code $awsExitCode)." }

    Write-Host ""
    Write-Host "Adding ALB 503 fixed-response rule(s)..." -ForegroundColor Yellow
    $ruleHttps = Ensure-FixedResponse503Rule $httpsListenerArn $hosts
    $ruleHttp = Ensure-FixedResponse503Rule $httpListenerArn $hosts

    Write-Host ""
    Write-Host "[OK] Single-env pause applied." -ForegroundColor Green
    Write-Host "  ECS: $clusterName / $serviceName => desiredCount=0" -ForegroundColor White
    if ($ruleHttps) { Write-Host "  HTTPS rule: $ruleHttps" -ForegroundColor White }
    if ($ruleHttp) { Write-Host "  HTTP rule:  $ruleHttp" -ForegroundColor White }

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host "  [OK] PROD environment paused successfully!" -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  - Verify PROD returns 503: curl -I https://$resolvedDomainName" -ForegroundColor White
    Write-Host "  - Verify STAGE still works: curl -I https://stage.$resolvedDomainName" -ForegroundColor White
    Write-Host "  - To resume PROD, run: .\scripts\resume-prod.ps1 -DomainName $resolvedDomainName" -ForegroundColor White
    Write-Host ""
    exit 0
}

try {
    Write-Host "Checking PROD ECS stack changes..." -ForegroundColor White
    $cdkContextArgs = @()
    $resolvedDomainName = if ($DomainName -and $DomainName.Trim()) { $DomainName.Trim() } else { $env:DOMAIN_NAME }
    if ($resolvedDomainName -and $resolvedDomainName.Trim()) {
        $cdkContextArgs += @('-c', "afu9-domain=$($resolvedDomainName.Trim())")
    } else {
        Write-Host "[ERROR] Missing required domain name for DNS stack." -ForegroundColor Red
        Write-Host "        Provide it via -DomainName <your-domain.com> or set env var DOMAIN_NAME." -ForegroundColor Red
        exit 1
    }
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & cdk diff Afu9EcsProdStack -c afu9-prod-paused=true -c afu9-multi-env=true @cdkContextArgs 2>&1 | Out-Host
    $cdkExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    if ($cdkExitCode -ne 0) {
        throw "cdk diff failed (exit code $cdkExitCode). If this mentions missing domainName, pass -DomainName or set env var DOMAIN_NAME / CDK context -c afu9-domain=..."
    }

    Write-Host ""
    Write-Host "Checking routing stack changes..." -ForegroundColor White
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & cdk diff Afu9RoutingStack -c afu9-prod-paused=true -c afu9-multi-env=true @cdkContextArgs 2>&1 | Out-Host
    $cdkExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    if ($cdkExitCode -ne 0) {
        throw "cdk diff failed (exit code $cdkExitCode). If this mentions missing domainName, pass -DomainName or set env var DOMAIN_NAME / CDK context -c afu9-domain=..."
    }

    Write-Host ""
    Write-Host "[OK] Diff preview complete" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Error during diff preview: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
if (-not $SkipConfirmation) {
    $proceedDeploy = Read-Host "Proceed with deployment? (yes/no)"
    if ($proceedDeploy -ne "yes") {
        Write-Host "[CANCELLED] Deployment cancelled" -ForegroundColor Yellow
        exit 0
    }
}

Write-Host ""
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Step 2: Deploying pause configuration" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & cdk deploy Afu9EcsProdStack Afu9RoutingStack -c afu9-prod-paused=true -c afu9-multi-env=true --require-approval never @cdkContextArgs 2>&1 | Out-Host
    $cdkExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    if ($cdkExitCode -ne 0) {
        throw "cdk deploy failed (exit code $cdkExitCode). Review output above; fix CDK context/AWS credentials and retry."
    }

    Write-Host ""
    Write-Host "[OK] Deployment complete" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Error during deployment: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting tips:" -ForegroundColor Yellow
    Write-Host "  1. Check CloudFormation console for detailed errors" -ForegroundColor Yellow
    Write-Host "  2. Verify AWS credentials are valid" -ForegroundColor Yellow
    Write-Host "  3. Review CDK diff output for unexpected changes" -ForegroundColor Yellow
    Write-Host "  4. See docs/runbooks/LOW_COST_MODE.md for troubleshooting" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Step 3: Verifying pause state" -ForegroundColor Cyan
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""

Start-Sleep -Seconds 5

try {
    Write-Host "Checking ECS service status..." -ForegroundColor Yellow

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $ecsRaw = & aws ecs describe-services `
        --cluster afu9-cluster `
        --services afu9-control-center-prod `
        --query 'services[0].[desiredCount,runningCount]' `
        --output text 2>&1
    $awsExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference

    if ($awsExitCode -ne 0 -or -not $ecsRaw) {
        Write-Host "  [WARN] Could not verify ECS status (aws cli error or no output)." -ForegroundColor Yellow
    } else {
        $ecsParts = ($ecsRaw -split '\s+')
        if ($ecsParts.Count -ge 2) {
            Write-Host "  Desired count: $($ecsParts[0])" -ForegroundColor White
            Write-Host "  Running count: $($ecsParts[1])" -ForegroundColor White
            if ($ecsParts[0] -ne '0') {
                Write-Host "  [WARN] Desired count is not 0. Tasks may still be running." -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [WARN] Unexpected ECS status output: $ecsRaw" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "  [WARN] Could not verify ECS status: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  [OK] PROD environment paused successfully!" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  - Verify PROD returns 503: curl -I https://prod.afu-9.com" -ForegroundColor White
Write-Host "  - Verify STAGE still works: curl -I https://stage.afu-9.com" -ForegroundColor White
Write-Host "  - Monitor AWS costs over the next few days" -ForegroundColor White
Write-Host "  - To resume PROD, run: .\scripts\resume-prod.ps1" -ForegroundColor White
Write-Host ""
Write-Host "See docs/runbooks/LOW_COST_MODE.md for more information" -ForegroundColor Gray
Write-Host ""
