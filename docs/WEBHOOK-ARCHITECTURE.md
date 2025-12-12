# GitHub Webhook Handler - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          GitHub                                  │
│                                                                  │
│  Events: issues, pull_request, check_run, check_suite          │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ HTTPS POST
                 │ + X-Hub-Signature-256
                 │ + X-GitHub-Event
                 │ + X-GitHub-Delivery
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              AFU-9 Control Center - Webhook API                  │
│                                                                  │
│  POST /api/webhooks/github                                      │
│  ├─ Verify HMAC-SHA256 signature                               │
│  ├─ Parse event type and action                                │
│  ├─ Store event in database                                    │
│  ├─ Return 200 OK (quick response)                             │
│  └─ Process asynchronously                                     │
└────────┬───────────────────────────┬────────────────────────────┘
         │                           │
         │                           │
         ▼                           ▼
┌─────────────────────┐    ┌──────────────────────────────────────┐
│   Database (RDS)    │    │    Async Event Processor             │
│                     │    │                                      │
│  webhook_events     │◄───┤  1. Check workflow mapping          │
│  webhook_configs    │    │  2. Build workflow context          │
│  workflows          │    │  3. Trigger workflow if enabled     │
│  workflow_executions│◄───┤  4. Update event status             │
└─────────────────────┘    └──────────────────────────────────────┘
         │
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Webhook Monitoring UI (/webhooks)                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Statistics Dashboard                                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │    │
│  │  │  Total   │ │Processed │ │ Failed   │ │  Types   │ │    │
│  │  │   Events │ │          │ │          │ │          │ │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Event List (Auto-refresh every 10s)                   │    │
│  │  ┌────────┬────────┬──────────┬──────────────────┐    │    │
│  │  │ Event  │ Status │ Received │ Workflow         │    │    │
│  │  ├────────┼────────┼──────────┼──────────────────┤    │    │
│  │  │ issues │✅ Done │ 2m ago   │ View Execution   │    │    │
│  │  │ opened │        │          │                  │    │    │
│  │  ├────────┼────────┼──────────┼──────────────────┤    │    │
│  │  │ pr     │⏳ Pend │ 1m ago   │ -                │    │    │
│  │  │ opened │        │          │                  │    │    │
│  │  └────────┴────────┴──────────┴──────────────────┘    │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Click event → View full payload and processing details         │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Webhook Reception
```
GitHub → Control Center
  ├─ Validate signature (HMAC-SHA256)
  ├─ Parse headers (event type, action, delivery ID)
  ├─ Store in webhook_events table
  └─ Return 200 OK immediately
```

### 2. Asynchronous Processing
```
Event Processor (async)
  ├─ Load webhook_configs
  ├─ Check event filters
  ├─ Match event to workflow mapping
  ├─ Build workflow context from payload
  ├─ Execute workflow (if auto_trigger enabled)
  └─ Update webhook_events with result
```

### 3. Workflow Context Building
```
GitHub Webhook Payload
  ├─ Extract repository info
  ├─ Extract issue/PR/check_run data
  ├─ Extract sender information
  └─ Build WorkflowContext
      ├─ input: { event_type, event_action, issue, pr, check_run }
      ├─ repo: { owner, name, default_branch }
      └─ variables: {}
```

## Database Schema

### webhook_events
Stores all incoming webhook events for audit and debugging.

```sql
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE,        -- GitHub delivery ID
  event_type VARCHAR(100),              -- issues, pull_request, check_run
  event_action VARCHAR(100),            -- opened, closed, completed
  payload JSONB,                        -- Full GitHub payload
  signature VARCHAR(255),               -- Received signature
  delivery_id VARCHAR(255),             -- GitHub delivery ID
  received_at TIMESTAMP,
  processed BOOLEAN,
  processed_at TIMESTAMP,
  workflow_execution_id UUID,           -- Link to triggered workflow
  error TEXT
);
```

### webhook_configs
Configures webhook behavior and workflow mappings.

```sql
CREATE TABLE webhook_configs (
  id UUID PRIMARY KEY,
  name VARCHAR(255) UNIQUE,             -- e.g., 'github'
  secret_key VARCHAR(255),              -- HMAC secret
  enabled BOOLEAN,
  event_filters JSONB,                  -- Which events to accept
  workflow_mappings JSONB               -- Event → Workflow mapping
);
```

**Example workflow_mappings:**
```json
{
  "issues.opened": {
    "workflow": "issue_to_pr",
    "auto_trigger": false
  },
  "pull_request.opened": {
    "workflow": "pr_review",
    "auto_trigger": true
  },
  "check_run.completed": {
    "workflow": "handle_ci_result",
    "auto_trigger": true
  }
}
```

