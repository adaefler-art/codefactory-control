# E9.1-CTRL-6 Verification Commands

Write-Host "===== E9.1-CTRL-6 Verification =====" -ForegroundColor Cyan
Write-Host ""

# 1. Verify S2 executor file exists
Write-Host "[1/8] Checking S2 executor implementation..." -ForegroundColor Yellow
$s2File = "control-center/src/lib/loop/stepExecutors/s2-spec-gate.ts"
if (Test-Path $s2File) {
    Write-Host "  ✓ S2 executor exists: $s2File" -ForegroundColor Green
    $lineCount = (Get-Content $s2File | Measure-Object -Line).Lines
    Write-Host "    Lines: $lineCount" -ForegroundColor Gray
} else {
    Write-Host "  ✗ S2 executor NOT found!" -ForegroundColor Red
    exit 1
}

# 2. Verify test file exists
Write-Host "[2/8] Checking test file..." -ForegroundColor Yellow
$testFile = "control-center/__tests__/lib/loop/s2-spec-gate.test.ts"
if (Test-Path $testFile) {
    Write-Host "  ✓ Test file exists: $testFile" -ForegroundColor Green
    $testCount = (Get-Content $testFile | Select-String -Pattern "^\s*test\(" | Measure-Object).Count
    Write-Host "    Test cases: ~$testCount" -ForegroundColor Gray
} else {
    Write-Host "  ✗ Test file NOT found!" -ForegroundColor Red
    exit 1
}

# 3. Verify integration in execution.ts
Write-Host "[3/8] Checking integration in execution.ts..." -ForegroundColor Yellow
$executionFile = "control-center/src/lib/loop/execution.ts"
if (Test-Path $executionFile) {
    $content = Get-Content $executionFile -Raw
    if ($content -match "import.*executeS2.*from.*stepExecutors/s2-spec-gate") {
        Write-Host "  ✓ S2 import found in execution.ts" -ForegroundColor Green
    } else {
        Write-Host "  ✗ S2 import NOT found in execution.ts!" -ForegroundColor Red
        exit 1
    }
    if ($content -match "executeS2\(pool") {
        Write-Host "  ✓ S2 executor call found" -ForegroundColor Green
    } else {
        Write-Host "  ✗ S2 executor call NOT found!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  ✗ execution.ts NOT found!" -ForegroundColor Red
    exit 1
}

# 4. Verify acceptance criteria implementation
Write-Host "[4/8] Checking acceptance criteria implementation..." -ForegroundColor Yellow
$s2Content = Get-Content $s2File -Raw

# Criterion 1: NO_DRAFT blocker
if ($s2Content -match "BlockerCode\.NO_DRAFT") {
    Write-Host "  ✓ Criterion 1: NO_DRAFT blocker code used" -ForegroundColor Green
} else {
    Write-Host "  ✗ Criterion 1: NO_DRAFT blocker NOT found!" -ForegroundColor Red
    exit 1
}

# Criterion 2: NO_COMMITTED_DRAFT blocker
if ($s2Content -match "BlockerCode\.NO_COMMITTED_DRAFT") {
    Write-Host "  ✓ Criterion 2: NO_COMMITTED_DRAFT blocker code used" -ForegroundColor Green
} else {
    Write-Host "  ✗ Criterion 2: NO_COMMITTED_DRAFT blocker NOT found!" -ForegroundColor Red
    exit 1
}

# Criterion 3: DRAFT_INVALID blocker
if ($s2Content -match "BlockerCode\.DRAFT_INVALID") {
    Write-Host "  ✓ Criterion 3: DRAFT_INVALID blocker code used" -ForegroundColor Green
} else {
    Write-Host "  ✗ Criterion 3: DRAFT_INVALID blocker NOT found!" -ForegroundColor Red
    exit 1
}

# Criterion 4: SPEC_READY state transition
if ($s2Content -match "SPEC_READY") {
    Write-Host "  ✓ Criterion 4: SPEC_READY state transition found" -ForegroundColor Green
} else {
    Write-Host "  ✗ Criterion 4: SPEC_READY state NOT found!" -ForegroundColor Red
    exit 1
}

# 5. Verify draft lifecycle usage
Write-Host "[5/8] Checking draft lifecycle integration..." -ForegroundColor Yellow

# Check for source_session_id usage
if ($s2Content -match "source_session_id") {
    Write-Host "  ✓ Uses source_session_id from issue" -ForegroundColor Green
} else {
    Write-Host "  ✗ source_session_id NOT used!" -ForegroundColor Red
    exit 1
}

# Check for draft query
if ($s2Content -match "intent_issue_drafts") {
    Write-Host "  ✓ Queries intent_issue_drafts table" -ForegroundColor Green
} else {
    Write-Host "  ✗ Draft table query NOT found!" -ForegroundColor Red
    exit 1
}

# Check for version query
if ($s2Content -match "intent_issue_draft_versions") {
    Write-Host "  ✓ Queries intent_issue_draft_versions table" -ForegroundColor Green
} else {
    Write-Host "  ✗ Version table query NOT found!" -ForegroundColor Red
    exit 1
}

# Check for validation status check
if ($s2Content -match "last_validation_status.*valid") {
    Write-Host "  ✓ Checks draft validation status" -ForegroundColor Green
} else {
    Write-Host "  ✗ Validation status check NOT found!" -ForegroundColor Red
    exit 1
}

# 6. Verify timeline event logging
Write-Host "[6/8] Checking timeline event logging..." -ForegroundColor Yellow

if ($s2Content -match "logTimelineEvent") {
    Write-Host "  ✓ Timeline event logging found" -ForegroundColor Green
} else {
    Write-Host "  ✗ Timeline event logging NOT found!" -ForegroundColor Red
    exit 1
}

if ($s2Content -match "loop_step_s2_spec_ready") {
    Write-Host "  ✓ Custom event name 'loop_step_s2_spec_ready' found" -ForegroundColor Green
} else {
    Write-Host "  ! Custom event name not clearly visible" -ForegroundColor Yellow
}

# 7. Verify execute vs dryRun mode handling
Write-Host "[7/8] Checking execute/dryRun mode handling..." -ForegroundColor Yellow

if ($s2Content -match "ctx\.mode.*===.*'execute'") {
    Write-Host "  ✓ Mode check found for execute" -ForegroundColor Green
} else {
    Write-Host "  ✗ Execute mode check NOT found!" -ForegroundColor Red
    exit 1
}

if ($s2Content -match "UPDATE.*afu9_issues") {
    Write-Host "  ✓ Issue update query found" -ForegroundColor Green
} else {
    Write-Host "  ✗ Issue update query NOT found!" -ForegroundColor Red
    exit 1
}

# 8. Run unit tests
Write-Host "[8/8] Running unit tests..." -ForegroundColor Yellow
Push-Location control-center
try {
    $testOutput = npm test -- s2-spec-gate 2>&1
    if ($LASTEXITCODE -eq 0) {
        $passCount = ($testOutput | Select-String -Pattern "Tests:.*(\d+) passed" | ForEach-Object { $_.Matches.Groups[1].Value })
        Write-Host "  ✓ All tests passed ($passCount tests)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Tests FAILED!" -ForegroundColor Red
        Write-Host $testOutput
        exit 1
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "===== E9.1-CTRL-6 Verification Complete =====" -ForegroundColor Cyan
Write-Host "All checks passed! ✓" -ForegroundColor Green
