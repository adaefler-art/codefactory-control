# E83.2 Implementation: assign_copilot_to_issue Tool

**Epic E83: GH Workflow Orchestrator**

## Overview

The `assign_copilot_to_issue` tool provides a deterministic, idempotent way to assign GitHub Copilot (or a configured user) to GitHub issues with minimal clicks. This is a key component of the GitHub Workflow Orchestrator that enables automated issue assignment while maintaining full audit trails and policy compliance.

## API Endpoint

```
POST /api/github/issues/{issueNumber}/assign-copilot
```

## Request

### Path Parameters
- `issueNumber` (integer, required): The GitHub issue number to assign

### Request Body
```json
{
  "owner": "string",        // Required: GitHub repository owner
  "repo": "string",         // Required: GitHub repository name
  "requestId": "string"     // Optional: Custom request ID for tracking
}
```

### Example Request
```bash
curl -X POST http://localhost:3000/api/github/issues/123/assign-copilot \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "requestId": "custom-request-id"
  }'
```

## Response

### Success Response (200 OK)

```json
{
  "status": "ASSIGNED" | "NOOP",
  "assignees": ["copilot"],
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "lawbookHash": "sha256:abc123..."
}
```

**Fields:**
- `status`: 
  - `"ASSIGNED"` - Copilot was successfully assigned to the issue
  - `"NOOP"` - Copilot was already assigned (idempotent behavior)
- `assignees`: Array of current assignees on the issue after the operation
- `requestId`: Unique identifier for this request (generated or provided)
- `lawbookHash`: Hash of the active lawbook at the time of execution

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Invalid request body",
  "details": "Request body must be valid JSON"
}
```

```json
{
  "error": "Missing required fields",
  "details": "owner and repo are required"
}
```

```json
{
  "error": "Invalid issue number",
  "details": "Issue number must be a positive integer"
}
```

#### 403 Forbidden
```json
{
  "error": "Action not allowed by registry",
  "details": "Action \"assign_issue\" is disabled in registry",
  "repository": "owner/repo",
  "actionType": "assign_issue",
  "validationErrors": ["Action not enabled in registry"]
}
```

#### 404 Not Found
```json
{
  "error": "Repository not found in registry",
  "details": "No active registry found for repository owner/repo",
  "repository": "owner/repo"
}
```

```json
{
  "error": "Issue not found",
  "details": "Issue #999 not found in owner/repo",
  "repository": "owner/repo",
  "issueNumber": 999
}
```

#### 409 Conflict
```json
{
  "error": "Production environment blocked",
  "details": "Production write operations are disabled. Use staging environment.",
  "environment": "production"
}
```

#### 500 Internal Server Error
```json
{
  "error": "No active lawbook found",
  "details": "System is not configured with an active lawbook"
}
```

## Features

### 1. Idempotency

The endpoint is fully idempotent. If the configured assignee is already assigned to the issue, the operation returns `status: "NOOP"` without making any changes. This ensures safe retries and prevents duplicate assignments.

**Example Flow:**
1. First call: `status: "ASSIGNED"`, assignees: `["copilot"]`
2. Second call: `status: "NOOP"`, assignees: `["copilot"]` (unchanged)

### 2. Registry-Based Authorization (E83.1)

The endpoint validates all requests against the Repository Actions Registry. The action must be explicitly allowed in the registry for the target repository.

**Required Registry Actions:**
- `assign_copilot` (specific)
- OR `assign_issue` (generic fallback)

**Example Registry Configuration:**
```json
{
  "allowedActions": [
    {
      "actionType": "assign_copilot",
      "enabled": true,
      "preconditions": [],
      "requireEvidence": true,
      "description": "Assign GitHub Copilot to an issue"
    }
  ]
}
```

### 3. Environment-Based Guardrails

The endpoint respects environment controls:

- **Production**: Blocked by default (returns 409) unless `ENABLE_PROD=true`
- **Staging**: Fully enabled
- **Development**: Fully enabled

Environment detection hierarchy:
1. `NODE_ENV` environment variable
2. Hostname pattern (e.g., `*.afu9.cloud` → production, `stage.afu9.cloud` → staging)
3. Default: staging (fail-safe)

### 4. Comprehensive Audit Trail

Every assignment operation is logged to the `registry_action_audit` table with:

- Registry ID and version
- Action type (`assign_issue` or `assign_copilot`)
- Action status (`allowed`)
- Repository and issue number
- Validation result (full details)
- Request ID (for correlation)
- Lawbook hash (for compliance tracking)
- Timestamp and executor

**Audit Record Example:**
```sql
INSERT INTO registry_action_audit (
  registry_id,
  registry_version,
  action_type,
  action_status,
  repository,
  resource_type,
  resource_number,
  validation_result,
  executed_by,
  evidence_id
) VALUES (
  'codefactory-control-default',
  '1.0.0',
  'assign_issue',
  'allowed',
  'owner/repo',
  'issue',
  123,
  '{"allowed":true,"actionType":"assign_issue",...}',
  'api',
  '550e8400-e29b-41d4-a716-446655440000'
);
```

### 5. Configurable Assignee

The assignee is configured via environment variable:

```bash
GITHUB_COPILOT_USERNAME=copilot  # Default: 'copilot'
```

This ensures only authorized users can be assigned (no arbitrary usernames from API requests).

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GITHUB_COPILOT_USERNAME` | No | `copilot` | Username to assign to issues |
| `ENABLE_PROD` | No | `false` | Enable production environment write operations |
| `NODE_ENV` | No | - | Environment mode (development/staging/production) |

