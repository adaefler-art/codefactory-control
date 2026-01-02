# E7.0.1 Positive Test: Deploy Context Guardrail
# Tests that the guardrail correctly PASSES when environment boundaries are respected

$ErrorActionPreference = 'Stop'

Write-Host "🧪 Deploy Context Guardrail - Positive Tests" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$guardrailScript = Join-Path $scriptDir "deploy-context-guardrail.ts"

$testCount = 0
$passCount = 0
$failCount = 0

function Run-PositiveTest {
    param(
        [string]$testName
    )
    
    $script:testCount++
    Write-Host "Test ${testCount}: ${testName}" -ForegroundColor Yellow
    
    # Run the guardrail and capture exit code
    $output = & npx ts-node $guardrailScript 2>&1
    $actualExitCode = $LASTEXITCODE
    
    if ($actualExitCode -eq 0) {
        Write-Host "✅ PASS: Guardrail correctly passed" -ForegroundColor Green
        $script:passCount++
    } else {
        Write-Host "❌ FAIL: Expected guardrail to pass, but it failed with exit code ${actualExitCode}" -ForegroundColor Red
        Write-Host "Output:"
        Write-Host $output
        $script:failCount++
    }
    Write-Host ""
}

# Test 1: Valid production deploy
Write-Host "=== Test 1: Valid Production Deploy ===" -ForegroundColor Cyan
Remove-Item Env:\* -ErrorAction SilentlyContinue -Exclude @('PATH', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP')
$env:DEPLOY_ENV = "production"
$env:ECS_SERVICE = "afu9-control-center"
$env:ECS_CLUSTER = "afu9-cluster"
$env:CREATE_STAGING_SERVICE = "false"
$env:DB_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123"
$env:IMAGE_URI = "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123"
Run-PositiveTest "Valid production deploy should pass"

# Test 2: Valid staging deploy
Write-Host "=== Test 2: Valid Staging Deploy ===" -ForegroundColor Cyan
Remove-Item Env:\* -ErrorAction SilentlyContinue -Exclude @('PATH', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP')
$env:DEPLOY_ENV = "staging"
$env:ECS_SERVICE = "afu9-control-center-staging"
$env:ECS_CLUSTER = "afu9-cluster"
$env:CREATE_STAGING_SERVICE = "true"
$env:DB_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123"
$env:SMOKE_KEY_SECRET_ARN = "arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-xyz"
$env:IMAGE_URI = "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123"
Run-PositiveTest "Valid staging deploy should pass"

# Test 3: Production with minimal config
Write-Host "=== Test 3: Production with minimal config ===" -ForegroundColor Cyan
Remove-Item Env:\* -ErrorAction SilentlyContinue -Exclude @('PATH', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP')
$env:DEPLOY_ENV = "production"
$env:ECS_SERVICE = "afu9-control-center"
$env:ECS_CLUSTER = "afu9-cluster"
Run-PositiveTest "Production deploy with minimal config should pass"

# Test 4: Staging with minimal config
Write-Host "=== Test 4: Staging with minimal config ===" -ForegroundColor Cyan
Remove-Item Env:\* -ErrorAction SilentlyContinue -Exclude @('PATH', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP')
$env:DEPLOY_ENV = "staging"
$env:ECS_SERVICE = "afu9-control-center-staging"
$env:ECS_CLUSTER = "afu9-cluster"
Run-PositiveTest "Staging deploy with minimal config should pass"

# Test 5: Production with "prod" alias
Write-Host "=== Test 5: Production with 'prod' alias ===" -ForegroundColor Cyan
Remove-Item Env:\* -ErrorAction SilentlyContinue -Exclude @('PATH', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP')
$env:DEPLOY_ENV = "prod"
$env:ECS_SERVICE = "afu9-control-center"
$env:ECS_CLUSTER = "afu9-cluster"
Run-PositiveTest "Production deploy with 'prod' alias should pass"

# Test 6: Staging with "stage" alias
Write-Host "=== Test 6: Staging with 'stage' alias ===" -ForegroundColor Cyan
Remove-Item Env:\* -ErrorAction SilentlyContinue -Exclude @('PATH', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP')
$env:DEPLOY_ENV = "stage"
$env:ECS_SERVICE = "afu9-control-center-staging"
$env:ECS_CLUSTER = "afu9-cluster"
Run-PositiveTest "Staging deploy with 'stage' alias should pass"

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
    Write-Host "Some positive tests failed!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "All positive tests passed! Valid deploys are allowed." -ForegroundColor Green
    exit 0
}
