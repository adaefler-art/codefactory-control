# E64.1: GitHub Runner Adapter - Testing Guide

## Overview

This document provides testing instructions for the GitHub Runner Adapter implementation.

## API Endpoints

### 1. Dispatch Workflow

**Endpoint:** `POST /api/integrations/github/runner/dispatch`

**Purpose:** Dispatch a GitHub Actions workflow run

**Request Body:**
```json
{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "workflowIdOrFile": "ci.yml",
  "ref": "main",
  "correlationId": "issue-123",
  "inputs": {
    "key": "value"
  },
  "title": "Optional run title"
}
```

**Response:**
```json
{
  "ok": true,
  "runId": 123456,
  "runUrl": "https://github.com/owner/repo/actions/runs/123456",
  "recordId": "run-record-uuid",
  "isExisting": false,
  "message": "Workflow dispatched successfully"
}
```

**PowerShell Example:**
```powershell
$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    workflowIdOrFile = "ci.yml"
    ref = "main"
    correlationId = "issue-test-001"
    inputs = @{
        environment = "test"
    }
    title = "Test dispatch from PowerShell"
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/dispatch" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

### 2. Poll Workflow Run

**Endpoint:** `POST /api/integrations/github/runner/poll`

**Purpose:** Poll a GitHub Actions workflow run for status updates

**Request Body:**
```json
{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "runId": 123456
}
```

**Response:**
```json
{
  "ok": true,
  "runId": 123456,
  "status": "in_progress",
  "conclusion": null,
  "normalizedStatus": "RUNNING",
  "updatedAt": "2024-01-01T12:05:00Z",
  "createdAt": "2024-01-01T12:00:00Z",
  "runStartedAt": "2024-01-01T12:01:00Z"
}
```

**PowerShell Example:**
```powershell
$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    runId = 123456
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/poll" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

### 3. Ingest Workflow Run

**Endpoint:** `POST /api/integrations/github/runner/ingest`

**Purpose:** Ingest a completed GitHub Actions workflow run (jobs, artifacts, annotations)

**Request Body:**
```json
{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "runId": 123456
}
```

**Response:**
```json
{
  "ok": true,
  "runId": 123456,
  "recordId": "run-record-uuid",
  "summary": {
    "status": "completed",
    "conclusion": "success",
    "totalJobs": 2,
    "successfulJobs": 2,
    "failedJobs": 0,
    "durationMs": 300000
  },
  "jobs": [...],
  "artifacts": [...],
  "annotations": [],
  "logsUrl": "https://api.github.com/repos/owner/repo/actions/runs/123456/logs"
}
```

**PowerShell Example:**
```powershell
$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    runId = 123456
} | ConvertTo-Json

Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/ingest" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body
```

## Testing Flow

### Complete Dispatch → Poll → Ingest Flow

```powershell
# 1. Dispatch a workflow
$dispatchResponse = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/dispatch" `
    -Method POST `
    -ContentType "application/json" `
    -Body (@{
        owner = "adaefler-art"
        repo = "codefactory-control"
        workflowIdOrFile = "ci.yml"
        ref = "main"
        correlationId = "test-" + (Get-Date -Format "yyyyMMddHHmmss")
    } | ConvertTo-Json)

Write-Host "Dispatched run: $($dispatchResponse.runId)"
Write-Host "Run URL: $($dispatchResponse.runUrl)"

# 2. Poll the run periodically
$runId = $dispatchResponse.runId
$pollBody = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    runId = $runId
} | ConvertTo-Json

do {
    Start-Sleep -Seconds 10
    $pollResponse = Invoke-RestMethod `
        -Uri "http://localhost:3000/api/integrations/github/runner/poll" `
        -Method POST `
        -ContentType "application/json" `
        -Body $pollBody
    
    Write-Host "Status: $($pollResponse.status) | Normalized: $($pollResponse.normalizedStatus)"
} while ($pollResponse.status -ne "completed")

# 3. Ingest the completed run
$ingestResponse = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/ingest" `
    -Method POST `
    -ContentType "application/json" `
    -Body $pollBody

Write-Host "Ingestion complete!"
Write-Host "Total jobs: $($ingestResponse.summary.totalJobs)"
Write-Host "Successful: $($ingestResponse.summary.successfulJobs)"
Write-Host "Failed: $($ingestResponse.summary.failedJobs)"
```

## Idempotency Testing

```powershell
# Dispatch the same workflow twice with same correlationId
$correlationId = "idempotent-test-" + (Get-Date -Format "yyyyMMdd")

$body = @{
    owner = "adaefler-art"
    repo = "codefactory-control"
    workflowIdOrFile = "ci.yml"
    ref = "main"
    correlationId = $correlationId
} | ConvertTo-Json

# First dispatch
$response1 = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/dispatch" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

Write-Host "First dispatch - isExisting: $($response1.isExisting) (should be false)"

# Second dispatch with same correlationId
$response2 = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/integrations/github/runner/dispatch" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

Write-Host "Second dispatch - isExisting: $($response2.isExisting) (should be true)"
Write-Host "Same run ID: $($response1.runId -eq $response2.runId) (should be true)"
```

## Unit Tests

Run the unit tests:

```bash
cd control-center
npm test -- __tests__/lib/github-runner-adapter.test.ts
npm test -- __tests__/api/github-runner-routes.test.ts
```

## Build Verification

```bash
cd control-center
npm run build
```

## Environment Variables Required

- `GITHUB_APP_ID` or secret in AWS Secrets Manager: `afu9/github/app`
- `GITHUB_APP_PRIVATE_KEY_PEM` or in secret
- Database connection: `DATABASE_URL` or env vars for PostgreSQL

## Database

The adapter uses the existing `runs` table (migration 026) with the following fields:
- `id`: Internal run record ID
- `issue_id`: Correlation ID (issue_id or execution_id)
- `playbook_id`: Workflow ID or file name
- `spec_json`: Contains GitHub run metadata (owner, repo, ref, inputs, githubRunId, runUrl)
- `result_json`: Contains ingested result data
- `status`: Normalized status (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED)

No new database migrations are required.

## Security Checklist

- ✅ No secrets in code
- ✅ Uses GitHub App authentication (server-to-server)
- ✅ Installation token obtained via deterministic repo lookup
- ✅ Rate limiting considerations (backoff in adapter)
- ✅ Input validation on all API routes
- ✅ Idempotency via correlationId + workflow
