# S1-S3 Live Flow MVP

This document describes the S1-S3 live flow implementation for AFU-9.

## Overview

The S1-S3 flow enables automated GitHub issue handling through three stages:
- **S1 (Pick Issue)**: Link a GitHub issue to AFU9
- **S2 (Spec Ready)**: Define spec with acceptance criteria
- **S3 (Implement)**: Create branch and PR automatically

## Architecture

### Data Models

#### afu9_s1s3_issues
Stores AFU9 issues linked to GitHub issues with spec and PR tracking.

Key fields:
- `id`: UUID primary key
- `public_id`: 8-character public identifier
- `canonical_id`: Human-readable ID (e.g., I123, E89.6)
- `repo_full_name`: GitHub repo (owner/repo)
- `github_issue_number`: Issue number in GitHub
- `github_issue_url`: Full URL to GitHub issue
- `status`: Current status (CREATED, SPEC_READY, PR_CREATED, etc.)
- `acceptance_criteria`: JSONB array (required for SPEC_READY)
- `pr_number`, `pr_url`, `branch_name`: PR tracking

#### s1s3_runs
Tracks execution runs for S1-S3 actions.

Key fields:
- `id`: UUID primary key
- `type`: Run type (S1_PICK_ISSUE, S2_SPEC_READY, S3_IMPLEMENT)
- `issue_id`: Foreign key to afu9_s1s3_issues
- `request_id`: Request tracking ID
- `status`: Run status (CREATED, RUNNING, DONE, FAILED)

#### s1s3_run_steps
Append-only event log for step execution.

Key fields:
- `id`: UUID primary key
- `run_id`: Foreign key to s1s3_runs
- `step_id`: Step identifier (S1, S2, S3)
- `status`: Step status (STARTED, SUCCEEDED, FAILED)
- `evidence_refs`: JSONB object with URLs and metadata

### API Endpoints

#### GET /api/afu9/github/issues
List GitHub issues from allowlisted repositories.

**Query Parameters:**
- `repo` (required): Repository in format "owner/repo"
- `state`: "open" | "closed" | "all" (default: "open")
- `label`: Filter by label
- `limit`: Results per page (default: 30, max: 100)
- `page`: Page number (default: 1)

**Response:**
```json
{
  "issues": [...],
  "total": 10,
  "page": 1,
  "limit": 30,
  "repo": "owner/repo"
}
```

#### POST /api/afu9/s1s3/issues/pick
S1 - Pick a GitHub issue and link it to AFU9.

**Request Body:**
```json
{
  "repo": "owner/repo",
  "issueNumber": 42,
  "owner": "afu9",
  "canonicalId": "I123"
}
```

**Response:**
```json
{
  "issue": { /* S1S3IssueRow */ },
  "run": { /* S1S3RunRow */ },
  "step": { /* S1S3RunStepRow */ }
}
```

#### POST /api/afu9/s1s3/issues/[id]/spec
S2 - Set spec ready with acceptance criteria.

**Request Body:**
```json
{
  "problem": "Description of the problem",
  "scope": "What needs to be changed",
  "acceptanceCriteria": ["AC1", "AC2", "AC3"],
  "notes": "Additional notes"
}
```

**Response:**
```json
{
  "issue": { /* S1S3IssueRow with SPEC_READY status */ },
  "run": { /* S1S3RunRow */ },
  "step": { /* S1S3RunStepRow */ }
}
```

#### POST /api/afu9/s1s3/issues/[id]/implement
S3 - Create branch and PR for implementation.

**Request Body:**
```json
{
  "baseBranch": "main",
  "prTitle": "Optional custom PR title",
  "prBody": "Optional custom PR body"
}
```

**Response:**
```json
{
  "issue": { /* S1S3IssueRow with PR_CREATED status */ },
  "run": { /* S1S3RunRow */ },
  "step": { /* S1S3RunStepRow */ },
  "pr": {
    "number": 123,
    "url": "https://github.com/owner/repo/pull/123",
    "branch": "afu9/issue-42-a1b2c3d4"
  }
}
```

#### GET /api/afu9/s1s3/prs/[prNumber]/checks
Get PR checks status from GitHub CI/CD.

**Query Parameters:**
- `repo` (required): Repository in format "owner/repo"

**Response:**
```json
{
  "pr": {
    "number": 123,
    "state": "open",
    "mergeable": true,
    "head_sha": "abc123..."
  },
  "checks": {
    "total": 5,
    "completed": 5,
    "success": 4,
    "failure": 1,
    "pending": 0,
    "conclusion": "failure",
    "runs": [...]
  }
}
```

#### GET /api/afu9/s1s3/issues
List all S1-S3 issues.

**Query Parameters:**
- `status`: Filter by status
- `repo`: Filter by repository
- `limit`: Results per page (default: 50, max: 100)
- `offset`: Pagination offset

#### GET /api/afu9/s1s3/issues/[id]
Get issue details with runs and timeline.

