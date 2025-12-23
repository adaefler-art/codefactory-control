# AFU9 Issues API Documentation

This API provides endpoints to manage AFU9 issues - list, create, update, activate, and handoff issues to GitHub.

## Base URL

```
/api/issues
```

## Endpoints

### 1. List Issues

List all AFU9 issues with optional filtering and sorting.

**Endpoint:** `GET /api/issues`

**Query Parameters:**
- `status` (optional): Filter by status (`CREATED`, `ACTIVE`, `BLOCKED`, `DONE`)
- `handoff_state` (optional): Filter by handoff state (`NOT_SENT`, `SENT`, `SYNCED`, `FAILED`)
- `label` (optional): Filter by label (exact match, single label)
- `q` (optional): Search query (searches in title and body)
- `sort` (optional): Sort field (`updatedAt`, `createdAt` - default: `updatedAt`)
- `order` (optional): Sort order (`asc`, `desc` - default: `desc`)
- `limit` (optional): Results per page (default: 100, max: 100)
- `offset` (optional): Pagination offset (default: 0)

**Example Request:**
```bash
GET /api/issues?status=ACTIVE&label=bug&q=authentication
```

**Example Response:**
```json
{
  "issues": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "title": "Fix authentication bug",
      "body": "Users unable to login...",
      "status": "ACTIVE",
      "labels": ["bug", "priority-p0"],
      "priority": "P0",
      "assignee": "john.doe",
      "source": "afu9",
      "handoff_state": "NOT_SENT",
      "github_issue_number": null,
      "github_url": null,
      "last_error": null,
      "created_at": "2023-12-23T10:00:00Z",
      "updated_at": "2023-12-23T12:00:00Z"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

### 2. Create Issue

Create a new AFU9 issue.

**Endpoint:** `POST /api/issues`

**Request Body:**
```json
{
  "title": "Fix authentication bug",
  "body": "Users unable to login after password reset",
  "labels": ["bug", "priority-p0"],
  "priority": "P0",
  "assignee": "john.doe",
  "status": "CREATED"
}
```

**Required Fields:**
- `title` (string): Issue title (max 500 characters)

**Optional Fields:**
- `body` (string): Issue description in markdown
- `labels` (string[]): Array of label strings
- `priority` (`P0`, `P1`, `P2`): Priority level
- `assignee` (string): Assigned user/agent
- `status` (`CREATED`, `ACTIVE`, `BLOCKED`, `DONE`): Initial status (default: `CREATED`)

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "title": "Fix authentication bug",
  "body": "Users unable to login after password reset",
  "status": "CREATED",
  "labels": ["bug", "priority-p0"],
  "priority": "P0",
  "assignee": "john.doe",
  "source": "afu9",
  "handoff_state": "NOT_SENT",
  "github_issue_number": null,
  "github_url": null,
  "last_error": null,
  "created_at": "2023-12-23T10:00:00Z",
  "updated_at": "2023-12-23T10:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid input (missing title, invalid status, etc.)
- `409 Conflict`: Single-Active constraint violation (trying to create/set ACTIVE when another issue is already ACTIVE)

### 3. Get Issue

Get details of a specific issue by ID.

**Endpoint:** `GET /api/issues/:id`

**URL Parameters:**
- `id` (UUID): Issue ID

**Example Request:**
```bash
GET /api/issues/123e4567-e89b-12d3-a456-426614174000
```

**Response (200 OK):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "title": "Fix authentication bug",
  "body": "Users unable to login...",
  "status": "ACTIVE",
  "labels": ["bug", "priority-p0"],
  "priority": "P0",
  "assignee": "john.doe",
  "source": "afu9",
  "handoff_state": "NOT_SENT",
  "github_issue_number": null,
  "github_url": null,
  "last_error": null,
  "created_at": "2023-12-23T10:00:00Z",
  "updated_at": "2023-12-23T12:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid UUID format
- `404 Not Found`: Issue not found

### 4. Update Issue

Update an existing issue.

**Endpoint:** `PATCH /api/issues/:id`

**URL Parameters:**
- `id` (UUID): Issue ID

**Request Body (all fields optional):**
```json
{
  "title": "Updated title",
  "body": "Updated description",
  "labels": ["bug", "fixed"],
  "status": "DONE",
  "priority": "P1",
  "assignee": "jane.doe"
}
```

**Response (200 OK):**
Returns the updated issue object.

**Error Responses:**
- `400 Bad Request`: Invalid input, no fields to update, invalid UUID
- `404 Not Found`: Issue not found
- `409 Conflict`: Single-Active constraint violation

### 5. Activate Issue

Activate an issue (set to ACTIVE status). Automatically deactivates any other active issue.

**Endpoint:** `POST /api/issues/:id/activate`

**URL Parameters:**
- `id` (UUID): Issue ID to activate

**Example Request:**
```bash
POST /api/issues/123e4567-e89b-12d3-a456-426614174000/activate
```

**Response (200 OK):**
```json
{
  "message": "Issue activated successfully",
  "issue": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Fix authentication bug",
    "status": "ACTIVE",
    ...
  },
  "deactivated": {
    "id": "prev-active-id",
    "title": "Previous active issue"
  }
}
```

**Behavior:**
- Sets the specified issue to `ACTIVE` status
- Automatically sets any other `ACTIVE` issue to `CREATED` status
- Only one issue can be `ACTIVE` at a time (Single-Active constraint)
- Leaves `DONE` and `BLOCKED` issues unchanged

**Error Responses:**
- `400 Bad Request`: Invalid UUID format
- `404 Not Found`: Issue not found
- `500 Internal Server Error`: Failed to activate issue

### 6. Handoff Issue to GitHub

Create a GitHub issue from an AFU9 issue.

**Endpoint:** `POST /api/issues/:id/handoff`

**URL Parameters:**
- `id` (UUID): Issue ID to hand off

**Example Request:**
```bash
POST /api/issues/123e4567-e89b-12d3-a456-426614174000/handoff
```

**Response (200 OK):**
```json
{
  "message": "Issue handed off to GitHub successfully",
  "issue": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Fix authentication bug",
    "handoff_state": "SYNCED",
    "github_issue_number": 42,
    "github_url": "https://github.com/owner/repo/issues/42",
    ...
  },
  "github_url": "https://github.com/owner/repo/issues/42",
  "github_issue_number": 42
}
```

**Behavior:**
- Creates a GitHub issue with the AFU9 issue's title, body, and labels
- Adds an idempotency marker (`AFU9-ISSUE:<id>`) to the GitHub issue body
- Updates `handoff_state` to `SYNCED`
- Sets `github_issue_number` and `github_url` on success
- Updates `handoff_state` to `FAILED` and sets `last_error` on failure
- Idempotent: Returns existing GitHub issue if already handed off

**Handoff Semantics:**
- **Unidirectional**: AFU9 → GitHub (one-way sync)
- **Idempotent**: Uses `AFU9-ISSUE:<id>` marker to prevent duplicate handoffs
- **State Tracking**: `handoff_state` tracks the handoff lifecycle

**Error Responses:**
- `400 Bad Request`: Invalid UUID format
- `404 Not Found`: Issue not found
- `500 Internal Server Error`: GitHub API error, handoff failure

## Status Values

### Issue Status
- `CREATED`: Issue created, not yet active
- `ACTIVE`: Issue is currently being worked on (only one allowed)
- `BLOCKED`: Issue is blocked, waiting on external dependency
- `DONE`: Issue is completed

### Handoff State
- `NOT_SENT`: Issue has not been sent to GitHub
- `SENT`: Handoff in progress
- `SYNCED`: Successfully synced to GitHub
- `FAILED`: Handoff failed (see `last_error`)

### Priority Levels
- `P0`: Highest priority (critical)
- `P1`: High priority
- `P2`: Normal priority

## Single-Active Constraint

AFU9 enforces a **Single-Active** constraint: only one issue can have `status=ACTIVE` at any time.

**Enforcement:**
- Creating/updating an issue to `ACTIVE` when another is already `ACTIVE` returns `409 Conflict`
- The `/activate` endpoint automatically deactivates other active issues
- Database-level trigger prevents violation

**Use Case:**
Ensures focused work on a single priority issue at a time.

## Error Codes

- `200 OK`: Success
- `201 Created`: Resource created successfully
- `400 Bad Request`: Invalid input, validation error
- `404 Not Found`: Resource not found
- `409 Conflict`: Single-Active constraint violation
- `500 Internal Server Error`: Database or GitHub API error

## Examples

### Create and Activate an Issue

```bash
# 1. Create issue
curl -X POST /api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Implement user authentication",
    "body": "Add JWT-based authentication",
    "labels": ["feature", "security"],
    "priority": "P0"
  }'

