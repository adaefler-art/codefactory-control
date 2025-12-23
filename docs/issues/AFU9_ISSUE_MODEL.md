# AFU9 Issue Domain Model

This document describes the canonical AFU9 issue data model with persistence, GitHub handoff state management, and Single-Issue-Mode enforcement.

## Overview

The AFU9 Issue Domain Model provides a structured way to track issues internally within AFU9 before (and after) they are handed off to GitHub. This model supports the autonomous fabrication workflow by maintaining issue state, handoff status, and event history.

## Data Model

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes (auto) | Unique identifier for the issue |
| `title` | string(500) | Yes | Issue title |
| `body` | text | No | Issue body in markdown format |
| `status` | enum | Yes | Current workflow status (default: `CREATED`) |
| `labels` | string[] | No | Array of label strings |
| `priority` | enum | No | Priority level: `P0`, `P1`, or `P2` |
| `assignee` | string(255) | No | Assigned user or agent |
| `source` | string(50) | Yes | Source system (always `afu9`) |
| `created_at` | timestamp | Yes (auto) | Creation timestamp |
| `updated_at` | timestamp | Yes (auto) | Last update timestamp |

### Handoff State Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `handoff_state` | enum | Yes | GitHub handoff status (default: `NOT_SENT`) |
| `github_issue_number` | integer | No | GitHub issue number after successful handoff |
| `github_url` | string(500) | No | Full GitHub issue URL |
| `last_error` | text | No | Last error message from handoff or processing |

## Status Model

The `status` field tracks the issue through its lifecycle within AFU9:

| Status | Description | Terminal? |
|--------|-------------|-----------|
| `CREATED` | Issue created but not yet active | No |
| `ACTIVE` | Issue is currently being worked on | No |
| `BLOCKED` | Issue is blocked and cannot proceed | No |
| `DONE` | Issue is completed | Yes |

### Status Transitions

```
CREATED → ACTIVE → DONE
    ↓       ↓
  BLOCKED → BLOCKED
    ↓       ↓
  ACTIVE  CREATED
```

Valid transitions:
- `CREATED` → `ACTIVE`, `BLOCKED`, `DONE`
- `ACTIVE` → `BLOCKED`, `DONE`
- `BLOCKED` → `CREATED`, `ACTIVE`, `DONE`
- `DONE` (terminal, no further transitions)

## HandoffState Model

The `handoff_state` field tracks the synchronization status with GitHub:

| HandoffState | Description |
|--------------|-------------|
| `NOT_SENT` | Issue has not been sent to GitHub yet |
| `SENT` | Issue has been sent to GitHub, awaiting confirmation |
| `SYNCED` | Issue is successfully synchronized with GitHub |
| `FAILED` | Handoff to GitHub failed (see `last_error`) |

### HandoffState Lifecycle

```
NOT_SENT → SENT → SYNCED
             ↓
           FAILED → SENT (retry)
```

**Typical Flow:**
1. Issue is created with `handoff_state = NOT_SENT`
2. When ready, AFU9 sends issue to GitHub → `handoff_state = SENT`
3. On success: `handoff_state = SYNCED`, `github_issue_number` and `github_url` are set
4. On failure: `handoff_state = FAILED`, `last_error` contains error details

## Single-Issue-Mode Enforcement

**Critical Constraint:** Only **ONE** issue can have `status = ACTIVE` at any given time.

This is enforced at multiple levels:

### 1. Database Trigger
A PostgreSQL trigger (`trg_enforce_single_active_issue`) prevents inserting or updating an issue to `ACTIVE` if another issue is already `ACTIVE`.

```sql
-- Automatically enforced by trigger
INSERT INTO afu9_issues (title, status) VALUES ('Issue 1', 'ACTIVE'); -- OK
INSERT INTO afu9_issues (title, status) VALUES ('Issue 2', 'ACTIVE'); -- ERROR!
```

**Error message example:**
```
Single-Active constraint violation: Only one issue can have status=ACTIVE. 
Found 1 other active issue(s). Current active issues: 
[abc-123:"Issue 1"]
```

### 2. Service Layer Check
The service layer (`src/lib/db/afu9Issues.ts`) includes `canSetIssueActive()` function that checks before creating or updating issues:

```typescript
// Before creating with ACTIVE status
const canSetActive = await canSetIssueActive(pool, null);
if (!canSetActive.success) {
  return { success: false, error: canSetActive.error };
}

// Before updating to ACTIVE status
const canSetActive = await canSetIssueActive(pool, issueId);
if (!canSetActive.success) {
  return { success: false, error: canSetActive.error };
}
```

### 3. Recommended Workflow

To safely activate an issue:

1. **Query current active issue:**
   ```typescript
   const activeResult = await getActiveIssue(pool);
   ```

2. **If active issue exists, set it to BLOCKED or DONE:**
   ```typescript
   if (activeResult.data) {
     await updateAfu9Issue(pool, activeResult.data.id, {
       status: Afu9IssueStatus.BLOCKED
     });
   }
   ```

3. **Activate new issue:**
   ```typescript
   await updateAfu9Issue(pool, newIssueId, {
     status: Afu9IssueStatus.ACTIVE
   });
   ```

## Event Logging

