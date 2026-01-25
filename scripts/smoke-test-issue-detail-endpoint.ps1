#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Smoke-Test für /api/afu9/issues/[ref] Endpoint (Epic-1 v0.9)

.DESCRIPTION
    Testet den neuen Issue Detail Endpoint mit allen drei Identifier-Typen:
    - UUID v4 (canonical)
    - publicId (8-hex prefix)
    - canonicalId (z.B. I811, E81.1)

.PARAMETER BaseUrl
    Base URL des control-center (default: http://localhost:3000)

.PARAMETER ServiceToken
    Service Token für Authentication (optional, falls gesetzt)

.EXAMPLE
    .\smoke-test-issue-detail-endpoint.ps1
    .\smoke-test-issue-detail-endpoint.ps1 -BaseUrl "https://control-center.example.com"
    .\smoke-test-issue-detail-endpoint.ps1 -ServiceToken "your-token-here"
#>

[CmdletBinding()]
param(
    [Parameter()]
    [string]$BaseUrl = "http://localhost:3000",

    [Parameter()]
    [string]$ServiceToken = $null
)

$ErrorActionPreference = "Stop"

# ANSI Color Codes
$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Success,
        [string]$Details = ""
    )
    
    if ($Success) {
        Write-Host "${Green}✓${Reset} ${TestName}" -NoNewline
    } else {
        Write-Host "${Red}✗${Reset} ${TestName}" -NoNewline
    }
    
    if ($Details) {
        Write-Host " ${Blue}(${Details})${Reset}"
    } else {
        Write-Host ""
    }
}

function Invoke-ApiRequest {
    param(
        [string]$Endpoint,
        [hashtable]$Headers = @{}
    )
    
    try {
        $uri = "${BaseUrl}${Endpoint}"
        
        # Add service token if provided
        if ($ServiceToken) {
            $Headers["x-afu9-service-token"] = $ServiceToken
        }
        
        $response = Invoke-RestMethod -Uri $uri -Method Get -Headers $Headers -ErrorAction Stop
        
        return @{
            Success = $true
            Data = $response
            StatusCode = 200
        }
    } catch {
        $statusCode = if ($_.Exception.Response) { 
            [int]$_.Exception.Response.StatusCode 
        } else { 
            0 
        }
        
        return @{
            Success = $false
            Error = $_.Exception.Message
            StatusCode = $statusCode
        }
    }
}

Write-Host ""
Write-Host "${Blue}═══════════════════════════════════════════════════════════${Reset}"
Write-Host "${Blue}  Epic-1 v0.9: /api/afu9/issues/[ref] Smoke Test${Reset}"
Write-Host "${Blue}═══════════════════════════════════════════════════════════${Reset}"
Write-Host ""
Write-Host "Base URL: ${Yellow}${BaseUrl}${Reset}"
Write-Host ""

# Step 1: Get list of issues to find a valid test candidate
Write-Host "${Blue}Step 1: Fetching issues list...${Reset}"

$listResult = Invoke-ApiRequest -Endpoint "/api/afu9/issues?limit=1"

if (-not $listResult.Success) {
    Write-Host "${Red}✗ Failed to fetch issues list${Reset}"
    Write-Host "Error: $($listResult.Error)"
    exit 1
}

if ($listResult.Data.issues.Count -eq 0) {
    Write-Host "${Yellow}⚠ No issues found in database${Reset}"
    Write-Host "Please create at least one issue before running this test."
    exit 0
}

$testIssue = $listResult.Data.issues[0]
$uuid = $testIssue.id
$publicId = $testIssue.publicId
$canonicalId = $testIssue.canonicalId

Write-Host "${Green}✓ Found test issue:${Reset}"
Write-Host "  UUID:        ${Yellow}${uuid}${Reset}"
Write-Host "  PublicId:    ${Yellow}${publicId}${Reset}"
Write-Host "  CanonicalId: ${Yellow}${canonicalId}${Reset}"
Write-Host ""

# Step 2: Test UUID lookup
Write-Host "${Blue}Step 2: Testing UUID lookup...${Reset}"

$uuidResult = Invoke-ApiRequest -Endpoint "/api/afu9/issues/${uuid}"

if ($uuidResult.Success -and $uuidResult.Data.id -eq $uuid) {
    Write-TestResult -TestName "UUID lookup" -Success $true -Details "Status: 200"
} else {
    Write-TestResult -TestName "UUID lookup" -Success $false -Details "Status: $($uuidResult.StatusCode)"
}

# Step 3: Test publicId lookup
Write-Host "${Blue}Step 3: Testing publicId (8-hex) lookup...${Reset}"

$publicIdResult = Invoke-ApiRequest -Endpoint "/api/afu9/issues/${publicId}"

if ($publicIdResult.Success -and $publicIdResult.Data.publicId -eq $publicId) {
    Write-TestResult -TestName "PublicId lookup" -Success $true -Details "Status: 200"
} else {
    Write-TestResult -TestName "PublicId lookup" -Success $false -Details "Status: $($publicIdResult.StatusCode)"
}

# Step 4: Test canonicalId lookup (if available)
if ($canonicalId) {
    Write-Host "${Blue}Step 4: Testing canonicalId lookup...${Reset}"
    
    $canonicalIdResult = Invoke-ApiRequest -Endpoint "/api/afu9/issues/${canonicalId}"
    
    if ($canonicalIdResult.Success -and $canonicalIdResult.Data.canonicalId -eq $canonicalId) {
        Write-TestResult -TestName "CanonicalId lookup" -Success $true -Details "Status: 200"
    } else {
        Write-TestResult -TestName "CanonicalId lookup" -Success $false -Details "Status: $($canonicalIdResult.StatusCode)"
    }
} else {
    Write-Host "${Yellow}⚠ Skipping canonicalId test (not set on test issue)${Reset}"
}

# Step 5: Test 404 (non-existent UUID)
Write-Host "${Blue}Step 5: Testing 404 (non-existent UUID)...${Reset}"

$notFoundResult = Invoke-ApiRequest -Endpoint "/api/afu9/issues/00000000-0000-0000-0000-000000000000"

if ($notFoundResult.StatusCode -eq 404) {
    Write-TestResult -TestName "404 Not Found" -Success $true -Details "Status: 404"
} else {
    Write-TestResult -TestName "404 Not Found" -Success $false -Details "Expected 404, got $($notFoundResult.StatusCode)"
}

# Step 6: Test 400 (invalid identifier)
Write-Host "${Blue}Step 6: Testing 400 (invalid identifier)...${Reset}"

$invalidResult = Invoke-ApiRequest -Endpoint "/api/afu9/issues/not-a-valid-id"

if ($invalidResult.StatusCode -eq 400) {
    Write-TestResult -TestName "400 Bad Request" -Success $true -Details "Status: 400"
} else {
    Write-TestResult -TestName "400 Bad Request" -Success $false -Details "Expected 400, got $($invalidResult.StatusCode)"
}

# Summary
Write-Host ""
Write-Host "${Blue}═══════════════════════════════════════════════════════════${Reset}"
Write-Host "${Green}✓ Smoke Test Complete${Reset}"
Write-Host "${Blue}═══════════════════════════════════════════════════════════${Reset}"
Write-Host ""
