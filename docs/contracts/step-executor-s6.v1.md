# Step Executor S6 Contract v1 (E9.3-CTRL-05)

**Contract ID:** `step-executor-s6.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-05  
**Created:** 2026-02-04

## Overview

The S6 (Deployment Observation) step executor implements read-only observation of GitHub deployments for AFU-9 issues. S6 captures deployment information after successful merge (S5), providing full traceability of code from issue to production without triggering deployments.

## Purpose

S6 serves as the deployment observation layer that:

1. **Observes** GitHub deployment events (read-only)
2. **Captures** deployment metadata (environment, commit, URL)
3. **Links** deployments to issues and PRs
4. **Validates** deployment authenticity (no fake deploys)

## Preconditions

Before S6 can execute:

- Issue must be in `DONE` state (completed S5 merge)
- PR must be merged (merge SHA available)
- Issue must have `pr_url` set
- No active lock on the issue

## Input Contract

### Database Schema Requirements

The executor expects the following issue data:

```typescript
interface IssueForS6 {
  id: string;                    // Issue UUID
  status: 'DONE';                // Must be in this state
  github_url: string;            // GitHub issue URL
  pr_url: string;                // GitHub PR URL (required)
  merge_sha?: string;            // Merge commit SHA from S5
}
```

### Step Executor Parameters

```typescript
interface ExecuteS6Params {
  issue: IssueForS6;
  runId: string;       // Loop run ID for traceability
  requestId: string;   // Request ID for correlation
  mode: 'execute' | 'dryRun';
}
```

## Execution Logic

### Step 1: PR Validation

- **Check PR exists**: Issue must have `pr_url` set
- **Check PR merged**: PR must have merge SHA
- **Parse PR URL**: Extract owner, repo, and PR number

**Blocker codes** (if validation fails):
- `NO_PR_LINKED` - Issue has no PR URL
- `PR_NOT_MERGED` - PR is not merged yet

### Step 2: Query GitHub Deployments API

Fetch deployments for the repository:

```typescript
// Query GitHub Deployments API
const deployments = await octokit.rest.repos.listDeployments({
  owner,
  repo,
  sha: mergeSha,  // Filter by merge commit SHA
  environment: undefined,  // Get all environments
  per_page: 100,
});
```

**Deployment resolution:**
- Environment: `deployment.environment` (e.g., "production", "staging")
- Commit SHA: `deployment.sha`
- URL/Target: `deployment.payload.web_url` or environment URL
- Created at: `deployment.created_at`
- Deployment ID: `deployment.id`

### Step 3: Validate Deployment Authenticity

Ensure observed deployments are real:

1. **Check deployment exists in GitHub**: Must be returned by GitHub API
2. **Verify commit SHA matches**: Deployment SHA must match merge SHA
3. **Check deployment status**: Query deployment status to verify it's not a fake

```typescript
// Get deployment statuses to validate authenticity
const statuses = await octokit.rest.repos.listDeploymentStatuses({
  owner,
  repo,
  deployment_id: deployment.id,
});