All issue lifecycle events are automatically logged to the `afu9_issue_events` table:

| Event Type | When Triggered |
|------------|----------------|
| `CREATED` | Issue is created |
| `STATUS_CHANGED` | Status changes |
| `HANDOFF_STATE_CHANGED` | Handoff state changes |
| `GITHUB_SYNCED` | Issue is synced to GitHub (github_issue_number set) |
| `ERROR_OCCURRED` | Error occurs (last_error set) |

Events include:
- `issue_id` - Reference to the issue
- `event_type` - Type of event
- `event_data` - Contextual data (JSONB)
- `old_status` / `new_status` - For status changes
- `old_handoff_state` / `new_handoff_state` - For handoff changes
- `created_at` - Event timestamp
- `created_by` - Who/what triggered the event

## Priority Levels

Issues can optionally be assigned a priority:

| Priority | Meaning | Use Case |
|----------|---------|----------|
| `P0` | Critical | Blocking issues, production outages |
| `P1` | High | Important features, significant bugs |
| `P2` | Normal | Regular features, minor bugs |
| (null) | Not set | Default, not prioritized |

## Database Schema

### Primary Table: `afu9_issues`

```sql
CREATE TABLE afu9_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  body TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
  labels TEXT[] DEFAULT '{}',
  priority VARCHAR(10),
  assignee VARCHAR(255),
  source VARCHAR(50) NOT NULL DEFAULT 'afu9',
  handoff_state VARCHAR(50) NOT NULL DEFAULT 'NOT_SENT',
  github_issue_number INTEGER,
  github_url VARCHAR(500),
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Event History: `afu9_issue_events`

```sql
CREATE TABLE afu9_issue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB DEFAULT '{}',
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  old_handoff_state VARCHAR(50),
  new_handoff_state VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255)
);
```

## Helper Views

### `afu9_active_issues`
Shows all non-DONE issues with age metrics:
```sql
SELECT * FROM afu9_active_issues;
```

### `afu9_pending_handoff`
Shows issues awaiting GitHub handoff or with failed handoff:
```sql
SELECT * FROM afu9_pending_handoff;
```

### `afu9_issue_stats`
Aggregated statistics by status:
```sql
SELECT * FROM afu9_issue_stats;
```

## TypeScript API

### Contract Types

```typescript
import {
  Afu9IssueInput,
  Afu9IssueRow,
  Afu9IssueStatus,
  Afu9HandoffState,
  Afu9IssuePriority,
  validateAfu9IssueInput,
  sanitizeAfu9IssueInput,
} from './lib/contracts/afu9Issue';
```

### Database Operations

```typescript
import {
  createAfu9Issue,
  getAfu9IssueById,
  getActiveIssue,
  listAfu9Issues,
  updateAfu9Issue,
  deleteAfu9Issue,
  canSetIssueActive,
  countIssuesByStatus,
} from './lib/db/afu9Issues';
```

### Example Usage

```typescript
// Create a new issue
const input: Afu9IssueInput = {
  title: 'Implement feature X',
  body: 'Description of feature X',
  priority: Afu9IssuePriority.P1,
  labels: ['feature', 'backend'],
};

const validation = validateAfu9IssueInput(input);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  return;
}

const result = await createAfu9Issue(pool, input);
if (!result.success) {
  console.error('Create failed:', result.error);
  return;
}

console.log('Created issue:', result.data);

// Get the active issue
const activeResult = await getActiveIssue(pool);
if (activeResult.data) {
  console.log('Active issue:', activeResult.data);
} else {
  console.log('No active issue');
}

// Update issue status
await updateAfu9Issue(pool, result.data.id, {
  status: Afu9IssueStatus.ACTIVE,
});

// Update handoff state after GitHub sync
await updateAfu9Issue(pool, result.data.id, {
  handoff_state: Afu9HandoffState.SYNCED,
  github_issue_number: 123,
  github_url: 'https://github.com/org/repo/issues/123',
});
```

## Migration

The database schema is defined in:
```
database/migrations/014_afu9_issues.sql
```

Run the migration:
```bash
./scripts/deploy-migrations.sh 014_afu9_issues.sql
```

## Testing

Tests are located in:
- `control-center/__tests__/lib/contracts/afu9Issue.test.ts` - Contract validation
- `control-center/__tests__/lib/db/afu9Issues.test.ts` - Database operations

Run tests:
```bash
npm test
```

## Single-Issue-Mode: Why?

AFU9 is designed to work on **one issue at a time** to:

1. **Focus resources** - All compute/LLM resources focus on one task
2. **Prevent conflicts** - Avoid merge conflicts from parallel work
3. **Clear state** - Always know what AFU9 is working on
4. **Simpler debugging** - Easier to trace what went wrong
5. **Quality over quantity** - Deep focus produces better results

When you need to work on a new issue, you must either:
- Complete the current issue (`status = DONE`)
- Block the current issue (`status = BLOCKED`) 
- Then activate the new issue (`status = ACTIVE`)

## Related Documentation

- [DB Contract Pattern](../../DB_CONTRACT_PATTERN.md) - How contracts work
- [Database README](../../../database/README.md) - Database overview
- [Issue State Machine](../../v04/ISSUE_STATE_MACHINE.md) - State transitions (different system)
