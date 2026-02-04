# E9.3-CTRL-05 Verification Script
# Validates S6 Deployment Observation implementation

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "E9.3-CTRL-05 Verification" -ForegroundColor Cyan
Write-Host "S6: Deployment Observation" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"
$allChecks = @()

function Test-Check {
    param(
        [string]$Name,
        [scriptblock]$Test
    )
    
    Write-Host "Checking: $Name" -ForegroundColor Yellow
    try {
        $result = & $Test
        if ($result) {
            Write-Host "  ✓ PASS" -ForegroundColor Green
            $script:allChecks += @{Name=$Name; Status="PASS"}
            return $true
        } else {
            Write-Host "  ✗ FAIL" -ForegroundColor Red
            $script:allChecks += @{Name=$Name; Status="FAIL"}
            return $false
        }
    } catch {
        Write-Host "  ✗ ERROR: $_" -ForegroundColor Red
        $script:allChecks += @{Name=$Name; Status="ERROR"}
        return $false
    }
}

# 1. Contract exists
Test-Check "Contract document exists" {
    Test-Path "docs/contracts/step-executor-s6.v1.md"
}

# 2. Contract listed in README
Test-Check "Contract listed in contracts README" {
    $content = Get-Content "docs/contracts/README.md" -Raw
    $content -match "step-executor-s6\.v1\.md"
}

# 3. Database migration exists
Test-Check "Database migration file exists" {
    Test-Path "database/migrations/089_deployment_observations.sql"
}

# 4. Deployment observer service exists
Test-Check "Deployment observer service exists" {
    Test-Path "control-center/src/lib/github/deployment-observer.ts"
}

# 5. S6 step executor exists
Test-Check "S6 step executor exists" {
    Test-Path "control-center/src/lib/loop/stepExecutors/s6-deployment-observe.ts"
}

# 6. S6 tests exist
Test-Check "S6 tests exist" {
    Test-Path "control-center/__tests__/lib/loop/s6-deployment-observe.test.ts"
}

# 7. State machine includes S6
Test-Check "State machine includes S6_DEPLOYMENT_OBSERVE" {
    $content = Get-Content "control-center/src/lib/loop/stateMachine.ts" -Raw
    $content -match "S6_DEPLOYMENT_OBSERVE"
}

# 8. Event store includes deployment observed event
Test-Check "Event store includes DEPLOYMENT_OBSERVED event" {
    $content = Get-Content "control-center/src/lib/loop/eventStore.ts" -Raw
    $content -match "DEPLOYMENT_OBSERVED"
}

# 9. Loop execution integrates S6
Test-Check "Loop execution integrates S6" {
    $content = Get-Content "control-center/src/lib/loop/execution.ts" -Raw
    ($content -match "import.*executeS6") -and ($content -match "executeS6\(pool")
}

# 10. Deployment observer has observeDeployments function
Test-Check "Deployment observer exports observeDeployments" {
    $content = Get-Content "control-center/src/lib/github/deployment-observer.ts" -Raw
    $content -match "export async function observeDeployments"
}

# 11. Database migration creates deployment_observations table
Test-Check "Migration creates deployment_observations table" {
    $content = Get-Content "database/migrations/089_deployment_observations.sql" -Raw
    $content -match "CREATE TABLE.*deployment_observations"
}

# 12. Database migration has unique constraint
Test-Check "Migration has unique constraint on issue_id + deployment_id" {
    $content = Get-Content "database/migrations/089_deployment_observations.sql" -Raw
    $content -match "UNIQUE.*issue_id.*github_deployment_id"
}

# 13. S6 executor imports deployment observer
Test-Check "S6 executor imports deployment observer" {
    $content = Get-Content "control-center/src/lib/loop/stepExecutors/s6-deployment-observe.ts" -Raw
    $content -match "import.*observeDeployments.*from.*deployment-observer"
}

# 14. S6 executor validates PR merged
Test-Check "S6 executor validates PR is merged" {
    $content = Get-Content "control-center/src/lib/loop/stepExecutors/s6-deployment-observe.ts" -Raw
    $content -match "PR_NOT_MERGED"
}

# 15. Contract specifies read-only semantics
Test-Check "Contract specifies read-only semantics" {
    $content = Get-Content "docs/contracts/step-executor-s6.v1.md" -Raw
    $content -match "Read-Only Semantics"
}

# 16. Contract specifies authenticity validation
Test-Check "Contract specifies authenticity validation" {
    $content = Get-Content "docs/contracts/step-executor-s6.v1.md" -Raw
    $content -match "Authenticity Guarantees"
}

# 17. Deployment observer validates authenticity
Test-Check "Deployment observer validates authenticity" {
    $content = Get-Content "control-center/src/lib/github/deployment-observer.ts" -Raw
    $content -match "validateDeploymentAuthenticity"
}

# 18. Database schema has is_authentic field
Test-Check "Database schema has is_authentic field" {
    $content = Get-Content "database/migrations/089_deployment_observations.sql" -Raw
    $content -match "is_authentic.*BOOLEAN"
}

# 19. Tests cover blocked scenarios
Test-Check "Tests cover blocked scenarios" {
    $content = Get-Content "control-center/__tests__/lib/loop/s6-deployment-observe.test.ts" -Raw
    ($content -match "Blocked scenarios") -and ($content -match "NO_PR_LINKED")
}

# 20. Tests cover success scenarios
Test-Check "Tests cover success scenarios" {
    $content = Get-Content "control-center/__tests__/lib/loop/s6-deployment-observe.test.ts" -Raw
    ($content -match "Success scenarios") -and ($content -match "deployments are found")
}

# Summary
Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

$passed = ($allChecks | Where-Object {$_.Status -eq "PASS"}).Count
$failed = ($allChecks | Where-Object {$_.Status -eq "FAIL"}).Count
$errors = ($allChecks | Where-Object {$_.Status -eq "ERROR"}).Count
$total = $allChecks.Count

Write-Host "Total Checks: $total" -ForegroundColor White
Write-Host "Passed: $passed" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "Errors: $errors" -ForegroundColor $(if ($errors -eq 0) { "Green" } else { "Red" })

if ($failed -eq 0 -and $errors -eq 0) {
    Write-Host ""
    Write-Host "✓ All checks passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "✗ Some checks failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Failed/Error checks:" -ForegroundColor Yellow
    $allChecks | Where-Object {$_.Status -ne "PASS"} | ForEach-Object {
        Write-Host "  - $($_.Name): $($_.Status)" -ForegroundColor Red
    }
    exit 1
}
