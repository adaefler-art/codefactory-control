# E77.5 Audit Event Schema Examples

This document provides concrete examples of audit events for each event type.

## Database Schema

```sql
CREATE TABLE remediation_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  remediation_run_id UUID NOT NULL REFERENCES remediation_runs(id),
  incident_id UUID NOT NULL REFERENCES incidents(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PLANNED', 'STEP_STARTED', 'STEP_FINISHED',
    'VERIFICATION_STARTED', 'VERIFICATION_FINISHED',
    'STATUS_UPDATED', 'COMPLETED', 'FAILED'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lawbook_version TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  payload_hash TEXT NOT NULL
);
```

## Event Type Examples

### 1. PLANNED

Emitted when remediation plan is generated (before execution starts).

```json
{
  "id": "ae789012-3456-7890-1234-567890123456",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "PLANNED",
  "created_at": "2026-01-04T11:00:00.000Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "playbookId": "restart-service",
    "playbookVersion": "1.0.0",
    "inputsHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "stepsCount": 3,
    "steps": [
      {
        "stepId": "snapshot-state",
        "actionType": "SNAPSHOT_SERVICE_STATE"
      },
      {
        "stepId": "restart",
        "actionType": "RESTART_SERVICE"
      },
      {
        "stepId": "verify-health",
        "actionType": "POLL_SERVICE_HEALTH"
      }
    ]
  },
  "payload_hash": "9a7b8c5d3e2f1a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b"
}
```

### 2. STEP_STARTED

Emitted before each step execution.

```json
{
  "id": "12345678-90ab-cdef-1234-567890abcdef",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "STEP_STARTED",
  "created_at": "2026-01-04T11:00:01.000Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "stepId": "restart",
    "actionType": "RESTART_SERVICE",
    "idempotencyKey": "RESTART_SERVICE:incident:prod:abc123",
    "inputsHash": "def456789abc012345678901234567890abcdef123456789012345678901234"
  },
  "payload_hash": "abc123def456789012345678901234567890abcdef123456789012345678901"
}
```

### 3. STEP_FINISHED (Success)

Emitted after step completes successfully.

```json
{
  "id": "23456789-0abc-def1-2345-67890abcdef1",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "STEP_FINISHED",
  "created_at": "2026-01-04T11:00:05.000Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "stepId": "restart",
    "actionType": "RESTART_SERVICE",
    "status": "SUCCEEDED",
    "outputSummary": {
      "hasOutput": true,
      "outputHash": "fed987654321098765432109876543210fedcba9876543210987654321098"
    }
  },
  "payload_hash": "bcd234efa567890123456789012345678901bcdef234567890123456789012"
}
```

### 4. STEP_FINISHED (Failure)

Emitted after step fails.

```json
{
  "id": "34567890-abcd-ef12-3456-7890abcdef12",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "STEP_FINISHED",
  "created_at": "2026-01-04T11:00:05.500Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "stepId": "restart",
    "actionType": "RESTART_SERVICE",
    "status": "FAILED",
    "errorCode": "SERVICE_NOT_FOUND",
    "errorMessage": "Unable to locate service 'api-prod'"
  },
  "payload_hash": "cde345fab678901234567890123456789012cdef345678901234567890123"
}
```

### 5. VERIFICATION_STARTED

Emitted before verification runs (when integrated with E65.2).

```json
{
  "id": "45678901-bcde-f123-4567-890abcdef123",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "VERIFICATION_STARTED",
  "created_at": "2026-01-04T11:00:10.000Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "verificationType": "E65.2_POST_DEPLOY",
    "targetEnvironment": "prod",
    "verificationConfig": {
      "timeout": 300,
      "requiredChecks": ["health", "metrics", "logs"]
    }
  },
  "payload_hash": "def456gab789012345678901234567890123def456789012345678901234"
}
```

### 6. VERIFICATION_FINISHED

Emitted after verification completes.

```json
{
  "id": "56789012-cdef-1234-5678-90abcdef1234",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "VERIFICATION_FINISHED",
  "created_at": "2026-01-04T11:00:15.000Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "verificationType": "E65.2_POST_DEPLOY",
    "status": "PASSED",
    "checksPerformed": 12,
    "checksPassed": 12,
    "checksFailed": 0,
    "verificationReportHash": "efa567890123456789012345678901234567890efabcd1234567890123456"
  },
  "payload_hash": "fab567890123456789012345678901234567890fab678901234567890123"
}
```

### 7. STATUS_UPDATED

Emitted when run status changes to final state.

```json
{
  "id": "67890123-def1-2345-6789-0abcdef12345",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "STATUS_UPDATED",
  "created_at": "2026-01-04T11:00:16.000Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "status": "SUCCEEDED",
    "totalSteps": 3,
    "successCount": 3,
    "failedCount": 0,
    "durationMs": 16000
  },
  "payload_hash": "gab678901234567890123456789012345678901gab789012345678901234"
}
```

### 8. COMPLETED

Emitted when remediation completes successfully.

```json
{
  "id": "78901234-ef12-3456-7890-abcdef123456",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "COMPLETED",
  "created_at": "2026-01-04T11:00:16.100Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "status": "SUCCEEDED",
    "totalSteps": 3,
    "successCount": 3,
    "failedCount": 0,
    "durationMs": 16100
  },
  "payload_hash": "hbc789012345678901234567890123456789012hbc890123456789012345"
}
```

### 9. FAILED

Emitted when remediation fails.

