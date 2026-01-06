# E76.2 Verification Commands

## Test Commands

### Run Incident Ingestion Tests
```powershell
# Run mapper tests (28 tests)
npm --prefix control-center test -- __tests__/lib/incident-ingestion/mappers.test.ts

# Run orchestrator tests (11 tests)
npm --prefix control-center test -- __tests__/lib/incident-ingestion/index.test.ts

# Run all incident ingestion tests
npm --prefix control-center test -- __tests__/lib/incident-ingestion/

# Run existing incident DB tests (compatibility check)
npm --prefix control-center test -- __tests__/lib/db/incidents.test.ts
```

### Type-Check Commands
```powershell
# Type-check incident ingestion files
cd control-center
npx tsc --noEmit --skipLibCheck src/lib/incident-ingestion/mappers.ts src/lib/incident-ingestion/index.ts

# Type-check all incident files
npx tsc --noEmit --skipLibCheck src/lib/incident-ingestion/*.ts src/lib/contracts/incident.ts src/lib/db/incidents.ts
```

## Expected Test Results

### Mapper Tests (28 tests)
```
PASS __tests__/lib/incident-ingestion/mappers.test.ts
  Incident Ingestion Mappers
    mapDeployStatusToIncident
      ✓ GREEN status returns null (no incident)
      ✓ YELLOW status creates YELLOW incident
      ✓ RED status creates RED incident
      ✓ missing deployId uses "unknown" in incident_key
      ✓ includes reasons in summary
      ✓ deterministic: same input produces same output
    mapVerificationFailureToIncident
      ✓ failed status creates RED incident
      ✓ timeout status creates RED incident with timeout error code
      ✓ falls back to runId when reportHash is missing
      ✓ includes failed steps in summary
      ✓ non-failed status returns null
    mapEcsStoppedTaskToIncident
      ✓ stopped task with exit code 0 creates YELLOW incident
      ✓ stopped task with non-zero exit code creates RED incident
      ✓ error reason creates RED incident
      ✓ includes container details in summary
      ✓ extracts task definition name for tags
    mapRunnerStepFailureToIncident
      ✓ failure conclusion creates RED incident
      ✓ timeout conclusion creates RED incident with timeout error code
      ✓ cancelled conclusion creates YELLOW incident
      ✓ includes error message in summary
      ✓ includes run URL in summary
      ✓ success conclusion returns null
    Validation Helpers
      ✓ validateDeployStatusSignal accepts valid signal
      ✓ validateDeployStatusSignal rejects invalid status
      ✓ validateVerificationSignal accepts valid signal
      ✓ validateEcsStoppedTaskSignal accepts valid signal
      ✓ validateRunnerStepFailureSignal accepts valid signal
      ✓ validateRunnerStepFailureSignal rejects invalid conclusion

Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
```

### Orchestrator Tests (11 tests)
```
PASS __tests__/lib/incident-ingestion/index.test.ts
  Incident Ingestion Orchestrator
    ingestDeployStatusSignal
      ✓ GREEN status returns null result without creating incident
      ✓ YELLOW status creates new incident with evidence and event
      ✓ RED status updates existing incident
      ✓ idempotent: same signal twice does not duplicate
    ingestVerificationFailureSignal
      ✓ failed verification creates RED incident
      ✓ success status returns null result
    ingestEcsStoppedTaskSignal
      ✓ stopped task creates incident
    ingestRunnerStepFailureSignal
      ✓ failed step creates RED incident
      ✓ cancelled step creates YELLOW incident
    batchIngestDeployStatusSignals
      ✓ processes multiple signals
    Error Handling
      ✓ handles database errors gracefully

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

## Usage Examples

### 1. Deploy Status Ingestion

```typescript
import { Pool } from 'pg';
import { ingestDeployStatusSignal } from './src/lib/incident-ingestion';

const pool = new Pool({ /* config */ });

const signal = {
  env: 'prod',
  status: 'RED',
  changedAt: '2024-01-01T00:00:00Z',
  signals: {
    checkedAt: '2024-01-01T00:00:00Z',
    verificationRun: null,
  },
  reasons: [
    {
      code: 'HEALTH_FAIL',
      severity: 'error',
      message: 'Health endpoint failed',
    },
  ],
  deployId: 'deploy-abc123',
};

const result = await ingestDeployStatusSignal(pool, signal);
console.log(result.incident);
// {
//   id: 'uuid-...',
//   incident_key: 'deploy_status:prod:deploy-abc123:2024-01-01T00:00:00Z',
//   severity: 'RED',
//   status: 'OPEN',
//   title: 'Deploy status RED in prod',
//   ...
// }
```

### 2. Verification Failure Ingestion

```typescript
import { ingestVerificationFailureSignal } from './src/lib/incident-ingestion';

const signal = {
  runId: 'run-123',
  playbookId: 'post-deploy-verify',
  playbookVersion: '1.0.0',
  env: 'prod',
  status: 'failed',
  deployId: 'deploy-abc123',
  completedAt: '2024-01-01T00:00:00Z',
  reportHash: 'sha256-xyz789',
  failedSteps: [
    {
      id: 'health-check',
      title: 'Health Check',
      error: 'HTTP 500 received',
    },
  ],
};

const result = await ingestVerificationFailureSignal(pool, signal);
console.log(result.incident.incident_key);
// 'verification:deploy-abc123:sha256-xyz789'
```

### 3. ECS Task Ingestion

```typescript
import { ingestEcsStoppedTaskSignal } from './src/lib/incident-ingestion';

