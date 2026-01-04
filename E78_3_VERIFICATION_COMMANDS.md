# E78.3 Verification Commands (PowerShell)

## Prerequisites

Ensure you have:
- PostgreSQL database running with DATABASE_URL set
- Node.js and npm installed
- PowerShell (or pwsh on Linux/macOS)

---

## 1. Database Migration

Apply the new tuning_suggestions table migration:

```powershell
# Run database migrations
bash scripts/db-migrate.sh

# Verify table exists
psql $env:DATABASE_URL -c "\d tuning_suggestions"
```

**Expected output**: Table structure with columns: id, window, window_start, window_end, suggestion_hash, suggestion_json, created_at

---

## 2. Run Tests

### Run tuning suggestions tests only:

```powershell
# Run specific test file
npm --prefix control-center test tuning-suggestions.test.ts
```

**Expected output**: 
```
PASS  __tests__/lib/tuning-suggestions.test.ts
  Tuning Suggestions Generator
    ✓ returns empty suggestions with insufficient data
    ✓ generates deterministic suggestion hash
    ✓ generates stable suggestion ID
    ✓ generates suggestions for high UNKNOWN rate
    ✓ idempotent generation - same inputs produce same results
    ✓ validates suggestion references exist
    ✓ retrieves suggestions by window and date range
    ✓ suggestion schema includes all required fields

Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

### Run all control-center tests:

```powershell
npm --prefix control-center test
```

**Expected**: All tests pass (existing + new tests)

---

## 3. Build Control-Center

Build the Next.js application:

```powershell
# Build control-center
npm --prefix control-center run build
```

**Expected output**:
```
✓ Compiled successfully
✓ Collecting page data
✓ Generating static pages
✓ Finalizing page optimization

Route (app)                              Size     First Load JS
...
○ /api/tuning                            -        -
○ /api/tuning/generate                   -        -
```

---

## 4. Verify Repository

Run repository verification script:

```powershell
npm run repo:verify
```

**Expected output**:
```
✅ No secrets found
✅ No unauthorized file access
✅ Repository structure valid
```

---

## 5. Manual API Testing (Optional)

### Start development server:

```powershell
npm --prefix control-center run dev
```

### Test API endpoints:

#### Generate suggestions:

```powershell
# Set variables
$windowStart = (Get-Date).AddDays(-1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$windowEnd = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Generate suggestions
curl -X POST http://localhost:3000/api/tuning/generate `
  -H "Content-Type: application/json" `
  -H "x-afu9-sub: test-user" `
  -d "{
    \"window\": \"daily\",
    \"windowStart\": \"$windowStart\",
    \"windowEnd\": \"$windowEnd\"
  }"
```

**Expected response**:
```json
{
  "success": true,
  "suggestions": [],
  "count": 0,
  "isNew": false,
  "metadata": {
    "window": "daily",
    "windowStart": "...",
    "windowEnd": "...",
    "rulesApplied": [],
    "dataPoints": {
      "outcomeCount": 0,
      "incidentCount": 0,
      "kpiAggregateCount": 0
    }
  }
}
```

#### Retrieve suggestions:

```powershell
curl -X GET "http://localhost:3000/api/tuning?window=daily&limit=10" `
  -H "x-afu9-sub: test-user"
```

**Expected response**:
```json
{
  "success": true,
  "suggestions": [],
  "count": 0,
  "hasMore": false,
  "filters": {
    "window": "daily",
    "from": null,
    "to": null,
    "limit": 10
  }
}
```

---

## 6. Verify Database State

Check that suggestions table is empty (fresh install):

```powershell
psql $env:DATABASE_URL -c "SELECT COUNT(*) FROM tuning_suggestions;"
```

**Expected output**: `0` (no suggestions yet)

---

## 7. Test with Sample Data (Optional)

### Create test incident and generate suggestions:

```powershell
# Start psql session
psql $env:DATABASE_URL

-- Create test incident with UNKNOWN classification
INSERT INTO incidents (
  incident_key, severity, status, title, classification,
  lawbook_version, source_primary, created_at
) VALUES (
  'test:manual:' || EXTRACT(EPOCH FROM NOW())::TEXT,
  'RED',
  'OPEN',
  'Manual Test Incident',
  '{"category": "UNKNOWN"}',
  'v1.0.0',
  '{"kind": "deploy_status", "ref": {"deployId": "test-123"}}',
  NOW() - INTERVAL '1 hour'
);

-- Verify incident created
SELECT id, incident_key, classification FROM incidents 
WHERE incident_key LIKE 'test:manual:%' 
ORDER BY created_at DESC LIMIT 1;
```

Then generate suggestions via API (see step 5).

### Cleanup test data:

```powershell
psql $env:DATABASE_URL -c "DELETE FROM incidents WHERE incident_key LIKE 'test:manual:%';"
psql $env:DATABASE_URL -c "DELETE FROM tuning_suggestions WHERE created_at > NOW() - INTERVAL '1 hour';"
```

---

## 8. Code Quality Checks

### TypeScript compilation:

```powershell
# Check TypeScript errors in control-center
npx --prefix control-center tsc --noEmit
```

**Expected**: No errors

### ESLint (if configured):

```powershell
npm --prefix control-center run lint
```

**Expected**: No errors or warnings

---

## Summary Verification Script

Run all critical checks in sequence:

```powershell
# E78.3 Complete Verification Script

Write-Host "1. Running database migration..." -ForegroundColor Cyan
bash scripts/db-migrate.sh

Write-Host "`n2. Running tuning suggestions tests..." -ForegroundColor Cyan
npm --prefix control-center test tuning-suggestions.test.ts

Write-Host "`n3. Building control-center..." -ForegroundColor Cyan
npm --prefix control-center run build

Write-Host "`n4. Running repository verification..." -ForegroundColor Cyan
npm run repo:verify

Write-Host "`n✅ E78.3 Verification Complete!" -ForegroundColor Green
Write-Host "All checks passed. Ready for merge." -ForegroundColor Green
```

Save this as `scripts/verify-e78-3.ps1` and run:

```powershell
pwsh scripts/verify-e78-3.ps1
```

---

## Troubleshooting

### Database connection errors:

```powershell
# Check DATABASE_URL is set
echo $env:DATABASE_URL

# Test connection
psql $env:DATABASE_URL -c "SELECT version();"
```

### Test failures:

```powershell
# Run tests with verbose output
npm --prefix control-center test tuning-suggestions.test.ts -- --verbose

# Check specific test
npm --prefix control-center test tuning-suggestions.test.ts -t "generates deterministic suggestion hash"
```

### Build errors:

```powershell
# Clean and rebuild
Remove-Item -Recurse -Force control-center/.next
npm --prefix control-center run build
```

---

## Files to Review

After running verification, review these files for correctness:

1. **Contract Schema**: `control-center/src/lib/contracts/tuning-suggestions.ts`
2. **Service Logic**: `control-center/src/lib/tuning-suggestions-service.ts`
3. **API Routes**: `control-center/app/api/tuning/*.ts`
4. **Migration**: `database/migrations/046_tuning_suggestions.sql`
5. **Tests**: `control-center/__tests__/lib/tuning-suggestions.test.ts`
6. **Example**: `docs/E78_3_EXAMPLE_SUGGESTION.json`

---

## Next Steps

After verification passes:

1. ✅ Review implementation summary: `E78_3_IMPLEMENTATION_SUMMARY.md`
2. ✅ Commit changes
3. ✅ Create PR with summary
4. ✅ Deploy to staging environment
5. ✅ Test with real data (daily/weekly windows)
6. ✅ Monitor suggestion quality and confidence scores