# Response: { "id": "abc-123", "status": "CREATED", ... }

# 2. Activate the issue
curl -X POST /api/issues/abc-123/activate

# Response: { "message": "Issue activated successfully", "issue": { "status": "ACTIVE", ... } }
```

### Handoff Issue to GitHub

```bash
# 1. Create issue
curl -X POST /api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix critical bug in payment flow",
    "body": "Users cannot complete checkout",
    "labels": ["bug", "critical"],
    "priority": "P0"
  }'

# Response: { "id": "xyz-789", ... }

# 2. Handoff to GitHub
curl -X POST /api/issues/xyz-789/handoff

# Response: {
#   "message": "Issue handed off to GitHub successfully",
#   "github_url": "https://github.com/owner/repo/issues/42",
#   "github_issue_number": 42
# }
```

### List and Filter Issues

```bash
# List all ACTIVE issues
curl /api/issues?status=ACTIVE

# Search for authentication-related issues
curl /api/issues?q=authentication

# List issues by label
curl /api/issues?label=bug

# List failed handoffs
curl /api/issues?handoff_state=FAILED
```

## Notes

- All dates are in ISO 8601 format (UTC)
- Issue IDs are UUIDs (v4)
- Labels are case-sensitive strings
- The `source` field is always `afu9` (enforced by database)
- GitHub integration requires `GITHUB_TOKEN` environment variable
