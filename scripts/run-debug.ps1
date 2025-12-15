#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Debug artifact uploader for AFU-9 with AWS authentication safety checks.

.DESCRIPTION
    This script uploads debug artifacts to S3 for AFU-9 troubleshooting.
    It includes safety checks to prevent running with AWS root credentials.

.PARAMETER Profile
    Optional AWS profile name to use (e.g., "codefactory").
    If not specified, uses default AWS credentials chain.

.PARAMETER Verbose
    Enable verbose output including detected AWS identity.

.PARAMETER DebugMode
    Enable debug mode with additional diagnostic output.

.EXAMPLE
    .\run-debug.ps1
    Run with default AWS credentials

.EXAMPLE
    .\run-debug.ps1 -Profile codefactory
    Run with a specific AWS SSO profile

.EXAMPLE
    .\run-debug.ps1 -Verbose
    Run with verbose output showing AWS identity
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Profile,

    [Parameter(Mandatory=$false)]
    [switch]$DebugMode
)

# Set error action preference
$ErrorActionPreference = "Stop"

# Helper function to write colored output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# Main script logic
try {
    Write-ColorOutput "`n=== AFU-9 Debug Artifact Uploader ===" "Cyan"
    Write-ColorOutput "Checking AWS authentication..." "Cyan"

    # Build AWS CLI command
    $awsCommand = "aws"
    $awsArgs = @("sts", "get-caller-identity", "--output", "json")
    
    if ($Profile) {
        $awsArgs = @("--profile", $Profile) + $awsArgs
        Write-ColorOutput "Using AWS profile: $Profile" "Gray"
    }

    # Check for AWS_PROFILE environment variable if no profile specified
    if (-not $Profile -and $env:AWS_PROFILE) {
        Write-ColorOutput "Using AWS_PROFILE environment variable: $env:AWS_PROFILE" "Gray"
    }

    # Execute AWS STS get-caller-identity
    $callerIdentityJson = & $awsCommand $awsArgs 2>&1
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput "`nERROR: Failed to get AWS caller identity." "Red"
        Write-ColorOutput "AWS CLI output: $callerIdentityJson" "Red"
        Write-ColorOutput "`nPlease ensure:" "Yellow"
        Write-ColorOutput "  1. AWS CLI is installed" "Yellow"
        Write-ColorOutput "  2. You are authenticated (run 'aws configure' or 'aws sso login')" "Yellow"
        Write-ColorOutput "  3. Your credentials are valid" "Yellow"
        Write-ColorOutput "`nFor help diagnosing authentication issues, run:" "Yellow"
        Write-ColorOutput "  .\scripts\aws-auth-doctor.ps1" "Cyan"
        exit 1
    }

    # Parse the JSON response
    $callerIdentity = $callerIdentityJson | ConvertFrom-Json

    # Extract relevant fields
    $arn = $callerIdentity.Arn
    $accountId = $callerIdentity.Account
    $userId = $callerIdentity.UserId

    # Display identity information if verbose or debug mode
    if ($VerbosePreference -eq 'Continue' -or $DebugMode) {
        Write-ColorOutput "`nAWS Identity Information:" "Green"
        Write-ColorOutput "  ARN:        $arn" "White"
        Write-ColorOutput "  Account ID: $accountId" "White"
        Write-ColorOutput "  User ID:    $userId" "White"
    }

    # SAFETY CHECK: Refuse to run with root credentials
    if ($arn -match ':root$') {
        Write-ColorOutput "`nERROR: Refusing to run with AWS root credentials!" "Red"
        Write-ColorOutput "`nDetected ARN: $arn" "Yellow"
        Write-ColorOutput "`nRunning AFU-9 automation with root credentials is a security risk." "Red"
        Write-ColorOutput "Root credentials have unrestricted access and should never be used for automation." "Red"
        Write-ColorOutput "`nRequired action:" "Yellow"
        Write-ColorOutput "  1. Clear any AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY environment variables" "Yellow"
        Write-ColorOutput "  2. Set up AWS SSO:" "Yellow"
        Write-ColorOutput "       aws configure sso" "Cyan"
        Write-ColorOutput "  3. Log in to your SSO profile:" "Yellow"
        Write-ColorOutput "       aws sso login --profile <profile-name>" "Cyan"
        Write-ColorOutput "  4. Rerun this script with the profile:" "Yellow"
        Write-ColorOutput "       .\run-debug.ps1 -Profile <profile-name>" "Cyan"
        Write-ColorOutput "`nFor detailed help, run:" "Yellow"
        Write-ColorOutput "  .\scripts\aws-auth-doctor.ps1" "Cyan"
        exit 1
    }

    # Identity check passed
    Write-ColorOutput "`n✓ AWS authentication verified" "Green"
    
    # Determine authentication type for informational purposes
    $authType = "Unknown"
    if ($arn -match 'assumed-role') {
        $authType = "SSO / Assumed Role"
    } elseif ($arn -match ':user/') {
        $authType = "IAM User"
    }
    
    if ($VerbosePreference -eq 'Continue' -or $DebugMode) {
        Write-ColorOutput "  Authentication type: $authType" "Green"
    }

    Write-ColorOutput "`n=== Starting debug artifact upload ===" "Cyan"
    
    # TODO: Implement actual debug artifact upload logic here
    # This is a placeholder for the actual upload functionality
    Write-ColorOutput "`nNote: Debug artifact upload functionality not yet implemented." "Yellow"
    Write-ColorOutput "This script currently only performs AWS authentication validation." "Yellow"
    
    Write-ColorOutput "`n✓ Script completed successfully" "Green"
    exit 0

} catch {
    Write-ColorOutput "`nERROR: An unexpected error occurred:" "Red"
    Write-ColorOutput $_.Exception.Message "Red"
    Write-ColorOutput "`nStack trace:" "Gray"
    Write-ColorOutput $_.ScriptStackTrace "Gray"
    exit 1
}
