# E9.1_F1 S1-S3 Flow Verification Script
# 
# Verifies that the S1-S3 live flow implementation is working correctly.
# Run this after deploying to verify all endpoints and database schema.

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Repo = "adaefler-art/codefactory-control",
    [int]$IssueNumber = 1
)

$ErrorActionPreference = "Stop"

Write-Host "=== E9.1_F1 S1-S3 Flow Verification ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host "Target Repo: $Repo" -ForegroundColor Gray
Write-Host ""

# Test results tracking
$TestResults = @()

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Url,
        [object]$Body = $null,
        [string]$ExpectedStatus = "200|201"
    )
    
    Write-Host "Testing: $Name" -ForegroundColor Yellow
    Write-Host "  $Method $Url" -ForegroundColor Gray
    
    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Request-ID" = "verify-$(Get-Date -Format 'yyyyMMddHHmmss')"
        }
        
        $params = @{
            Uri = $Url
            Method = $Method
            Headers = $headers
            ErrorAction = "Stop"
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
        }
        
        $response = Invoke-WebRequest @params
        
        if ($response.StatusCode -match $ExpectedStatus) {
            Write-Host "  ✓ Success (Status: $($response.StatusCode))" -ForegroundColor Green
            $script:TestResults += @{
                Name = $Name
                Status = "PASS"
                StatusCode = $response.StatusCode
            }
            return $response.Content | ConvertFrom-Json
        } else {
            Write-Host "  ✗ Failed (Status: $($response.StatusCode), Expected: $ExpectedStatus)" -ForegroundColor Red
            $script:TestResults += @{
                Name = $Name
                Status = "FAIL"
                StatusCode = $response.StatusCode
            }
            return $null
        }
    }
    catch {
        Write-Host "  ✗ Error: $($_.Exception.Message)" -ForegroundColor Red
        $script:TestResults += @{
            Name = $Name
            Status = "ERROR"
            Error = $_.Exception.Message
        }
        return $null
    }
    
    Write-Host ""
}

# Test 1: List GitHub Issues (S1 - Part 1)
Write-Host "`n--- Test 1: List GitHub Issues ---" -ForegroundColor Cyan
$issues = Test-Endpoint `
    -Name "GET /api/afu9/github/issues" `
    -Method "GET" `
    -Url "$BaseUrl/api/afu9/github/issues?repo=$Repo&state=open&limit=10"

if ($issues -and $issues.issues) {
    Write-Host "  Issues found: $($issues.issues.Count)" -ForegroundColor Green
} else {
    Write-Host "  Warning: No issues found or endpoint failed" -ForegroundColor Yellow
}

# Test 2: Pick Issue (S1)
Write-Host "`n--- Test 2: Pick Issue (S1) ---" -ForegroundColor Cyan
$pickResult = Test-Endpoint `
    -Name "POST /api/afu9/s1s3/issues/pick" `
    -Method "POST" `
    -Url "$BaseUrl/api/afu9/s1s3/issues/pick" `
    -Body @{
        repo = $Repo
        issueNumber = $IssueNumber
        canonicalId = "VERIFY-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    } `
    -ExpectedStatus "201|200"

$issueId = $null
if ($pickResult -and $pickResult.issue) {
    $issueId = $pickResult.issue.id
    Write-Host "  Issue ID: $issueId" -ForegroundColor Green
    Write-Host "  Public ID: $($pickResult.issue.public_id)" -ForegroundColor Green
    Write-Host "  Status: $($pickResult.issue.status)" -ForegroundColor Green
}

# Test 3: List S1-S3 Issues
Write-Host "`n--- Test 3: List S1-S3 Issues ---" -ForegroundColor Cyan
$issuesList = Test-Endpoint `
    -Name "GET /api/afu9/s1s3/issues" `
    -Method "GET" `
    -Url "$BaseUrl/api/afu9/s1s3/issues?limit=10"

if ($issuesList -and $issuesList.issues) {
    Write-Host "  Issues found: $($issuesList.issues.Count)" -ForegroundColor Green
}

# Test 4: Get Issue Detail
if ($issueId) {
    Write-Host "`n--- Test 4: Get Issue Detail ---" -ForegroundColor Cyan
    $issueDetail = Test-Endpoint `
        -Name "GET /api/afu9/s1s3/issues/[id]" `
        -Method "GET" `
        -Url "$BaseUrl/api/afu9/s1s3/issues/$issueId"
    
    if ($issueDetail) {
        Write-Host "  Runs: $($issueDetail.runs.Count)" -ForegroundColor Green
        Write-Host "  Steps: $($issueDetail.steps.Count)" -ForegroundColor Green
    }
}

# Test 5: Set Spec (S2)
if ($issueId) {
    Write-Host "`n--- Test 5: Set Spec (S2) ---" -ForegroundColor Cyan
    $specResult = Test-Endpoint `
        -Name "POST /api/afu9/s1s3/issues/[id]/spec" `
        -Method "POST" `
        -Url "$BaseUrl/api/afu9/s1s3/issues/$issueId/spec" `
        -Body @{
            problem = "Verification test problem"
            scope = "Test scope for verification"
            acceptanceCriteria = @(
                "AC1: System responds correctly",
                "AC2: Data is persisted",
                "AC3: Logs are generated"
            )
            notes = "Automated verification test"
        }
    
    if ($specResult -and $specResult.issue) {
        Write-Host "  Status: $($specResult.issue.status)" -ForegroundColor Green
        Write-Host "  AC Count: $(($specResult.issue.acceptance_criteria | Measure-Object).Count)" -ForegroundColor Green
    }
}

