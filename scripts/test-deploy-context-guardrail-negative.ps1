# E7.0.1 Negative Test: Deploy Context Guardrail
# Tests that the guardrail correctly FAILS when environment boundaries are violated

$ErrorActionPreference = 'Stop'

Write-Host "🧪 Deploy Context Guardrail - Negative Tests" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$guardrailScript = Join-Path $scriptDir "deploy-context-guardrail.ts"

$testCount = 0
$passCount = 0
$failCount = 0

function Run-NegativeTest {
    param(
        [string]$testName,
        [int]$expectedExitCode
    )
    
    $script:testCount++
    Write-Host "Test ${testCount}: ${testName}" -ForegroundColor Yellow
    
    # Run the guardrail and capture exit code
    $output = & npx ts-node $guardrailScript 2>&1
    $actualExitCode = $LASTEXITCODE
    
    if ($actualExitCode -eq $expectedExitCode) {
        Write-Host "✅ PASS: Guardrail correctly failed with exit code ${actualExitCode}" -ForegroundColor Green
        $script:passCount++
    } else {
        Write-Host "❌ FAIL: Expected exit code ${expectedExitCode}, got ${actualExitCode}" -ForegroundColor Red
        Write-Host "Output:"
        Write-Host $output
        $script:failCount++
    }
    Write-Host ""
}

# Test 1: Missing DEPLOY_ENV (should fail with exit code 2)
Write-Host "=== Test 1: Missing DEPLOY_ENV ===" -ForegroundColor Cyan
Remove-Item Env:\DEPLOY_ENV -ErrorAction SilentlyContinue
Run-NegativeTest "Missing DEPLOY_ENV should fail" 2

# Test 2: Invalid DEPLOY_ENV values
Write-Host "=== Test 2: Invalid DEPLOY_ENV ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "development"
Run-NegativeTest "Invalid DEPLOY_ENV='development' should fail" 2

$env:DEPLOY_ENV = "test"
Run-NegativeTest "Invalid DEPLOY_ENV='test' should fail" 2

# Test 3: Prod deploy with stage secret ARN
Write-Host "=== Test 3: Prod deploy with stage secret ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "production"
$env:DB_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123"
Run-NegativeTest "Prod deploy with stage secret should fail" 1
Remove-Item Env:\DB_SECRET_ARN -ErrorAction SilentlyContinue

# Test 4: Prod deploy with stage image tag
Write-Host "=== Test 4: Prod deploy with stage image ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "production"
$env:IMAGE_URI = "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123"
Run-NegativeTest "Prod deploy with stage image should fail" 1
Remove-Item Env:\IMAGE_URI -ErrorAction SilentlyContinue

# Test 5: Prod deploy with staging service
Write-Host "=== Test 5: Prod deploy with staging service ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "production"
$env:ECS_SERVICE = "afu9-control-center-staging"
Run-NegativeTest "Prod deploy with staging service should fail" 1
Remove-Item Env:\ECS_SERVICE -ErrorAction SilentlyContinue

# Test 6: Prod deploy with CREATE_STAGING_SERVICE=true
Write-Host "=== Test 6: Prod deploy with CREATE_STAGING_SERVICE=true ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "production"
$env:CREATE_STAGING_SERVICE = "true"
Run-NegativeTest "Prod deploy with CREATE_STAGING_SERVICE=true should fail" 1
Remove-Item Env:\CREATE_STAGING_SERVICE -ErrorAction SilentlyContinue

# Test 7: Stage deploy with prod image tag
Write-Host "=== Test 7: Stage deploy with prod image ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "staging"
$env:IMAGE_URI = "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123"
Run-NegativeTest "Stage deploy with prod image should fail" 1
Remove-Item Env:\IMAGE_URI -ErrorAction SilentlyContinue

# Test 8: Stage deploy with prod service (no "staging" in name)
Write-Host "=== Test 8: Stage deploy with prod service ===" -ForegroundColor Cyan
$env:DEPLOY_ENV = "staging"
$env:ECS_SERVICE = "afu9-control-center"
Run-NegativeTest "Stage deploy with prod service should fail" 1
Remove-Item Env:\ECS_SERVICE -ErrorAction SilentlyContinue

# Summary
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Test Summary:"
Write-Host "  Total:  ${testCount}"
Write-Host "  Passed: ${passCount}" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "  Failed: ${failCount}" -ForegroundColor Red
} else {
    Write-Host "  Failed: ${failCount}"
}
Write-Host "==========================================" -ForegroundColor Cyan

if ($failCount -gt 0) {
    Write-Host "Some negative tests failed!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "All negative tests passed! Guardrail is working correctly." -ForegroundColor Green
    exit 0
}
