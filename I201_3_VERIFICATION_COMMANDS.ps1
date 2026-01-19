# I201.3 Verification Commands

## Prerequisites

1. Database migration 081 must be applied
2. Control-center must be deployed with new code
3. At least one test issue must exist with timeline events

## Deployment Checklist

### 1. Run Database Migration

```powershell
# Connect to database (staging)
$dbHost = "your-db-host"
$dbName = "codefactory"

# Run migration
psql -h $dbHost -d $dbName -f database/migrations/081_add_timeline_event_types_i201_3.sql

# Verify constraint was updated
psql -h $dbHost -d $dbName -c "
  SELECT constraint_name, check_clause 
  FROM information_schema.check_constraints 
  WHERE table_name = 'issue_timeline' 
  AND constraint_name = 'chk_issue_timeline_event_type';
"
# Expected: Should include RUN_STARTED, VERDICT_SET, STATE_CHANGED, EVIDENCE_LINKED
```

### 2. Verify API Deployment

```powershell
$base = "https://stage.afu-9.com"

# Check API is accessible
$health = curl.exe -s "$base/api/health" | ConvertFrom-Json
Write-Host "Health check: $($health.status)"

# Test Timeline API with invalid issueId (should return 400)
$response = curl.exe -s -w "%{http_code}" "$base/api/afu9/timeline"
Write-Host "Expected 400, Got: $response"
```

## Functional Tests

### Test 1: Get Timeline by UUID

```powershell
$base = "https://stage.afu-9.com"

# Replace with actual UUID from your staging DB
$issueId = "your-test-issue-uuid"

$timeline = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId" | ConvertFrom-Json

# Verify response structure
Write-Host "Total events: $($timeline.total)"
Write-Host "Events returned: $($timeline.events.Count)"
Write-Host "Issue ID: $($timeline.issueId)"

# Display events
$timeline.events | Format-Table eventType, actor, createdAt
```

**Expected Output**:
```
Total events: 5
Events returned: 5
Issue ID: abc123...

eventType         actor   createdAt
---------         -----   ---------
ISSUE_CREATED     system  2026-01-19T...
STATE_CHANGED     system  2026-01-19T...
RUN_STARTED       system  2026-01-19T...
VERDICT_SET       system  2026-01-19T...
EVIDENCE_LINKED   system  2026-01-19T...
```

### Test 2: Get Timeline by PublicId (8-hex)

```powershell
$base = "https://stage.afu-9.com"

# Get publicId from issue UUID (first 8 characters)
$uuid = "abc12345-6789-..."
$publicId = $uuid.Substring(0, 8)

$timeline = curl.exe -s "$base/api/afu9/timeline?issueId=$publicId" | ConvertFrom-Json

# Should return same timeline as UUID
Write-Host "Total events: $($timeline.total)"
Write-Host "Resolved to UUID: $($timeline.issueId)"
```

**Expected**: Same results as Test 1, with `issueId` showing full UUID

### Test 3: Verify Stable Sort Order (Ascending)

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

$timeline = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId" | ConvertFrom-Json

# Check that events are in ascending chronological order
$timestamps = $timeline.events | ForEach-Object { [DateTime]$_.createdAt }

$isSorted = $true
for ($i = 1; $i -lt $timestamps.Count; $i++) {
    if ($timestamps[$i] -lt $timestamps[$i-1]) {
        $isSorted = $false
        Write-Host "ERROR: Sort order violated at index $i"
    }
}

if ($isSorted) {
    Write-Host "✅ Timeline is in stable ascending order"
} else {
    Write-Host "❌ Timeline sort order is incorrect"
}
```

**Expected**: `✅ Timeline is in stable ascending order`

### Test 4: ISSUE_CREATED Uniqueness (I201.2)

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

# Filter by ISSUE_CREATED event type
$created = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId&eventType=ISSUE_CREATED" | ConvertFrom-Json

Write-Host "ISSUE_CREATED events count: $($created.total)"
Write-Host "Expected: 1"

if ($created.total -eq 1) {
    Write-Host "✅ Exactly one ISSUE_CREATED event"
} else {
    Write-Host "❌ ISSUE_CREATED count is incorrect: $($created.total)"
}
```

