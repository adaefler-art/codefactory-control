# GitHub Runner Adapter

E64.1: AFU-9 GitHub Actions Integration - Dispatch, Poll, and Ingest GitHub workflow runs.

## Overview

The GitHub Runner Adapter provides a deterministic, idempotent interface for AFU-9 to interact with GitHub Actions workflow runs. It enables:

1. **Dispatch**: Trigger GitHub Actions workflows programmatically
2. **Poll**: Monitor workflow run status
3. **Ingest**: Collect completed run results (jobs, artifacts, logs)

## Architecture

```
┌─────────────────┐
│  AFU-9 Control  │
│     Center      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────────┐
│ GitHub Runner   │─────▶│  Database (PG)   │
│    Adapter      │      │  runs table      │
└────────┬────────┘      └──────────────────┘
         │
         ▼
┌─────────────────┐
│  GitHub API     │
│  (via App Auth) │
└─────────────────┘
```

## Files

### Core Implementation
- `src/lib/github-runner/types.ts` - TypeScript type definitions and contracts
- `src/lib/github-runner/adapter.ts` - Core dispatch/poll/ingest logic
- `src/lib/db/githubRuns.ts` - Database persistence layer

### API Routes
- `app/api/integrations/github/runner/dispatch/route.ts` - POST endpoint to dispatch workflows
- `app/api/integrations/github/runner/poll/route.ts` - POST endpoint to poll run status
- `app/api/integrations/github/runner/ingest/route.ts` - POST endpoint to ingest run results

### Tests
- `__tests__/lib/github-runner-adapter.test.ts` - Unit tests for adapter
- `__tests__/api/github-runner-routes.test.ts` - API route integration tests

## Usage

### 1. Dispatch a Workflow

```typescript
import { dispatchWorkflow } from '@/lib/github-runner/adapter';
import { getPool } from '@/lib/db';

const pool = getPool();
const result = await dispatchWorkflow(pool, {
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  workflowIdOrFile: 'ci.yml',
  ref: 'main',
  correlationId: 'issue-123', // For idempotency and tracking
  inputs: {
    environment: 'production',
  },
  title: 'Deploy to production',
});

console.log(`Run ID: ${result.runId}`);
console.log(`Run URL: ${result.runUrl}`);
console.log(`Existing: ${result.isExisting}`);
```

### 2. Poll Run Status

```typescript
import { pollRun } from '@/lib/github-runner/adapter';

const status = await pollRun(pool, {
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  runId: 123456,
});

console.log(`Status: ${status.status}`); // e.g., 'in_progress'
console.log(`Normalized: ${status.normalizedStatus}`); // e.g., 'RUNNING'
```

### 3. Ingest Completed Run

```typescript
import { ingestRun } from '@/lib/github-runner/adapter';

const result = await ingestRun(pool, {
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  runId: 123456,
});

console.log(`Total jobs: ${result.summary.totalJobs}`);
console.log(`Successful: ${result.summary.successfulJobs}`);
console.log(`Artifacts: ${result.artifacts.length}`);
```

## API Endpoints

### POST `/api/integrations/github/runner/dispatch`

Dispatch a GitHub Actions workflow.

**Request:**
```json
{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "workflowIdOrFile": "ci.yml",
  "ref": "main",
  "correlationId": "issue-123",
  "inputs": {},
  "title": "Optional run title"
}
```

**Response:**
```json
{
  "ok": true,
  "runId": 123456,
  "runUrl": "https://github.com/owner/repo/actions/runs/123456",
  "recordId": "uuid",
  "isExisting": false
}
```

### POST `/api/integrations/github/runner/poll`

Poll a workflow run for status updates.

**Request:**
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
  "updatedAt": "2024-01-01T12:05:00Z"
}
```

### POST `/api/integrations/github/runner/ingest`

Ingest a completed workflow run.

**Request:**
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
  "recordId": "uuid",
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
  "logsUrl": "..."
}
```

