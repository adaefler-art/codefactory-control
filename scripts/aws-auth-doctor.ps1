#!/usr/bin/env pwsh
<#
.SYNOPSIS
    AWS Authentication Doctor - Diagnose and fix AWS authentication issues for AFU-9.

.DESCRIPTION
    This script analyzes your AWS authentication configuration and provides
    actionable guidance for setting up secure authentication for AFU-9 automation.
    
    It checks:
    - Current AWS identity (via STS)
    - AWS CLI configuration
    - Available profiles
    - Environment variables
    - Authentication method classification

.EXAMPLE
    .\aws-auth-doctor.ps1
    Run the authentication diagnostic
#>

[CmdletBinding()]
param()

# Set error action preference to continue (we want to check even if some commands fail)
$ErrorActionPreference = "Continue"

# Helper function to write colored output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White",
        [switch]$NoNewline
    )
    if ($NoNewline) {
        Write-Host $Message -ForegroundColor $Color -NoNewline
    } else {
        Write-Host $Message -ForegroundColor $Color
    }
}

# Helper function to write section headers
function Write-Section {
    param([string]$Title)
    Write-ColorOutput "`n========================================" "Cyan"
    Write-ColorOutput "  $Title" "Cyan"
    Write-ColorOutput "========================================" "Cyan"
}

# Main diagnostic logic
Write-ColorOutput "`n╔════════════════════════════════════════════╗" "Cyan"
Write-ColorOutput "║   AWS Authentication Doctor for AFU-9      ║" "Cyan"
Write-ColorOutput "╚════════════════════════════════════════════╝" "Cyan"

# Section 1: Check AWS CLI availability
Write-Section "1. AWS CLI Status"
$awsVersion = aws --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-ColorOutput "✓ AWS CLI installed: $awsVersion" "Green"
} else {
    Write-ColorOutput "✗ AWS CLI not found or not in PATH" "Red"
    Write-ColorOutput "  Install from: https://aws.amazon.com/cli/" "Yellow"
    exit 1
}

# Section 2: Environment Variables
Write-Section "2. Environment Variables"
$envVarsFound = $false

if ($env:AWS_ACCESS_KEY_ID) {
    Write-ColorOutput "  AWS_ACCESS_KEY_ID: Set (value hidden for security)" "Yellow"
    $envVarsFound = $true
} else {
    Write-ColorOutput "  AWS_ACCESS_KEY_ID: Not set" "Gray"
}

if ($env:AWS_SECRET_ACCESS_KEY) {
    Write-ColorOutput "  AWS_SECRET_ACCESS_KEY: Set (value hidden for security)" "Yellow"
    $envVarsFound = $true
} else {
    Write-ColorOutput "  AWS_SECRET_ACCESS_KEY: Not set" "Gray"
}

if ($env:AWS_PROFILE) {
    Write-ColorOutput "  AWS_PROFILE: $env:AWS_PROFILE" "Green"
} else {
    Write-ColorOutput "  AWS_PROFILE: Not set" "Gray"
}

if ($env:AWS_DEFAULT_REGION) {
    Write-ColorOutput "  AWS_DEFAULT_REGION: $env:AWS_DEFAULT_REGION" "Green"
} else {
    Write-ColorOutput "  AWS_DEFAULT_REGION: Not set" "Gray"
}

# Section 3: Current AWS Identity
Write-Section "3. Current AWS Identity"
$callerIdentityJson = aws sts get-caller-identity --output json 2>&1
$stsSuccess = $LASTEXITCODE -eq 0

if ($stsSuccess) {
    try {
        $identity = $callerIdentityJson | ConvertFrom-Json
        $arn = $identity.Arn
        $accountId = $identity.Account
        $userId = $identity.UserId
        
        Write-ColorOutput "  ARN:        $arn" "White"
        Write-ColorOutput "  Account ID: $accountId" "White"
        Write-ColorOutput "  User ID:    $userId" "White"
    } catch {
        Write-ColorOutput "  Failed to parse identity: $callerIdentityJson" "Red"
        $stsSuccess = $false
    }
} else {
    Write-ColorOutput "  ✗ Unable to retrieve AWS identity" "Red"
    Write-ColorOutput "  Error: $callerIdentityJson" "Red"
}

