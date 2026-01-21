# I201.4 Quick Verification Guide

## Prerequisites
- Server running at http://localhost:3000
- An existing issue or ability to create one

## Quick Test

### 1. Create a test issue (if needed)
```powershell
$base = "http://localhost:3000"
$createResponse = curl.exe -s -X POST "$base/api/afu9/issues" `
  -H "Content-Type: application/json" `
  -d '{"title":"Test Issue for Run Start","body":"Testing I201.4","status":"CREATED"}' | ConvertFrom-Json

$issueId = $createResponse.id
Write-Host "Created issue: $issueId"
```

### 2. Start a run for the issue
```powershell
$base = "http://localhost:3000"
$issueId = "your-issue-id-here"  # Replace with actual issue ID

$runResponse = curl.exe -s -X POST "$base/api/afu9/issues/$issueId/runs/start" `
  -H "Content-Type: application/json" `
  -d '{"type":"manual"}' | ConvertFrom-Json

# Display result
Write-Host "Run ID: $($runResponse.runId)"
Write-Host "Status: $($runResponse.status)"
Write-Host "Type: $($runResponse.type)"
Write-Host "Created: $($runResponse.createdAt)"
Write-Host "Started: $($runResponse.startedAt)"
```

### 3. Verify issue state changed
```powershell
$issueResponse = curl.exe -s -X GET "$base/api/afu9/issues/$issueId" | ConvertFrom-Json
Write-Host "Issue Status: $($issueResponse.status)"
Write-Host "Execution State: $($issueResponse.executionState)"
```

### 4. Check timeline for RUN_STARTED event
```powershell
$timelineResponse = curl.exe -s -X GET "$base/api/issues/$issueId/events" | ConvertFrom-Json
$runStartedEvent = $timelineResponse.events | Where-Object { $_.event_type -eq "RUN_STARTED" } | Select-Object -First 1
Write-Host "RUN_STARTED event found: $($runStartedEvent -ne $null)"
if ($runStartedEvent) {
    Write-Host "  Run ID: $($runStartedEvent.event_data.runId)"
    Write-Host "  Type: $($runStartedEvent.event_data.type)"
    Write-Host "  Status: $($runStartedEvent.event_data.status)"
}
```

## Automated Verification

Run the complete verification script:
```powershell
.\I201_4_VERIFICATION.ps1 -BaseUrl http://localhost:3000
```

Or with a specific issue:
```powershell
.\I201_4_VERIFICATION.ps1 -BaseUrl http://localhost:3000 -IssueId <issue-id>
```

## Expected Results

### Run Response
```json
{
  "runId": "uuid-v4-format",
  "issueId": "issue-uuid",
  "type": "manual",
  "status": "RUNNING",
  "createdAt": "2026-01-19T...",
  "startedAt": "2026-01-19T..."
}
```

### Issue Status After Start
- `status`: "IMPLEMENTING" (if was "CREATED")
- `executionState`: "RUNNING"
- `executionStartedAt`: timestamp

### Timeline Event
- `event_type`: "RUN_STARTED"
- `event_data.runId`: matches run ID
- `event_data.type`: matches request type
- `event_data.status`: "RUNNING"

## Acceptance Criteria

- [x] Start Run creates exactly one Run record
- [x] Run has `runId`, `issueId`, `type`, `status=RUNNING`, timestamps
- [x] Issue state transitions from CREATED → IMPLEMENTING
- [x] Issue `executionState` is set to RUNNING
- [x] Timeline contains RUN_STARTED event with runId
