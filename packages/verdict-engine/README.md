# Verdict Engine v1.1 - Governance & Auditability

**EPIC 2 Implementation** - Provides governance, auditability, and deterministic verdict evaluation for AFU-9.

## Overview

The Verdict Engine v1.1 enhances the AFU-9 system with:

1. **Policy Snapshotting** (Issue 2.1): Immutable policy snapshots per run for full auditability
2. **Confidence Score Normalization** (Issue 2.2): Deterministic 0-100 scale confidence scoring

## Key Features

### 1. Normalized Confidence Scores

All confidence scores are normalized to a 0-100 integer scale:

- **Deterministic**: Identical inputs always produce identical scores
- **Comparable**: Easy comparison across verdicts and time periods
- **Documented**: Simple formula: `round(raw_confidence * 100)`

```typescript
// Example: Classifier returns 0.9 → Verdict Engine returns 90
const rawConfidence = 0.9; // From classifier
const normalizedScore = normalizeConfidenceScore(rawConfidence); // Returns 90
```

### 2. Immutable Policy Snapshots

Every verdict references an immutable policy snapshot:

```typescript
interface PolicySnapshot {
  id: string;
  version: string; // e.g., "v1.0.0"
  policies: {
    classification_rules: ClassificationRule[];
    playbooks: Record<ErrorClass, FactoryAction>;
    confidence_normalization: {
      scale: "0-100";
      formula: "raw * 100";
      deterministic: true;
    };
  };
  created_at: string;
}
```

Policy snapshots are:
- **Immutable**: Cannot be changed after creation
- **Versioned**: Each snapshot has a unique version identifier
- **Referenced**: Every verdict links to its policy snapshot
- **Auditable**: Full history preserved for compliance

### 3. Complete Auditability

Every verdict includes:
- Execution ID (which workflow run)
- Policy snapshot ID (which rules were used)
- Fingerprint ID (stable identifier for error pattern)
- Raw signals (original failure data)
- Confidence score (normalized 0-100)
- Proposed action (what to do next)
- Timestamp (when verdict was created)

## Database Schema

### Tables

1. **policy_snapshots**: Immutable policy versions
2. **verdicts**: Verdict records with normalized confidence
3. **verdict_audit_log**: Audit trail for verdict lifecycle
4. **verdicts_with_policy** (view): Verdicts with policy information
5. **verdict_statistics** (view): Aggregated statistics

See `database/migrations/004_verdict_engine.sql` for complete schema.

## Usage

### Creating a Verdict

```typescript
import { generateVerdict, storeVerdict } from '@codefactory/verdict-engine';
import { getPool } from './db';

// 1. Get failure signals from deployment
const signals: CfnFailureSignal[] = [
  {
    resourceType: 'AWS::CertificateManager::Certificate',
    logicalId: 'Certificate',
    statusReason: 'DNS validation is pending',
    timestamp: new Date(),
  },
];

// 2. Generate verdict (deterministic, no side effects)
const verdict = generateVerdict({
  execution_id: 'exec-123',
  policy_snapshot_id: 'policy-v1.0.0',
  signals,
});

// 3. Store verdict in database
const pool = getPool();
const storedVerdict = await storeVerdict(pool, verdict);

console.log(storedVerdict);
// {
//   id: 'uuid...',
//   execution_id: 'exec-123',
//   error_class: 'ACM_DNS_VALIDATION_PENDING',
//   confidence_score: 90,  // Normalized 0-100
//   proposed_action: 'WAIT_AND_RETRY',
//   policy_snapshot_id: 'policy-v1.0.0',
//   ...
// }
```

### Querying Verdicts

```typescript
import { queryVerdicts } from '@codefactory/verdict-engine';

// Query by execution
const executionVerdicts = await queryVerdicts(pool, {
  execution_id: 'exec-123',
});

// Query by confidence range
const highConfidenceVerdicts = await queryVerdicts(pool, {
  min_confidence: 80,
  max_confidence: 100,
});

// Query by error class
const acmVerdicts = await queryVerdicts(pool, {
  error_class: 'ACM_DNS_VALIDATION_PENDING',
});
```

