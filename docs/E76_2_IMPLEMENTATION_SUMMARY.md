# E76.2 Incident Ingestion Implementation Summary

## Overview

This implementation delivers idempotent incident ingestion pipelines that transform AFU-9 signals (Runner results, Post-Deploy Verification failures, Deploy Status changes, ECS events) into normalized Incident records as specified in I762 (E76.2).

## Architecture

### 1. Pure Mappers (`control-center/src/lib/incident-ingestion/mappers.ts`)

Four pure, deterministic mapper functions that transform signals into `IncidentInput`:

#### A. Deploy Status Mapper
- **Input**: `DeployStatusSignal` from E65.1
- **Rules**:
  - GREEN → `null` (no incident created)
  - YELLOW → YELLOW severity incident
  - RED → RED severity incident
- **incident_key**: `deploy_status:<env>:<deployId|unknown>:<changedAt>`
- **Error Codes**: `DEPLOY_STATUS_YELLOW`, `DEPLOY_STATUS_RED`

#### B. Verification Failure Mapper
- **Input**: `VerificationSignal` from E65.2
- **Rules**:
  - Only `failed` or `timeout` status creates incidents
  - Always RED severity
- **incident_key**: `verification:<deployId>:<reportHash>`
  - Falls back to `runId` if `reportHash` unavailable
- **Error Codes**: `VERIFICATION_FAILED`, `VERIFICATION_TIMEOUT`

#### C. ECS Stopped Task Mapper
- **Input**: `EcsStoppedTaskSignal`
- **Rules**:
  - `exitCode !== 0` → RED severity
  - `stoppedReason` contains "error", "fail", "crash" → RED severity
  - Otherwise → YELLOW severity
- **incident_key**: `ecs_stopped:<cluster>:<taskArn>:<stoppedAt>`
- **Error Codes**: `ECS_TASK_STOPPED`, `ECS_TASK_FAILED`

#### D. Runner Step Failure Mapper
- **Input**: `RunnerStepFailureSignal` (GitHub Actions)
- **Rules**:
  - `failure` or `timeout` → RED severity
  - `cancelled` → YELLOW severity
- **incident_key**: `runner:<runId>:<stepName>:<conclusion>`
- **Error Codes**: `RUNNER_STEP_FAILED`, `RUNNER_STEP_TIMEOUT`

### 2. Idempotent Orchestrator (`control-center/src/lib/incident-ingestion/index.ts`)

Core ingestion functions that ensure idempotency:

#### Functions

```typescript
// Single signal ingestion
ingestDeployStatusSignal(pool, signal): Promise<IncidentIngestionResult>
ingestVerificationFailureSignal(pool, signal): Promise<IncidentIngestionResult>
ingestEcsStoppedTaskSignal(pool, signal): Promise<IncidentIngestionResult>
ingestRunnerStepFailureSignal(pool, signal): Promise<IncidentIngestionResult>

// Batch ingestion (for backfill/bulk)
batchIngestDeployStatusSignals(pool, signals): Promise<IncidentIngestionResult[]>
batchIngestVerificationFailureSignals(pool, signals): Promise<IncidentIngestionResult[]>
batchIngestEcsStoppedTaskSignals(pool, signals): Promise<IncidentIngestionResult[]>
batchIngestRunnerStepFailureSignals(pool, signals): Promise<IncidentIngestionResult[]>
```

#### Idempotency Guarantees

1. **Stable incident_key**: Each signal type generates deterministic keys
2. **Upsert by key**: `ON CONFLICT (incident_key)` ensures safe retries
3. **Evidence deduplication**: SHA-256 hashing prevents duplicate evidence
4. **Event logging**: Tracks `CREATED` vs `UPDATED` events

#### Evidence Handling

- Primary source signal stored as evidence with kind matching `source_primary.kind`
- Additional evidence attached based on signal type
- SHA-256 hash computed from `{incident_id, kind, ref}` for deduplication
- Idempotent: same evidence added twice → only one DB row

#### Result Type

```typescript
interface IncidentIngestionResult {
  incident: Incident | null;
  isNew: boolean; // true if created, false if updated
  evidenceAdded: number;
  error?: string;
}
```

## Files Created

### Core Implementation
- **`control-center/src/lib/incident-ingestion/mappers.ts`** (NEW)
  - Pure mapper functions (4 signal types)
  - Error code constants
  - Validation helpers
  - ~730 lines

- **`control-center/src/lib/incident-ingestion/index.ts`** (NEW)
  - Orchestrator functions
  - Idempotent ingestion logic
  - SHA-256 evidence hashing
  - Batch processing
  - ~390 lines