# Section 4: AWS Configuration
Write-Section "4. AWS Configuration"
$configList = aws configure list 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-ColorOutput $configList "White"
} else {
    Write-ColorOutput "  Unable to retrieve configuration" "Yellow"
}

# Section 5: Available Profiles
Write-Section "5. Available AWS Profiles"
$profilesList = aws configure list-profiles 2>&1
if ($LASTEXITCODE -eq 0 -and $profilesList) {
    $profiles = $profilesList -split "`n" | Where-Object { $_ -ne "" }
    if ($profiles.Count -gt 0) {
        Write-ColorOutput "  Found $($profiles.Count) profile(s):" "Green"
        foreach ($profile in $profiles) {
            $profile = $profile.Trim()
            if ($profile) {
                Write-ColorOutput "    - $profile" "White"
            }
        }
    } else {
        Write-ColorOutput "  No profiles configured" "Yellow"
    }
} else {
    Write-ColorOutput "  No profiles configured" "Yellow"
}

# Section 6: Authentication Classification and Recommendations
Write-Section "6. Authentication Analysis"

$authMode = "unknown"
$isRoot = $false
$isIAMUser = $false
$isAssumedRole = $false

if ($stsSuccess -and $identity) {
    if ($arn -match ':root$') {
        $authMode = "root"
        $isRoot = $true
    } elseif ($arn -match 'assumed-role') {
        $authMode = "assumed-role"
        $isAssumedRole = $true
    } elseif ($arn -match ':user/') {
        $authMode = "iam-user"
        $isIAMUser = $true
    }
}

Write-ColorOutput "`nAuthentication Mode: " -NoNewline
switch ($authMode) {
    "root" {
        Write-ColorOutput "ROOT ACCOUNT" "Red"
        Write-ColorOutput "  Status: " -NoNewline
        Write-ColorOutput "⚠ INSECURE - NOT RECOMMENDED" "Red"
    }
    "iam-user" {
        Write-ColorOutput "IAM User" "Yellow"
        Write-ColorOutput "  Status: " -NoNewline
        Write-ColorOutput "⚠ Acceptable, but SSO is preferred" "Yellow"
    }
    "assumed-role" {
        Write-ColorOutput "SSO / Assumed Role" "Green"
        Write-ColorOutput "  Status: " -NoNewline
        Write-ColorOutput "✓ SECURE - Recommended" "Green"
    }
    default {
        Write-ColorOutput "Unknown or Not Authenticated" "Red"
        Write-ColorOutput "  Status: " -NoNewline
        Write-ColorOutput "✗ Unable to authenticate" "Red"
    }
}

# Section 7: Actionable Recommendations
Write-Section "7. Recommended Actions"

