#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Epic-4 Smoke Test: Health/Ready checks with DB toggle validation

.DESCRIPTION
    This script performs comprehensive smoke tests for Epic-4 requirements:
    - Tests /health and /ready endpoints on all services
    - Validates database status based on enableDatabase configuration
    - Asserts database:not_configured when DATABASE_ENABLED=false
    - Asserts database:ok when DATABASE_ENABLED=true (with credentials)

.PARAMETER BaseUrl
    Base URL for the AFU-9 deployment (e.g., http://localhost or https://stage.afu-9.com)
    Default: http://localhost

.PARAMETER ExpectDatabaseEnabled
    Expected database configuration state:
    - 'true': Assert database should be configured and accessible
    - 'false': Assert database should report not_configured status
    - 'auto': Auto-detect from /ready endpoint response (default)

.PARAMETER Profile
    Optional AWS profile name for ECS deployments

.EXAMPLE
    .\scripts\smoke_epic4.ps1
    Run smoke tests against localhost with auto-detection

.EXAMPLE
    .\scripts\smoke_epic4.ps1 -BaseUrl https://stage.afu-9.com -ExpectDatabaseEnabled false
    Test staging environment and assert database is disabled

.EXAMPLE
    .\scripts\smoke_epic4.ps1 -BaseUrl https://prod.afu-9.com -ExpectDatabaseEnabled true
    Test production environment and assert database is enabled
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$BaseUrl = "http://localhost",

    [Parameter(Mandatory=$false)]
    [ValidateSet('true', 'false', 'auto')]
    [string]$ExpectDatabaseEnabled = 'auto',

    [Parameter(Mandatory=$false)]
    [string]$Profile
)

$ErrorActionPreference = "Stop"

