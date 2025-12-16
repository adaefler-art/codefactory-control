# Confidence Score Schema & Normalization

## Overview

The AFU-9 Verdict Engine uses a **normalized confidence score** to express the certainty of error classification. This score is deterministic, comparable, and fully documented for transparency and auditability.

**Key Properties:**
- **Scale**: 0-100 (integer)
- **Deterministic**: Identical inputs always produce identical scores
- **Comparable**: Scores can be compared across all verdicts and time periods
- **Documented**: Formula is public and immutable

## Score Scale

```
0   ────────────────────────────────────────────── 100
│                       │                           │
Low Confidence      Medium Confidence      High Confidence

0-49:   Low confidence - Uncertain classification
50-74:  Medium confidence - Likely correct classification  
75-89:  High confidence - Very likely correct classification
90-100: Very high confidence - Nearly certain classification
```

## Normalization Formula

### Mathematical Definition

The confidence score normalization converts the raw classifier confidence (0-1 range) to a 0-100 integer scale:

```
normalized_score = round(raw_confidence × 100)
```

**Where:**
- `raw_confidence`: Classifier confidence in range [0, 1]
- `round()`: Standard mathematical rounding (half-up)
- `normalized_score`: Output score in range [0, 100]

### Implementation

The normalization is implemented in `packages/verdict-engine/src/engine.ts`:

```typescript
export function normalizeConfidenceScore(rawConfidence: number): number {
  // Validate input range
  if (rawConfidence < 0 || rawConfidence > 1) {
    throw new Error(`Invalid confidence: ${rawConfidence}. Must be between 0 and 1.`);
  }
  
  // Scale to 0-100 and round to integer for determinism
  return Math.round(rawConfidence * 100);
}
```

### Rounding Behavior

JavaScript's `Math.round()` uses **half-up rounding** (banker's rounding):

| Raw Confidence | Calculation | Normalized Score |
|----------------|-------------|------------------|
| 0.0            | 0 × 100 = 0 | **0** |
| 0.5            | 0.5 × 100 = 50 | **50** |
| 0.854          | 0.854 × 100 = 85.4 | **85** |
| 0.855          | 0.855 × 100 = 85.5 | **86** |
| 0.9            | 0.9 × 100 = 90 | **90** |
| 0.95           | 0.95 × 100 = 95 | **95** |
| 1.0            | 1.0 × 100 = 100 | **100** |

## Error Class Confidence Levels

Each error class in the Deploy Memory classifier has a predefined confidence level:

| Error Class | Raw Confidence | Normalized Score | Rationale |
|-------------|----------------|------------------|-----------|
| **ACM_DNS_VALIDATION_PENDING** | 0.90 | **90** | Well-defined pattern, low ambiguity |
| **ROUTE53_DELEGATION_PENDING** | 0.90 | **90** | Clear DNS delegation signals |
| **CFN_IN_PROGRESS_LOCK** | 0.95 | **95** | Explicit CloudFormation state |
| **CFN_ROLLBACK_LOCK** | 0.95 | **95** | Explicit CloudFormation state |
| **MISSING_SECRET** | 0.85 | **85** | Pattern-based, some variation |
| **MISSING_ENV_VAR** | 0.80 | **80** | Multiple possible patterns |
| **DEPRECATED_CDK_API** | 0.75 | **75** | Requires API version analysis |
| **UNIT_MISMATCH** | 0.80 | **80** | Context-dependent validation |
| **UNKNOWN** | 0.50 | **50** | Fallback classification |

## Determinism Guarantees

### Property: Reproducibility

**Guarantee:** Given identical input signals, the Verdict Engine will always produce the same confidence score.

**Proof:**
1. Classifier produces deterministic raw confidence based on pattern matching
2. Normalization uses pure mathematical function (`Math.round`)
3. No external state or randomness involved
4. Input validation ensures range constraints

### Validation

The determinism property is validated in tests:

```typescript
// Test: Identical signals produce identical scores
const signals1 = [/* same signals */];
const signals2 = [/* same signals */];

const verdict1 = generateVerdict({ execution_id: 'test-1', signals: signals1 });
const verdict2 = generateVerdict({ execution_id: 'test-2', signals: signals2 });

assert(verdict1.confidence_score === verdict2.confidence_score);
assert(verdict1.fingerprint_id === verdict2.fingerprint_id);
assert(verdict1.error_class === verdict2.error_class);
```

## Consistency Metrics

### Verdict Consistency Score

The system tracks a **Verdict Consistency KPI** to monitor determinism in production:

```
Consistency Score = (consistent_groups / total_groups) × 100
```

**Where:**
- **Consistent group**: All verdicts with same fingerprint have identical error_class and confidence_score
- **Total groups**: Number of unique fingerprint IDs
- **Target**: >95% consistency

### Monitoring

Consistency is monitored via:
1. **Factory Status API**: Real-time consistency score in `/api/v1/factory/status`
2. **Database views**: `verdict_statistics` aggregates consistency metrics
3. **Audit logs**: Track any inconsistencies for investigation

## API Response Format

### Verdict Response

