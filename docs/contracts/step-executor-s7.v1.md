# Step Executor S7 Contract v1 (E9.3-CTRL-06)

**Contract ID:** `step-executor-s7.v1`  
**Status:** Active  
**Owner:** Control Center  
**Issue:** E9.3-CTRL-06  
**Created:** 2026-02-05

## Overview

The S7 (Verify Gate) step executor implements explicit verification of deployment success. S7 evaluates evidence after deployment observation (S6) and sets an explicit verdict (GREEN/RED) with no implicit success.

## Purpose

S7 serves as the verification gate that:

1. **Accepts** evidence from deployment observations
2. **Evaluates** deployment success explicitly
3. **Sets** verdict GREEN or RED (no implicit success)
4. **Links** evidence to verdict for full traceability

## Preconditions

Before S7 can execute:

- Issue must be in `DONE` state (completed S6 deployment observation)
- Deployment observations must exist (from S6)
- Evidence must be available and linked
- No active lock on the issue

## Input Contract

### Database Schema Requirements

The executor expects the following issue data:

```typescript
interface IssueForS7 {
  id: string;                    // Issue UUID
  status: 'DONE';                // Must be in this state
  github_url: string;            // GitHub issue URL
  pr_url: string;                // GitHub PR URL (required)
  merge_sha?: string;            // Merge commit SHA from S5
}
```

### Step Executor Parameters

```typescript
interface ExecuteS7Params {
  issue: IssueForS7;
  runId: string;       // Loop run ID for traceability
  requestId: string;   // Request ID for correlation
  mode: 'execute' | 'dryRun';
  evidence: VerificationEvidence;  // Evidence for verification
}
```

### Evidence Schema

```typescript
interface VerificationEvidence {
  deploymentObservations: Array<{
    deploymentId: number;
    environment: string;
    sha: string;
    status: string;           // deployment status
    isAuthentic: boolean;
    observedAt: string;
  }>;
  healthChecks?: Array<{
    endpoint: string;
    status: number;
    responseTime: number;
    timestamp: string;
  }>;
  integrationTests?: {
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  errorRates?: {
    current: number;
    threshold: number;
  };
}
```

## Execution Logic

### Step 1: Evidence Validation

- **Check evidence exists**: Evidence must be provided
- **Validate evidence structure**: Must match schema
- **Verify evidence completeness**: Required fields present
- **Check evidence freshness**: Evidence should be recent

**Blocker codes** (if validation fails):
- `NO_EVIDENCE` - No evidence provided
- `INVALID_EVIDENCE` - Evidence schema invalid
- `STALE_EVIDENCE` - Evidence too old

### Step 2: Evaluate Deployment Success

Apply deterministic evaluation rules:

```typescript
function evaluateDeploymentSuccess(evidence: VerificationEvidence): Verdict {
  // Rule 1: At least one authentic deployment must exist
  const hasAuthenticDeployment = evidence.deploymentObservations.some(
    d => d.isAuthentic && d.status === 'success'
  );
  
  if (!hasAuthenticDeployment) {
    return 'RED';
  }
  
  // Rule 2: All health checks must pass (if present)
  if (evidence.healthChecks) {
    const allHealthy = evidence.healthChecks.every(
      h => h.status >= 200 && h.status < 300
    );
    if (!allHealthy) {
      return 'RED';
    }
  }
  
  // Rule 3: Integration tests must pass (if present)
  if (evidence.integrationTests) {
    if (evidence.integrationTests.failed > 0) {
      return 'RED';
    }
  }
  
  // Rule 4: Error rates must be below threshold (if present)
  if (evidence.errorRates) {
    if (evidence.errorRates.current > evidence.errorRates.threshold) {
      return 'RED';
    }
  }
  
  // All checks passed
  return 'GREEN';
}
```

### Step 3: Set Verdict Explicitly

No implicit success - verdict must be set explicitly:

```typescript
interface VerdictRecord {
  id: string;                     // UUID
  issue_id: string;               // Foreign key to afu9_issues
  run_id: string;                 // Foreign key to loop run
  verdict: 'GREEN' | 'RED';       // Explicit verdict (no null/undefined)
  evidence_id: string;            // Foreign key to evidence
  evaluated_at: string;           // When verdict was set
  evaluation_rules: string[];     // Rules that were applied
  decision_rationale: string;     // Why this verdict
}
```

**Critical**: Verdict is ALWAYS explicitly set - never null, never undefined, never implicit.

### Step 4: Link Evidence to Verdict

Create immutable link between evidence and verdict:

```typescript
interface EvidenceLink {
  verdict_id: string;             // Foreign key to verdict
  evidence_id: string;            // Foreign key to evidence
  evidence_hash: string;          // Hash for integrity
  linked_at: string;              // When link was created
}
```

### Step 5: Create Timeline Event

Record verification in timeline:

