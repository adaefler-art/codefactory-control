#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Setup AWS Secrets Manager for AFU9_ADMIN_SUBS

.DESCRIPTION
    This script creates or updates the admin subscription allowlist secret in
    AWS Secrets Manager for Stage or Production environments.
    
    Features:
    - Creates or updates afu9/{env}/admin-subs secret
    - Dry-run mode for safe preview
    - Manual confirmation before AWS changes
    - Automatic verification of created/updated secret
    - Deployment instructions for ECS integration
    
    The script is designed for one-time setup when deploying E80.1 migration
    parity check to Stage/Prod environments.

.PARAMETER Environment
    Target AWS environment.
    Valid values: stage, prod
    REQUIRED parameter.

.PARAMETER AdminSubs
    Comma-separated list of admin user subscription IDs.
    Example: "sub1,sub2,sub3"
    REQUIRED parameter.

.PARAMETER DryRun
    Preview operations without making any AWS changes.
    Shows what would be created/updated.

.EXAMPLE
    .\scripts\setup-aws-admin-subs.ps1 -Environment stage -AdminSubs "sub123" -DryRun
    Preview changes for staging environment

.EXAMPLE
    .\scripts\setup-aws-admin-subs.ps1 -Environment stage -AdminSubs "S3b43b2-a051-7015-a2b7-98f77551d415"
    Create/update admin subs secret for staging

.EXAMPLE
    .\scripts\setup-aws-admin-subs.ps1 -Environment prod -AdminSubs "user1,user2,user3"
    Create/update admin subs secret for production (with confirmation)

.NOTES
    Version: 1.0
    Author: AFU-9 Team
    Related: E80.1 Implementation Summary
    
    Requirements:
    - AWS CLI installed and configured
    - Valid AWS credentials with SecretsManager permissions
    - IAM permissions: secretsmanager:CreateSecret, UpdateSecret, DescribeSecret, GetSecretValue
    
    Exit Codes:
    - 0: Success
    - 1: Error (missing dependencies, AWS errors, validation failures)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('stage', 'prod')]
    [string]$Environment,
    
    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]$AdminSubs,
    
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# ============================================================================
# Configuration
# ============================================================================

$AWS_REGION = "eu-central-1"
$SECRET_NAME = "afu9/$Environment/admin-subs"

# ============================================================================
# Helper Functions
# ============================================================================

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error-Message {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning-Message {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Cyan
}

function Write-Header {
    param([string]$Message)
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host "  $Message" -ForegroundColor Magenta
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Magenta
    Write-Host ""
}

# ============================================================================
# Main Script
# ============================================================================

Write-Header "AWS Admin Subs Secret Setup (E80.1)"

if ($DryRun) {
    Write-Warning-Message "DRY-RUN MODE - No changes will be made to AWS"
    Write-Host ""
}

Write-Info "Environment: $Environment"
Write-Info "Secret Name: $SECRET_NAME"
Write-Info "AWS Region: $AWS_REGION"
Write-Info "Admin Subs: $AdminSubs"
Write-Host ""

# ============================================================================
# Step 1: Check AWS CLI
# ============================================================================

Write-Header "Step 1: Checking AWS CLI"

try {
    $null = Get-Command aws -ErrorAction Stop
    $awsVersion = aws --version 2>&1
    Write-Success "AWS CLI is available: $awsVersion"
} catch {
    Write-Error-Message "AWS CLI not found in PATH"
    Write-Info "Install from: https://aws.amazon.com/cli/"
    exit 1
}

# ============================================================================
# Step 2: Verify AWS Authentication
# ============================================================================

Write-Header "Step 2: Verifying AWS Authentication"

try {
    $identity = aws sts get-caller-identity --region $AWS_REGION --output json 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error-Message "AWS authentication failed"
        Write-Host $identity -ForegroundColor Red
        Write-Host ""
        Write-Info "Check your AWS credentials:"
        Write-Info "  - AWS_PROFILE environment variable"
        Write-Info "  - ~/.aws/credentials file"
        Write-Info "  - AWS SSO login status"
        exit 1
    }
    
    $identityObj = $identity | ConvertFrom-Json
    Write-Success "Authenticated as:"
    Write-Info "  Account: $($identityObj.Account)"
    Write-Info "  User/Role: $($identityObj.Arn)"
    
} catch {
    Write-Error-Message "Error checking AWS authentication: $_"
    exit 1
}

# ============================================================================
# Step 3: Check if Secret Exists
# ============================================================================

Write-Header "Step 3: Checking Secret Existence"

$secretExists = $false
$currentSecretValue = $null

try {
    $secretInfo = aws secretsmanager describe-secret `
        --secret-id $SECRET_NAME `
        --region $AWS_REGION `
        --output json 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $secretExists = $true
        $secretInfoObj = $secretInfo | ConvertFrom-Json
        Write-Warning-Message "Secret already exists: $SECRET_NAME"
        Write-Info "  Created: $($secretInfoObj.CreatedDate)"
        Write-Info "  Last Modified: $($secretInfoObj.LastChangedDate)"
        
        # Try to get current value
        try {
            $currentSecret = aws secretsmanager get-secret-value `
                --secret-id $SECRET_NAME `
                --region $AWS_REGION `
                --output json 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                $currentSecretObj = $currentSecret | ConvertFrom-Json
                $currentSecretValue = $currentSecretObj.SecretString | ConvertFrom-Json
                Write-Info "  Current admin_subs: $($currentSecretValue.admin_subs)"
            }
        } catch {
            Write-Warning-Message "Could not read current secret value"
        }
    } else {
        Write-Info "Secret does not exist yet (will create new)"
    }
} catch {
    Write-Info "Secret does not exist (will create new)"
}