### Registry Setup

Ensure the target repository has an active registry with the required action:

```typescript
import { getRepoActionsRegistryService } from '@/lib/repo-actions-registry-service';

const service = getRepoActionsRegistryService();

await service.createRegistry({
  version: '1.0.0',
  registryId: 'my-repo-v1',
  repository: 'owner/repo',
  allowedActions: [
    {
      actionType: 'assign_copilot',
      enabled: true,
      preconditions: [],
      requireEvidence: true,
    },
  ],
  createdAt: new Date().toISOString(),
  createdBy: 'admin',
  failClosed: true,
});
```

## Testing

### Unit Tests

Run the comprehensive test suite:

```bash
cd control-center
npx jest __tests__/api/github-assign-copilot.test.ts
```

**Test Coverage:**
- ✓ Successful assignment (ASSIGNED)
- ✓ Idempotent behavior (NOOP)
- ✓ Invalid request body (400)
- ✓ Missing required fields (400)
- ✓ Invalid issue number (400)
- ✓ Production blocked (409)
- ✓ Repository not in registry (404)
- ✓ Action not allowed (403)
- ✓ Issue not found (404)

### Integration Testing

Use the PowerShell verification script:

```powershell
# Staging environment
pwsh scripts/verify-assign-copilot.ps1 `
  -BaseUrl "https://control-center.stage.afu9.cloud" `
  -IssueNumber 123 `
  -Owner "adaefler-art" `
  -Repo "codefactory-control"

# Local development
pwsh scripts/verify-assign-copilot.ps1 `
  -BaseUrl "http://localhost:3000" `
  -IssueNumber 123
```

The script validates:
1. First call assigns successfully (ASSIGNED)
2. Second call is idempotent (NOOP)
3. Assignees remain unchanged
4. lawbookHash is present
5. Invalid issue returns 404
6. Missing fields return 400

## Security Considerations

### 1. Fail-Closed Registry
If no registry exists for a repository, all requests are **denied by default** (404).

### 2. Production Blocking
Production environment is **blocked by default** unless explicitly enabled via `ENABLE_PROD=true`.

### 3. No Arbitrary Assignments
The assignee is **configured server-side**, not user-supplied. This prevents unauthorized assignments.

### 4. Audit Trail
All operations are **logged to append-only audit table** for forensic analysis.

### 5. GitHub App Authentication
Uses GitHub App authentication (not personal tokens) with proper scoping and rate limiting.

## Error Handling

The endpoint uses structured error responses with:
- Clear error messages
- Detailed descriptions
- Relevant context (repository, issue number, etc.)
- Appropriate HTTP status codes

All errors are logged with request correlation IDs for troubleshooting.

## Dependencies

- **E83.1**: Repository Actions Registry (required)
- **E79.1**: Lawbook versioning (required for lawbookHash)
- **Database**: PostgreSQL with `registry_action_audit` table
- **GitHub App**: Authenticated Octokit client with repo access

## Future Enhancements

1. **Batch Assignment**: Assign multiple issues in one request
2. **Custom Assignee Selection**: Allow selecting from a predefined list
3. **Assignment Rules**: Auto-assign based on labels, milestones, etc.
4. **Webhook Integration**: Auto-assign on issue creation
5. **Metrics Dashboard**: Track assignment patterns and success rates

## References

- Issue: I832 (E83.2) - Tool `assign_copilot_to_issue`
- Epic: E83 - GH Workflow Orchestrator
- Related: E83.1 - Repository Actions Registry
- Related: E79.1 - Lawbook Versioning

## Changelog

### v1.0.0 (2026-01-12)
- Initial implementation
- Idempotency support
- Registry-based authorization
- Environment-based guardrails
- Comprehensive audit logging
- PowerShell verification script
- Full test coverage (9/9 tests passing)
