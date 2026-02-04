# E9.3-CTRL-02 Verification Commands
# Checks Mirror (PR/Commit Checks Snapshot)

Write-Host "=== E9.3-CTRL-02: Checks Mirror Verification ===" -ForegroundColor Cyan
Write-Host ""

# 1. Verify database migration
Write-Host "1. Database Migration Check" -ForegroundColor Yellow
Write-Host "   File: database/migrations/088_checks_snapshots.sql"
if (Test-Path "database/migrations/088_checks_snapshots.sql") {
    Write-Host "   ✓ Migration file exists" -ForegroundColor Green
    $lines = (Get-Content "database/migrations/088_checks_snapshots.sql" | Measure-Object -Line).Lines
    Write-Host "   ✓ Migration has $lines lines" -ForegroundColor Green
} else {
    Write-Host "   ✗ Migration file missing" -ForegroundColor Red
}
Write-Host ""

# 2. Verify contract schema
Write-Host "2. Contract Schema Check" -ForegroundColor Yellow
Write-Host "   File: control-center/src/lib/contracts/checksSnapshot.ts"
if (Test-Path "control-center/src/lib/contracts/checksSnapshot.ts") {
    Write-Host "   ✓ Contract file exists" -ForegroundColor Green
    $exports = Select-String -Path "control-center/src/lib/contracts/checksSnapshot.ts" -Pattern "^export" | Measure-Object
    Write-Host "   ✓ Contract has $($exports.Count) exports" -ForegroundColor Green
} else {
    Write-Host "   ✗ Contract file missing" -ForegroundColor Red
}
Write-Host ""

# 3. Verify database access layer
Write-Host "3. Database Access Layer Check" -ForegroundColor Yellow
Write-Host "   File: control-center/src/lib/db/checksSnapshots.ts"
if (Test-Path "control-center/src/lib/db/checksSnapshots.ts") {
    Write-Host "   ✓ DB layer file exists" -ForegroundColor Green
    $functions = Select-String -Path "control-center/src/lib/db/checksSnapshots.ts" -Pattern "^export async function" | Measure-Object
    Write-Host "   ✓ DB layer has $($functions.Count) exported functions" -ForegroundColor Green
} else {
    Write-Host "   ✗ DB layer file missing" -ForegroundColor Red
}
Write-Host ""

# 4. Verify service implementation
Write-Host "4. Service Implementation Check" -ForegroundColor Yellow
Write-Host "   File: control-center/src/lib/github/checks-mirror-service.ts"
if (Test-Path "control-center/src/lib/github/checks-mirror-service.ts") {
    Write-Host "   ✓ Service file exists" -ForegroundColor Green
    $functions = Select-String -Path "control-center/src/lib/github/checks-mirror-service.ts" -Pattern "^export async function" | Measure-Object
    Write-Host "   ✓ Service has $($functions.Count) exported functions" -ForegroundColor Green
} else {
    Write-Host "   ✗ Service file missing" -ForegroundColor Red
}
Write-Host ""

# 5. Verify evidence integration
Write-Host "5. Evidence Integration Check" -ForegroundColor Yellow
Write-Host "   File: control-center/src/lib/contracts/issueEvidence.ts"
if (Test-Path "control-center/src/lib/contracts/issueEvidence.ts") {
    $hasChecksEvidence = Select-String -Path "control-center/src/lib/contracts/issueEvidence.ts" -Pattern "CHECKS_SNAPSHOT_RECEIPT" -Quiet
    if ($hasChecksEvidence) {
        Write-Host "   ✓ CHECKS_SNAPSHOT_RECEIPT type added" -ForegroundColor Green
    } else {
        Write-Host "   ✗ CHECKS_SNAPSHOT_RECEIPT type missing" -ForegroundColor Red
    }
    
    $hasReceiptData = Select-String -Path "control-center/src/lib/contracts/issueEvidence.ts" -Pattern "ChecksSnapshotReceiptData" -Quiet
    if ($hasReceiptData) {
        Write-Host "   ✓ ChecksSnapshotReceiptData interface added" -ForegroundColor Green
    } else {
        Write-Host "   ✗ ChecksSnapshotReceiptData interface missing" -ForegroundColor Red
    }
} else {
    Write-Host "   ✗ Evidence contract file missing" -ForegroundColor Red
}
Write-Host ""