```json
{
  "id": "89012345-f123-4567-8901-bcdef1234567",
  "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
  "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
  "event_type": "FAILED",
  "created_at": "2026-01-04T11:00:16.200Z",
  "lawbook_version": "abcd1234",
  "payload_json": {
    "status": "FAILED",
    "totalSteps": 3,
    "successCount": 1,
    "failedCount": 2,
    "durationMs": 8500
  },
  "payload_hash": "icd890123456789012345678901234567890123icd901234567890123456"
}
```

## Complete Audit Trail Example

For a successful 3-step remediation run:

```json
[
  {
    "event_type": "PLANNED",
    "created_at": "2026-01-04T11:00:00.000Z",
    "payload_json": { "playbookId": "restart-service", "stepsCount": 3 }
  },
  {
    "event_type": "STEP_STARTED",
    "created_at": "2026-01-04T11:00:01.000Z",
    "payload_json": { "stepId": "snapshot", "actionType": "SNAPSHOT_SERVICE_STATE" }
  },
  {
    "event_type": "STEP_FINISHED",
    "created_at": "2026-01-04T11:00:02.000Z",
    "payload_json": { "stepId": "snapshot", "status": "SUCCEEDED" }
  },
  {
    "event_type": "STEP_STARTED",
    "created_at": "2026-01-04T11:00:03.000Z",
    "payload_json": { "stepId": "restart", "actionType": "RESTART_SERVICE" }
  },
  {
    "event_type": "STEP_FINISHED",
    "created_at": "2026-01-04T11:00:08.000Z",
    "payload_json": { "stepId": "restart", "status": "SUCCEEDED" }
  },
  {
    "event_type": "STEP_STARTED",
    "created_at": "2026-01-04T11:00:09.000Z",
    "payload_json": { "stepId": "verify", "actionType": "POLL_SERVICE_HEALTH" }
  },
  {
    "event_type": "STEP_FINISHED",
    "created_at": "2026-01-04T11:00:15.000Z",
    "payload_json": { "stepId": "verify", "status": "SUCCEEDED" }
  },
  {
    "event_type": "STATUS_UPDATED",
    "created_at": "2026-01-04T11:00:16.000Z",
    "payload_json": { "status": "SUCCEEDED", "totalSteps": 3, "successCount": 3 }
  },
  {
    "event_type": "COMPLETED",
    "created_at": "2026-01-04T11:00:16.100Z",
    "payload_json": { "status": "SUCCEEDED", "durationMs": 16100 }
  }
]
```

## API Response Examples

### GET /api/remediation/runs/[id]/audit

```json
{
  "runId": "12345678-90ab-cdef-1234-567890abcdef",
  "incidentId": "abcdef12-3456-7890-abcd-ef1234567890",
  "playbookId": "restart-service",
  "status": "SUCCEEDED",
  "auditEvents": [
    {
      "id": "ae789012-3456-7890-1234-567890123456",
      "remediation_run_id": "12345678-90ab-cdef-1234-567890abcdef",
      "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
      "event_type": "PLANNED",
      "created_at": "2026-01-04T11:00:00.000Z",
      "lawbook_version": "abcd1234",
      "payload_json": { "playbookId": "restart-service", "stepsCount": 3 },
      "payload_hash": "9a7b8c5d3e2f1a9b8c7d6e5f4a3b2c1d..."
    }
    // ... more events
  ]
}
```

### GET /api/remediation/runs/[id]/export

```json
{
  "exportedAt": "2026-01-04T11:20:00.000Z",
  "run": {
    "id": "12345678-90ab-cdef-1234-567890abcdef",
    "run_key": "incident:prod:deploy-123:restart-service:abc",
    "incident_id": "abcdef12-3456-7890-abcd-ef1234567890",
    "playbook_id": "restart-service",
    "playbook_version": "1.0.0",
    "status": "SUCCEEDED",
    "created_at": "2026-01-04T11:00:00.000Z",
    "updated_at": "2026-01-04T11:00:16.000Z",
    "lawbook_version": "abcd1234",
    "inputs_hash": "e3b0c44298fc1c14..."
  },
  "steps": [
    {
      "id": "step-1",
      "step_id": "snapshot",
      "action_type": "SNAPSHOT_SERVICE_STATE",
      "status": "SUCCEEDED",
      "started_at": "2026-01-04T11:00:01.000Z",
      "finished_at": "2026-01-04T11:00:02.000Z"
    }
    // ... more steps
  ],
  "auditEvents": [
    // ... all audit events
  ],
  "incidentRef": {
    "id": "abcdef12-3456-7890-abcd-ef1234567890",
    "incident_key": "incident:prod:deploy-123",
    "severity": "RED",
    "status": "RESOLVED",
    "title": "Production deploy verification failed"
  }
}
```

## Payload Hash Verification

All payload hashes are computed deterministically:

```typescript
import { computePayloadHash, stableStringify } from './contracts/remediation-playbook';

const payload = {
  stepId: "restart",
  actionType: "RESTART_SERVICE",
  status: "SUCCEEDED"
};

// Same payload, different key order -> same hash
const payload2 = {
  status: "SUCCEEDED",
  actionType: "RESTART_SERVICE",
  stepId: "restart"
};

const hash1 = computePayloadHash(payload);
const hash2 = computePayloadHash(payload2);

console.log(hash1 === hash2); // true
```

## Security Notes

1. **No secrets in payloads** - All values sanitized through `sanitizeRedact()`
2. **Hashes only** - Sensitive outputs stored as hashes, not plaintext
3. **Append-only** - Database trigger prevents modification
4. **Evidence by reference** - Only pointers to evidence stored, not full content