const signal = {
  cluster: 'prod-cluster',
  taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/prod-cluster/abc123',
  taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/control-center:1',
  stoppedAt: '2024-01-01T00:00:00Z',
  stoppedReason: 'Task failed to start',
  exitCode: 137,
  lastStatus: 'STOPPED',
  containers: [
    {
      name: 'app',
      exitCode: 137,
      reason: 'OutOfMemoryError',
    },
  ],
};

const result = await ingestEcsStoppedTaskSignal(pool, signal);
console.log(result.incident.severity);
// 'RED'
```

### 4. Runner Failure Ingestion

```typescript
import { ingestRunnerStepFailureSignal } from './src/lib/incident-ingestion';

const signal = {
  runId: '123456789',
  stepName: 'Deploy to Production',
  conclusion: 'failure',
  completedAt: '2024-01-01T00:00:00Z',
  errorMessage: 'Deployment failed: insufficient permissions',
  jobName: 'deploy',
  workflowName: 'Deploy',
  repository: 'adaefler-art/codefactory-control',
  ref: 'refs/heads/main',
  runUrl: 'https://github.com/user/repo/actions/runs/123456789',
};

const result = await ingestRunnerStepFailureSignal(pool, signal);
console.log(result.incident.classification);
// {
//   error_code: 'RUNNER_STEP_FAILED',
//   signal_type: 'runner',
//   conclusion: 'failure',
//   auto_generated: true
// }
```

### 5. Batch Ingestion

```typescript
import { batchIngestDeployStatusSignals } from './src/lib/incident-ingestion';

const signals = [
  {
    env: 'prod',
    status: 'YELLOW',
    changedAt: '2024-01-01T00:00:00Z',
    signals: { checkedAt: '2024-01-01T00:00:00Z' },
    reasons: [],
    deployId: 'deploy-1',
  },
  {
    env: 'stage',
    status: 'RED',
    changedAt: '2024-01-01T00:00:00Z',
    signals: { checkedAt: '2024-01-01T00:00:00Z' },
    reasons: [],
    deployId: 'deploy-2',
  },
];

const results = await batchIngestDeployStatusSignals(pool, signals);
console.log(`Ingested ${results.length} incidents`);
// 'Ingested 2 incidents'
```

## Idempotency Verification

### Test 1: Same Deploy Status Signal Twice

```typescript
const signal = {
  env: 'prod',
  status: 'YELLOW',
  changedAt: '2024-01-01T00:00:00Z',
  signals: { checkedAt: '2024-01-01T00:00:00Z' },
  reasons: [],
  deployId: 'deploy-123',
};

// First ingestion
const result1 = await ingestDeployStatusSignal(pool, signal);
console.log({
  isNew: result1.isNew, // true
  incidentId: result1.incident.id, // 'uuid-1'
  firstSeenAt: result1.incident.first_seen_at, // '2024-01-01T00:00:00Z'
});

// Second ingestion (same signal)
const result2 = await ingestDeployStatusSignal(pool, signal);
console.log({
  isNew: result2.isNew, // false
  incidentId: result2.incident.id, // 'uuid-1' (same)
  firstSeenAt: result2.incident.first_seen_at, // '2024-01-01T00:00:00Z' (unchanged)
  lastSeenAt: result2.incident.last_seen_at, // NOW() (updated)
});

// Evidence is deduplicated
console.log(result2.evidenceAdded); // 0 (already exists)
```

### Test 2: Evidence Deduplication

```typescript
// Same incident_key, different timestamps
const signal1 = {
  env: 'prod',
  status: 'RED',
  changedAt: '2024-01-01T00:00:00Z',
  signals: { checkedAt: '2024-01-01T00:00:00Z' },
  reasons: [{ code: 'HEALTH_FAIL', severity: 'error', message: 'Failed' }],
  deployId: 'deploy-123',
};

const signal2 = {
  ...signal1,
  changedAt: '2024-01-01T00:05:00Z', // Different time, same deployId
};

const result1 = await ingestDeployStatusSignal(pool, signal1);
const result2 = await ingestDeployStatusSignal(pool, signal2);

// Different incident_keys (due to changedAt)
console.log(result1.incident.incident_key);
// 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z'

console.log(result2.incident.incident_key);
// 'deploy_status:prod:deploy-123:2024-01-01T00:05:00Z'

// Both create separate incidents (different keys)
console.log(result1.incident.id !== result2.incident.id); // true
```

## Files Changed

### Implementation
- `control-center/src/lib/incident-ingestion/mappers.ts` (NEW, 730 lines)
- `control-center/src/lib/incident-ingestion/index.ts` (NEW, 390 lines)

### Tests
- `control-center/__tests__/lib/incident-ingestion/mappers.test.ts` (NEW, 580 lines)
- `control-center/__tests__/lib/incident-ingestion/index.test.ts` (NEW, 420 lines)

### Documentation
- `E76_2_IMPLEMENTATION_SUMMARY.md` (NEW, 384 lines)
- `E76_2_VERIFICATION_COMMANDS.md` (NEW, this file)

## Total Test Coverage

- ✅ 39 new tests (28 mapper + 11 orchestrator)
- ✅ 16 existing incident DB tests (compatibility)
- ✅ 0 security vulnerabilities (CodeQL)
- ✅ 0 type errors (TypeScript)

---

**Implementation Date**: 2026-01-03  
**Reference**: I762 (E76.2 - Incident Ingestion Pipelines)  
**Status**: ✅ Complete