### Auditability

```typescript
import { getVerdictWithPolicy, auditVerdict } from '@codefactory/verdict-engine';

// Get verdict with full policy information
const verdictWithPolicy = await getVerdictWithPolicy(pool, verdictId);

console.log(verdictWithPolicy);
// {
//   ...verdict fields,
//   policy_version: 'v1.0.0',
//   policy_definition: { /* full policy */ },
//   workflow_id: 'wf-123',
//   execution_status: 'failed',
// }

// Audit a verdict for compliance
const snapshot = await getPolicySnapshot(pool, verdict.policy_snapshot_id);
const audit = auditVerdict(verdict, snapshot);

if (audit.compliant) {
  console.log('Verdict is compliant with policy', audit.policy_version);
} else {
  console.error('Compliance issues:', audit.issues);
}
```

### Consistency Metrics

```typescript
import { calculateConsistencyMetrics } from '@codefactory/verdict-engine';

// Get all verdicts
const verdicts = await queryVerdicts(pool, { limit: 1000 });

// Calculate consistency metrics
const metrics = calculateConsistencyMetrics(verdicts);

console.log(metrics);
// {
//   total: 1000,
//   avg_confidence: 87,
//   consistency_score: 98, // 98% of fingerprint groups are consistent
//   by_error_class: {
//     ACM_DNS_VALIDATION_PENDING: { count: 150, avg_confidence: 90 },
//     MISSING_SECRET: { count: 75, avg_confidence: 85 },
//     ...
//   }
// }
```

## Factory Status API Integration

The Verdict Engine is integrated into the Factory Status API (v1.1.0):

```typescript
GET /api/v1/factory/status

Response:
{
  "api": { "version": "1.1.0" },
  "timestamp": "2024-01-15T10:00:00Z",
  "runs": { ... },
  "errors": { ... },
  "kpis": { ... },
  "verdicts": {
    "enabled": true,
    "summary": [
      {
        "id": "verdict-123",
        "executionId": "exec-456",
        "errorClass": "ACM_DNS_VALIDATION_PENDING",
        "confidenceScore": 90,
        "proposedAction": "WAIT_AND_RETRY",
        "policyVersion": "v1.0.0",
        ...
      }
    ],
    "kpis": {
      "totalVerdicts": 245,
      "avgConfidence": 87,
      "consistencyScore": 98,
      "byAction": {
        "waitAndRetry": 120,
        "openIssue": 100,
        "humanRequired": 25
      },
      "topErrorClasses": [
        { "errorClass": "ACM_DNS_VALIDATION_PENDING", "count": 50, "avgConfidence": 90 },
        ...
      ]
    }
  }
}
```

## KPI Metrics

### Auditability (Issue 2.1)
- Every verdict references an immutable policy snapshot
- Full audit trail in `verdict_audit_log` table
- Complete traceability from verdict → policy → execution → workflow

### Verdict Consistency (Issue 2.2)
- **Consistency Score**: Percentage of fingerprint groups with consistent verdicts
- Target: >95% consistency
- Formula: `(consistent_groups / total_groups) * 100`

Consistent groups are those where all verdicts with the same fingerprint have:
- Same error class
- Same confidence score

## Error Classes

The Verdict Engine classifies errors into these classes:

1. **ACM_DNS_VALIDATION_PENDING** (90% confidence)
   - Action: WAIT_AND_RETRY
   - DNS validation in progress

2. **ROUTE53_DELEGATION_PENDING** (90% confidence)
   - Action: HUMAN_REQUIRED
   - NS records need configuration

3. **CFN_IN_PROGRESS_LOCK** (95% confidence)
   - Action: WAIT_AND_RETRY
   - Stack update in progress

