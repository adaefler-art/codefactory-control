# E78.1: KPI Store + Compute - Verification Commands

## PowerShell Commands for Testing and Verification

### 1. Database Migration

```powershell
# Apply migration 042
psql -h localhost -U postgres -d afu9 -f database/migrations/042_kpi_measurements_and_aggregates.sql

# Verify tables created
psql -h localhost -U postgres -d afu9 -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'kpi_%' ORDER BY table_name;"

# Expected output:
# table_name
# ----------------------
# kpi_aggregates
# kpi_measurements
```

### 2. Test Suite

```powershell
# Run only E78.1 KPI tests
npm --prefix control-center test -- kpi-measurements-aggregates.test.ts

# Expected: 11 tests passing
# ✓ calculateMTTRForWindow (3 tests)
# ✓ calculateIncidentRateForWindow (2 tests)
# ✓ calculateAutoFixRateForWindow (2 tests)
# ✓ computeKpisForWindow (2 tests)
# ✓ createKpiMeasurement (1 test)
# ✓ getKpiAggregates (1 test)

# Run all tests
npm --prefix control-center test

# Expected: 138 test suites passing (8 pre-existing failures in packages)
```

### 3. Build Verification

```powershell
# Build control center
npm --prefix control-center run build

# Note: Build may fail on pre-existing package dependencies
# Our TypeScript code is valid - failures are in:
# - @codefactory/deploy-memory (missing crypto, AWS SDK deps)
# - @codefactory/verdict-engine (depends on deploy-memory)

# Type check our files only
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/types/kpi.ts
# Should complete without errors in kpi.ts
```

### 4. Database Function Verification

```powershell
# Test MTTR calculation with synthetic data
# (Replace dates with actual incident data range)
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  mttr_hours,
  incident_count
FROM calculate_mttr_for_window(
  '2024-01-01'::timestamptz, 
  '2024-01-02'::timestamptz
);
"@

# Test Incident Rate calculation
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  incidents_per_day,
  total_incidents,
  window_days
FROM calculate_incident_rate_for_window(
  '2024-01-01'::timestamptz, 
  '2024-01-02'::timestamptz
);
"@

# Test Auto-fix Rate calculation
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  autofix_rate_pct,
  autofix_count,
  total_runs
FROM calculate_autofix_rate_for_window(
  '2024-01-01'::timestamptz, 
  '2024-01-02'::timestamptz
);
"@

# Test D2D calculation (requires valid issue ID with timeline data)
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  d2d_hours,
  decision_at,
  deploy_at
FROM calculate_d2d_hours('00000000-0000-0000-0000-000000000000'::uuid);
"@
# Will return empty if no matching data, not an error
```

### 5. API Testing (requires running server)

```powershell
# Start development server
npm --prefix control-center run dev
# Server starts on http://localhost:3000

# In another PowerShell window:

# Test GET /api/kpis
$response = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/kpis?window=daily&limit=10" `
  -Method Get

Write-Host "KPI Aggregates Retrieved: $($response.count)"
$response.aggregates | Format-Table -Property kpiName, window, valueNum, unit

# Test POST /api/kpis/recompute
$recomputeBody = @{
  window = "daily"
  windowStart = "2024-01-01T00:00:00Z"
  windowEnd = "2024-01-02T00:00:00Z"
  kpiNames = @("incident_rate", "mttr", "autofix_rate")
  forceRecompute = $false
} | ConvertTo-Json

$recomputeResponse = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/kpis/recompute" `
  -Method Post `
  -Body $recomputeBody `
  -ContentType "application/json"

Write-Host "Computed $($recomputeResponse.aggregates.Count) aggregates"
Write-Host "Compute Version: $($recomputeResponse.computeVersion)"
Write-Host "Inputs Hash: $($recomputeResponse.inputsHash)"
```

### 6. Data Integrity Verification

```powershell
# Verify kpi_measurements table structure
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'kpi_measurements'
ORDER BY ordinal_position;
"@

# Verify kpi_aggregates table structure
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'kpi_aggregates'
ORDER BY ordinal_position;
"@

# Check indexes on kpi_measurements
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  indexname, 
  indexdef
FROM pg_indexes
WHERE tablename = 'kpi_measurements';
"@

# Check indexes on kpi_aggregates
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  indexname, 
  indexdef
FROM pg_indexes
WHERE tablename = 'kpi_aggregates';
"@
```

### 7. Deterministic Computation Verification

```powershell
# Test idempotent recompute
# Run recompute twice with same inputs

$testWindow = @{
  window = "daily"
  windowStart = "2024-01-01T00:00:00Z"
  windowEnd = "2024-01-02T00:00:00Z"
  kpiNames = @("incident_rate")
  forceRecompute = $false
} | ConvertTo-Json

# First compute
$result1 = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/kpis/recompute" `
  -Method Post `
  -Body $testWindow `
  -ContentType "application/json"

# Second compute (should skip existing)
$result2 = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/kpis/recompute" `
  -Method Post `
  -Body $testWindow `
  -ContentType "application/json"

