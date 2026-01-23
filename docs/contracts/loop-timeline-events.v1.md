# Loop Timeline Events Contract v1

**Contract ID:** `loop-timeline-events.v1`  
**Schema Version:** `loop.events.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.1-CTRL-8  
**Created:** 2026-01-23

## Overview

The Loop Timeline Events contract defines standardized events for tracking loop execution lifecycle. Events provide full traceability of what happened during each run, enabling audit trails, debugging, and monitoring.

## Event Types

Standard events emitted during loop execution:

| Event Type | Description | Required Fields | Optional Fields |
|------------|-------------|----------------|-----------------|
| `loop_run_started` | Loop execution started | runId, step, stateBefore, requestId | - |
| `loop_run_finished` | Loop execution completed successfully | runId, step, stateBefore, stateAfter, requestId | - |
| `loop_step_s1_completed` | Step S1 (Pick Issue) completed | runId, step, stateBefore, stateAfter, requestId | - |
| `loop_step_s2_spec_ready` | Step S2 (Spec Ready) completed | runId, step, stateBefore, stateAfter, requestId | - |
| `loop_step_s3_implement_prep` | Step S3 (Implement Prep) completed | runId, step, stateBefore, stateAfter, requestId | - |
| `loop_run_blocked` | Loop execution blocked | runId, step, stateBefore, requestId, blockerCode | - |
| `loop_run_failed` | Loop execution failed | runId, step, stateBefore, requestId | - |

## Payload Schema

All events follow a strict allowlist schema with no secrets:

```typescript
interface LoopEventPayload {
  runId: string;           // UUID of the loop run
  step: string;            // Step identifier (e.g., "S1_PICK_ISSUE")
  stateBefore: string;     // Issue state before execution
  stateAfter?: string;     // Issue state after execution (for completion events)
  blockerCode?: string;    // Blocker code (for blocked events)
  requestId: string;       // Request ID for traceability
}
```

### Field Constraints

- **runId**: UUID format, references `loop_runs.id`
- **step**: Must be a valid LoopStep enum value
- **stateBefore**: Issue status string (e.g., "CREATED", "SPEC_READY")
- **stateAfter**: Issue status string (optional, only for completion events)
- **blockerCode**: BlockerCode enum value (optional, only for blocked events)
- **requestId**: UUID format for request correlation

### Redaction Policy

**Prohibited Data:**
- API keys, tokens, or credentials
- GitHub PAT tokens
- AWS credentials
- User passwords or secrets
- Sensitive business data
- PII beyond actor identifiers

**Allowed Data:**
- Run identifiers (UUIDs)
- Step names and status
- Blocker codes (enumerated values only)
- Request IDs
- Issue IDs
- State transitions
- Actor identifiers (email/username)

## Database Schema

Events are persisted in the `loop_events` table:

```sql
CREATE TABLE loop_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT fk_loop_events_run FOREIGN KEY (run_id) 
    REFERENCES loop_runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_loop_events_issue_id ON loop_events(issue_id, occurred_at DESC);
CREATE INDEX idx_loop_events_run_id ON loop_events(run_id, occurred_at);
CREATE INDEX idx_loop_events_type ON loop_events(event_type);
```

## Acceptance Criteria

1. **Minimum 2 Events Per Run**
   - Every run must emit at least:
     - 1x `loop_run_started` (at the beginning)
     - 1x completion event (`loop_run_finished`, `loop_run_blocked`, or `loop_run_failed`)

2. **Events Queryable by Issue ID**
   - API endpoint: `GET /api/loop/issues/[issueId]/events`
   - Returns events in reverse chronological order
   - Supports pagination

3. **No Secrets**
   - All event payloads must pass redaction validation
   - Payloads must conform to allowlist schema

## Event Emission Flow

### Successful Run

```
1. loop_run_started       (runId, step: "S1_PICK_ISSUE", stateBefore: "CREATED", requestId)
2. loop_step_s1_completed (runId, step: "S1_PICK_ISSUE", stateBefore: "CREATED", stateAfter: "CREATED", requestId)
3. loop_run_finished      (runId, step: "S1_PICK_ISSUE", stateBefore: "CREATED", stateAfter: "CREATED", requestId)
```

### Blocked Run

```
1. loop_run_started  (runId, step: "S2_SPEC_READY", stateBefore: "CREATED", requestId)
2. loop_run_blocked  (runId, step: "S2_SPEC_READY", stateBefore: "CREATED", blockerCode: "NO_DRAFT", requestId)
```

### Failed Run

```
1. loop_run_started (runId, step: "S1_PICK_ISSUE", stateBefore: "CREATED", requestId)
2. loop_run_failed  (runId, step: "S1_PICK_ISSUE", stateBefore: "CREATED", requestId)
```

## API: Query Events

**Endpoint:** `GET /api/loop/issues/[issueId]/events`

**Query Parameters:**
- `limit` (optional): Number of events to return (default: 50, max: 200)
- `offset` (optional): Pagination offset (default: 0)

**Response:**

```typescript
{
  schemaVersion: "loop.events.v1",
  issueId: string,
  events: LoopEvent[],
  total: number,
  limit: number,
  offset: number
}
```

**LoopEvent Schema:**

```typescript
interface LoopEvent {
  id: string;
  issueId: string;
  runId: string;
  eventType: string;
  eventData: LoopEventPayload;
  occurredAt: string;  // ISO 8601 datetime
}
```

## Implementation

**Source of Truth:**
- Contract: `docs/contracts/loop-timeline-events.v1.md` (this file)
- Event Store: `control-center/src/lib/loop/eventStore.ts`
- Database Migration: `database/migrations/085_loop_events.sql`
- API Route: `control-center/app/api/loop/issues/[issueId]/events/route.ts`

**Integration Points:**
- Loop execution engine (`control-center/src/lib/loop/execution.ts`)
- Step executors (`control-center/src/lib/loop/stepExecutors/*.ts`)

## Testing

**Acceptance Tests:**
1. Run creates `loop_run_started` event
2. Successful run creates `loop_run_finished` event
3. Blocked run creates `loop_run_blocked` event with blockerCode
4. Failed run creates `loop_run_failed` event
5. Step completion creates step-specific event
6. Events are queryable by issueId
7. Events contain only allowlisted fields
8. No secrets in event payloads

## Version History

- **v1.0** (2026-01-23): Initial implementation with standard events and payload allowlist (E9.1-CTRL-8)

## Related Contracts

- [Loop API v1](./loop-api.v1.md) - Loop execution API
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic
