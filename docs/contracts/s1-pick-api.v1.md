# S1 Pick API Contract v1

**Contract ID:** `s1-pick-api.v1`  
**Schema Version:** `afu9.s1s3.pick.v1`  
**Status:** Active  
**Owner:** Control Center  
**Created:** 2026-02-03  
**Issue:** E9.2-CONTROL-01

## Overview

The S1 Pick API provides the **canonical endpoint for the UI to initiate the S1 (Pick Issue) transition**. This is the single allowed entry point for linking a GitHub issue to AFU-9, creating an AFU-9 issue record, and beginning the loop execution lifecycle.

## Purpose

The S1 Pick endpoint serves as the bridge between the UI and the Control layer, enabling:

1. **GitHub Issue → AFU-9 Issue**: Links an existing GitHub issue to the AFU-9 system
2. **Idempotent Creation**: Multiple picks of the same issue return the existing AFU-9 record
3. **S1 State Transition**: Creates issue in `CREATED` state, ready for loop execution
4. **Audit Trail**: Full timeline event logging for governance and debugging

## Endpoint

**POST** `/api/afu9/s1s3/issues/pick`

### Request

**Method:** `POST`

**Headers:**
- `Content-Type: application/json`
- Auth: Session cookies (`credentials: 'include'`)

**Body:**
```typescript
{
  repo: string;           // Format: "owner/repo"
  issueNumber: number;    // GitHub issue number
  owner?: string;         // AFU-9 owner (default: "afu9")
  canonicalId?: string;   // Optional canonical ID (e.g., "E89.6", "I811")
}
```

**Validation:**
- `repo` is required and must be in format `"owner/repo"`
- `issueNumber` is required and must be a positive integer
- `owner` defaults to `"afu9"` if not provided
- `canonicalId` is optional for tracking purposes

### Response

**Success (201 Created):**

```typescript
{
  issue: {
    id: string;                    // UUID
    public_id: string;             // Public identifier (e.g., "AFU9-123")
    repo_full_name: string;        // "owner/repo"
    github_issue_number: number;   // GitHub issue #
    github_issue_url: string;      // Full GitHub URL
    owner: string;                 // AFU-9 owner
    canonical_id: string | null;   // Canonical ID if provided
    status: "CREATED";             // Initial status
    created_at: string;            // ISO 8601 timestamp
    updated_at: string;            // ISO 8601 timestamp
  };
  run: {
    id: string;                    // UUID
    type: "S1_PICK_ISSUE";         // Run type
    issue_id: string;              // FK to issue.id
    request_id: string;            // Request UUID for tracing
    actor: string;                 // Actor who initiated
    status: "DONE";                // Run status
    created_at: string;            // ISO 8601 timestamp
    updated_at: string;            // ISO 8601 timestamp
  };
  step: {
    id: string;                    // UUID
    run_id: string;                // FK to run.id
    step_id: "S1";                 // Step identifier
    step_name: "Pick GitHub Issue"; // Human-readable name
    status: "SUCCEEDED";           // Step status
    evidence_refs: {               // Evidence JSON
      issue_url: string;
      issue_number: number;
      repo_full_name: string;
      afu9_issue_id: string;
      afu9_public_id: string;
      request_id: string;
    };
    created_at: string;            // ISO 8601 timestamp
  };
}
```

**Headers:**
- `Content-Type: application/json`

### Error Responses

All error responses follow this structure:

```typescript
{
  error: string;        // Error message
  details?: string;     // Additional details
  requestId: string;    // Request UUID for tracing
}
```

**Error Codes:**

| HTTP Status | Error | Description | Example Scenario |
|-------------|-------|-------------|------------------|
| 400 | `Missing required fields` | Request validation failed | Missing `repo` or `issueNumber` |
| 400 | `Invalid repo format` | Repo not in "owner/repo" format | Repo is "myrepo" instead of "owner/myrepo" |
| 400 | `Cannot pick pull request` | Issue is a PR, not an issue | GitHub issue #123 is actually a PR |
| 401 | `GitHub authentication failed` | GitHub App auth failed | Invalid installation or expired token |
| 403 | `Repository access denied` | Repo not in allowlist | Attempting to pick from non-allowed repo |
| 404 | `GitHub issue not found` | Issue doesn't exist on GitHub | Issue #9999 doesn't exist in the repo |
| 500 | `Failed to create AFU9 issue record` | Database error | Database constraint violation or connection error |
| 500 | `Failed to create run record` | Database error | Unable to persist run record |
| 500 | `Failed to create step event` | Database error | Timeline event creation failed |

## Behavior

### Idempotency

The pick endpoint is **fully idempotent** through database upsert:

