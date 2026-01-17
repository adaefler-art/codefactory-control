# I904 Verification Commands

## Overview
Commands to verify the I904 Activity Log implementation is working correctly.

## Prerequisites
```bash
# Ensure you're in the repository root
cd /path/to/codefactory-control

# Install dependencies (if not already done)
npm --prefix control-center install
```

## 1. Run Unit/Integration Tests

```bash
# Run all activity log tests
npm --prefix control-center test -- __tests__/api/admin-activity-log.test.ts

# Expected output:
# PASS __tests__/api/admin-activity-log.test.ts
#   GET /api/admin/activity
#     ✓ returns 401 when not authenticated
#     ✓ allows access with valid admin user
#     ✓ allows access with valid smoke key
#     ✓ filters by sessionId
#     ✓ filters by issueId
#     ✓ filters by event type
#     ✓ supports pagination with cursor
#     ✓ validates response schema
#     ✓ enforces limit bounds (max 200)
#     ✓ handles date range filters
#     ✓ returns 500 on database error
#     ✓ sets proper cache headers
# 
# Test Suites: 1 passed, 1 total
# Tests:       12 passed, 12 total
```

## 2. Type Check (TypeScript)

```bash
# Check for TypeScript errors in new files
cd control-center

# Note: May show Next.js config errors (unrelated to our changes)
# Focus on errors in:
# - app/api/admin/activity/route.ts
# - app/admin/activity/page.tsx
npx tsc --noEmit --skipLibCheck
```

## 3. Build Verification

```bash
# Build control-center (note: may fail on workspace deps, not related to I904)
npm --prefix control-center run build

# If build fails on workspace deps, verify our files have no syntax errors:
npm --prefix control-center run lint -- app/api/admin/activity/route.ts
npm --prefix control-center run lint -- app/admin/activity/page.tsx
```

## 4. Repository Verification

```bash
# Run repo verification script
npx ts-node scripts/repo-verify.ts

# Expected: 
# ✅ Route-Map Check PASSED
# ✅ Forbidden Paths Check PASSED
# ✅ Tracked Artifacts Check PASSED
# ✅ Large File Check PASSED
# ✅ Secret Files Check PASSED
# ... etc
```

## 5. Staging Smoke Test (PowerShell)

**Prerequisites:**
- Staging environment deployed
- AFU9_SMOKE_KEY environment variable set

```powershell
# Windows PowerShell or PowerShell Core
$env:AFU9_SMOKE_KEY = "your-smoke-key-here"

./scripts/verify-i904.ps1 `
  -BaseUrl "https://stage.afu-9.com" `
  -SmokeKey $env:AFU9_SMOKE_KEY

# Expected output:
# =====================================
# I904 Activity Log API Verification
# =====================================
# 
# Test 1: Basic GET request (limit=10)
# ✓ Response OK: True
# ✓ Schema Version: 1.0.0
# ✓ Events Count: 10
# ✓ Total Events: 200
# ✓ Has More: True
# 
# Test 2: Pagination test (limit=50, cursor=0)
# ✓ Retrieved 50 events
# ✓ Response time: 0.87s
# ✓ Performance: < 2s requirement met
# ...
# 
# =====================================
# Verification Complete ✓
# =====================================
```

## 6. Manual UI Testing

**Prerequisites:**
- Control-center running locally or on staging
- Admin user credentials

```bash
# Start local dev server
npm --prefix control-center run dev

# Open browser to:
# http://localhost:3000/admin/activity
```

**Test Checklist:**
- [ ] Page loads without errors
- [ ] Event list displays with events
- [ ] Filters work:
  - [ ] Session ID filter
  - [ ] Issue ID filter
  - [ ] Event type dropdown
  - [ ] Date range filters
  - [ ] Clear all filters
- [ ] Filter chips appear/disappear
- [ ] Pagination works:
  - [ ] Next button loads next page
  - [ ] Previous button works
  - [ ] Pagination counter updates
- [ ] Detail drawer:
  - [ ] Opens when clicking "Details"
  - [ ] Shows all event fields
  - [ ] Links are clickable
  - [ ] JSON details formatted correctly
  - [ ] Closes when clicking X or outside
- [ ] Responsive design:
  - [ ] Desktop view (1920x1080)
  - [ ] Mobile view (375x812)

## 7. API Manual Testing (curl)

**Prerequisites:**
- Staging or local environment running
- Valid smoke key or admin session