# Test 6: Implement (S3) - Skip by default as it creates real branches/PRs
Write-Host "`n--- Test 6: Implement (S3) ---" -ForegroundColor Cyan
Write-Host "  ⚠ Skipped - Would create real branch/PR" -ForegroundColor Yellow
if ($issueId) {
    Write-Host "  To test manually, run:" -ForegroundColor Gray
    Write-Host "  curl -X POST $BaseUrl/api/afu9/s1s3/issues/$issueId/implement -H 'Content-Type: application/json' -d '{\"baseBranch\":\"main\"}'" -ForegroundColor Gray
} else {
    Write-Host "  (Issue ID not available from previous steps)" -ForegroundColor Gray
}

# Test 7: Database Schema Verification
Write-Host "`n--- Test 7: Database Schema Verification ---" -ForegroundColor Cyan
Write-Host "  Checking for migration 086_s1s3_flow_persistence.sql" -ForegroundColor Gray

$migrationFile = "database/migrations/086_s1s3_flow_persistence.sql"
if (Test-Path $migrationFile) {
    Write-Host "  ✓ Migration file exists" -ForegroundColor Green
    $script:TestResults += @{
        Name = "Migration File Exists"
        Status = "PASS"
    }
} else {
    Write-Host "  ✗ Migration file not found" -ForegroundColor Red
    $script:TestResults += @{
        Name = "Migration File Exists"
        Status = "FAIL"
    }
}

# Test 8: Code Files Verification
Write-Host "`n--- Test 8: Code Files Verification ---" -ForegroundColor Cyan

$requiredFiles = @(
    "control-center/src/lib/contracts/s1s3Flow.ts",
    "control-center/src/lib/db/s1s3Flow.ts",
    "control-center/app/api/afu9/github/issues/route.ts",
    "control-center/app/api/afu9/s1s3/issues/pick/route.ts",
    "control-center/app/api/afu9/s1s3/issues/[id]/spec/route.ts",
    "control-center/app/api/afu9/s1s3/issues/[id]/implement/route.ts",
    "control-center/app/api/afu9/s1s3/prs/[prNumber]/checks/route.ts"
)

foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file" -ForegroundColor Red
    }
}

# Summary
Write-Host "`n=== Test Summary ===" -ForegroundColor Cyan

$passCount = ($TestResults | Where-Object { $_.Status -eq "PASS" }).Count
$failCount = ($TestResults | Where-Object { $_.Status -eq "FAIL" }).Count
$errorCount = ($TestResults | Where-Object { $_.Status -eq "ERROR" }).Count
$totalCount = $TestResults.Count

Write-Host "Total Tests: $totalCount" -ForegroundColor Gray
Write-Host "  Passed: $passCount" -ForegroundColor Green
Write-Host "  Failed: $failCount" -ForegroundColor Red
Write-Host "  Errors: $errorCount" -ForegroundColor Yellow

if ($failCount -eq 0 -and $errorCount -eq 0) {
    Write-Host "`n✓ All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n✗ Some tests failed or had errors" -ForegroundColor Red
    exit 1
}