// Validate: deployment must have at least one status
const isAuthentic = statuses.data.length > 0;
```

**Authenticity criteria:**
- Deployment exists in GitHub API
- Deployment has at least one status record
- Deployment SHA matches merge SHA
- Deployment is for the correct repository

### Step 4: Store Deployment Observations

Store validated deployments in database:

```typescript
interface DeploymentObservation {
  id: string;                     // UUID
  issue_id: string;               // Foreign key to afu9_issues
  github_deployment_id: number;   // GitHub deployment ID
  environment: string;            // Environment name
  sha: string;                    // Commit SHA
  target_url?: string;            // Deployment target URL
  description?: string;           // Deployment description
  created_at: string;             // When deployment was created
  observed_at: string;            // When we observed it
  deployment_status?: string;     // Latest status (success, failure, pending)
  is_authentic: boolean;          // Validation result
  raw_payload: object;            // Full GitHub deployment data
}
```

### Step 5: Create Timeline Event

Record deployment observation in timeline:

```typescript
{
  event_type: 'deployment_observed',
  event_data: {
    runId: string;
    step: 'S6_DEPLOYMENT_OBSERVE',
    stateBefore: 'DONE',
    stateAfter: 'DONE',
    requestId: string;
    deploymentsFound: number;
    deployments: Array<{
      deploymentId: number;
      environment: string;
      sha: string;
      targetUrl?: string;
      isAuthentic: boolean;
    }>;
  }
}
```

## Output Contract

### Success Response

```typescript
interface S6ExecutionResult {
  success: true;
  runId: string;
  step: 'S6_DEPLOYMENT_OBSERVE';
  stateBefore: 'DONE';
  stateAfter: 'DONE';
  observationEvidence: {
    eventId: string;              // UUID of observation event
    deploymentsFound: number;     // Count of deployments observed
    deployments: Array<{
      deploymentId: number;
      environment: string;
      sha: string;
      targetUrl?: string;
      isAuthentic: boolean;
      observedAt: string;
    }>;
  };
  durationMs: number;
}
```

### No Deployments Response

```typescript
interface S6NoDeploymentsResult {
  success: true;
  runId: string;
  step: 'S6_DEPLOYMENT_OBSERVE';
  stateBefore: 'DONE';
  stateAfter: 'DONE';
  message: 'No deployments found for merge SHA';
  observationEvidence: {
    eventId: string;
    deploymentsFound: 0;
    mergeSha: string;
  };
  durationMs: number;
}
```

### Blocked Response

```typescript
interface S6BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S6_DEPLOYMENT_OBSERVE';
  stateBefore: string;
  stateAfter: string;  // State unchanged on block
}
```

## Block Reasons

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `NO_PR_LINKED` | Issue has no PR URL | pr_url is null/empty |
| `PR_NOT_MERGED` | PR is not merged | merge_sha is null |
| `GITHUB_API_ERROR` | GitHub API error | API call failed |

## Event Types

S6 emits the following timeline events:

| Event Type | When | Required Fields |
|------------|------|-----------------|
| `deployment_observed` | Deployments found and validated | runId, step, stateBefore, stateAfter, deploymentsFound, requestId |
| `loop_step_s6_completed` | S6 completed successfully | runId, step, stateBefore, stateAfter, requestId |
| `loop_run_blocked` | S6 blocked | runId, step, stateBefore, blockerCode, requestId |

## Read-Only Semantics

**Critical**: S6 is strictly read-only observation:

1. **No triggers**: S6 does not trigger deployments
2. **No modifications**: S6 does not modify GitHub deployments
3. **No status changes**: S6 does not update deployment statuses
4. **Pure observation**: S6 only reads and records data

## Authenticity Guarantees

**Critical**: S6 validates deployment authenticity:

1. **GitHub API validation**: Deployment must exist in GitHub API
2. **Status verification**: Deployment must have status records
3. **SHA matching**: Deployment SHA must match merge SHA
4. **Repository verification**: Deployment must be for correct repo

## Idempotency Guarantees

**Critical**: S6 observation operations are idempotent:

1. **Duplicate-safe**: Same deployment observed multiple times creates single record
2. **Hash-based deduplication**: Use (issue_id + github_deployment_id) as unique key
3. **No side effects on retry**: Retrying observation has no additional effects
4. **Deterministic outcome**: Same inputs → Same output

## State Machine Integration

### State Transition Rules

| Current State | Step | Next State | Condition |
|---------------|------|------------|-----------|
| `DONE` | S6 | `DONE` | Observation completed (with or without deployments) |
| Any other state | S6 | Blocked | Invalid state for S6 |

### Post-Merge Flow

S6 is executed after S5 (Merge):
1. S5 merges PR → Issue transitions to `DONE`
2. S6 observes deployments → Issue remains `DONE`
3. S6 records deployment observations → Timeline updated

## Integration Points

### GitHub Deployments API

S6 uses GitHub's Deployments API:

```typescript
import { Octokit } from '@octokit/rest';