```typescript
{
  event_type: 'verification_completed',
  event_data: {
    runId: string;
    step: 'S7_VERIFY_GATE',
    stateBefore: 'DONE',
    stateAfter: 'VERIFIED' | 'HOLD',  // Based on verdict
    requestId: string;
    verdict: 'GREEN' | 'RED';
    evidenceId: string;
    evaluationRules: string[];
  }
}
```

## Output Contract

### Success Response (GREEN Verdict)

```typescript
interface S7GreenResult {
  success: true;
  runId: string;
  step: 'S7_VERIFY_GATE';
  stateBefore: 'DONE';
  stateAfter: 'VERIFIED';
  verdict: 'GREEN';
  verdictEvidence: {
    eventId: string;              // UUID of verification event
    verdictId: string;            // UUID of verdict record
    evidenceId: string;           // UUID of evidence
    evaluatedAt: string;          // ISO 8601 timestamp
    evaluationRules: string[];    // Rules that were applied
    rationale: string;            // Why GREEN
  };
  durationMs: number;
}
```

### Success Response (RED Verdict)

```typescript
interface S7RedResult {
  success: true;
  runId: string;
  step: 'S7_VERIFY_GATE';
  stateBefore: 'DONE';
  stateAfter: 'HOLD';
  verdict: 'RED';
  verdictEvidence: {
    eventId: string;
    verdictId: string;
    evidenceId: string;
    evaluatedAt: string;
    evaluationRules: string[];
    rationale: string;            // Why RED (e.g., "Health check failed")
    failedChecks: string[];       // Specific failures
  };
  durationMs: number;
}
```

### Blocked Response

```typescript
interface S7BlockedResult {
  success: false;
  blocked: true;
  blockerCode: BlockerCode;
  blockerMessage: string;
  runId: string;
  step: 'S7_VERIFY_GATE';
  stateBefore: string;
  stateAfter: string;  // State unchanged on block
}
```

## Block Reasons

| Block Reason | Description | Condition |
|--------------|-------------|-----------|
| `NO_EVIDENCE` | No evidence provided | evidence is null/empty |
| `INVALID_EVIDENCE` | Evidence schema invalid | evidence doesn't match schema |
| `STALE_EVIDENCE` | Evidence too old | evidence older than threshold |
| `NO_DEPLOYMENT_OBSERVATIONS` | No S6 observations found | S6 was not executed |

## Verdict Evaluation Rules

S7 applies deterministic evaluation rules:

1. **RULE_AUTHENTIC_DEPLOYMENT**: At least one authentic, successful deployment must exist
2. **RULE_HEALTH_CHECKS**: All health checks must return 2xx status (if present)
3. **RULE_INTEGRATION_TESTS**: Integration tests must have zero failures (if present)
4. **RULE_ERROR_RATES**: Error rates must be below threshold (if present)

**Evaluation order**: Rules are evaluated in order. First failure causes RED verdict.

**Determinism**: Same evidence → Same verdict (always)

## Event Types

S7 emits the following timeline events:

| Event Type | When | Required Fields |
|------------|------|-----------------|
| `verification_completed` | Verdict set successfully | runId, step, verdict, evidenceId, requestId |
| `loop_step_s7_completed` | S7 completed successfully | runId, step, stateBefore, stateAfter, requestId |
| `loop_run_blocked` | S7 blocked | runId, step, blockerCode, requestId |

## Fail-Closed Semantics

**Critical**: S7 implements fail-closed evaluation:

1. **No implicit success**: Verdict must be explicitly set
2. **No silent fallbacks**: All errors result in explicit blocker codes
3. **No default GREEN**: Absence of evidence is RED, not GREEN
4. **No ambiguous states**: Verdict is always GREEN or RED, never null/undefined

## Evidence Linking Guarantees

**Critical**: S7 ensures evidence is immutably linked:

1. **Unique link**: Each verdict has exactly one evidence link
2. **Integrity hash**: Evidence is hashed to detect tampering
3. **Immutable**: Evidence links cannot be modified after creation
4. **Traceable**: Full audit trail from evidence to verdict

## Idempotency Guarantees

**Critical**: S7 verification operations are idempotent:

1. **Duplicate-safe**: Same evidence evaluated multiple times produces same verdict
2. **Hash-based deduplication**: Evidence hash prevents duplicate evaluations
3. **No side effects on retry**: Retrying verification has no additional effects
4. **Deterministic outcome**: Same inputs → Same output

## State Machine Integration

### State Transition Rules

| Current State | Verdict | Next State | Condition |
|---------------|---------|------------|-----------|
| `DONE` | GREEN | `VERIFIED` | All checks passed |
| `DONE` | RED | `HOLD` | At least one check failed |
| Any other state | Any | Blocked | Invalid state for S7 |

### Post-Deployment Flow

S7 is executed after S6 (Deployment Observation):
1. S6 observes deployments → Issue remains `DONE`
2. S7 evaluates evidence → Verdict set explicitly
3. GREEN verdict → Issue transitions to `VERIFIED`
4. RED verdict → Issue transitions to `HOLD`