# Color output helpers
function Write-Success { param([string]$Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Failure { param([string]$Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Warning { param([string]$Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Info { param([string]$Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Section { param([string]$Message) Write-Host "`n========================================" -ForegroundColor Cyan; Write-Host $Message -ForegroundColor Cyan; Write-Host "========================================" -ForegroundColor Cyan }

# Test counters
$script:PassedTests = 0
$script:FailedTests = 0
$script:WarningTests = 0

function Assert-Equal {
    param(
        [string]$Actual,
        [string]$Expected,
        [string]$TestName
    )
    if ($Actual -eq $Expected) {
        Write-Success "$TestName : $Actual = $Expected"
        $script:PassedTests++
        return $true
    } else {
        Write-Failure "$TestName : Expected '$Expected' but got '$Actual'"
        $script:FailedTests++
        return $false
    }
}

function Test-HealthEndpoint {
    param(
        [string]$ServiceName,
        [string]$Url
    )
    
    Write-Info "Testing $ServiceName health endpoint: $Url/health"
    
    try {
        $response = Invoke-RestMethod -Uri "$Url/health" -Method Get -TimeoutSec 10
        
        # Validate response structure
        if ($response.status -eq "ok" -and $response.service -and $response.version -and $response.timestamp) {
            Write-Success "$ServiceName health check passed"
            Write-Host "   Service: $($response.service), Version: $($response.version)" -ForegroundColor Gray
            $script:PassedTests++
            return $response
        } else {
            Write-Failure "$ServiceName health check failed: Invalid response structure"
            Write-Host "   Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Gray
            $script:FailedTests++
            return $null
        }
    } catch {
        Write-Failure "$ServiceName health check failed: $($_.Exception.Message)"
        $script:FailedTests++
        return $null
    }
}

function Test-ReadinessEndpoint {
    param(
        [string]$ServiceName,
        [string]$Url,
        [bool]$ValidateDatabaseStatus = $false,
        [string]$ExpectedDbStatus = "auto"
    )
    
    Write-Info "Testing $ServiceName readiness endpoint: $Url/ready"
    
    try {
        $response = Invoke-RestMethod -Uri "$Url/ready" -Method Get -TimeoutSec 10 -SkipHttpErrorCheck
        
        # Validate response structure
        if ($null -ne $response.ready -and $response.service -and $response.version -and $response.timestamp) {
            $readyStatus = if ($response.ready) { "READY" } else { "NOT READY" }
            
            if ($response.ready) {
                Write-Success "$ServiceName readiness check: $readyStatus"
            } else {
                Write-Warning "$ServiceName readiness check: $readyStatus (expected in some environments)"
                $script:WarningTests++
            }
            
            Write-Host "   Service: $($response.service), Version: $($response.version)" -ForegroundColor Gray
            
            # Display checks
            if ($response.checks) {
                Write-Host "   Checks:" -ForegroundColor Gray
                $response.checks.PSObject.Properties | ForEach-Object {
                    $checkName = $_.Name
                    $checkData = $_.Value
                    $statusEmoji = switch ($checkData.status) {
                        "ok" { "✓" }
                        "not_configured" { "○" }
                        "warning" { "⚠" }
                        "error" { "✗" }
                        default { "?" }
                    }
                    $statusColor = switch ($checkData.status) {
                        "ok" { "Green" }
                        "not_configured" { "Gray" }
                        "warning" { "Yellow" }
                        "error" { "Red" }
                        default { "White" }
                    }
                    Write-Host "     $statusEmoji $checkName : $($checkData.status)" -ForegroundColor $statusColor -NoNewline
                    if ($checkData.message) {
                        Write-Host " ($($checkData.message))" -ForegroundColor Gray
                    } else {
                        Write-Host ""
                    }
                }
            }
            
            # Validate database status if requested
            if ($ValidateDatabaseStatus -and $response.checks.database) {
                Write-Section "DATABASE CONFIGURATION VALIDATION"
                
                $dbStatus = $response.checks.database.status
                Write-Info "Database check status: $dbStatus"
                
                if ($ExpectedDbStatus -eq "false") {
                    # Assert database should be not_configured
                    if ($dbStatus -eq "not_configured") {
                        Write-Success "DATABASE TOGGLE VALIDATION: Database correctly reports 'not_configured' when enableDatabase=false"
                        $script:PassedTests++
                    } else {
                        Write-Failure "DATABASE TOGGLE VALIDATION: Expected 'not_configured' but got '$dbStatus' when enableDatabase=false"
                        Write-Failure "CRITICAL: This indicates enableDatabase=false is not properly preventing database access"
                        $script:FailedTests++
                    }
                } elseif ($ExpectedDbStatus -eq "true") {
                    # Assert database should be ok or at least attempting connection
                    if ($dbStatus -eq "ok" -or $dbStatus -eq "connection_configured") {
                        Write-Success "DATABASE TOGGLE VALIDATION: Database correctly reports '$dbStatus' when enableDatabase=true"
                        $script:PassedTests++
                    } elseif ($dbStatus -eq "not_configured") {
                        Write-Failure "DATABASE TOGGLE VALIDATION: Database reports 'not_configured' but enableDatabase=true"
                        Write-Failure "CRITICAL: Database credentials may not be injected properly"
                        $script:FailedTests++
                    } else {
                        Write-Warning "DATABASE TOGGLE VALIDATION: Database status is '$dbStatus' - may indicate connection issues"
                        Write-Host "   Message: $($response.checks.database.message)" -ForegroundColor Gray
                        $script:WarningTests++
                    }
                } else {
                    # Auto mode: just report the status
                    Write-Info "DATABASE STATUS (auto-detect): $dbStatus"
                    if ($response.checks.database.message) {
                        Write-Info "Message: $($response.checks.database.message)"
                    }
                }
            }
            
            $script:PassedTests++
            return $response
        } else {
            Write-Failure "$ServiceName readiness check failed: Invalid response structure"
            Write-Host "   Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor Gray
            $script:FailedTests++
            return $null
        }
    } catch {
        Write-Failure "$ServiceName readiness check failed: $($_.Exception.Message)"
        $script:FailedTests++
        return $null
    }
}

function Test-Service {
    param(
        [string]$ServiceName,
        [string]$Url,
        [bool]$ValidateDatabaseStatus = $false,
        [string]$ExpectedDbStatus = "auto"
    )
    
    Write-Section "Testing $ServiceName"
    Write-Info "URL: $Url"
    
    # Test health endpoint
    $healthResponse = Test-HealthEndpoint -ServiceName $ServiceName -Url $Url
    
    # Test readiness endpoint
    $readinessResponse = Test-ReadinessEndpoint -ServiceName $ServiceName -Url $Url -ValidateDatabaseStatus $ValidateDatabaseStatus -ExpectedDbStatus $ExpectedDbStatus
    
    return @{
        Health = $healthResponse
        Readiness = $readinessResponse
    }
}

# Main execution
try {
    Write-Section "AFU-9 Epic-4 Smoke Test Suite"
    Write-Host "Base URL: $BaseUrl" -ForegroundColor White
    Write-Host "Expected Database Enabled: $ExpectDatabaseEnabled" -ForegroundColor White
    Write-Host ""
    
    # Normalize base URL (remove trailing slash)
    $BaseUrl = $BaseUrl.TrimEnd('/')
    
    # Test Control Center (port 3000) with database validation
    $controlCenterUrl = "${BaseUrl}:3000"
    $controlCenterResult = Test-Service -ServiceName "Control Center" -Url $controlCenterUrl -ValidateDatabaseStatus $true -ExpectedDbStatus $ExpectDatabaseEnabled
    
    # Test MCP GitHub Server (port 3001)
    $mcpGithubUrl = "${BaseUrl}:3001"
    Test-Service -ServiceName "MCP GitHub Server" -Url $mcpGithubUrl
    
    # Test MCP Deploy Server (port 3002)
    $mcpDeployUrl = "${BaseUrl}:3002"
    Test-Service -ServiceName "MCP Deploy Server" -Url $mcpDeployUrl
    
    # Test MCP Observability Server (port 3003)
    $mcpObservabilityUrl = "${BaseUrl}:3003"
    Test-Service -ServiceName "MCP Observability Server" -Url $mcpObservabilityUrl
    
    # Print summary
    Write-Section "TEST SUMMARY"
    Write-Host "Passed:  $script:PassedTests" -ForegroundColor Green
    Write-Host "Warnings: $script:WarningTests" -ForegroundColor Yellow
    Write-Host "Failed:  $script:FailedTests" -ForegroundColor Red
    Write-Host ""
    
    if ($script:FailedTests -gt 0) {
        Write-Failure "SMOKE TESTS FAILED"
        Write-Host "Some critical tests did not pass. Review the output above for details." -ForegroundColor Red
        exit 1
    } else {
        Write-Success "ALL SMOKE TESTS PASSED"
        if ($script:WarningTests -gt 0) {
            Write-Warning "Some services reported warnings (expected in certain environments)"
        }
        Write-Host ""
        Write-Success "✨ Epic-4 smoke test suite completed successfully"
        exit 0
    }
    
} catch {
    Write-Failure "Unexpected error during smoke test execution"
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    exit 1
}
