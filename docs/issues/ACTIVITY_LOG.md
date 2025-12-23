# AFU9 Activity Log

## Overview

The AFU9 Activity Log provides a complete audit trail of all issue lifecycle events. Every change to an issue is automatically recorded in the `afu9_issue_events` table, creating a deterministic and traceable history.

## Purpose

The Activity Log serves several critical functions:

1. **Audit Trail** - Complete history of what happened and when
2. **Debugging** - Understand how an issue reached its current state
3. **Transparency** - See all actions taken by AFU9 and users
4. **Compliance** - Maintain records of all changes
5. **Determinism** - Reproducible history of system behavior

## Event Types

The Activity Log tracks these event types:

| Event Type | Description | When Triggered |
|------------|-------------|----------------|
| `CREATED` | Issue was created | On INSERT into afu9_issues |
| `STATUS_CHANGED` | Status field changed | When status changes (e.g., CREATED → ACTIVE) |
| `HANDOFF_STATE_CHANGED` | Handoff state changed | When handoff_state changes (e.g., NOT_SENT → SENT) |
| `GITHUB_SYNCED` | Issue synced to GitHub | When github_issue_number is first set |
| `ERROR_OCCURRED` | Error occurred | When last_error is set |
| `FIELD_UPDATED` | Other field updated | For non-tracked field changes (future use) |

## Event Schema

Each event record contains:

```typescript
interface ActivityEvent {
  id: string;                    // Unique event ID (UUID)
  issue_id: string;              // Reference to afu9_issues.id
  event_type: string;            // One of the event types above
  event_data: Record<string, unknown>; // Additional context (JSONB)
  
  // Status change tracking
  old_status: string | null;     // Previous status (if changed)
  new_status: string | null;     // New status (if changed)
  
  // Handoff state tracking
  old_handoff_state: string | null;  // Previous handoff state (if changed)
  new_handoff_state: string | null;  // New handoff state (if changed)
  
  // Audit fields
  created_at: string;            // Event timestamp
  created_by: string | null;     // User/agent who triggered (if known)
}
```

## Automatic Event Logging

Events are logged automatically via PostgreSQL triggers:

```sql
CREATE TRIGGER trg_log_afu9_issue_event
  AFTER INSERT OR UPDATE ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION log_afu9_issue_event();
```

**No manual logging required** - the database handles it automatically.

## Event Details

### CREATED Event

Logged when an issue is first created.

**Example event_data:**
```json
{
  "title": "Fix authentication bug",
  "priority": "P1",
  "assignee": "afu9"
}
```

**Fields:**
- `new_status`: Initial status (usually "CREATED")
- `new_handoff_state`: Initial handoff state (usually "NOT_SENT")

### STATUS_CHANGED Event

Logged when the status field changes.

**Example:**
- `old_status`: "CREATED"
- `new_status`: "ACTIVE"

**Common transitions:**
- CREATED → ACTIVE (issue activated)
- ACTIVE → DONE (issue completed)
- ACTIVE → BLOCKED (issue blocked)
- BLOCKED → CREATED (issue unblocked)

### HANDOFF_STATE_CHANGED Event

Logged when the handoff_state field changes.

**Example event_data:**
```json
{
  "github_issue_number": 123,
  "github_url": "https://github.com/org/repo/issues/123",
  "last_error": null
}
```

**Common transitions:**
- NOT_SENT → SENT (handoff initiated)
- SENT → SYNCED (handoff succeeded)
- SENT → FAILED (handoff failed)
- FAILED → SENT (retry)

### GITHUB_SYNCED Event

Logged when an issue is successfully synced to GitHub (github_issue_number is first set).

**Example event_data:**
```json
{
  "github_issue_number": 123,
  "github_url": "https://github.com/org/repo/issues/123"
}
```

### ERROR_OCCURRED Event

Logged when last_error field is set.

**Example event_data:**
```json
{
  "error": "GitHub API rate limit exceeded",
  "handoff_state": "FAILED"
}
```

## API Endpoints

### Get Activity Log for an Issue

```bash
GET /api/issues/{id}/events?limit=100
```

**Query Parameters:**
- `limit` (optional): Maximum events to return (default: 100, max: 500)

