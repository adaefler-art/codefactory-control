# E88.1: Manual Touchpoints Counter

## Overview

The Manual Touchpoints Counter provides transparent measurement of human steering required by AFU-9. It tracks explicit manual interventions across release cycles and issues to support AVS (Automation Value Score) calculation, D2D (Deploy-to-Deploy) analysis, and identification of opportunities to reduce Human Steering Hours.

## Touchpoint Types

Four types of manual interventions are tracked:

### 1. ASSIGN
**Definition**: Assigning an issue to GitHub Copilot  
**When Recorded**: When `POST /api/github/issues/{issueNumber}/assign-copilot` successfully assigns Copilot  
**Example**: User clicks "Assign to Copilot" button in UI

### 2. REVIEW
**Definition**: Requesting or providing code review feedback  
**When Recorded**: When `POST /api/github/prs/{prNumber}/request-review-and-wait` is called with reviewers  
**Example**: User requests review from team members

### 3. MERGE_APPROVAL
**Definition**: Explicit approval to merge a PR (typing "YES MERGE")  
**When Recorded**: When `POST /api/approvals` receives an approved decision for merge action type  
**Example**: User types "YES MERGE" in approval dialog

### 4. DEBUG_INTERVENTION
**Definition**: Manual debugging or job rerun action  
**When Recorded**: When `POST /api/github/prs/{prNumber}/checks/rerun` successfully reruns failed jobs  
**Example**: User manually reruns failed CI checks

## Touchpoint Sources

Touchpoints are classified by their origin:

- **UI**: Manual action via Control Center UI
- **INTENT**: Action via INTENT session
- **GH**: Direct GitHub action
- **API**: Direct API call

## Database Schema

### Table: `manual_touchpoints`

```sql
CREATE TABLE manual_touchpoints (
  id SERIAL PRIMARY KEY,
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  
  -- Context identifiers
  cycle_id VARCHAR(255),
  issue_id UUID REFERENCES afu9_issues(id),
  gh_issue_number INTEGER,
  pr_number INTEGER,
  session_id VARCHAR(255),
  
  -- Classification
  type VARCHAR(50) NOT NULL CHECK (type IN ('ASSIGN', 'REVIEW', 'MERGE_APPROVAL', 'DEBUG_INTERVENTION')),
  source VARCHAR(50) NOT NULL CHECK (source IN ('UI', 'INTENT', 'GH', 'API')),
  
  -- Actor and tracking
  actor VARCHAR(255) NOT NULL,
  request_id VARCHAR(255) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Key Features**:
- **Append-only**: No updates or deletes
- **Idempotent**: `idempotency_key` prevents double-counting
- **Indexed**: Efficient queries by cycle, issue, PR, actor, type

## API Endpoints

### Query Touchpoints

**GET** `/api/touchpoints`

Query manual touchpoint records with filtering and aggregation.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `cycleId` | string | Filter by release cycle |
| `issueId` | string | Filter by AFU-9 issue UUID |
| `ghIssueNumber` | number | Filter by GitHub issue number |
| `prNumber` | number | Filter by PR number |
| `type` | TouchpointType | Filter by touchpoint type |
| `stats` | boolean | Return only aggregated statistics (default: false) |
| `limit` | number | Max records to return (default: 100, max: 1000) |

#### Response Format

```json
{
  "touchpoints": [
    {
      "id": 1,
      "type": "ASSIGN",
      "source": "API",
      "actor": "user123",
      "cycleId": "v0.5.0",
      "issueId": "uuid",
      "ghIssueNumber": 42,
      "prNumber": null,
      "sessionId": null,
      "requestId": "req-123",
      "metadata": {},
      "createdAt": "2026-01-15T10:00:00Z"
    }
  ],
  "stats": {
    "total": 5,
    "byType": {
      "ASSIGN": 1,
      "REVIEW": 2,
      "MERGE_APPROVAL": 1,
      "DEBUG_INTERVENTION": 1
    },
    "bySource": {
      "UI": 0,
      "INTENT": 0,
      "GH": 0,
      "API": 5
    },
    "uniqueActors": 3
  },
  "query": {
    "cycleId": "v0.5.0",
    "issueId": null,
    "ghIssueNumber": null,
    "prNumber": null,
    "type": null,
    "limit": 100
  }
}
```

## Usage Examples

### Record a Touchpoint (Programmatic)

```typescript
import { recordAssignTouchpoint } from '@/lib/touchpoints/manual-touchpoints';
import { getPool } from '@/lib/db';

const pool = getPool();

// Record ASSIGN touchpoint
await recordAssignTouchpoint(pool, {
  cycleId: 'v0.5.0',
  ghIssueNumber: 42,
  actor: 'user123',
  requestId: 'req-assign-1',
  source: 'API',
  metadata: {
    repository: 'owner/repo',
    assignee: 'copilot',
  },
});
```

### Query Touchpoints by Cycle

```bash
# Get all touchpoints for cycle v0.5.0
curl -X GET "http://localhost:3000/api/touchpoints?cycleId=v0.5.0"

# Get only statistics
curl -X GET "http://localhost:3000/api/touchpoints?cycleId=v0.5.0&stats=true"
```

### Query Touchpoints by Issue

```bash
# Get touchpoints for specific issue
curl -X GET "http://localhost:3000/api/touchpoints?issueId=uuid-here"