# ============================================================================
# Step 4: Prepare Secret Value
# ============================================================================

Write-Header "Step 4: Preparing Secret Value"

# Build secret JSON
$secretObject = @{
    admin_subs = $AdminSubs
}

$secretJson = $secretObject | ConvertTo-Json -Compress
Write-Info "Secret JSON: $secretJson"

# ============================================================================
# Step 5: Display Planned Operation
# ============================================================================

Write-Header "Step 5: Planned Operation"

if ($secretExists) {
    Write-Warning-Message "OPERATION: UPDATE existing secret"
    Write-Host ""
    Write-Host "Current value:" -ForegroundColor Yellow
    if ($currentSecretValue) {
        Write-Host "  admin_subs: $($currentSecretValue.admin_subs)" -ForegroundColor Gray
    } else {
        Write-Host "  (unable to retrieve)" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "New value:" -ForegroundColor Green
    Write-Host "  admin_subs: $AdminSubs" -ForegroundColor Gray
} else {
    Write-Info "OPERATION: CREATE new secret"
    Write-Host ""
    Write-Host "Secret details:" -ForegroundColor Cyan
    Write-Host "  Name: $SECRET_NAME" -ForegroundColor Gray
    Write-Host "  Region: $AWS_REGION" -ForegroundColor Gray
    Write-Host "  Value: $secretJson" -ForegroundColor Gray
}

Write-Host ""

if ($DryRun) {
    Write-Success "DRY-RUN: No changes made to AWS"
    Write-Info "Remove -DryRun flag to execute this operation"
    exit 0
}

# ============================================================================
# Step 6: Confirmation
# ============================================================================

Write-Host ""
$confirmation = Read-Host "Proceed with AWS Secrets Manager operation? (yes/no)"

if ($confirmation -ne "yes") {
    Write-Warning-Message "Operation cancelled by user"
    exit 0
}

# ============================================================================
# Step 7: Create or Update Secret
# ============================================================================

Write-Header "Step 7: Executing AWS Operation"

try {
    if ($secretExists) {
        Write-Info "Updating secret..."
        
        $updateResult = aws secretsmanager update-secret `
            --secret-id $SECRET_NAME `
            --secret-string $secretJson `
            --region $AWS_REGION `
            --output json 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Secret updated successfully"
            $updateObj = $updateResult | ConvertFrom-Json
            Write-Info "  ARN: $($updateObj.ARN)"
            Write-Info "  Version: $($updateObj.VersionId)"
        } else {
            Write-Error-Message "Failed to update secret"
            Write-Host $updateResult -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Info "Creating secret..."
        
        $createResult = aws secretsmanager create-secret `
            --name $SECRET_NAME `
            --secret-string $secretJson `
            --region $AWS_REGION `
            --description "AFU-9 Admin subscription IDs for ops endpoints ($Environment)" `
            --output json 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Secret created successfully"
            $createObj = $createResult | ConvertFrom-Json
            Write-Info "  ARN: $($createObj.ARN)"
            Write-Info "  Version: $($createObj.VersionId)"
        } else {
            Write-Error-Message "Failed to create secret"
            Write-Host $createResult -ForegroundColor Red
            exit 1
        }
    }
} catch {
    Write-Error-Message "Error during AWS operation: $_"
    exit 1
}

# ============================================================================
# Step 8: Verification
# ============================================================================

Write-Header "Step 8: Verifying Secret"

try {
    Start-Sleep -Seconds 2  # Give AWS a moment to propagate
    
    $verifySecret = aws secretsmanager get-secret-value `
        --secret-id $SECRET_NAME `
        --region $AWS_REGION `
        --output json 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        $verifyObj = $verifySecret | ConvertFrom-Json
        $verifyValue = $verifyObj.SecretString | ConvertFrom-Json
        
        if ($verifyValue.admin_subs -eq $AdminSubs) {
            Write-Success "Verification passed - secret value matches expected"
            Write-Info "  admin_subs: $($verifyValue.admin_subs)"
        } else {
            Write-Warning-Message "Verification warning - value mismatch"
            Write-Info "  Expected: $AdminSubs"
            Write-Info "  Got: $($verifyValue.admin_subs)"
        }
    } else {
        Write-Warning-Message "Could not verify secret (may still be propagating)"
    }
} catch {
    Write-Warning-Message "Verification failed: $_"
}

# ============================================================================
# Step 9: Next Steps
# ============================================================================

Write-Header "Next Steps"

Write-Host "✅ Secret setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "To enable this secret in ECS tasks, you need to:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Update ECS Task Definition" -ForegroundColor Yellow
Write-Host "   Run the helper script:" -ForegroundColor Gray
Write-Host "   .\scripts\update-task-definition-admin-subs.ps1" -ForegroundColor White
Write-Host ""
Write-Host "2. Deploy Updated Infrastructure" -ForegroundColor Yellow
Write-Host "   After updating the task definition code:" -ForegroundColor Gray
Write-Host "   npm run synth" -ForegroundColor White
Write-Host "   npm run deploy" -ForegroundColor White
Write-Host ""
Write-Host "3. Verify in ECS" -ForegroundColor Yellow
Write-Host "   After deployment, check that the environment variable is set:" -ForegroundColor Gray
Write-Host "   aws ecs describe-task-definition --task-definition afu9-control-center-$Environment" -ForegroundColor White
Write-Host ""
Write-Host "4. Test Migration Parity Endpoint" -ForegroundColor Yellow
Write-Host "   Use the GitHub Actions workflow or API calls with admin auth" -ForegroundColor Gray
Write-Host ""

Write-Success "Setup complete!"
exit 0