if ($isRoot) {
    Write-ColorOutput "`n⚠ CRITICAL: You are using AWS root credentials!" "Red"
    Write-ColorOutput "`nRoot credentials should NEVER be used for automation or daily operations." "Red"
    Write-ColorOutput "They have unrestricted access to your entire AWS account." "Red"
    
    Write-ColorOutput "`n📋 Required Steps:" "Yellow"
    Write-ColorOutput "`n1. Clear root credentials from environment:" "White"
    Write-ColorOutput "   # Windows (PowerShell)" "Gray"
    Write-ColorOutput "   Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue" "Cyan"
    Write-ColorOutput "   Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue" "Cyan"
    Write-ColorOutput "   # Linux/macOS (Bash)" "Gray"
    Write-ColorOutput "   unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY" "Cyan"
    
    Write-ColorOutput "`n2. Set up AWS SSO (recommended):" "White"
    Write-ColorOutput "   aws configure sso" "Cyan"
    Write-ColorOutput "   # Follow prompts to set up your SSO profile" "Gray"
    
    Write-ColorOutput "`n3. Log in to your SSO profile:" "White"
    Write-ColorOutput "   aws sso login --profile <your-profile-name>" "Cyan"
    
    Write-ColorOutput "`n4. Verify your identity is now SSO-based:" "White"
    Write-ColorOutput "   aws sts get-caller-identity --profile <your-profile-name>" "Cyan"
    
    Write-ColorOutput "`n5. Use the profile when running AFU-9 scripts:" "White"
    Write-ColorOutput "   .\scripts\run-debug.ps1 -Profile <your-profile-name>" "Cyan"

} elseif ($isIAMUser) {
    Write-ColorOutput "`n⚠ You are using IAM user credentials." "Yellow"
    Write-ColorOutput "While functional, SSO with temporary credentials is more secure." "Yellow"
    
    Write-ColorOutput "`n📋 Recommended (Optional):" "White"
    Write-ColorOutput "`n1. Set up AWS SSO for better security:" "White"
    Write-ColorOutput "   aws configure sso" "Cyan"
    
    Write-ColorOutput "`n2. Log in to your SSO profile:" "White"
    Write-ColorOutput "   aws sso login --profile <profile-name>" "Cyan"
    
    Write-ColorOutput "`n3. Use the SSO profile:" "White"
    Write-ColorOutput "   .\scripts\run-debug.ps1 -Profile <profile-name>" "Cyan"
    
    Write-ColorOutput "`nCurrent Setup: Your IAM user can continue to work with AFU-9." "Green"

} elseif ($isAssumedRole) {
    Write-ColorOutput "`n✓ Perfect! You are using SSO / Assumed Role authentication." "Green"
    Write-ColorOutput "This is the recommended secure method for AFU-9." "Green"
    
    Write-ColorOutput "`n📋 Usage:" "White"
    if ($env:AWS_PROFILE) {
        Write-ColorOutput "  Your AWS_PROFILE is set to: $env:AWS_PROFILE" "Green"
        Write-ColorOutput "  Run scripts normally:" "White"
        Write-ColorOutput "    .\scripts\run-debug.ps1" "Cyan"
    } else {
        Write-ColorOutput "  Specify your profile when running scripts:" "White"
        Write-ColorOutput "    .\scripts\run-debug.ps1 -Profile <profile-name>" "Cyan"
        Write-ColorOutput "  Or set AWS_PROFILE environment variable:" "White"
        Write-ColorOutput "    `$env:AWS_PROFILE = '<profile-name>'" "Cyan"
    }

} else {
    Write-ColorOutput "`n⚠ Unable to authenticate or unknown authentication mode." "Red"
    
    Write-ColorOutput "`n📋 Setup Steps:" "Yellow"
    Write-ColorOutput "`n1. Configure AWS SSO (recommended):" "White"
    Write-ColorOutput "   aws configure sso" "Cyan"
    Write-ColorOutput "   # Follow the prompts to configure your profile" "Gray"
    
    Write-ColorOutput "`n2. Log in to your profile:" "White"
    Write-ColorOutput "   aws sso login --profile <profile-name>" "Cyan"
    
    Write-ColorOutput "`n3. Verify authentication:" "White"
    Write-ColorOutput "   aws sts get-caller-identity --profile <profile-name>" "Cyan"
    
    Write-ColorOutput "`nAlternatively, configure IAM user credentials:" "White"
    Write-ColorOutput "   aws configure" "Cyan"
}

# Section 8: Additional Resources
Write-Section "8. Additional Resources"
Write-ColorOutput "  • AWS SSO Configuration: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html" "Gray"
Write-ColorOutput "  • AWS CLI Configuration: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html" "Gray"
Write-ColorOutput "  • AFU-9 Documentation: docs/AWS_AUTH.md" "Gray"

# Summary footer
Write-ColorOutput "`n╔════════════════════════════════════════════╗" "Cyan"
Write-ColorOutput "║         Diagnostic Complete                ║" "Cyan"
Write-ColorOutput "╚════════════════════════════════════════════╝" "Cyan"

if ($isRoot) {
    Write-ColorOutput "`n⚠ ACTION REQUIRED: Configure SSO before using AFU-9" "Red"
    exit 1
} elseif (-not $stsSuccess) {
    Write-ColorOutput "`n⚠ ACTION REQUIRED: Configure AWS authentication" "Yellow"
    exit 1
} else {
    Write-ColorOutput "`n✓ Authentication is configured and working" "Green"
    exit 0
}