- **Unique Key**: `(repo_full_name, github_issue_number)`
- **First Call**: Creates new AFU-9 issue record with status `CREATED`
- **Subsequent Calls**: Returns existing AFU-9 issue without modification
- **Run Records**: Each call creates a new run record (for audit trail)
- **Step Events**: Each call creates new step events (STARTED + SUCCEEDED)

**Multiple Pick Behavior:**
```
Pick #1: Creates issue AFU9-123, run R1, steps [S1-START, S1-SUCCESS]
Pick #2: Returns issue AFU9-123 (unchanged), run R2, steps [S1-START, S1-SUCCESS]
Pick #3: Returns issue AFU9-123 (unchanged), run R3, steps [S1-START, S1-SUCCESS]
```

### GitHub Validation

Before creating AFU-9 issue, the endpoint:

1. **Validates repo format**: Must be `"owner/repo"`
2. **Checks allowlist**: Repo must be in GitHub App installation allowlist
3. **Authenticates**: Creates authenticated GitHub client via GitHub App
4. **Fetches issue**: Verifies issue exists and is not a pull request
5. **Stores metadata**: Saves GitHub issue URL, title, state in AFU-9 record

### State Machine Integration

Pick is the **S1 transition** in the loop state machine:

- **Initial State**: None (issue doesn't exist in AFU-9)
- **Post-Pick State**: `CREATED` status
- **Next Available Step**: S2 (Spec Gate) via `/api/loop/issues/[issueId]/run-next-step`

The pick endpoint:
- ✅ Creates issue in `CREATED` state
- ✅ Does NOT execute S2 or any other loop step
- ✅ Returns immediately after S1 completion
- ✅ UI must call loop API separately to execute S2+

## Integration Flow

### UI → Pick → Loop Execution

```
1. User selects GitHub issue in UI
   ↓
2. UI calls POST /api/afu9/s1s3/issues/pick
   {repo: "owner/repo", issueNumber: 123}
   ↓
3. Pick endpoint:
   - Validates repo + issue
   - Creates AFU-9 issue (CREATED state)
   - Returns {issue, run, step}
   ↓
4. UI receives AFU-9 issue.id
   ↓
5. UI calls POST /api/loop/issues/[issueId]/run-next-step
   {mode: "execute"}
   ↓
6. Loop API:
   - Acquires lock
   - Executes S2 (Spec Gate)
   - Returns loop status
```

### Separation of Concerns

| Endpoint | Responsibility | State Change |
|----------|---------------|--------------|
| `/api/afu9/s1s3/issues/pick` | Create AFU-9 issue from GitHub issue | None → `CREATED` |
| `/api/loop/issues/[id]/run-next-step` | Execute next loop step | `CREATED` → `SPEC_READY`, etc. |

## Examples

### Example 1: Successful Pick (First Time)

**Request:**
```bash
POST /api/afu9/s1s3/issues/pick
Content-Type: application/json

{
  "repo": "adaefler-art/codefactory-control",
  "issueNumber": 42,
  "canonicalId": "E92.1"
}
```

**Response (201 Created):**
```json
{
  "issue": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "public_id": "AFU9-001",
    "repo_full_name": "adaefler-art/codefactory-control",
    "github_issue_number": 42,
    "github_issue_url": "https://github.com/adaefler-art/codefactory-control/issues/42",
    "owner": "afu9",
    "canonical_id": "E92.1",
    "status": "CREATED",
    "created_at": "2026-02-03T15:30:00.000Z",
    "updated_at": "2026-02-03T15:30:00.000Z"
  },
  "run": {
    "id": "223e4567-e89b-12d3-a456-426614174001",
    "type": "S1_PICK_ISSUE",
    "issue_id": "123e4567-e89b-12d3-a456-426614174000",
    "request_id": "323e4567-e89b-12d3-a456-426614174002",
    "actor": "afu9",
    "status": "DONE",
    "created_at": "2026-02-03T15:30:00.100Z",
    "updated_at": "2026-02-03T15:30:00.200Z"
  },
  "step": {
    "id": "423e4567-e89b-12d3-a456-426614174003",
    "run_id": "223e4567-e89b-12d3-a456-426614174001",
    "step_id": "S1",
    "step_name": "Pick GitHub Issue",
    "status": "SUCCEEDED",
    "evidence_refs": {
      "issue_url": "https://github.com/adaefler-art/codefactory-control/issues/42",
      "issue_number": 42,
      "repo_full_name": "adaefler-art/codefactory-control",
      "afu9_issue_id": "123e4567-e89b-12d3-a456-426614174000",
      "afu9_public_id": "AFU9-001",
      "request_id": "323e4567-e89b-12d3-a456-426614174002"
    },
    "created_at": "2026-02-03T15:30:00.150Z"
  }
}
```

### Example 2: Idempotent Pick (Same Issue)

**Request:**
```bash
POST /api/afu9/s1s3/issues/pick
Content-Type: application/json

{
  "repo": "adaefler-art/codefactory-control",
  "issueNumber": 42
}
```

**Response (201 Created):**
```json
{
  "issue": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "public_id": "AFU9-001",
    // ... same issue data as before
    "created_at": "2026-02-03T15:30:00.000Z",  // Original timestamp
    "updated_at": "2026-02-03T15:30:00.000Z"   // Unchanged
  },
  "run": {
    "id": "999e4567-e89b-12d3-a456-999999999999",  // New run ID
    "type": "S1_PICK_ISSUE",
    // ... new run record
  },
  "step": {
    "id": "888e4567-e89b-12d3-a456-888888888888",  // New step ID
    // ... new step record
  }
}
```

**Note:** Issue record is identical, but run and step are new for audit trail.

### Example 3: Error - Repo Not in Allowlist

**Request:**
```bash
POST /api/afu9/s1s3/issues/pick
Content-Type: application/json

{
  "repo": "some-org/forbidden-repo",
  "issueNumber": 1
}
```

**Response (403 Forbidden):**
```json
{
  "error": "Repository access denied",
  "details": "Repository some-org/forbidden-repo is not in the allowlist",
  "requestId": "req-123e4567-e89b-12d3-a456-426614174004"
}
```

### Example 4: Error - Issue is a Pull Request

**Request:**
```bash
POST /api/afu9/s1s3/issues/pick
Content-Type: application/json

{
  "repo": "adaefler-art/codefactory-control",
  "issueNumber": 100
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Cannot pick pull request",
  "details": "#100 is a pull request, not an issue",
  "requestId": "req-223e4567-e89b-12d3-a456-426614174005"
}
```

## UI Client Pattern

### React Component Example

```typescript
"use client";

import { useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";

interface PickResult {
  issue: {
    id: string;
    public_id: string;
    github_issue_url: string;
    status: string;
  };
  run: { id: string };
  step: { id: string };
}

export function usePickIssue() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickIssue = async (
    repo: string,
    issueNumber: number,
    canonicalId?: string
  ): Promise<PickResult | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.afu9.s1s3.pick, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo,
          issueNumber,
          owner: "afu9",
          canonicalId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || "Pick failed");
      }

      const data: PickResult = await response.json();
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { pickIssue, loading, error };
}
```

### Usage in Component

```typescript
function PickIssueButton({ repo, issueNumber }: { repo: string; issueNumber: number }) {
  const { pickIssue, loading, error } = usePickIssue();
  const router = useRouter();

  const handlePick = async () => {
    const result = await pickIssue(repo, issueNumber);
    if (result) {
      // Navigate to issue detail page
      router.push(`/issues/${result.issue.id}`);
    }
  };

  return (
    <div>
      <button onClick={handlePick} disabled={loading}>
        {loading ? "Picking..." : "Pick Issue"}
      </button>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

## Implementation

**Source Files:**
- **Route:** `control-center/app/api/afu9/s1s3/issues/pick/route.ts`
- **Schemas:** `control-center/src/lib/contracts/s1s3Flow.ts`
- **DB Functions:** `control-center/src/lib/db/s1s3Flow.ts`
- **API Routes:** `control-center/src/lib/api-routes.ts`

**Dependencies:**
- PostgreSQL database (s1s3_issues, s1s3_runs, s1s3_run_steps tables)
- GitHub App authentication (@/lib/github/auth-wrapper)
- Octokit for GitHub API calls

## Testing

**Test Coverage Required:**
- ✅ Successful pick (first time)
- ✅ Idempotent pick (same issue, multiple calls)
- ✅ Error: Missing required fields
- ✅ Error: Invalid repo format
- ✅ Error: Repo not in allowlist
- ✅ Error: GitHub issue not found
- ✅ Error: Issue is a pull request
- ✅ Timeline event creation
- ✅ Run record creation
- ✅ Step event creation

## Changelog

### v1.0 (2026-02-03) - E9.2-CONTROL-01
- Initial contract version
- POST `/api/afu9/s1s3/issues/pick` endpoint
- Request/response schemas
- Idempotency guarantees via database upsert
- Full error handling and validation
- UI client pattern documentation

## Related Contracts

- [Step Executor S1 v1](./step-executor-s1.v1.md) - S1 step execution logic
- [Loop API v1](./loop-api.v1.md) - Loop execution API for S2+ steps
- [Loop State Machine v1](./loop-state-machine.v1.md) - State transitions and rules