### Tests
- **`control-center/__tests__/lib/incident-ingestion/mappers.test.ts`** (NEW)
  - 28 tests covering all mappers
  - Determinism verification
  - Null handling
  - Validation tests
  - ~580 lines

- **`control-center/__tests__/lib/incident-ingestion/index.test.ts`** (NEW)
  - 11 tests covering orchestrator
  - Idempotency tests
  - Evidence deduplication
  - Error handling
  - ~420 lines

## Test Coverage

✅ **All 39 tests passing**

### Mapper Tests (28 tests)
- ✅ Deploy Status: GREEN returns null, YELLOW/RED create incidents
- ✅ Verification: failed/timeout create RED incidents
- ✅ ECS: exit code and reason determine severity
- ✅ Runner: failure/timeout → RED, cancelled → YELLOW
- ✅ Deterministic: same input → same output
- ✅ Validation: all signal validators working

### Orchestrator Tests (11 tests)
- ✅ Idempotency: same signal twice updates, not duplicates
- ✅ Evidence addition with deduplication
- ✅ Event logging (CREATED vs UPDATED)
- ✅ Batch processing
- ✅ Error handling

### Compatibility Tests
- ✅ Existing incident DB tests (16 tests) still passing

## Key Features

### 1. Deterministic Mapping
- All mappers are pure functions
- Same input always produces same output
- No external dependencies or side effects
- Testable without database

### 2. Stable incident_key Generation
- Each signal type has predictable key format
- Keys include timestamps to avoid collisions
- Missing fields use "unknown" fallback
- Examples:
  - `deploy_status:prod:deploy-abc123:2024-01-01T00:00:00Z`
  - `verification:deploy-123:sha256-xyz789`
  - `ecs_stopped:prod-cluster:arn:aws:...:2024-01-01T00:00:00Z`
  - `runner:run-12345:deploy:failure`

### 3. Evidence-First Design
- Primary signal stored as evidence
- Additional context attached as separate evidence
- SHA-256 hashing for deduplication
- No secrets in evidence (references only)

### 4. Error Taxonomy
Eight distinct error codes:
- `DEPLOY_STATUS_YELLOW`
- `DEPLOY_STATUS_RED`
- `VERIFICATION_FAILED`
- `VERIFICATION_TIMEOUT`
- `ECS_TASK_STOPPED`
- `ECS_TASK_FAILED`
- `RUNNER_STEP_FAILED`
- `RUNNER_STEP_TIMEOUT`

## Usage Examples

### Example 1: Deploy Status Ingestion

```typescript
import { ingestDeployStatusSignal } from './lib/incident-ingestion';

const signal: DeployStatusSignal = {
  env: 'prod',
  status: 'RED',
  changedAt: '2024-01-01T00:00:00Z',
  signals: { /* ... */ },
  reasons: [
    { code: 'HEALTH_FAIL', severity: 'error', message: 'Health check failed' }
  ],
  deployId: 'deploy-123',
};

const result = await ingestDeployStatusSignal(pool, signal);
// result.incident → Incident record
// result.isNew → true (first ingestion)
// result.evidenceAdded → 2 (primary + snapshot)
```

### Example 2: Verification Failure Ingestion

```typescript
import { ingestVerificationFailureSignal } from './lib/incident-ingestion';

const signal: VerificationSignal = {
  runId: 'run-456',
  playbookId: 'post-deploy-verify',
  playbookVersion: '1.0.0',
  env: 'prod',
  status: 'failed',
  deployId: 'deploy-123',
  completedAt: '2024-01-01T00:00:00Z',
  reportHash: 'sha256-abc',
  failedSteps: [
    { id: 'health', title: 'Health check', error: 'HTTP 500' }
  ],
};

const result = await ingestVerificationFailureSignal(pool, signal);
// result.incident.severity → 'RED'
// result.incident.classification.error_code → 'VERIFICATION_FAILED'
```

### Example 3: Batch Ingestion

```typescript
import { batchIngestDeployStatusSignals } from './lib/incident-ingestion';

const signals = [
  { env: 'prod', status: 'YELLOW', /* ... */ },
  { env: 'stage', status: 'RED', /* ... */ },
];

const results = await batchIngestDeployStatusSignals(pool, signals);
// results[0].incident → prod incident
// results[1].incident → stage incident
```

## Idempotency Proof

### Scenario: Same signal ingested twice

**Input**: Deploy status signal with same `env`, `deployId`, `changedAt`

