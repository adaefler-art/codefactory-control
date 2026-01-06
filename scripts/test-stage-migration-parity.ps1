#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Stage Migration Parity Test with Cognito Authentication

.DESCRIPTION
    This script automates Cognito authentication and tests the Migration Parity Check
    endpoint on staging environment with proper JWT authentication.
    
    Features:
    - Auto-discovery of Cognito User Pool ID and Client ID from environment or CloudFormation
    - Secure Cognito authentication using AWS CLI (USER_PASSWORD_AUTH flow)
    - JWT token extraction and management
    - Authenticated API calls to stage.afu-9.com
    - Formatted parity check result display
    - Comprehensive error handling for auth and API failures
    
    The script is designed for testing E80.1 migration parity endpoint on staging
    with proper authentication, complementing local testing workflows.

.PARAMETER Username
    Cognito username (email address).
    REQUIRED parameter.

.PARAMETER Password
    Cognito password. If not provided, will prompt securely.
    WARNING: Providing password as parameter is less secure (visible in process list).
    Recommended to use interactive password prompt instead.

.PARAMETER SkipLogin
    Skip Cognito authentication and attempt API call without Authorization header.
    Useful for testing error responses or if using alternative authentication method.

.EXAMPLE
    .\scripts\test-stage-migration-parity.ps1 -Username "adaefler@me.com"
    Prompts for password securely, authenticates with Cognito, tests migration parity

.EXAMPLE
    .\scripts\test-stage-migration-parity.ps1 -Username "adaefler@me.com" -Password "MyPassword"
    Authenticates with provided password (less secure - password visible in process list)

.EXAMPLE
    .\scripts\test-stage-migration-parity.ps1 -Username "adaefler@me.com" -SkipLogin
    Skips Cognito login and attempts direct API call (will likely fail with 401/403)

.NOTES
    Version: 1.0
    Author: AFU-9 Team
    Related: E80.1 Implementation Summary
    
    Requirements:
    - PowerShell 5.1+ or PowerShell Core 7+
    - AWS CLI installed and configured
    - Valid Cognito user credentials
    - Admin privileges in AFU9_ADMIN_SUBS secret
    
    Environment Variables (Optional):
    - COGNITO_USER_POOL_ID: Cognito User Pool ID (e.g., eu-central-1_XXXXXXXXX)
    - COGNITO_CLIENT_ID: Cognito App Client ID
    
    If not set, script attempts to retrieve from CloudFormation stack 'Afu9AuthStack'.
    
    Exit Codes:
    - 0: Success (PASS or FAIL with proper response)
    - 1: Error (authentication failed, API unreachable, configuration missing)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateNotNullOrEmpty()]
    [string]$Username,
    
    [Parameter(Mandatory=$false)]
    [string]$Password,
    
    [switch]$SkipLogin
)

$ErrorActionPreference = "Stop"

# ============================================================================
# Configuration
# ============================================================================

$AWS_REGION = "eu-central-1"
$STAGE_API_URL = "https://stage.afu-9.com/api/ops/db/migrations"

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
    Write-Host "═══════════════════════════════════════" -ForegroundColor Magenta
    Write-Host $Message -ForegroundColor Magenta
    Write-Host "═══════════════════════════════════════" -ForegroundColor Magenta
    Write-Host ""
}

function Write-Box {
    param(
        [string]$Title,
        [string[]]$Lines
    )
    Write-Host ""
    Write-Host "┌─────────────────────────────────────┐" -ForegroundColor White
    Write-Host ("│    " + $Title.PadRight(33) + "│") -ForegroundColor White
    Write-Host "└─────────────────────────────────────┘" -ForegroundColor White
    Write-Host ""
    foreach ($line in $Lines) {
        Write-Host $line -ForegroundColor White
    }
}

function Truncate-Token {
    param([string]$Token)
    if ($Token.Length -gt 20) {
        return $Token.Substring(0, 20) + "..."
    }
    return $Token
}

# ============================================================================
# Main Script
# ============================================================================

Write-Header "Stage Migration Parity Test (with Cognito Auth)"

# Security warning if password provided as parameter
if ($Password -and -not $SkipLogin) {
    Write-Warning-Message "Password provided as parameter - visible in process list"
    Write-Warning-Message "For better security, omit -Password to use interactive prompt"
    Write-Host ""
}