# Filter by type
curl -X GET "http://localhost:3000/api/touchpoints?issueId=uuid-here&type=REVIEW"
```

## Idempotency

Touchpoints use deterministic idempotency keys to prevent double-counting:

**Key Format**: `SHA-256(type|actor|context|timestamp_window)`

- **type**: Touchpoint type (ASSIGN, REVIEW, etc.)
- **actor**: User or system identifier
- **context**: Stable-sorted context identifiers (cycle, issue, PR)
- **timestamp_window**: Timestamp rounded to 5-minute window

**Example**: Multiple rapid clicks on "Request Review" within 5 minutes = 1 touchpoint

## Database Views

### Recent Touchpoints

```sql
SELECT * FROM recent_touchpoints LIMIT 100;
```

### Touchpoints by Cycle

```sql
SELECT * FROM touchpoints_by_cycle WHERE cycle_id = 'v0.5.0';
```

Returns aggregated counts:
- `total_touchpoints`
- `assign_count`
- `review_count`
- `merge_approval_count`
- `debug_intervention_count`
- `first_touchpoint_at`
- `last_touchpoint_at`

### Touchpoints by Type (Summary)

```sql
SELECT * FROM touchpoints_by_type;
```

Returns global summary:
- `type`
- `total_count`
- `unique_actors`
- `unique_cycles`
- `unique_issues`
- `first_seen`
- `last_seen`

## Integration Points

Manual touchpoint tracking is integrated into these existing API routes:

1. **`POST /api/github/issues/{issueNumber}/assign-copilot`**
   - Records ASSIGN touchpoint when Copilot is assigned

2. **`POST /api/approvals`** (E87.1 Approval Gate)
   - Records MERGE_APPROVAL touchpoint for approved merge actions

3. **`POST /api/github/prs/{prNumber}/request-review-and-wait`**
   - Records REVIEW touchpoint when reviewers are requested

4. **`POST /api/github/prs/{prNumber}/checks/rerun`**
   - Records DEBUG_INTERVENTION touchpoint when jobs are rerun

## Zero Impact Design

Touchpoint tracking is designed to have **zero impact** on existing automation:

- **Never throws errors**: Failed touchpoint recording returns `null`, doesn't propagate
- **Non-blocking**: Touchpoint recording happens after main operation completes
- **Idempotent**: Duplicate calls don't create duplicate records
- **Optional**: Missing context fields (cycle_id, issue_id) don't prevent recording

## Acceptance Criteria Verification

### Simulated Cycle Test

The acceptance criteria requires:
- **Input**: Simulated cycle with 1 review + 1 approval
- **Expected**: Exactly 2 touchpoints

**Test Result**: ✅ Verified in `e88-1-integration.test.ts`

```typescript
// 1 Review touchpoint
await recordReviewTouchpoint(pool, { ... });

// 1 Approval touchpoint  
await recordMergeApprovalTouchpoint(pool, { ... });

// Verify exactly 2 touchpoints
const stats = await getTouchpointStatsByCycle(pool, cycleId);
expect(stats.total).toBe(2);
expect(stats.byType.REVIEW).toBe(1);
expect(stats.byType.MERGE_APPROVAL).toBe(1);
```

### Idempotency Test

**Test Result**: ✅ Verified - no double-counts

```typescript
// Record same review twice
const result1 = await recordReviewTouchpoint(pool, { ... });
const result2 = await recordReviewTouchpoint(pool, { ... });

// Both return same record ID
expect(result1?.id).toBe(result2?.id);

// Only 1 touchpoint recorded
const stats = await getTouchpointStatsByCycle(pool, cycleId);
expect(stats.total).toBe(1);
```

## Migration

To enable touchpoints tracking:

```bash
# Run database migration
npm run db:migrate

# Migration file: database/migrations/070_manual_touchpoints.sql
```

## Testing

### Run Tests

```bash
# All touchpoint tests
npm test -- __tests__/lib/touchpoints/

# Service tests (13 tests)
npm test -- __tests__/lib/touchpoints/manual-touchpoints.test.ts

# Database tests (11 tests)
npm test -- __tests__/lib/db/manualTouchpoints.test.ts

# Integration tests (5 tests)
npm test -- __tests__/lib/touchpoints/e88-1-integration.test.ts
```

### Test Coverage

- ✅ Idempotency key generation (6 tests)
- ✅ Touchpoint recording (7 tests)
- ✅ Database operations (11 tests)
- ✅ Simulated cycle scenario (5 tests)
- **Total**: 29 tests passing

## Future Enhancements

1. **UI Dashboard**: Visual display of touchpoints per cycle/issue
2. **Trend Analysis**: Track reduction in touchpoints over time
3. **Automation Score**: Calculate automation % based on touchpoint density
4. **Alerts**: Notify when touchpoint count exceeds threshold
5. **Cycle Correlation**: Link touchpoints to release cycle outcomes

## References

- **Epic**: E88.1 - Manual Touchpoints Counter
- **Related**: E87.1 - Approval Gates Framework
- **Database Migration**: `database/migrations/070_manual_touchpoints.sql`
- **Core Service**: `control-center/src/lib/touchpoints/manual-touchpoints.ts`
- **Database Layer**: `control-center/src/lib/db/manualTouchpoints.ts`
- **API Endpoint**: `control-center/app/api/touchpoints/route.ts`