**Expected**: `✅ Exactly one ISSUE_CREATED event`

### Test 5: Filter by Event Type

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

# Test each event type
$eventTypes = @('RUN_STARTED', 'VERDICT_SET', 'STATE_CHANGED', 'EVIDENCE_LINKED')

foreach ($eventType in $eventTypes) {
    $filtered = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId&eventType=$eventType" | ConvertFrom-Json
    
    Write-Host "$eventType events: $($filtered.total)"
    
    # Verify all returned events match the filter
    $allMatch = $filtered.events | ForEach-Object { $_.eventType -eq $eventType } | Where-Object { $_ -eq $false }
    
    if ($allMatch.Count -eq 0) {
        Write-Host "✅ $eventType filter working correctly"
    } else {
        Write-Host "❌ $eventType filter returned wrong events"
    }
}
```

**Expected**: All filters working correctly

### Test 6: Pagination

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

# Get first page
$page1 = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId&limit=2&offset=0" | ConvertFrom-Json
Write-Host "Page 1: $($page1.events.Count) events (limit=$($page1.limit), offset=$($page1.offset))"

# Get second page
$page2 = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId&limit=2&offset=2" | ConvertFrom-Json
Write-Host "Page 2: $($page2.events.Count) events (limit=$($page2.limit), offset=$($page2.offset))"

# Verify different events on each page
if ($page1.events[0].id -ne $page2.events[0].id) {
    Write-Host "✅ Pagination working correctly"
} else {
    Write-Host "❌ Pagination returned same events"
}

# Verify total is consistent
Write-Host "Total from page 1: $($page1.total)"
Write-Host "Total from page 2: $($page2.total)"
if ($page1.total -eq $page2.total) {
    Write-Host "✅ Total count is consistent"
} else {
    Write-Host "❌ Total count is inconsistent"
}
```

**Expected**: Different events on each page, consistent total

### Test 7: Max Limit Enforcement

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

# Request more than max limit (500)
$result = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId&limit=1000" | ConvertFrom-Json

Write-Host "Requested limit: 1000"
Write-Host "Actual limit: $($result.limit)"

if ($result.limit -eq 500) {
    Write-Host "✅ Max limit enforced (500)"
} else {
    Write-Host "❌ Max limit not enforced"
}
```

**Expected**: `✅ Max limit enforced (500)`

### Test 8: Invalid Parameters

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

# Test invalid eventType
$response = curl.exe -s -w "%{http_code}" -o $null "$base/api/afu9/timeline?issueId=$issueId&eventType=INVALID_TYPE"
Write-Host "Invalid eventType response: $response (expected 400)"

# Test invalid limit (negative)
$response = curl.exe -s -w "%{http_code}" -o $null "$base/api/afu9/timeline?issueId=$issueId&limit=-1"
Write-Host "Invalid limit response: $response (expected 400)"

# Test invalid offset (negative)
$response = curl.exe -s -w "%{http_code}" -o $null "$base/api/afu9/timeline?issueId=$issueId&offset=-1"
Write-Host "Invalid offset response: $response (expected 400)"

# Test missing issueId
$response = curl.exe -s -w "%{http_code}" -o $null "$base/api/afu9/timeline"
Write-Host "Missing issueId response: $response (expected 400)"

# Test non-existent issue
$response = curl.exe -s -w "%{http_code}" -o $null "$base/api/afu9/timeline?issueId=00000000-0000-0000-0000-000000000000"
Write-Host "Non-existent issue response: $response (expected 404)"
```

**Expected**: All validation errors return appropriate status codes

## Performance Tests

### Test 9: Response Time