# ============================================================================
# Step 1: Cognito Configuration Discovery
# ============================================================================

Write-Header "1. Cognito Configuration"

$UserPoolId = $env:COGNITO_USER_POOL_ID
$ClientId = $env:COGNITO_CLIENT_ID

# Try environment variables first
if ($UserPoolId -and $ClientId) {
    Write-Success "Cognito User Pool ID: $UserPoolId"
    Write-Success "Cognito Client ID:    $(Truncate-Token $ClientId)"
} else {
    Write-Info "Environment variables not set, attempting CloudFormation discovery..."
    
    # Check AWS CLI availability
    try {
        $null = Get-Command aws -ErrorAction Stop
    } catch {
        Write-Error-Message "AWS CLI not found in PATH"
        Write-Info "Install from: https://aws.amazon.com/cli/"
        Write-Host ""
        Write-Info "Alternative: Set environment variables manually:"
        Write-Info '  $env:COGNITO_USER_POOL_ID = "eu-central-1_XXXXXXXXX"'
        Write-Info '  $env:COGNITO_CLIENT_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxx"'
        exit 1
    }
    
    # Try to get from CloudFormation
    try {
        Write-Info "Querying CloudFormation stack 'Afu9AuthStack'..."
        
        $stackOutputs = aws cloudformation describe-stacks `
            --stack-name "Afu9AuthStack" `
            --region $AWS_REGION `
            --query "Stacks[0].Outputs" `
            --output json 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Warning-Message "Failed to query CloudFormation stack"
            Write-Host $stackOutputs -ForegroundColor Yellow
            Write-Host ""
            Write-Info "Please set environment variables manually:"
            Write-Info '  $env:COGNITO_USER_POOL_ID = "eu-central-1_XXXXXXXXX"'
            Write-Info '  $env:COGNITO_CLIENT_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxx"'
            exit 1
        }
        
        $outputs = $stackOutputs | ConvertFrom-Json
        
        foreach ($output in $outputs) {
            if ($output.OutputKey -eq "UserPoolId") {
                $UserPoolId = $output.OutputValue
            }
            if ($output.OutputKey -eq "UserPoolClientId") {
                $ClientId = $output.OutputValue
            }
        }
        
        if (-not $UserPoolId -or -not $ClientId) {
            Write-Error-Message "Could not find UserPoolId or UserPoolClientId in CloudFormation outputs"
            Write-Info "Available outputs: $($outputs | ForEach-Object { $_.OutputKey } | Join-String -Separator ', ')"
            Write-Host ""
            Write-Info "Please set environment variables manually:"
            Write-Info '  $env:COGNITO_USER_POOL_ID = "eu-central-1_XXXXXXXXX"'
            Write-Info '  $env:COGNITO_CLIENT_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxx"'
            exit 1
        }
        
        Write-Success "Cognito User Pool ID: $UserPoolId"
        Write-Success "Cognito Client ID:    $(Truncate-Token $ClientId)"
        
    } catch {
        Write-Error-Message "Error querying CloudFormation: $_"
        Write-Host ""
        Write-Info "Please set environment variables manually:"
        Write-Info '  $env:COGNITO_USER_POOL_ID = "eu-central-1_XXXXXXXXX"'
        Write-Info '  $env:COGNITO_CLIENT_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxx"'
        exit 1
    }
}

# ============================================================================
# Step 2: Cognito Authentication
# ============================================================================

$IdToken = $null
$AccessToken = $null
$RefreshToken = $null