# Verify same inputsHash
if ($result1.inputsHash -eq $result2.inputsHash) {
  Write-Host "✅ Deterministic computation verified - same inputs_hash"
} else {
  Write-Host "❌ Different inputs_hash - non-deterministic!"
}

# Check database for duplicates (should be none due to unique constraint)
psql -h localhost -U postgres -d afu9 -c @"
SELECT 
  kpi_name, 
  window, 
  window_start, 
  inputs_hash,
  COUNT(*) as duplicate_count
FROM kpi_aggregates
GROUP BY kpi_name, window, window_start, inputs_hash
HAVING COUNT(*) > 1;
"@
# Should return 0 rows (no duplicates)
```

### 8. Sample Data Population (for testing)

```powershell
# Create sample incidents for testing
psql -h localhost -U postgres -d afu9 -c @"
INSERT INTO incidents (
  incident_key, severity, status, title, summary, 
  source_primary, created_at, first_seen_at, last_seen_at
) VALUES 
  ('test:inc:1', 'YELLOW', 'OPEN', 'Test Incident 1', 'Test', 
   '{"kind": "test"}', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
  ('test:inc:2', 'RED', 'CLOSED', 'Test Incident 2', 'Test', 
   '{"kind": "test"}', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day')
ON CONFLICT (incident_key) DO NOTHING;

-- Create CLOSED events
INSERT INTO incident_events (incident_id, event_type, payload, created_at)
SELECT id, 'CLOSED', '{}'::jsonb, NOW() - INTERVAL '1 day'
FROM incidents 
WHERE incident_key = 'test:inc:2'
ON CONFLICT DO NOTHING;
"@

# Create sample remediation runs
psql -h localhost -U postgres -d afu9 -c @"
INSERT INTO remediation_runs (
  run_key, incident_id, playbook_id, playbook_version, 
  status, lawbook_version, inputs_hash, created_at
)
SELECT 
  'test:run:' || i.id::text, 
  i.id, 
  'test-playbook', 
  '1.0.0', 
  'SUCCEEDED', 
  'v1.0.0', 
  'testhash', 
  NOW() - INTERVAL '1 day'
FROM incidents i 
WHERE i.incident_key LIKE 'test:inc:%'
ON CONFLICT (run_key) DO NOTHING;
"@

# Verify sample data
psql -h localhost -U postgres -d afu9 -c "SELECT COUNT(*) FROM incidents WHERE incident_key LIKE 'test:inc:%';"
psql -h localhost -U postgres -d afu9 -c "SELECT COUNT(*) FROM remediation_runs WHERE run_key LIKE 'test:run:%';"
```

### 9. Cleanup Test Data

```powershell
# Remove sample test data
psql -h localhost -U postgres -d afu9 -c @"
DELETE FROM incidents WHERE incident_key LIKE 'test:inc:%';
DELETE FROM remediation_runs WHERE run_key LIKE 'test:run:%';
"@
```

### 10. Full Verification Workflow

```powershell
# Complete verification workflow

Write-Host "=== E78.1 KPI Store + Compute Verification ===" -ForegroundColor Cyan

Write-Host "`n1. Running tests..." -ForegroundColor Yellow
npm --prefix control-center test -- kpi-measurements-aggregates.test.ts

Write-Host "`n2. Checking database schema..." -ForegroundColor Yellow
psql -h localhost -U postgres -d afu9 -c "\dt kpi_*"

Write-Host "`n3. Testing SQL functions..." -ForegroundColor Yellow
psql -h localhost -U postgres -d afu9 -c "SELECT * FROM calculate_incident_rate_for_window(NOW() - INTERVAL '1 day', NOW());"

Write-Host "`n4. Checking API endpoints (requires server running)..." -ForegroundColor Yellow
try {
  $apiTest = Invoke-RestMethod -Uri "http://localhost:3000/api/kpis?limit=1" -Method Get
  Write-Host "✅ API responding: $($apiTest.count) aggregates found"
} catch {
  Write-Host "⚠️  API not responding (server may not be running)"
}

Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
```

## Expected Results Summary

| Verification Step | Expected Result |
|-------------------|----------------|
| Migration | Tables `kpi_measurements` and `kpi_aggregates` created |
| Tests | 11/11 tests passing |
| Build | TypeScript compilation succeeds for our files |
| SQL Functions | Functions execute without errors |
| API GET | Returns aggregates with proper structure |
| API POST | Creates aggregates idempotently |
| Determinism | Same inputs → same inputs_hash |
| Uniqueness | No duplicate aggregates (unique constraint enforced) |

## Troubleshooting

### Tests fail with "jest: not found"
```powershell
cd control-center
npm install
npm test
```

### Build fails on packages
This is expected due to pre-existing dependency issues in `@codefactory/deploy-memory` and `@codefactory/verdict-engine`. Our E78.1 code is valid.

### API returns 500 errors
Check database connection and ensure migration 042 has been applied.

### SQL functions return empty results
Ensure there is data in the source tables (`incidents`, `incident_events`, `remediation_runs`) for the time window being queried.