// List deployments for a commit
const deployments = await octokit.rest.repos.listDeployments({
  owner: string,
  repo: string,
  sha?: string,
  environment?: string,
  per_page?: number,
});

// Get deployment statuses
const statuses = await octokit.rest.repos.listDeploymentStatuses({
  owner: string,
  repo: string,
  deployment_id: number,
});
```

### Database Integration

S6 stores observations in `deployment_observations` table:

```sql
CREATE TABLE deployment_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id),
  github_deployment_id BIGINT NOT NULL,
  environment TEXT NOT NULL,
  sha TEXT NOT NULL,
  target_url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deployment_status TEXT,
  is_authentic BOOLEAN NOT NULL DEFAULT false,
  raw_payload JSONB NOT NULL,
  
  -- Unique constraint: one observation per deployment per issue
  UNIQUE(issue_id, github_deployment_id)
);
```

## Determinism Guarantees

The S6 observation operation is **deterministic**:

1. **Same inputs → Same output**: Given same PR + deployments, always returns same observations
2. **Stable API queries**: GitHub Deployments API provides stable historical data
3. **Consistent validation**: Authenticity checks are deterministic
4. **No time dependencies**: Decision based on explicit data, not timing

## Error Handling

### Transient Errors

- GitHub API rate limit → Retry with backoff OR fail with `GITHUB_API_ERROR`
- Network timeout → Retry OR fail with `GITHUB_API_ERROR`
- DB connection lost → Retry OR fail with `GITHUB_API_ERROR`

### Permanent Errors

- PR not found → Fail with `NO_PR_LINKED`
- PR not merged → Fail with `PR_NOT_MERGED`
- Auth failure → Fail with `GITHUB_API_ERROR`

All errors result in **explicit blocker code** (fail-closed).

## Testing

### Unit Tests

Required test cases:

1. **Success conditions:**
   - Deployments found → Observations recorded
   - No deployments found → Success with count 0
   - Multiple environments → All recorded

2. **Validation conditions:**
   - Authentic deployment → is_authentic = true
   - No status records → is_authentic = false
   - SHA mismatch → is_authentic = false

3. **PR FAIL conditions:**
   - No PR linked → Blocked with NO_PR_LINKED
   - PR not merged → Blocked with PR_NOT_MERGED

4. **Error conditions:**
   - GitHub API error → Blocked with GITHUB_API_ERROR

### Integration Tests

1. Full S6 observation flow with real GitHub API (mocked)
2. Idempotency: Multiple observations of same deployment
3. Authenticity validation: Real vs fake deployments
4. Multi-environment: Production + staging deployments

## Acceptance Criteria

1. ✅ **Deployment uniquely identifiable**
   - Deployment ID from GitHub is stored
   - Combination of (issue_id, github_deployment_id) is unique
   - Full deployment metadata captured

2. ✅ **No fake deployments**
   - Authenticity validation via GitHub API
   - Deployment must have status records
   - SHA must match merge commit
   - is_authentic flag set based on validation

3. ✅ **Read-only observation**
   - No GitHub API write operations
   - No deployment triggers
   - No status modifications
   - Pure observation only

4. ✅ **Environment resolution**
   - Environment name captured from deployment
   - Commit SHA captured and validated
   - Target URL captured when available

## Version History

- **v1.0** (2026-02-04): Initial S6 Deployment Observation implementation (E9.3-CTRL-05)

## Related Contracts

- [Step Executor S5 v1](./step-executor-s5.v1.md) - S5 Merge (precedes S6)
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic
- [Loop Timeline Events v1](./loop-timeline-events.v1.md) - Timeline event structure

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/step-executor-s6.v1.md` (this file)
- Service: `control-center/src/lib/github/deployment-observer.ts`
- Step Executor: `control-center/src/lib/loop/stepExecutors/s6-deployment-observe.ts`
- Database: `database/migrations/089_deployment_observations.sql`
- Tests: `control-center/__tests__/lib/loop/s6-deployment-observe.test.ts`
