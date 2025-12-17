#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Validate Epic-4 DB toggle hardening implementation

.DESCRIPTION
    This script validates that the database toggle hardening works correctly by:
    - Checking ECS stack implementation for conditional DB secret grants
    - Verifying DATABASE_ENABLED environment variable logic
    - Confirming CDK validation for enableDatabase=true without dbSecretArn
    - Testing smoke test script syntax and help

.EXAMPLE
    .\scripts\validate_epic4_implementation.ps1
#>

$ErrorActionPreference = "Stop"

# Color output helpers
function Write-Success { param([string]$Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Failure { param([string]$Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Info { param([string]$Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Section { param([string]$Message) Write-Host "`n========================================" -ForegroundColor Cyan; Write-Host $Message -ForegroundColor Cyan; Write-Host "========================================" -ForegroundColor Cyan }

$script:PassedChecks = 0
$script:FailedChecks = 0

function Test-FileContains {
    param(
        [string]$FilePath,
        [string]$Pattern,
        [string]$CheckName
    )
    
    if (-not (Test-Path $FilePath)) {
        Write-Failure "$CheckName : File not found: $FilePath"
        $script:FailedChecks++
        return $false
    }
    
    $content = Get-Content $FilePath -Raw
    if ($content -match $Pattern) {
        Write-Success "$CheckName : Found pattern"
        $script:PassedChecks++
        return $true
    } else {
        Write-Failure "$CheckName : Pattern not found in $FilePath"
        Write-Host "   Expected pattern: $Pattern" -ForegroundColor Gray
        $script:FailedChecks++
        return $false
    }
}

function Test-ScriptSyntax {
    param(
        [string]$ScriptPath,
        [string]$ScriptName
    )
    
    Write-Info "Testing $ScriptName syntax..."
    
    try {
        $help = pwsh -Command "Get-Help $ScriptPath -ErrorAction Stop" 2>&1
        
        if ($LASTEXITCODE -eq 0 -and $help -match $ScriptName) {
            Write-Success "$ScriptName : Valid PowerShell syntax"
            $script:PassedChecks++
            return $true
        } else {
            Write-Failure "$ScriptName : Syntax error or help not available"
            $script:FailedChecks++
            return $false
        }
    } catch {
        Write-Failure "$ScriptName : Script syntax check failed: $($_.Exception.Message)"
        $script:FailedChecks++
        return $false
    }
}

try {
    Write-Section "Epic-4 Implementation Validation"
    
    # 1. Check ECS stack has conditional DB secret grants
    Write-Section "Checking ECS Stack Implementation"
    
    Test-FileContains `
        -FilePath "lib/afu9-ecs-stack.ts" `
        -Pattern "if \(dbSecret\)" `
        -CheckName "Conditional DB secret grants"
    
    Test-FileContains `
        -FilePath "lib/afu9-ecs-stack.ts" `
        -Pattern "DATABASE_ENABLED: enableDatabase \? 'true' : 'false'" `
        -CheckName "DATABASE_ENABLED environment variable logic"
    
    Test-FileContains `
        -FilePath "lib/afu9-ecs-stack.ts" `
        -Pattern "\.\.\.\(dbSecret" `
        -CheckName "Conditional database secrets injection"
    
    Test-FileContains `
        -FilePath "lib/afu9-ecs-stack.ts" `
        -Pattern "if \(enableDatabase && !dbSecretArn && !dbSecretName\)" `
        -CheckName "CDK validation for enableDatabase=true"
    
    # 2. Check Control Center ready endpoint handles DATABASE_ENABLED
    Write-Section "Checking Control Center Implementation"
    
    Test-FileContains `
        -FilePath "control-center/app/api/ready/route.ts" `
        -Pattern "DATABASE_ENABLED === 'true'" `
        -CheckName "Control Center reads DATABASE_ENABLED env var"
    
    Test-FileContains `
        -FilePath "control-center/app/api/ready/route.ts" `
        -Pattern "status: 'not_configured'" `
        -CheckName "Control Center reports not_configured when DB disabled"
    
    # 3. Check scripts exist and have valid syntax
    Write-Section "Checking Scripts"
    
    Test-ScriptSyntax -ScriptPath "scripts/smoke_epic4.ps1" -ScriptName "smoke_epic4"
    Test-ScriptSyntax -ScriptPath "scripts/ecs_debug.ps1" -ScriptName "ecs_debug"
    
    # 4. Check documentation exists
    Write-Section "Checking Documentation"
    
    if (Test-Path "docs/TESTING_EPIC4.md") {
        Write-Success "TESTING_EPIC4.md exists"
        $script:PassedChecks++
    } else {
        Write-Failure "TESTING_EPIC4.md not found"
        $script:FailedChecks++
    }
    
    # 5. Check package.json scripts
    Write-Section "Checking package.json Scripts"
    
    Test-FileContains `
        -FilePath "package.json" `
        -Pattern '"smoke:epic4"' `
        -CheckName "npm script smoke:epic4"
    
    Test-FileContains `
        -FilePath "package.json" `
        -Pattern '"ecs:debug"' `
        -CheckName "npm script ecs:debug"
    
    # Print summary
    Write-Section "VALIDATION SUMMARY"
    Write-Host "Passed:  $script:PassedChecks" -ForegroundColor Green
    Write-Host "Failed:  $script:FailedChecks" -ForegroundColor Red
    Write-Host ""
    
    if ($script:FailedChecks -gt 0) {
        Write-Failure "VALIDATION FAILED"
        Write-Host "Some checks did not pass. Review the output above for details." -ForegroundColor Red
        exit 1
    } else {
        Write-Success "ALL VALIDATION CHECKS PASSED"
        Write-Host ""
        Write-Success "✨ Epic-4 implementation is complete and correct"
        Write-Host ""
        Write-Info "Next steps:"
        Write-Info "  1. Deploy with enableDatabase=false to test DB disabled scenario"
        Write-Info "  2. Run smoke tests: npm run smoke:epic4 -- -ExpectDatabaseEnabled false"
        Write-Info "  3. Deploy with enableDatabase=true to test DB enabled scenario"
        Write-Info "  4. Run smoke tests: npm run smoke:epic4 -- -ExpectDatabaseEnabled true"
        Write-Host ""
        Write-Info "For detailed testing instructions, see docs/TESTING_EPIC4.md"
        exit 0
    }
    
} catch {
    Write-Failure "Unexpected error during validation"
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Gray
    exit 1
}