**Response:**
```json
{
  "issue": { /* S1S3IssueRow */ },
  "runs": [ /* S1S3RunRow[] */ ],
  "steps": [ /* S1S3RunStepRow[] */ ]
}
```

## Security & Authorization

### Repository Allowlist
All GitHub API operations enforce repository access policy via the allowlist configured in `GITHUB_REPO_ALLOWLIST` environment variable.

- Repositories not in the allowlist will return `403 Forbidden`
- Allowlist is enforced before token acquisition (fail-closed)
- See `control-center/src/lib/github/policy.ts` for details

### GitHub App Authentication
All GitHub API calls use GitHub App server-to-server authentication:
- No PATs or OAuth tokens
- Installation tokens are fetched per request
- Token acquisition includes audit evidence (request ID, allowlist hash)
- See `control-center/src/lib/github-app-auth.ts` and `auth-wrapper.ts`

## Evidence & Audit Trail

Every step creates immutable event records:

1. **Run Record**: Created at start of each action (S1, S2, S3)
   - Includes request ID, actor, timestamps
   - Status tracked through lifecycle (CREATED → RUNNING → DONE/FAILED)

2. **Step Events**: Append-only log of step execution
   - STARTED event when step begins
   - SUCCEEDED or FAILED event when step completes
   - Evidence refs include URLs, IDs, and relevant metadata

3. **Evidence Refs Format**:
```json
{
  "issue_url": "https://github.com/owner/repo/issues/42",
  "issue_number": 42,
  "repo_full_name": "owner/repo",
  "pr_url": "https://github.com/owner/repo/pull/123",
  "pr_number": 123,
  "branch_name": "afu9/issue-42-a1b2c3d4",
  "request_id": "req-abc123"
}
```

## Database Migration

To apply the database schema:

```bash
# Migration is in database/migrations/086_s1s3_flow_persistence.sql
# Apply via your migration tool (e.g., node-pg-migrate, flyway, etc.)
```

## Testing

Unit tests are located in:
- `control-center/__tests__/lib/db/s1s3Flow.test.ts`

Run tests:
```bash
cd control-center
npm test -- __tests__/lib/db/s1s3Flow.test.ts
```

## Example Workflow

### Complete S1-S3 Flow

```bash
# 1. List available issues from allowlisted repo
curl "http://localhost:3000/api/afu9/github/issues?repo=owner/repo&state=open"

# 2. Pick an issue (S1)
curl -X POST http://localhost:3000/api/afu9/s1s3/issues/pick \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "owner/repo",
    "issueNumber": 42,
    "canonicalId": "I123"
  }'

# Response includes issue.id (use in next steps)

# 3. Set spec ready (S2)
curl -X POST http://localhost:3000/api/afu9/s1s3/issues/{issue-id}/spec \
  -H "Content-Type: application/json" \
  -d '{
    "problem": "Users cannot log in",
    "scope": "Fix authentication service",
    "acceptanceCriteria": [
      "Login works for existing users",
      "Error messages are clear",
      "Session persists correctly"
    ]
  }'

# 4. Create branch and PR (S3)
curl -X POST http://localhost:3000/api/afu9/s1s3/issues/{issue-id}/implement \
  -H "Content-Type: application/json" \
  -d '{
    "baseBranch": "main"
  }'

# Response includes PR number

# 5. Check PR status
curl "http://localhost:3000/api/afu9/s1s3/prs/{pr-number}/checks?repo=owner/repo"

# 6. View issue timeline
curl "http://localhost:3000/api/afu9/s1s3/issues/{issue-id}"
```

## Configuration

### Environment Variables

Required:
- `GITHUB_APP_SECRET_ID`: AWS Secrets Manager secret ID for GitHub App credentials
- `GITHUB_REPO_ALLOWLIST`: JSON array of allowed repositories (see policy.ts)

Optional:
- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`: Database connection

Example allowlist:
```json
[
  {"owner": "adaefler-art", "repo": "codefactory-control"},
  {"owner": "myorg", "repo": "myrepo"}
]
```

## Design Principles

1. **No Mocks**: All data is persisted and all GitHub operations are real API calls
2. **Evidence First**: Every action creates auditable events with timestamps and links
3. **Fail Closed**: Unauthorized repos return 403, failed auth returns 401
4. **Deterministic**: Step events are append-only, no silent retries
5. **Idempotent**: Issue upsert by repo+number, runs can be re-executed

## Future Enhancements

- [ ] Auto-refresh PR checks on a schedule
- [ ] Webhook integration for GitHub events
- [ ] Auto-merge when checks pass
- [ ] Slack/email notifications for status changes
- [ ] UI for S1-S3 flow visualization

## References

- Issue: E9.1_F1
- Database Migration: `086_s1s3_flow_persistence.sql`
- Contracts: `control-center/src/lib/contracts/s1s3Flow.ts`
- DAO: `control-center/src/lib/db/s1s3Flow.ts`
- API Routes: `control-center/app/api/afu9/s1s3/`
