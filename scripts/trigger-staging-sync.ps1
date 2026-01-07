#!/usr/bin/env pwsh
#Requires -Version 7.0

<#
.SYNOPSIS
    Triggers GitHub issues sync for staging environment
    
.DESCRIPTION
    Authenticates with Cognito and calls the /api/ops/issues/sync endpoint
    
.EXAMPLE
    .\scripts\trigger-staging-sync.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# Configuration
$UserPoolId = "eu-central-1_XYQjr7oX6"
$ClientId = "3rmgq2qf1p84mo64tnhvk9cr6s"
$Username = "adaefler@me.com"
$Password = "SecurePass123!@#Dev"
$ApiBaseUrl = "https://stage.afu-9.com"
$SyncEndpoint = "/api/ops/issues/sync"

Write-Host "🔐 Authenticating with Cognito..." -ForegroundColor Cyan

# Authenticate and get tokens
$authParams = @{
    AuthFlow = "USER_PASSWORD_AUTH"
    ClientId = $ClientId
    AuthParameters = @{
        USERNAME = $Username
        PASSWORD = $Password
    }
}

try {
    $authResult = aws cognito-idp initiate-auth `
        --region eu-central-1 `
        --auth-flow USER_PASSWORD_AUTH `
        --client-id $ClientId `
        --auth-parameters "USERNAME=$Username,PASSWORD=$Password" `
        --query 'AuthenticationResult.[IdToken,AccessToken,RefreshToken]' `
        --output text
    
    if ($LASTEXITCODE -ne 0) {
        throw "Cognito authentication failed"
    }
    
    $tokens = $authResult -split "`t"
    $IdToken = $tokens[0]
    $AccessToken = $tokens[1]
    $RefreshToken = $tokens[2]
    
    Write-Host "  ✅ Authentication successful" -ForegroundColor Green
    
    # Get user sub from ID token
    $tokenParts = $IdToken -split '\.'
    $payload = $tokenParts[1]
    # Add padding if needed
    while ($payload.Length % 4 -ne 0) {
        $payload += "="
    }
    $decodedBytes = [Convert]::FromBase64String($payload)
    $decodedJson = [System.Text.Encoding]::UTF8.GetString($decodedBytes)
    $claims = $decodedJson | ConvertFrom-Json
    $cognitoSub = $claims.sub
    
    Write-Host "  User sub: $cognitoSub" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ Authentication failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🚀 Triggering GitHub sync..." -ForegroundColor Cyan

try {
    # Create session with cookies
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    
    # Add cookies from tokens
    $cookieDomain = "stage.afu-9.com"
    $session.Cookies.Add((New-Object System.Net.Cookie("afu9_id", $IdToken, "/", $cookieDomain)))
    $session.Cookies.Add((New-Object System.Net.Cookie("afu9_access", $AccessToken, "/", $cookieDomain)))
    $session.Cookies.Add((New-Object System.Net.Cookie("afu9_refresh", $RefreshToken, "/", $cookieDomain)))
    
    # Call sync endpoint with Cognito sub header
    $headers = @{
        "x-afu9-sub" = $cognitoSub
        "Content-Type" = "application/json"
    }
    
    $response = Invoke-WebRequest `
        -Uri "$ApiBaseUrl$SyncEndpoint" `
        -Method POST `
        -Headers $headers `
        -WebSession $session `
        -TimeoutSec 120 `
        -ErrorAction Stop
    
    Write-Host "  ✅ Sync triggered successfully!" -ForegroundColor Green
    Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Gray
    
    if ($response.Content) {
        Write-Host ""
        Write-Host "📊 Response:" -ForegroundColor Cyan
        $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Write-Host
    }
    
} catch {
    Write-Host "❌ Sync request failed: $_" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  Status Code: $statusCode" -ForegroundColor Red
        
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            $reader.Close()
            Write-Host "  Response: $responseBody" -ForegroundColor Red
        } catch {
            # Ignore read errors
        }
    }
    
    exit 1
}

Write-Host ""
Write-Host "✅ Done! Check diagnostic endpoint for results:" -ForegroundColor Green
Write-Host "   https://stage.afu-9.com/api/admin/diagnose-mirror-status-test" -ForegroundColor Gray