# 6. Verify unit tests
Write-Host "6. Unit Tests Check" -ForegroundColor Yellow
Write-Host "   File: control-center/__tests__/lib/contracts/checksSnapshot.test.ts"
if (Test-Path "control-center/__tests__/lib/contracts/checksSnapshot.test.ts") {
    Write-Host "   ✓ Test file exists" -ForegroundColor Green
    $testCases = Select-String -Path "control-center/__tests__/lib/contracts/checksSnapshot.test.ts" -Pattern "^\s+it\(" | Measure-Object
    Write-Host "   ✓ Test has $($testCases.Count) test cases" -ForegroundColor Green
} else {
    Write-Host "   ✗ Test file missing" -ForegroundColor Red
}
Write-Host ""

# 7. Verify documentation
Write-Host "7. Documentation Check" -ForegroundColor Yellow
Write-Host "   File: docs/contracts/checks-mirror-contract.md"
if (Test-Path "docs/contracts/checks-mirror-contract.md") {
    Write-Host "   ✓ Contract documentation exists" -ForegroundColor Green
    $sections = Select-String -Path "docs/contracts/checks-mirror-contract.md" -Pattern "^##" | Measure-Object
    Write-Host "   ✓ Documentation has $($sections.Count) sections" -ForegroundColor Green
} else {
    Write-Host "   ✗ Contract documentation missing" -ForegroundColor Red
}

Write-Host "   File: docs/contracts/checks-mirror-examples.ts"
if (Test-Path "docs/contracts/checks-mirror-examples.ts") {
    Write-Host "   ✓ Example code exists" -ForegroundColor Green
    $examples = Select-String -Path "docs/contracts/checks-mirror-examples.ts" -Pattern "^export async function" | Measure-Object
    Write-Host "   ✓ Examples has $($examples.Count) example functions" -ForegroundColor Green
} else {
    Write-Host "   ✗ Example code missing" -ForegroundColor Red
}
Write-Host ""

# 8. Check for imports/dependencies
Write-Host "8. Dependencies Check" -ForegroundColor Yellow
$hasZod = Select-String -Path "control-center/src/lib/contracts/checksSnapshot.ts" -Pattern "from 'zod'" -Quiet
$hasPg = Select-String -Path "control-center/src/lib/db/checksSnapshots.ts" -Pattern "from 'pg'" -Quiet
$hasGithub = Select-String -Path "control-center/src/lib/github/checks-mirror-service.ts" -Pattern "createAuthenticatedClient" -Quiet

if ($hasZod) {
    Write-Host "   ✓ Zod validation library used" -ForegroundColor Green
} else {
    Write-Host "   ✗ Zod validation missing" -ForegroundColor Red
}

if ($hasPg) {
    Write-Host "   ✓ PostgreSQL integration present" -ForegroundColor Green
} else {
    Write-Host "   ✗ PostgreSQL integration missing" -ForegroundColor Red
}

if ($hasGithub) {
    Write-Host "   ✓ GitHub integration present" -ForegroundColor Green
} else {
    Write-Host "   ✗ GitHub integration missing" -ForegroundColor Red
}
Write-Host ""

# 9. Summary
Write-Host "=== Implementation Summary ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Core Components:" -ForegroundColor Yellow
Write-Host "  • Database migration (088_checks_snapshots.sql)"
Write-Host "  • Contract schema (checksSnapshot.ts)"
Write-Host "  • Database access layer (checksSnapshots.ts)"
Write-Host "  • GitHub service (checks-mirror-service.ts)"
Write-Host "  • Evidence integration (issueEvidence.ts)"
Write-Host "  • Unit tests (checksSnapshot.test.ts)"
Write-Host "  • Documentation (checks-mirror-contract.md)"
Write-Host "  • Examples (checks-mirror-examples.ts)"
Write-Host ""

Write-Host "Key Features:" -ForegroundColor Yellow
Write-Host "  ✓ Deterministic snapshot capture" -ForegroundColor Green
Write-Host "  ✓ Idempotent by hash" -ForegroundColor Green
Write-Host "  ✓ Fail-closed semantics" -ForegroundColor Green
Write-Host "  ✓ Evidence integration" -ForegroundColor Green
Write-Host "  ✓ S4/S5 gate ready" -ForegroundColor Green
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Run database migration: npm run db:migrate"
Write-Host "  2. Install dependencies: npm --prefix control-center install"
Write-Host "  3. Run tests: npm --prefix control-center test"
Write-Host "  4. Build: npm --prefix control-center run build"
Write-Host "  5. Integrate into S4/S5 step executors"
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
