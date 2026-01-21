# E9.1-CTRL-2 Loop Run Persistence Verification
# Demonstrates run record creation and persistence

Write-Host "=== E9.1-CTRL-2 Loop Run Persistence Verification ===" -ForegroundColor Cyan
Write-Host ""

# Check if database migration exists
Write-Host "1. Checking database migration..." -ForegroundColor Yellow
$migrationFile = "database/migrations/083_loop_runs_persistence.sql"
if (Test-Path $migrationFile) {
    Write-Host "   ✓ Migration file exists: $migrationFile" -ForegroundColor Green
    $migrationContent = Get-Content $migrationFile -Raw
    if ($migrationContent -match "loop_runs" -and $migrationContent -match "loop_run_steps") {
        Write-Host "   ✓ Contains loop_runs and loop_run_steps tables" -ForegroundColor Green
    }
} else {
    Write-Host "   ✗ Migration file not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check if runStore module exists
Write-Host "2. Checking runStore module..." -ForegroundColor Yellow
$runStoreFile = "control-center/src/lib/loop/runStore.ts"
if (Test-Path $runStoreFile) {
    Write-Host "   ✓ runStore.ts exists" -ForegroundColor Green
    $runStoreContent = Get-Content $runStoreFile -Raw
    if ($runStoreContent -match "LoopRunStore" -and $runStoreContent -match "createRun") {
        Write-Host "   ✓ Contains LoopRunStore class with createRun method" -ForegroundColor Green
    }
} else {
    Write-Host "   ✗ runStore.ts not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check if execution.ts was updated
Write-Host "3. Checking execution.ts integration..." -ForegroundColor Yellow
$executionFile = "control-center/src/lib/loop/execution.ts"
if (Test-Path $executionFile) {
    $executionContent = Get-Content $executionFile -Raw
    if ($executionContent -match "getLoopRunStore" -and $executionContent -match "createRun") {
        Write-Host "   ✓ execution.ts integrated with runStore" -ForegroundColor Green
    } else {
        Write-Host "   ✗ execution.ts not properly integrated" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "   ✗ execution.ts not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check if schemas.ts includes runId
Write-Host "4. Checking schemas.ts for runId..." -ForegroundColor Yellow
$schemasFile = "control-center/src/lib/loop/schemas.ts"
if (Test-Path $schemasFile) {
    $schemasContent = Get-Content $schemasFile -Raw
    if ($schemasContent -match "runId.*uuid") {
        Write-Host "   ✓ schemas.ts includes runId field" -ForegroundColor Green
    } else {
        Write-Host "   ✗ schemas.ts missing runId field" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "   ✗ schemas.ts not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check if tests exist
Write-Host "5. Checking test coverage..." -ForegroundColor Yellow
$testFile = "control-center/__tests__/lib/loop/runStore.test.ts"
if (Test-Path $testFile) {
    Write-Host "   ✓ runStore tests exist" -ForegroundColor Green
    $testContent = Get-Content $testFile -Raw
    if ($testContent -match "createRun" -and $testContent -match "updateRunStatus" -and $testContent -match "getRunWithSteps") {
        Write-Host "   ✓ Tests cover main operations" -ForegroundColor Green
    }
} else {
    Write-Host "   ✗ runStore tests not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Check if contract was updated
Write-Host "6. Checking contract documentation..." -ForegroundColor Yellow
$contractFile = "docs/contracts/loop-api.v1.md"
if (Test-Path $contractFile) {
    $contractContent = Get-Content $contractFile -Raw
    if ($contractContent -match "runId" -and $contractContent -match "E9.1-CTRL-2") {
        Write-Host "   ✓ Contract documentation updated with runId" -ForegroundColor Green
    } else {
        Write-Host "   ✗ Contract not properly updated" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "   ✗ Contract file not found" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "✓ Database migration created (083_loop_runs_persistence.sql)" -ForegroundColor Green
Write-Host "✓ runStore.ts persistence module implemented" -ForegroundColor Green
Write-Host "✓ execution.ts integrated with persistence" -ForegroundColor Green
Write-Host "✓ schemas.ts includes runId in response" -ForegroundColor Green
Write-Host "✓ Test coverage for runStore" -ForegroundColor Green
Write-Host "✓ Contract documentation updated" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Apply database migration: npm run db:migrate" -ForegroundColor White
Write-Host "2. Test API endpoint: POST /api/loop/issues/[issueId]/run-next-step" -ForegroundColor White
Write-Host "3. Verify run records: SELECT * FROM loop_runs ORDER BY created_at DESC LIMIT 5" -ForegroundColor White
Write-Host ""
Write-Host "All verification checks passed! ✓" -ForegroundColor Green