```powershell
$base = "https://stage.afu-9.com"
$issueId = "your-test-issue-uuid"

$iterations = 10
$times = @()

for ($i = 0; $i -lt $iterations; $i++) {
    $start = Get-Date
    $result = curl.exe -s "$base/api/afu9/timeline?issueId=$issueId" | ConvertFrom-Json
    $end = Get-Date
    $duration = ($end - $start).TotalMilliseconds
    $times += $duration
    Write-Host "Request $($i+1): $duration ms"
}

$avg = ($times | Measure-Object -Average).Average
$max = ($times | Measure-Object -Maximum).Maximum
$min = ($times | Measure-Object -Minimum).Minimum

Write-Host ""
Write-Host "Average: $avg ms"
Write-Host "Max: $max ms"
Write-Host "Min: $min ms"

if ($avg -lt 200) {
    Write-Host "✅ Performance acceptable (avg < 200ms)"
} else {
    Write-Host "⚠️ Performance may need optimization"
}
```

**Expected**: Average response time < 200ms

## Integration Tests

### Test 10: End-to-End Flow

```powershell
$base = "https://stage.afu-9.com"

# 1. Create a test issue (via I201.2 endpoint)
# ... (implementation depends on your test data setup)

# 2. Get initial timeline
$timeline1 = curl.exe -s "$base/api/afu9/timeline?issueId=$newIssueId" | ConvertFrom-Json
Write-Host "Initial events: $($timeline1.total)"

# 3. Verify ISSUE_CREATED exists
$hasCreated = $timeline1.events | Where-Object { $_.eventType -eq 'ISSUE_CREATED' }
if ($hasCreated) {
    Write-Host "✅ ISSUE_CREATED event exists"
} else {
    Write-Host "❌ ISSUE_CREATED event missing"
}

# 4. Log additional events (via database or future API)
# ... (implementation TBD)

# 5. Verify new events appear in timeline
$timeline2 = curl.exe -s "$base/api/afu9/timeline?issueId=$newIssueId" | ConvertFrom-Json
Write-Host "Final events: $($timeline2.total)"

if ($timeline2.total -gt $timeline1.total) {
    Write-Host "✅ New events successfully logged"
} else {
    Write-Host "⚠️ No new events detected"
}
```

## Acceptance Criteria Checklist

Run all tests above, then verify:

- [ ] ✅ GET /api/afu9/timeline?issueId=... returns 200
- [ ] ✅ Events returned in stable ascending order (created_at ASC)
- [ ] ✅ Exactly one ISSUE_CREATED event per issue
- [ ] ✅ Event type filtering works for all minimal types
- [ ] ✅ Pagination works with limit and offset
- [ ] ✅ Max limit (500) is enforced
- [ ] ✅ UUID and 8-hex publicId lookups both work
- [ ] ✅ Invalid parameters return 400
- [ ] ✅ Non-existent issues return 404
- [ ] ✅ Response time < 200ms average

## Troubleshooting

### Issue: 404 on /api/afu9/timeline

**Check**: Ensure API route is deployed
```powershell
curl.exe -s "$base/api/afu9/timeline?issueId=test" 
# Should return error message, not 404 (proves route exists)
```

### Issue: Events not in ascending order

**Check**: Verify database query
```sql
SELECT created_at FROM issue_timeline 
WHERE issue_id = 'your-uuid' 
ORDER BY created_at ASC;
```

### Issue: ISSUE_CREATED count != 1

**Check**: Database for duplicate events
```sql
SELECT COUNT(*) FROM issue_timeline 
WHERE issue_id = 'your-uuid' 
AND event_type = 'ISSUE_CREATED';
```

### Issue: New event types not accepted

**Check**: Migration 081 was applied
```sql
SELECT check_clause FROM information_schema.check_constraints 
WHERE table_name = 'issue_timeline' 
AND constraint_name = 'chk_issue_timeline_event_type';
```

## Success Criteria

All tests pass ✅

- Timeline API accessible
- Stable sort order confirmed
- ISSUE_CREATED uniqueness verified
- All event types working
- Pagination functional
- Input validation working
- Performance acceptable

**Status**: Ready for production deployment after all tests pass.