## Idempotency

The adapter ensures idempotent dispatch operations:

1. **Check**: Before dispatching, checks for existing run with same `correlationId + workflowId + repo`
2. **Return**: If found, returns existing run (`isExisting: true`)
3. **Create**: Otherwise, dispatches new workflow and creates database record

This prevents duplicate workflow runs and ensures safe retries.

## Status Normalization

GitHub workflow run statuses are normalized to internal statuses:

| GitHub Status | GitHub Conclusion | Internal Status |
|--------------|-------------------|-----------------|
| queued       | -                 | QUEUED          |
| waiting      | -                 | QUEUED          |
| requested    | -                 | QUEUED          |
| in_progress  | -                 | RUNNING         |
| completed    | success           | SUCCEEDED       |
| completed    | neutral           | SUCCEEDED       |
| completed    | skipped           | SUCCEEDED       |
| completed    | cancelled         | CANCELLED       |
| completed    | failure           | FAILED          |
| completed    | timed_out         | FAILED          |
| completed    | action_required   | FAILED          |

## Database Schema

Uses existing `runs` table (migration 026):

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  issue_id TEXT,                    -- correlationId
  title TEXT NOT NULL,
  playbook_id TEXT,                 -- workflowId
  status TEXT NOT NULL,             -- QUEUED|RUNNING|SUCCEEDED|FAILED|CANCELLED
  spec_json JSONB NOT NULL,         -- GitHub metadata (owner, repo, ref, inputs, githubRunId, runUrl)
  result_json JSONB,                -- Ingested result data
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
```

## Authentication

Uses GitHub App authentication (server-to-server):

1. **JWT Generation**: Creates RS256 JWT from `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PEM`
2. **Installation Lookup**: Deterministically resolves installation ID for repository
3. **Access Token**: Creates short-lived installation access token
4. **API Calls**: Uses access token for all GitHub API requests

Secrets are loaded from:
- AWS Secrets Manager: `afu9/github/app` (production)
- Environment variables: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_PEM` (development)

## Error Handling

All functions throw descriptive errors:

```typescript
try {
  await dispatchWorkflow(pool, input);
} catch (error) {
  // Error types:
  // - "Failed to dispatch workflow (404): Workflow not found"
  // - "Failed to get workflow run (403): Forbidden"
  // - "No run record found for GitHub run ID 123456"
}
```

API routes return proper HTTP status codes:
- `200 OK` - Success
- `400 Bad Request` - Invalid input
- `500 Internal Server Error` - GitHub API or database errors

## Rate Limiting

GitHub API has rate limits:
- **GitHub Apps**: 5,000 requests per hour per installation

Recommendations:
1. Implement exponential backoff for polling
2. Use webhooks for run completion notifications (future enhancement)
3. Monitor rate limit headers in responses

## Testing

Run tests:
```bash
cd control-center
npm test -- __tests__/lib/github-runner-adapter.test.ts
npm test -- __tests__/api/github-runner-routes.test.ts
```

Manual testing with PowerShell:
```powershell
# See docs/E64_1_TESTING_GUIDE.md for examples
```

## Security

- ✅ No secrets in code
- ✅ GitHub App authentication (server-to-server)
- ✅ Installation tokens expire after 1 hour
- ✅ Input validation on all API routes
- ✅ Type-safe TypeScript implementation

## Future Enhancements

1. **UI Integration**: Display run status in issue/execution detail pages
2. **Webhooks**: Subscribe to GitHub workflow run webhooks for real-time updates
3. **Annotations**: Parse check run annotations for detailed error reporting
4. **Retry Logic**: Implement exponential backoff for transient failures
5. **Caching**: Cache workflow metadata to reduce API calls

## References

- [GitHub REST API - Actions](https://docs.github.com/en/rest/actions)
- [GitHub App Authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app)
- [Workflow Dispatch Event](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch)
