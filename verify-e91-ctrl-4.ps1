# E9.1-CTRL-4 Verification Script
# State Machine v1 (S1-S3) + Blocker Codes

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "E9.1-CTRL-4: State Machine v1 Verification" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

$allChecks = @()

# Check 1: State machine implementation exists
Write-Host "✓ Checking state machine implementation..." -ForegroundColor Yellow
$stateMachine = "control-center/src/lib/loop/stateMachine.ts"
if (Test-Path $stateMachine) {
    Write-Host "  [PASS] $stateMachine exists" -ForegroundColor Green
    $allChecks += $true
} else {
    Write-Host "  [FAIL] $stateMachine not found" -ForegroundColor Red
    $allChecks += $false
}

# Check 2: Tests exist
Write-Host "✓ Checking test file..." -ForegroundColor Yellow
$testFile = "control-center/__tests__/lib/loop/stateMachine.test.ts"
if (Test-Path $testFile) {
    Write-Host "  [PASS] $testFile exists" -ForegroundColor Green
    $allChecks += $true
} else {
    Write-Host "  [FAIL] $testFile not found" -ForegroundColor Red
    $allChecks += $false
}

# Check 3: Contract documentation exists
Write-Host "✓ Checking contract documentation..." -ForegroundColor Yellow
$contractDoc = "docs/contracts/loop-state-machine.v1.md"
if (Test-Path $contractDoc) {
    Write-Host "  [PASS] $contractDoc exists" -ForegroundColor Green
    $allChecks += $true
} else {
    Write-Host "  [FAIL] $contractDoc not found" -ForegroundColor Red
    $allChecks += $false
}

# Check 4: Verify TypeScript compilation
Write-Host "✓ Checking TypeScript compilation..." -ForegroundColor Yellow
Push-Location control-center
try {
    $tscOutput = npx tsc --noEmit src/lib/loop/stateMachine.ts 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  [PASS] TypeScript compilation successful" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  [FAIL] TypeScript compilation failed:" -ForegroundColor Red
        Write-Host $tscOutput -ForegroundColor Red
        $allChecks += $false
    }
} finally {
    Pop-Location
}

# Check 5: Run tests
Write-Host "✓ Running state machine tests..." -ForegroundColor Yellow
Push-Location control-center
try {
    $testOutput = npm test -- __tests__/lib/loop/stateMachine.test.ts 2>&1
    if ($testOutput -match "Tests:.*39 passed") {
        Write-Host "  [PASS] All 39 tests passed" -ForegroundColor Green
        $allChecks += $true
    } else {
        Write-Host "  [FAIL] Tests failed or incorrect count" -ForegroundColor Red
        $allChecks += $false
    }
} finally {
    Pop-Location
}

# Check 6: Verify blocker codes are defined
Write-Host "✓ Checking blocker codes..." -ForegroundColor Yellow
$blockerCodes = @(
    "NO_GITHUB_LINK",
    "NO_DRAFT",
    "NO_COMMITTED_DRAFT",
    "DRAFT_INVALID",
    "LOCKED",
    "UNKNOWN_STATE",
    "INVARIANT_VIOLATION"
)
$stateMachineContent = Get-Content $stateMachine -Raw
$allBlockersFound = $true
foreach ($code in $blockerCodes) {
    if ($stateMachineContent -match $code) {
        Write-Host "  ✓ $code defined" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ $code missing" -ForegroundColor Red
        $allBlockersFound = $false
    }
}
if ($allBlockersFound) {
    Write-Host "  [PASS] All 7 blocker codes defined" -ForegroundColor Green
    $allChecks += $true
} else {
    Write-Host "  [FAIL] Some blocker codes missing" -ForegroundColor Red
    $allChecks += $false
}

# Check 7: Verify states are defined
Write-Host "✓ Checking states..." -ForegroundColor Yellow
$states = @(
    "CREATED",
    "SPEC_READY",
    "IMPLEMENTING_PREP",
    "HOLD",
    "DONE"
)
$allStatesFound = $true
foreach ($state in $states) {
    if ($stateMachineContent -match $state) {
        Write-Host "  ✓ $state defined" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ $state missing" -ForegroundColor Red
        $allStatesFound = $false
    }
}
if ($allStatesFound) {
    Write-Host "  [PASS] All 5 states defined" -ForegroundColor Green
    $allChecks += $true
} else {
    Write-Host "  [FAIL] Some states missing" -ForegroundColor Red
    $allChecks += $false
}

# Check 8: Verify steps are defined
Write-Host "✓ Checking steps..." -ForegroundColor Yellow
$steps = @(
    "S1_PICK_ISSUE",
    "S2_SPEC_READY",
    "S3_IMPLEMENT_PREP"
)
$allStepsFound = $true
foreach ($step in $steps) {
    if ($stateMachineContent -match $step) {
        Write-Host "  ✓ $step defined" -ForegroundColor Gray
    } else {
        Write-Host "  ✗ $step missing" -ForegroundColor Red
        $allStepsFound = $false
    }
}
if ($allStepsFound) {
    Write-Host "  [PASS] All 3 steps defined" -ForegroundColor Green
    $allChecks += $true
} else {
    Write-Host "  [FAIL] Some steps missing" -ForegroundColor Red
    $allChecks += $false
}

# Summary
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Verification Summary" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
$passCount = ($allChecks | Where-Object { $_ -eq $true }).Count
$totalCount = $allChecks.Count
Write-Host "Passed: $passCount / $totalCount checks" -ForegroundColor $(if ($passCount -eq $totalCount) { "Green" } else { "Yellow" })

if ($passCount -eq $totalCount) {
    Write-Host ""
    Write-Host "✅ E9.1-CTRL-4 implementation verified successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    Write-Host "  1. Review the implementation in control-center/src/lib/loop/stateMachine.ts"
    Write-Host "  2. Review the contract in docs/contracts/loop-state-machine.v1.md"
    Write-Host "  3. Integrate resolveNextStep() into Loop execution logic"
    Write-Host "  4. Add UI indicators for blocker codes"
    exit 0
} else {
    Write-Host ""
    Write-Host "❌ Some verification checks failed. Please review the output above." -ForegroundColor Red
    exit 1
}