```json
{
  "id": "verdict-abc123",
  "executionId": "exec-456",
  "errorClass": "ACM_DNS_VALIDATION_PENDING",
  "service": "ACM",
  "confidenceScore": 90,
  "proposedAction": "WAIT_AND_RETRY",
  "fingerprintId": "fingerprint-xyz",
  "policyVersion": "v1.0.0",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Field Details:**
- `confidenceScore`: Integer in range [0, 100]
- Always normalized using the documented formula
- Deterministic for identical error patterns

### KPI Response

```json
{
  "verdicts": {
    "kpis": {
      "totalVerdicts": 245,
      "avgConfidence": 87,
      "consistencyScore": 98
    }
  }
}
```

**Field Details:**
- `avgConfidence`: Average of all normalized scores (0-100)
- `consistencyScore`: Percentage of consistent fingerprint groups (0-100)

## Auditability

### Policy Snapshot Reference

Every verdict includes:
- **policy_snapshot_id**: Immutable reference to classification rules
- **policy_version**: Human-readable version (e.g., "v1.0.0")
- **confidence_normalization**: Policy metadata with formula

Example policy snapshot:

```json
{
  "id": "policy-v1.0.0",
  "version": "v1.0.0",
  "policies": {
    "confidence_normalization": {
      "scale": "0-100",
      "formula": "round(raw_confidence * 100)",
      "deterministic": true
    }
  }
}
```

### Audit Trail

All verdicts are auditable via:
1. **Immutable policy snapshots**: Rules cannot change retroactively
2. **Raw signals preserved**: Original failure data stored with verdict
3. **Timestamps**: Creation time tracked
4. **Audit log**: Lifecycle events recorded

## Usage Examples

### Example 1: ACM DNS Validation

**Input:**
```typescript
const signals: CfnFailureSignal[] = [
  {
    resourceType: 'AWS::CertificateManager::Certificate',
    logicalId: 'Certificate',
    statusReason: 'DNS validation is pending',
    timestamp: new Date(),
  },
];
```

**Processing:**
1. Classifier matches pattern → `ACM_DNS_VALIDATION_PENDING`
2. Classifier confidence → `0.9`
3. Normalization → `Math.round(0.9 * 100)` = **90**
4. Result: confidenceScore = **90**

### Example 2: Missing Secret

**Input:**
```typescript
const signals: CfnFailureSignal[] = [
  {
    resourceType: 'AWS::Lambda::Function',
    logicalId: 'Function',
    statusReason: 'ResourceNotFoundException: Secrets Manager cannot find secret',
    timestamp: new Date(),
  },
];
```

**Processing:**
1. Classifier matches pattern → `MISSING_SECRET`
2. Classifier confidence → `0.85`
3. Normalization → `Math.round(0.85 * 100)` = **85**
4. Result: confidenceScore = **85**

### Example 3: Unknown Error

**Input:**
```typescript
const signals: CfnFailureSignal[] = [
  {
    resourceType: 'AWS::CustomResource',
    logicalId: 'Custom',
    statusReason: 'Unexpected error occurred',
    timestamp: new Date(),
  },
];
```

**Processing:**
1. Classifier no pattern match → `UNKNOWN`
2. Classifier confidence → `0.5` (fallback)
3. Normalization → `Math.round(0.5 * 100)` = **50**
4. Result: confidenceScore = **50**

## Validation

### Input Validation

The normalization function validates inputs:

```typescript
// Valid inputs
normalizeConfidenceScore(0.0);   // ✓ Returns 0
normalizeConfidenceScore(0.5);   // ✓ Returns 50
normalizeConfidenceScore(1.0);   // ✓ Returns 100

// Invalid inputs
normalizeConfidenceScore(-0.1);  // ✗ Throws Error
normalizeConfidenceScore(1.5);   // ✗ Throws Error
normalizeConfidenceScore(NaN);   // ✗ Throws Error
```

### Output Validation

The audit system validates verdicts:

```typescript
// Valid confidence scores
{ confidenceScore: 0 }    // ✓
{ confidenceScore: 50 }   // ✓
{ confidenceScore: 100 }  // ✓

// Invalid confidence scores
{ confidenceScore: -1 }   // ✗ Audit fails
{ confidenceScore: 101 }  // ✗ Audit fails
{ confidenceScore: 85.5 } // ✗ Audit fails (not integer)
```

## Testing

### Test Coverage

Confidence score normalization has comprehensive test coverage:

1. **Boundary tests**: 0, 0.5, 1.0
2. **Rounding tests**: 0.854, 0.855, 0.856
3. **Error class tests**: All 9 error classes
4. **Determinism tests**: Identical inputs → identical outputs
5. **Validation tests**: Invalid inputs throw errors
6. **Consistency tests**: Fingerprint-based consistency tracking

See: `packages/verdict-engine/__tests__/engine.test.ts`

## Change Policy

### Immutability

The normalization formula is **immutable** and cannot be changed for existing policy snapshots. Any future changes would:

1. Create a new policy snapshot with new version
2. New verdicts use new policy snapshot
3. Old verdicts remain unchanged
4. Full audit trail of policy evolution

### Versioning

Policy snapshots are versioned (e.g., v1.0.0, v1.1.0):
- **Major version**: Breaking changes to formula or scale
- **Minor version**: New error classes or patterns
- **Patch version**: Documentation or bug fixes

Current version: **v1.0.0**

## References

- **Implementation**: `packages/verdict-engine/src/engine.ts`
- **Tests**: `packages/verdict-engine/__tests__/engine.test.ts`
- **API Documentation**: `docs/FACTORY_STATUS_API.md`
- **Package README**: `packages/verdict-engine/README.md`
- **Deploy Memory**: `packages/deploy-memory/src/classifier.ts`
- **Validation Examples**: `docs/examples/confidence-score-validation.md`

## Contact

For questions or issues regarding confidence score normalization:
1. Review this documentation
2. Check validation examples in `docs/examples/confidence-score-validation.md`
3. Check test suite for examples
4. Consult the Verdict Engine README
5. Open a GitHub issue with details
