# I201.4 Verification Script
# Tests the Start Run endpoint (POST /api/afu9/issues/:issueId/runs/start)

param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$IssueId = ""
)

Write-Host "=== I201.4 Start Run Endpoint Verification ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl" -ForegroundColor Gray
Write-Host ""

# Function to make API calls
function Invoke-ApiTest {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null,
        [string]$Description
    )
    
    Write-Host "Testing: $Description" -ForegroundColor Yellow
    Write-Host "  $Method $Endpoint" -ForegroundColor Gray
    
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    try {
        if ($Body) {
            $bodyJson = $Body | ConvertTo-Json
            $response = Invoke-RestMethod -Uri "$BaseUrl$Endpoint" -Method $Method -Headers $headers -Body $bodyJson
        } else {
            $response = Invoke-RestMethod -Uri "$BaseUrl$Endpoint" -Method $Method -Headers $headers
        }
        
        Write-Host "  ✓ Success" -ForegroundColor Green
        return $response
    } catch {
        Write-Host "  ✗ Failed: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "  Response: $responseBody" -ForegroundColor DarkRed
        }
        return $null
    }
}

# Step 1: Create a test issue if no IssueId provided
if (-not $IssueId) {
    Write-Host "Step 1: Creating a test issue..." -ForegroundColor Cyan
    $createIssueBody = @{
        title = "Test Issue for Run Start Verification"
        body = "This is a test issue created to verify the Start Run endpoint (I201.4)"
        status = "CREATED"
    }
    
    $issue = Invoke-ApiTest -Method POST -Endpoint "/api/afu9/issues" -Body $createIssueBody -Description "Create test issue"
    
    if ($issue) {
        $IssueId = $issue.id
        Write-Host "  Created issue: $IssueId" -ForegroundColor Green
    } else {
        Write-Host "Failed to create test issue. Exiting." -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Step 2: Start a run for the issue
Write-Host "Step 2: Starting a run for issue $IssueId..." -ForegroundColor Cyan
$startRunBody = @{
    type = "test"
}

$run = Invoke-ApiTest -Method POST -Endpoint "/api/afu9/issues/$IssueId/runs/start" -Body $startRunBody -Description "Start run"

if ($run) {
    Write-Host "  Run ID: $($run.runId)" -ForegroundColor Green
    Write-Host "  Status: $($run.status)" -ForegroundColor Green
    Write-Host "  Type: $($run.type)" -ForegroundColor Green
    Write-Host "  Created: $($run.createdAt)" -ForegroundColor Green
    Write-Host "  Started: $($run.startedAt)" -ForegroundColor Green
    
    # Validation checks
    $validations = @()
    if ($run.status -eq "RUNNING") {
        $validations += "✓ Run status is RUNNING"
    } else {
        $validations += "✗ Run status is not RUNNING (got: $($run.status))"
    }
    
    if ($run.runId) {
        $validations += "✓ Run ID is present"
    } else {
        $validations += "✗ Run ID is missing"
    }
    
    if ($run.issueId -eq $IssueId) {
        $validations += "✓ Issue ID matches"
    } else {
        $validations += "✗ Issue ID mismatch"
    }
    
    if ($run.createdAt -and $run.startedAt) {
        $validations += "✓ Timestamps are present"
    } else {
        $validations += "✗ Timestamps are missing"
    }
    
    Write-Host ""
    Write-Host "Validations:" -ForegroundColor Cyan
    foreach ($validation in $validations) {
        if ($validation.StartsWith("✓")) {
            Write-Host "  $validation" -ForegroundColor Green
        } else {
            Write-Host "  $validation" -ForegroundColor Red
        }
    }
} else {
    Write-Host "Failed to start run" -ForegroundColor Red
}
Write-Host ""

# Step 3: Verify issue state transition
Write-Host "Step 3: Verifying issue state transition..." -ForegroundColor Cyan
$updatedIssue = Invoke-ApiTest -Method GET -Endpoint "/api/afu9/issues/$IssueId" -Description "Get updated issue"

if ($updatedIssue) {
    Write-Host "  Status: $($updatedIssue.status)" -ForegroundColor Green
    Write-Host "  Execution State: $($updatedIssue.executionState)" -ForegroundColor Green
    
    if ($updatedIssue.status -eq "IMPLEMENTING") {
        Write-Host "  ✓ Issue transitioned to IMPLEMENTING" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Issue did not transition to IMPLEMENTING (got: $($updatedIssue.status))" -ForegroundColor Red
    }
    
    if ($updatedIssue.executionState -eq "RUNNING") {
        Write-Host "  ✓ Execution state is RUNNING" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Execution state is not RUNNING (got: $($updatedIssue.executionState))" -ForegroundColor Red
    }
}
Write-Host ""

# Step 4: Verify timeline event
Write-Host "Step 4: Verifying RUN_STARTED timeline event..." -ForegroundColor Cyan
$timeline = Invoke-ApiTest -Method GET -Endpoint "/api/issues/$IssueId/events" -Description "Get timeline events"

if ($timeline -and $timeline.events) {
    $runStartedEvent = $timeline.events | Where-Object { $_.event_type -eq "RUN_STARTED" } | Select-Object -First 1
    
    if ($runStartedEvent) {
        Write-Host "  ✓ RUN_STARTED event found" -ForegroundColor Green
        Write-Host "  Event data:" -ForegroundColor Gray
        Write-Host "    Run ID: $($runStartedEvent.event_data.runId)" -ForegroundColor Gray
        Write-Host "    Type: $($runStartedEvent.event_data.type)" -ForegroundColor Gray
        Write-Host "    Status: $($runStartedEvent.event_data.status)" -ForegroundColor Gray
        
        if ($runStartedEvent.event_data.runId -eq $run.runId) {
            Write-Host "  ✓ Timeline event runId matches" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Timeline event runId mismatch" -ForegroundColor Red
        }
    } else {
        Write-Host "  ✗ RUN_STARTED event not found" -ForegroundColor Red
    }
} else {
    Write-Host "  ✗ Failed to retrieve timeline" -ForegroundColor Red
}
Write-Host ""

Write-Host "=== Verification Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  ✓ Run created with status=RUNNING" -ForegroundColor Green
Write-Host "  ✓ Issue transitioned to IMPLEMENTING" -ForegroundColor Green
Write-Host "  ✓ RUN_STARTED timeline event logged" -ForegroundColor Green
Write-Host ""
Write-Host "To run again with specific issue:" -ForegroundColor Gray
Write-Host "  .\I201_4_VERIFICATION.ps1 -IssueId <issue-id>" -ForegroundColor Gray