**First call**:
```typescript
const result1 = await ingestDeployStatusSignal(pool, signal);
// result1.isNew = true
// result1.incident.first_seen_at = '2024-01-01T00:00:00Z'
// result1.incident.last_seen_at = '2024-01-01T00:00:00Z'
```

**Second call** (same signal):
```typescript
const result2 = await ingestDeployStatusSignal(pool, signal);
// result2.isNew = false
// result2.incident.id === result1.incident.id
// result2.incident.first_seen_at = '2024-01-01T00:00:00Z' (unchanged)
// result2.incident.last_seen_at = NOW() (updated)
// result2.evidenceAdded = 0 (deduplicated via sha256)
```

## Integration Points

### Deploy Status Monitor (E65.1)
```typescript
// When status changes to YELLOW/RED
const statusSnapshot = await computeDeployStatus(env);
if (statusSnapshot.status !== 'GREEN') {
  await ingestDeployStatusSignal(pool, {
    env: statusSnapshot.env,
    status: statusSnapshot.status,
    changedAt: statusSnapshot.observedAt,
    signals: statusSnapshot.signals,
    reasons: statusSnapshot.reasons,
    deployId: statusSnapshot.relatedDeployId,
  });
}
```

### Post-Deploy Verification (E65.2)
```typescript
// When playbook run fails
if (playbookRun.status === 'failed' || playbookRun.status === 'timeout') {
  await ingestVerificationFailureSignal(pool, {
    runId: playbookRun.id,
    playbookId: playbookRun.playbookId,
    playbookVersion: playbookRun.playbookVersion,
    env: playbookRun.env,
    status: playbookRun.status,
    completedAt: playbookRun.completedAt,
    reportHash: computeHash(playbookRun.results),
  });
}
```

### ECS Event Handler
```typescript
// On ECS task stopped event
await ingestEcsStoppedTaskSignal(pool, {
  cluster: event.detail.clusterArn,
  taskArn: event.detail.taskArn,
  taskDefinition: event.detail.taskDefinitionArn,
  stoppedAt: event.time,
  stoppedReason: event.detail.stoppedReason,
  exitCode: event.detail.containers[0]?.exitCode,
  containers: event.detail.containers,
});
```

### GitHub Actions Runner
```typescript
// On workflow run conclusion
if (['failure', 'timeout', 'cancelled'].includes(step.conclusion)) {
  await ingestRunnerStepFailureSignal(pool, {
    runId: run.id,
    stepName: step.name,
    conclusion: step.conclusion,
    completedAt: step.completed_at,
    workflowName: workflow.name,
    errorMessage: step.error,
  });
}
```

## Validation

### Type Safety
```bash
npx tsc --noEmit --skipLibCheck \
  src/lib/incident-ingestion/mappers.ts \
  src/lib/incident-ingestion/index.ts
```
✅ **No type errors**

### Tests
```bash
npm --prefix control-center test -- __tests__/lib/incident-ingestion/
```
✅ **39/39 tests passing**

### Existing Compatibility
```bash
npm --prefix control-center test -- __tests__/lib/db/incidents.test.ts
```
✅ **16/16 tests passing**

## Future Enhancements (out of scope for I762)

1. **I763 - AI Classifier**: Auto-classify incidents based on evidence
2. **I764 - Incident UI**: Dashboard for viewing/managing incidents
3. **I765 - Auto-Remediation**: Trigger playbooks based on incident type
4. **Webhook Integration**: Real-time ingestion from external sources
5. **Incident Correlation**: Link related incidents across signals
6. **SLA Tracking**: Monitor time-to-ack, time-to-mitigation

## Non-Negotiables Satisfied

✅ **No guesses**: All mappers require concrete signal input
✅ **Idempotent**: Safe to run repeatedly, stable incident_key
✅ **Deterministic**: Explicit mapping rules + error codes
✅ **No destructive actions**: Only creates/updates, never deletes

## Acceptance Criteria

✅ **All mappers implemented**: Deploy Status, Verification, ECS, Runner
✅ **Idempotency proven**: Tests verify same input → update, not duplicate
✅ **Evidence deduplication**: SHA-256 hashing prevents duplicates
✅ **Event logging**: CREATED/UPDATED events tracked
✅ **Tests passing**: 39/39 tests green
✅ **Type safety**: No TypeScript errors
✅ **Documentation**: Complete usage guide

---

**Implementation Date**: 2026-01-03  
**Reference**: I762 (E76.2 - Incident Ingestion Pipelines)  
**Status**: ✅ Complete  
**Next**: I763 (Incident Classifier v1)