```bash
# Set variables
BASE_URL="https://stage.afu-9.com"
SMOKE_KEY="your-smoke-key-here"

# Test 1: Basic GET (no filters)
curl -X GET "$BASE_URL/api/admin/activity?limit=10" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.'

# Expected: JSON response with ok: true, events array, pagination object

# Test 2: Filter by sessionId
curl -X GET "$BASE_URL/api/admin/activity?sessionId=abc123&limit=5" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.filters.sessionId'

# Expected: "abc123"

# Test 3: Filter by issue ID
curl -X GET "$BASE_URL/api/admin/activity?issueId=101&limit=5" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.filters.issueId'

# Expected: 101

# Test 4: Filter by event type
curl -X GET "$BASE_URL/api/admin/activity?types=approval_approved&limit=5" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.filters.types'

# Expected: ["approval_approved"]

# Test 5: Pagination
curl -X GET "$BASE_URL/api/admin/activity?cursor=50&limit=50" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.pagination.cursor'

# Expected: 50

# Test 6: Date range
START_DATE=$(date -u -d '7 days ago' +'%Y-%m-%dT%H:%M:%S.000Z')
END_DATE=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')

curl -X GET "$BASE_URL/api/admin/activity?startDate=$START_DATE&endDate=$END_DATE&limit=10" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.filters'

# Expected: startDate and endDate set

# Test 7: Unauthorized (no auth)
curl -X GET "$BASE_URL/api/admin/activity?limit=5" \
  | jq '.error'

# Expected: "Unauthorized"
# Status: 401

# Test 8: Performance check (200 events)
time curl -X GET "$BASE_URL/api/admin/activity?limit=200" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -o /dev/null -s -w '%{time_total}\n'

# Expected: < 2.0 seconds
```

## 8. Security Verification

```bash
# Run CodeQL scanner
# (This was already run, but can be re-run if needed)

# Check for common vulnerabilities:
# 1. SQL injection attempts
curl -X GET "$BASE_URL/api/admin/activity?sessionId='; DROP TABLE users; --&limit=5" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.events'
# Expected: No error, empty or filtered results (injection blocked)

# 2. XSS attempts
curl -X GET "$BASE_URL/api/admin/activity?sessionId=<script>alert('xss')</script>&limit=5" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.filters.sessionId'
# Expected: Escaped or sanitized (no script execution in UI)

# 3. Large limit (resource exhaustion)
curl -X GET "$BASE_URL/api/admin/activity?limit=99999" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.pagination.limit'
# Expected: 200 (capped at max)

# 4. Negative cursor
curl -X GET "$BASE_URL/api/admin/activity?cursor=-100&limit=10" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  | jq '.pagination.cursor'
# Expected: 0 (clamped to min)
```

## 9. Database Verification (PostgreSQL)

**Prerequisites:**
- Access to staging/local database

```sql
-- Connect to database
psql -h localhost -U postgres -d codefactory

-- Verify unified_timeline_events table exists
\dt unified_timeline_events

-- Check event count
SELECT COUNT(*) FROM unified_timeline_events;

-- Sample recent events
SELECT 
  id, 
  event_type, 
  actor, 
  session_id, 
  gh_issue_number, 
  summary,
  created_at
FROM unified_timeline_events
ORDER BY created_at DESC
LIMIT 10;

-- Verify indexes exist
\d unified_timeline_events

-- Expected indexes:
-- - idx_unified_timeline_events_session_id
-- - idx_unified_timeline_events_gh_issue
-- - idx_unified_timeline_events_event_type
-- - idx_unified_timeline_events_timestamp
```

## 10. Performance Profiling

```bash
# Install Apache Bench (if not already installed)
# sudo apt-get install apache2-utils

# Run load test (100 requests, 10 concurrent)
ab -n 100 -c 10 \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  "$BASE_URL/api/admin/activity?limit=50"

# Expected:
# - Time per request: < 2000ms (mean)
# - Failed requests: 0
# - Requests per second: > 5

# Alternatively, use curl with time measurement
for i in {1..10}; do
  time curl -X GET "$BASE_URL/api/admin/activity?limit=50" \
    -H "x-afu9-smoke-key: $SMOKE_KEY" \
    -o /dev/null -s
done

# Expected: Each request < 2s
```

## Success Criteria

All checks must pass:
- ✅ 12/12 integration tests passing
- ✅ No TypeScript errors in new files
- ✅ Staging smoke test: 6/6 tests passing
- ✅ UI loads and functions correctly
- ✅ API responds correctly to all test cases
- ✅ Security tests show no vulnerabilities
- ✅ Performance: < 2s for 200 events
- ✅ Database has data and indexes

## Troubleshooting

### Tests failing?
```bash
# Clear jest cache
npm --prefix control-center test -- --clearCache

# Reinstall dependencies
rm -rf control-center/node_modules
npm --prefix control-center install
```

### UI not loading?
```bash
# Check console for errors
# Verify you're logged in as admin
# Check network tab for 401/403 errors
```

### API returning errors?
```bash
# Check environment variables
echo $AFU9_ADMIN_SUBS
echo $AFU9_SMOKE_KEY

# Check database connection
# Verify migrations applied
```

### Performance issues?
```sql
-- Check database indexes
EXPLAIN ANALYZE 
SELECT * FROM unified_timeline_events 
ORDER BY timestamp DESC 
LIMIT 50;

-- Should use index scan, not seq scan
```

## Done!

If all verifications pass, the I904 implementation is ready for deployment! 🎉