## Security Features

### 1. Signature Verification
```typescript
// Generate expected signature
const hmac = createHmac('sha256', secret);
hmac.update(rawPayload, 'utf8');
const expected = `sha256=${hmac.digest('hex')}`;

// Compare using timing-safe method
timingSafeEqual(
  Buffer.from(receivedSignature),
  Buffer.from(expectedSignature)
);
```

### 2. Request Validation
- Check required headers (X-Hub-Signature-256, X-GitHub-Event)
- Validate JSON payload structure
- Verify signature before processing
- Reject invalid/malformed requests

### 3. Error Handling
- All errors logged with context
- Failed events marked with error message
- No sensitive data in error responses
- Full audit trail maintained

## API Endpoints

### POST /api/webhooks/github
**Purpose**: Receive GitHub webhook events

**Headers**:
- `X-Hub-Signature-256`: HMAC-SHA256 signature
- `X-GitHub-Event`: Event type (issues, pull_request, etc.)
- `X-GitHub-Delivery`: Unique delivery ID

**Response**: `200 OK` (immediate)
```json
{
  "success": true,
  "event_id": "abc123",
  "event_type": "issues",
  "event_action": "opened",
  "message": "Webhook received and queued for processing"
}
```

### GET /api/webhooks/events
**Purpose**: List webhook events

**Query Parameters**:
- `limit`: Number of events (default: 50)
- `offset`: Pagination offset
- `stats`: Return statistics only (boolean)

**Response**:
```json
{
  "events": [...],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 123,
    "hasMore": true
  }
}
```

### GET /api/webhooks/events/[id]
**Purpose**: Get specific event details

**Response**:
```json
{
  "id": "uuid",
  "event_id": "abc123",
  "event_type": "issues",
  "event_action": "opened",
  "payload": { /* full GitHub payload */ },
  "received_at": "2024-01-15T10:30:00Z",
  "processed": true,
  "workflow_execution_id": "uuid"
}
```

## Configuration

### Environment Variables
```bash
GITHUB_WEBHOOK_SECRET=your_webhook_secret_here
```

### Database Configuration
```sql
UPDATE webhook_configs
SET secret_key = 'your_webhook_secret_here'
WHERE name = 'github';
```

### GitHub Repository Settings
1. Go to Settings → Webhooks → Add webhook
2. Payload URL: `https://your-domain.com/api/webhooks/github`
3. Content type: `application/json`
4. Secret: Same as configured above
5. Events: Select individual events (issues, pull requests, check runs)

## Monitoring & Debugging

### UI Features
1. **Statistics Dashboard**: Total events, processed, failed, by type
2. **Event List**: All events with status badges
3. **Event Details**: Full payload viewer
4. **Workflow Links**: Jump to triggered workflow executions
5. **Auto-refresh**: Real-time updates every 10 seconds

### Event Status
- 🟡 **Pending**: Event received, awaiting processing
- 🟢 **Processed**: Successfully processed
- 🔴 **Failed**: Processing failed (view error)

### Debugging
1. Check event list for incoming webhooks
2. View event details to inspect payload
3. Check error messages for failed events
4. Verify workflow execution links
5. Review GitHub webhook delivery logs

## Example Use Cases

### 1. Auto-Create PR from Issue
```json
{
  "issues.opened": {
    "workflow": "issue_to_pr",
    "auto_trigger": true
  }
}
```

### 2. Respond to Failed CI
```json
{
  "check_run.completed": {
    "workflow": "debug_failed_check",
    "auto_trigger": true
  }
}
```

### 3. Manual Review on PR
```json
{
  "pull_request.opened": {
    "workflow": "pr_review_checklist",
    "auto_trigger": false
  }
}
```

## Performance Considerations

1. **Immediate Response**: Returns 200 OK within milliseconds
2. **Async Processing**: Heavy work done in background
3. **Database Indexing**: Optimized queries with proper indexes
4. **Pagination**: Efficient event listing with limits
5. **Auto-refresh**: Intelligent polling with configurable intervals

## Future Enhancements

- [ ] Webhook retry mechanism for failed processing
- [ ] Event filtering by repository
- [ ] Advanced workflow mapping rules (conditions)
- [ ] Webhook secret rotation UI
- [ ] Event replay functionality
- [ ] Webhook analytics and insights
- [ ] Multi-repository webhook support
- [ ] Custom event handlers