**Response:**
```json
{
  "events": [
    {
      "id": "event-uuid",
      "issue_id": "issue-uuid",
      "event_type": "STATUS_CHANGED",
      "event_data": {},
      "old_status": "CREATED",
      "new_status": "ACTIVE",
      "old_handoff_state": null,
      "new_handoff_state": null,
      "created_at": "2024-12-23T10:30:00Z",
      "created_by": null
    },
    {
      "id": "event-uuid-2",
      "issue_id": "issue-uuid",
      "event_type": "CREATED",
      "event_data": {
        "title": "Fix authentication bug",
        "priority": "P1"
      },
      "old_status": null,
      "new_status": "CREATED",
      "old_handoff_state": null,
      "new_handoff_state": "NOT_SENT",
      "created_at": "2024-12-23T10:00:00Z",
      "created_by": null
    }
  ],
  "total": 2,
  "limit": 100
}
```

Events are returned in **reverse chronological order** (newest first).

## Database Schema

### Table: `afu9_issue_events`

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
  created_by VARCHAR(255),
  
  CONSTRAINT chk_afu9_event_type CHECK (event_type IN (
    'CREATED',
    'STATUS_CHANGED',
    'HANDOFF_STATE_CHANGED',
    'FIELD_UPDATED',
    'GITHUB_SYNCED',
    'ERROR_OCCURRED'
  ))
);
```

### Indexes

```sql
CREATE INDEX idx_afu9_issue_events_issue_id ON afu9_issue_events(issue_id);
CREATE INDEX idx_afu9_issue_events_created_at ON afu9_issue_events(created_at DESC);
CREATE INDEX idx_afu9_issue_events_event_type ON afu9_issue_events(event_type);
CREATE INDEX idx_afu9_issue_events_issue_id_created_at ON afu9_issue_events(issue_id, created_at DESC);
```

These indexes optimize:
- Fetching all events for an issue
- Sorting by timestamp (newest first)
- Filtering by event type
- Combined queries

## UI Display

### Issue Detail Page

The Activity Log is displayed as a collapsible section at the bottom of the issue detail page.

**Features:**
- **Toggle** - Expand/collapse to show/hide events
- **Lazy Loading** - Events are only fetched when expanded
- **Color-Coded Badges** - Each event type has a distinct color
- **Formatted Details** - Events show relevant information based on type
- **Timestamps** - German locale format with date and time
- **Created By** - Shows who/what triggered the event (if known)

**Event Badge Colors:**
- CREATED: Blue
- STATUS_CHANGED: Purple
- HANDOFF_STATE_CHANGED: Yellow
- GITHUB_SYNCED: Green
- ERROR_OCCURRED: Red
- Other: Gray

### Example Activity Log Entry

```
[CREATED]
Status: CREATED | Handoff: NOT_SENT
23. Dez 2024, 10:00

[STATUS_CHANGED]
CREATED → ACTIVE
23. Dez 2024, 10:30

[GITHUB_SYNCED]
GitHub Issue #123
23. Dez 2024, 11:00
```

## TypeScript Usage

### Get Events for an Issue

```typescript
import { getIssueEvents } from './lib/db/afu9Issues';

const result = await getIssueEvents(pool, issueId, 100);

if (result.success) {
  const events = result.data;
  events.forEach(event => {
    console.log(`${event.event_type} at ${event.created_at}`);
  });
} else {
  console.error('Failed to get events:', result.error);
}
```

### Display in React Component

```typescript
const [events, setEvents] = useState<ActivityEvent[]>([]);

const fetchEvents = async () => {
  const response = await fetch(`/api/issues/${id}/events`);
  const data = await response.json();
  setEvents(data.events);
};

// Display
{events.map(event => (
  <div key={event.id}>
    <span>{event.event_type}</span>
    <span>{formatDate(event.created_at)}</span>
    <span>{formatEventDetails(event)}</span>
  </div>
))}
```

## Common Queries

### Get All Events for an Issue

```sql
SELECT * FROM afu9_issue_events
WHERE issue_id = 'issue-uuid'
ORDER BY created_at DESC;
```

### Get Recent Status Changes

```sql
SELECT issue_id, old_status, new_status, created_at
FROM afu9_issue_events
WHERE event_type = 'STATUS_CHANGED'
ORDER BY created_at DESC
LIMIT 10;
```

### Find All Activations

```sql
SELECT issue_id, created_at
FROM afu9_issue_events
WHERE event_type = 'STATUS_CHANGED'
  AND new_status = 'ACTIVE'