if (-not $SkipLogin) {
    Write-Header "2. Cognito Authentication"
    
    # Get password securely if not provided
    if (-not $Password) {
        $securePassword = Read-Host -Prompt "Enter password for $Username" -AsSecureString
        $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($BSTR)
    }
    
    Write-Info "Authenticating with Cognito..."
    
    # Build auth parameters JSON
    $authParams = @{
        USERNAME = $Username
        PASSWORD = $Password
    }
    $authParamsJson = $authParams | ConvertTo-Json -Compress
    
    try {
        # Call cognito-idp initiate-auth
        $authResponse = aws cognito-idp initiate-auth `
            --auth-flow USER_PASSWORD_AUTH `
            --client-id $ClientId `
            --auth-parameters $authParamsJson `
            --region $AWS_REGION `
            --output json 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error-Message "Cognito authentication failed"
            Write-Host $authResponse -ForegroundColor Red
            Write-Host ""
            Write-Info "Possible causes:"
            Write-Info "  - Incorrect username or password"
            Write-Info "  - User does not exist in Cognito User Pool"
            Write-Info "  - MFA required (not supported by this script yet)"
            Write-Info "  - User needs to change password"
            exit 1
        }
        
        $authResult = $authResponse | ConvertFrom-Json
        
        # Check for challenges (MFA, password change, etc.)
        if ($authResult.ChallengeName) {
            Write-Error-Message "Authentication challenge required: $($authResult.ChallengeName)"
            Write-Host ""
            Write-Info "This script does not support authentication challenges yet."
            Write-Info "Challenges may include:"
            Write-Info "  - NEW_PASSWORD_REQUIRED: User must change password"
            Write-Info "  - SMS_MFA: SMS-based MFA verification"
            Write-Info "  - SOFTWARE_TOKEN_MFA: TOTP-based MFA verification"
            Write-Host ""
            Write-Info "Please resolve the challenge using AWS Console or AWS CLI, then try again."
            exit 1
        }
        
        # Extract tokens
        if ($authResult.AuthenticationResult) {
            $IdToken = $authResult.AuthenticationResult.IdToken
            $AccessToken = $authResult.AuthenticationResult.AccessToken
            $RefreshToken = $authResult.AuthenticationResult.RefreshToken
            
            Write-Success "Authentication successful!"
            Write-Info "ID Token:      $(Truncate-Token $IdToken)"
            Write-Info "Access Token:  $(Truncate-Token $AccessToken)"
            
            if ($RefreshToken) {
                Write-Info "Refresh Token: $(Truncate-Token $RefreshToken)"
            }
        } else {
            Write-Error-Message "No authentication result in response"
            Write-Host ($authResult | ConvertTo-Json -Depth 5) -ForegroundColor Red
            exit 1
        }
        
    } catch {
        Write-Error-Message "Error during Cognito authentication: $_"
        exit 1
    } finally {
        # Clear password from memory
        if ($Password) {
            $Password = $null
        }
    }
} else {
    Write-Header "2. Cognito Authentication"
    Write-Warning-Message "Skipping Cognito login (SkipLogin flag set)"
    Write-Info "API request will be made without Authorization header"
}

# ============================================================================
# Step 3: Migration Parity API Request
# ============================================================================

Write-Header "3. Migration Parity API Request"

Write-Info "Calling API: $STAGE_API_URL"

# Prepare headers
$headers = @{
    "Content-Type" = "application/json"
}

if ($IdToken) {
    $headers["Authorization"] = "Bearer $IdToken"
    Write-Info "Using JWT Authorization header"
} else {
    Write-Warning-Message "No Authorization header (may result in 401/403)"
}

# Call the API
try {
    $response = Invoke-RestMethod -Method Get `
        -Uri $STAGE_API_URL `
        -Headers $headers `
        -ErrorAction Stop
    
    Write-Success "API request successful!"
    
    # ========================================================================
    # Step 4: Display Parity Results
    # ========================================================================
    
    Write-Header "4. Migration Parity Result"
    
    $status = $response.parity.status
    
    # Build result display
    $resultLines = @(
        "",
        "Status:               $status",
        "Repository Migrations: $($response.repo.migrationCount)",
        "Applied Migrations:    $($response.ledger.appliedCount)",
        "Latest (Repo):         $($response.repo.latest)",
        "Latest (DB):           $($response.ledger.lastApplied)",
        "",
        "Database:              $($response.database.host):$($response.database.port)/$($response.database.name)",
        "Lawbook Version:       $($response.lawbook.version)",
        "Generated:             $($response.timestamp)",
        ""
    )
    
    Write-Box -Title "MIGRATION PARITY CHECK RESULT" -Lines $resultLines
    
    # Status indicator
    if ($status -eq "PASS") {
        Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Green
        Write-Host "║    ✓ ALL MIGRATIONS IN SYNC           ║" -ForegroundColor Green
        Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Green
    } else {
        Write-Host "╔═══════════════════════════════════════╗" -ForegroundColor Red
        Write-Host "║    ✗ MIGRATIONS OUT OF SYNC           ║" -ForegroundColor Red
        Write-Host "╚═══════════════════════════════════════╝" -ForegroundColor Red
    }
    
    Write-Host ""
    Write-Host "Discrepancies:" -ForegroundColor White
    Write-Host "  Missing in DB:     $($response.parity.missingInDb.Count)" -ForegroundColor $(if ($response.parity.missingInDb.Count -gt 0) { "Yellow" } else { "Gray" })
    Write-Host "  Extra in DB:       $($response.parity.extraInDb.Count)" -ForegroundColor $(if ($response.parity.extraInDb.Count -gt 0) { "DarkYellow" } else { "Gray" })
    Write-Host "  Hash Mismatches:   $($response.parity.hashMismatches.Count)" -ForegroundColor $(if ($response.parity.hashMismatches.Count -gt 0) { "Red" } else { "Gray" })
    Write-Host ""
    
    # Display detailed discrepancies if FAIL
    if ($status -ne "PASS") {
        Write-Header "Discrepancy Details"
        
        if ($response.parity.missingInDb.Count -gt 0) {
            Write-Host "Missing in Database (repo has, DB doesn't):" -ForegroundColor Yellow
            foreach ($missing in $response.parity.missingInDb) {
                Write-Host "  - $missing" -ForegroundColor Yellow
            }
            Write-Host ""
        }
        
        if ($response.parity.extraInDb.Count -gt 0) {
            Write-Host "Extra in Database (DB has, repo doesn't):" -ForegroundColor DarkYellow
            foreach ($extra in $response.parity.extraInDb) {
                Write-Host "  - $extra" -ForegroundColor DarkYellow
            }
            Write-Host ""
        }
        
        if ($response.parity.hashMismatches.Count -gt 0) {
            Write-Host "Hash Mismatches (file modified after application):" -ForegroundColor Red
            foreach ($mismatch in $response.parity.hashMismatches) {
                Write-Host "  - $($mismatch.filename)" -ForegroundColor Red
                Write-Host "    Repo hash: $($mismatch.repoHash)" -ForegroundColor Gray
                Write-Host "    DB hash:   $($mismatch.dbHash)" -ForegroundColor Gray
            }
            Write-Host ""
        }
    }
    
    Write-Success "Test completed successfully!"
    exit 0
    
} catch {
    Write-Error-Message "API request failed!"
    Write-Host ""
    
    # Check for HTTP response
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $statusDescription = $_.Exception.Response.StatusDescription
        
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
        Write-Host "Error: $statusDescription" -ForegroundColor Red
        Write-Host ""
        
        # Provide helpful error messages based on status code
        switch ($statusCode) {
            401 {
                Write-Info "Unauthorized. Ensure:"
                Write-Info "  1. You authenticated with Cognito successfully"
                Write-Info "  2. The JWT token is valid and not expired"
                Write-Info "  3. The Authorization header is being sent correctly"
                Write-Host ""
                Write-Info "Try running the script again without -SkipLogin"
            }
            403 {
                Write-Info "Forbidden. Ensure:"
                Write-Info "  1. Your user has admin privileges"
                Write-Info "  2. AFU9_ADMIN_SUBS secret includes your sub"
                Write-Info "  3. ECS service has been restarted after secret update"
                Write-Host ""
                Write-Info "Your Cognito sub should be in the admin allowlist."
                Write-Info "Use scripts/setup-aws-admin-subs.ps1 to configure."
            }
            409 {
                Write-Info "Environment Disabled (ENV_DISABLED). Ensure:"
                Write-Info "  1. Stage environment is running"
                Write-Info "  2. Migration parity endpoint is enabled"
                Write-Info "  3. Check environment configuration"
            }
            404 {
                Write-Info "Not Found. Ensure:"
                Write-Info "  1. API endpoint exists: $STAGE_API_URL"
                Write-Info "  2. Stage deployment is complete"
                Write-Info "  3. Routing configuration is correct"
            }
            500 {
                Write-Info "Internal Server Error. Check:"
                Write-Info "  1. Stage environment logs"
                Write-Info "  2. Database connectivity"
                Write-Info "  3. ECS task health"
            }
            default {
                Write-Info "Unexpected error code: $statusCode"
                Write-Info "Check stage environment logs for details"
            }
        }
    } else {
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host ""
        Write-Info "Possible causes:"
        Write-Info "  - Network connectivity issues"
        Write-Info "  - DNS resolution failed"
        Write-Info "  - Stage environment unreachable"
        Write-Info "  - SSL/TLS certificate issues"
    }
    
    exit 1
}