4. **CFN_ROLLBACK_LOCK** (95% confidence)
   - Action: OPEN_ISSUE
   - Stack rollback, needs investigation

5. **MISSING_SECRET** (85% confidence)
   - Action: OPEN_ISSUE
   - Secret not found in Secrets Manager

6. **MISSING_ENV_VAR** (80% confidence)
   - Action: OPEN_ISSUE
   - Required environment variable missing

7. **DEPRECATED_CDK_API** (75% confidence)
   - Action: OPEN_ISSUE
   - Using deprecated CDK API

8. **UNIT_MISMATCH** (80% confidence)
   - Action: OPEN_ISSUE
   - Incorrect units (MB vs MiB, etc.)

9. **UNKNOWN** (50% confidence)
   - Action: OPEN_ISSUE
   - Unclassified error

## API Reference

### Core Functions

#### `normalizeConfidenceScore(rawConfidence: number): number`
Normalize confidence from 0-1 to 0-100 scale.

#### `generateVerdict(input: CreateVerdictInput): Verdict`
Generate a verdict from failure signals (pure function).

#### `validateDeterminism(signals1, signals2): boolean`
Validate that identical signals produce identical verdicts.

#### `calculateConsistencyMetrics(verdicts): ConsistencyMetrics`
Calculate consistency metrics for verdict analysis.

#### `auditVerdict(verdict, policySnapshot): AuditResult`
Audit a verdict for compliance with policy.

### Database Functions

#### `storePolicySnapshot(pool, snapshot): Promise<PolicySnapshot>`
Store an immutable policy snapshot.

#### `getLatestPolicySnapshot(pool): Promise<PolicySnapshot>`
Get the most recent policy snapshot.

#### `storeVerdict(pool, verdict): Promise<Verdict>`
Store a verdict in the database.

#### `getVerdictsByExecution(pool, executionId): Promise<Verdict[]>`
Get all verdicts for a workflow execution.

#### `queryVerdicts(pool, params): Promise<Verdict[]>`
Query verdicts with filters.

#### `getVerdictWithPolicy(pool, verdictId): Promise<VerdictWithPolicy>`
Get verdict with full policy information for auditability.

#### `getVerdictStatistics(pool): Promise<VerdictStatistics[]>`
Get aggregated verdict statistics.

## Testing

Run the test suite:

```bash
cd packages/verdict-engine
npm test
```

Test coverage includes:
- Confidence score normalization (all ranges, edge cases)
- Verdict generation (all error classes)
- Determinism validation
- Consistency metrics calculation
- Audit functionality
- All 25 tests passing

## Migration

To apply the Verdict Engine schema:

```bash
psql -h <host> -U <user> -d <database> -f database/migrations/004_verdict_engine.sql
```

This creates:
- Tables: `policy_snapshots`, `verdicts`, `verdict_audit_log`
- Views: `verdicts_with_policy`, `verdict_statistics`
- Initial policy snapshot (v1.0.0)

## Future Enhancements

Potential improvements for future versions:

1. **Policy Evolution**: Track policy changes over time
2. **Verdict Overrides**: Allow human override of verdicts with audit trail
3. **ML-based Classification**: Enhance confidence scoring with ML models
4. **Custom Policies**: Allow per-product custom policies
5. **Verdict Expiry**: Auto-expire old verdicts based on age

## Related Documentation

- [AFU-9 Roadmap v0.3](../docs/roadmaps/afu9_roadmap_v0_3_issues.md) - EPIC 2
- [Factory Status API](../docs/FACTORY_STATUS_API.md) - Integration documentation
- [Deploy Memory](../packages/deploy-memory/README.md) - Classification engine
- [Database Schema](../database/README.md) - Database structure

## Support

For issues or questions:
1. Check existing GitHub issues
2. Review the test suite for usage examples
3. Consult the deploy-memory package documentation
4. Open a new issue with reproduction steps