## Integration Points

### API Endpoint

S7 is exposed via API endpoint:

```typescript
POST /api/afu9/runs/:runId/verify

Request:
{
  evidence: VerificationEvidence;
}

Response (GREEN):
{
  verdict: 'GREEN';
  verdictId: string;
  evidenceId: string;
  evaluatedAt: string;
  rationale: string;
}

Response (RED):
{
  verdict: 'RED';
  verdictId: string;
  evidenceId: string;
  evaluatedAt: string;
  rationale: string;
  failedChecks: string[];
}
```

### Database Integration

S7 stores verdicts in `verification_verdicts` table:

```sql
CREATE TABLE verification_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id),
  run_id UUID NOT NULL REFERENCES loop_runs(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('GREEN', 'RED')),
  evidence_id UUID NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evaluation_rules TEXT[] NOT NULL,
  decision_rationale TEXT NOT NULL,
  failed_checks TEXT[] DEFAULT '{}',
  
  -- Unique constraint: one verdict per run
  UNIQUE(run_id)
);

CREATE TABLE verification_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES afu9_issues(id),
  evidence_hash TEXT NOT NULL,
  evidence_data JSONB NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  
  -- Unique constraint: one evidence per hash
  UNIQUE(evidence_hash)
);

CREATE TABLE evidence_links (
  verdict_id UUID NOT NULL REFERENCES verification_verdicts(id),
  evidence_id UUID NOT NULL REFERENCES verification_evidence(id),
  evidence_hash TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (verdict_id, evidence_id)
);
```

## Determinism Guarantees

The S7 verification operation is **deterministic**:

1. **Same inputs → Same output**: Given same evidence, always returns same verdict
2. **Stable evaluation rules**: Rules are fixed and versioned
3. **No time dependencies**: Decision based on evidence, not timing
4. **Reproducible**: Verdict can be recalculated from evidence

## Error Handling

### Transient Errors

- Database connection lost → Retry OR fail with blocker code
- Evidence unavailable → Retry OR fail with `NO_EVIDENCE`

### Permanent Errors

- Invalid evidence schema → Fail with `INVALID_EVIDENCE`
- No deployment observations → Fail with `NO_DEPLOYMENT_OBSERVATIONS`
- Stale evidence → Fail with `STALE_EVIDENCE`

All errors result in **explicit blocker code** (fail-closed).

## Testing

### Unit Tests

Required test cases:

1. **GREEN verdict conditions:**
   - Authentic deployment + no health checks → GREEN
   - Authentic deployment + passing health checks → GREEN
   - Authentic deployment + passing tests → GREEN

2. **RED verdict conditions:**
   - No authentic deployment → RED
   - Failed health check → RED
   - Failed integration tests → RED
   - High error rate → RED

3. **Blocked conditions:**
   - No evidence → Blocked with NO_EVIDENCE
   - Invalid evidence → Blocked with INVALID_EVIDENCE
   - Stale evidence → Blocked with STALE_EVIDENCE

4. **Determinism:**
   - Same evidence evaluated twice → Same verdict

### Integration Tests

1. Full S7 verification flow with evidence
2. Idempotency: Multiple verifications with same evidence
3. Evidence linking: Verify evidence is immutably linked
4. State transitions: DONE → VERIFIED (GREEN) / HOLD (RED)

## Acceptance Criteria

1. ✅ **Verdict is explicitly set**
   - No null/undefined verdicts
   - Always GREEN or RED
   - Never implicit success

2. ✅ **Evidence is linked**
   - Evidence immutably linked to verdict
   - Evidence hash for integrity
   - Full audit trail

3. ✅ **No implicit success**
   - Absence of evidence → RED (fail-closed)
   - All failures → Explicit blocker codes
   - No silent fallbacks

4. ✅ **Deterministic evaluation**
   - Same evidence → Same verdict
   - Reproducible outcomes
   - Versioned evaluation rules

## Version History

- **v1.0** (2026-02-05): Initial S7 Verify Gate implementation (E9.3-CTRL-06)

## Related Contracts

- [Step Executor S6 v1](./step-executor-s6.v1.md) - S6 Deployment Observation (precedes S7)
- [Loop State Machine v1](./loop-state-machine.v1.md) - State resolution logic
- [Loop Timeline Events v1](./loop-timeline-events.v1.md) - Timeline event structure

## Source of Truth

This contract is the canonical specification. Implementation resides in:
- Contract: `docs/contracts/step-executor-s7.v1.md` (this file)
- API Endpoint: `control-center/app/api/afu9/runs/[runId]/verify/route.ts`
- Service: `control-center/src/lib/verification/verificationService.ts`
- Database: `database/migrations/090_verification_verdicts.sql`
- Tests: `control-center/__tests__/api/afu9-runs-verify.test.ts`
