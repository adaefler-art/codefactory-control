# E76.1 Verification Commands

## Test Commands

### Run Incident Schema Tests
```powershell
# Navigate to control-center
cd control-center

# Run incident tests only
npm test -- __tests__/lib/db/incidents.test.ts

# Run all tests
npm test
```

### TypeScript Compilation Check
```powershell
# Type-check incident files
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/contracts/incident.ts src/lib/db/incidents.ts
```

## Build Commands

### Build Control Center
```powershell
# Note: There are pre-existing workspace dependency issues
# Our incident schema files compile successfully
npm --prefix control-center run build
```

## Database Migration

### Apply Migration
```powershell
# Run all pending migrations (including 037_incidents_schema.sql)
npm --prefix control-center run db:migrate
```

### Verify Migration
```powershell
# Connect to database and verify tables exist
psql $DATABASE_URL -c "\dt incidents*"
```

## Repository Verification

### Verify File Structure
```powershell
# Check migration file
ls database/migrations/037_incidents_schema.sql

# Check contracts
ls control-center/src/lib/contracts/incident.ts

# Check DAO
ls control-center/src/lib/db/incidents.ts

# Check tests
ls control-center/__tests__/lib/db/incidents.test.ts

# Check documentation
ls E76_1_IMPLEMENTATION_SUMMARY.md
```

## Test Results

Expected output:
```
PASS  __tests__/lib/db/incidents.test.ts
  IncidentDAO
    upsertIncidentByKey
      ✓ creates new incident on first insert
      ✓ updates existing incident on conflict (idempotent)
    addEvidence
      ✓ adds new evidence
      ✓ deduplicates evidence with same sha256 (idempotent)
      ✓ allows multiple evidence entries with null sha256
    listIncidents
      ✓ returns incidents in deterministic order (last_seen_at DESC, id ASC)
      ✓ filters by status
      ✓ filters by severity
    incident_key helpers
      ✓ generateDeployStatusIncidentKey
      ✓ generateVerificationIncidentKey
      ✓ generateEcsStoppedIncidentKey
      ✓ generateRunnerIncidentKey
    createLink
      ✓ creates new link
      ✓ returns existing link on conflict (idempotent)
    createEvent
      ✓ creates incident event
    getEvents
      ✓ returns events in deterministic order (created_at DESC, id DESC)

Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

## Quick Verification Script

```powershell
# Run all verification steps
Write-Host "=== E76.1 Verification ===" -ForegroundColor Green

Write-Host "`n1. Running tests..." -ForegroundColor Cyan
npm --prefix control-center test -- __tests__/lib/db/incidents.test.ts

Write-Host "`n2. Type-checking..." -ForegroundColor Cyan
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/contracts/incident.ts src/lib/db/incidents.ts
cd ..

Write-Host "`n3. Checking files..." -ForegroundColor Cyan
$files = @(
    "database/migrations/037_incidents_schema.sql",
    "control-center/src/lib/contracts/incident.ts",
    "control-center/src/lib/db/incidents.ts",
    "control-center/__tests__/lib/db/incidents.test.ts",
    "E76_1_IMPLEMENTATION_SUMMARY.md"
)

foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "✓ $file" -ForegroundColor Green
    } else {
        Write-Host "✗ $file MISSING" -ForegroundColor Red
    }
}

Write-Host "`n=== Verification Complete ===" -ForegroundColor Green
```

## Summary

All acceptance criteria met:
- ✅ Schema supports ingest from E65.1/E65.2/ECS/Runner
- ✅ Idempotency proven by tests
- ✅ Deterministic ordering implemented and tested
- ✅ Tests pass (16/16)
- ✅ TypeScript compilation successful