ORDER BY created_at DESC;
```

### Track Handoff Attempts

```sql
SELECT issue_id, old_handoff_state, new_handoff_state, event_data, created_at
FROM afu9_issue_events
WHERE event_type = 'HANDOFF_STATE_CHANGED'
ORDER BY created_at DESC;
```

### Find All Errors

```sql
SELECT issue_id, event_data->>'error' as error_message, created_at
FROM afu9_issue_events
WHERE event_type = 'ERROR_OCCURRED'
ORDER BY created_at DESC;
```

## Event Lifecycle Example

Typical sequence of events for an issue:

```
1. CREATED
   - Issue is created with status=CREATED, handoff_state=NOT_SENT

2. STATUS_CHANGED (CREATED → ACTIVE)
   - Issue is activated for work

3. HANDOFF_STATE_CHANGED (NOT_SENT → SENT)
   - Handoff to GitHub is initiated

4. HANDOFF_STATE_CHANGED (SENT → SYNCED)
   - Handoff succeeds

5. GITHUB_SYNCED
   - GitHub issue number is recorded

6. STATUS_CHANGED (ACTIVE → DONE)
   - Work is completed
```

If handoff fails:

```
3. HANDOFF_STATE_CHANGED (NOT_SENT → SENT)
4. ERROR_OCCURRED
   - Handoff fails with error
5. HANDOFF_STATE_CHANGED (SENT → FAILED)
   - State updated to reflect failure
```

## Retention and Cleanup

**Retention:** Events are kept indefinitely by default.

**Cascade Delete:** If an issue is deleted, all its events are automatically deleted:
```sql
REFERENCES afu9_issues(id) ON DELETE CASCADE
```

**Manual Cleanup (if needed):**
```sql
-- Delete events older than 90 days for DONE issues
DELETE FROM afu9_issue_events
WHERE issue_id IN (
  SELECT id FROM afu9_issues WHERE status = 'DONE'
)
AND created_at < NOW() - INTERVAL '90 days';
```

## Best Practices

1. **Never modify events** - They are an audit trail, treat as immutable
2. **Use for debugging** - Check events when issue state is unexpected
3. **Monitor for patterns** - Track how long issues stay in each status
4. **Alert on errors** - Watch for ERROR_OCCURRED events
5. **Analyze handoff success rate** - Track SYNCED vs FAILED events

## Integration with Single-Issue Mode

Activity Log is critical for tracking Single-Issue Mode enforcement:

**Activation Pattern:**
```
Issue A:
  - STATUS_CHANGED: ACTIVE → CREATED (deactivated)

Issue B:
  - STATUS_CHANGED: CREATED → ACTIVE (activated)
```

**Query to find activation conflicts:**
```sql
-- Find issues that were deactivated (ACTIVE → CREATED)
SELECT issue_id, old_status, new_status, created_at
FROM afu9_issue_events
WHERE event_type = 'STATUS_CHANGED'
  AND old_status = 'ACTIVE'
  AND new_status = 'CREATED'
ORDER BY created_at DESC;
```

## Related Documentation

- [AFU9 Issue Model](./AFU9_ISSUE_MODEL.md) - Complete issue data model
- [Single-Issue Mode](./SINGLE_ISSUE_MODE.md) - Single-Active constraint enforcement
- [Database Contract Pattern](../../DB_CONTRACT_PATTERN.md) - Contract architecture
- [Migration 014](../../../database/migrations/014_afu9_issues.sql) - Schema definition

## Summary

The AFU9 Activity Log provides:
- ✅ Automatic event logging via database triggers
- ✅ Complete audit trail of all changes
- ✅ API endpoint for retrieving events
- ✅ UI display in issue detail page
- ✅ Indexed for fast queries
- ✅ Integration with Single-Issue Mode tracking

Every action is logged, creating a deterministic and traceable history.
