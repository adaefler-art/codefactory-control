# Confidence Score Validation Examples

This document provides practical examples to validate the deterministic behavior of the confidence score normalization.

## Quick Validation

### Test 1: Basic Normalization

```typescript
import { normalizeConfidenceScore } from '@codefactory/verdict-engine';

// Test boundary values
console.log(normalizeConfidenceScore(0.0));   // Output: 0
console.log(normalizeConfidenceScore(0.5));   // Output: 50
console.log(normalizeConfidenceScore(1.0));   // Output: 100

// Test typical classifier values
console.log(normalizeConfidenceScore(0.9));   // Output: 90  (ACM_DNS_VALIDATION_PENDING)
console.log(normalizeConfidenceScore(0.85));  // Output: 85  (MISSING_SECRET)
console.log(normalizeConfidenceScore(0.95));  // Output: 95  (CFN_ROLLBACK_LOCK)
```

### Test 2: Rounding Behavior

```typescript
// Test rounding edge cases
console.log(normalizeConfidenceScore(0.854)); // Output: 85  (rounds down)
console.log(normalizeConfidenceScore(0.855)); // Output: 86  (rounds up)
console.log(normalizeConfidenceScore(0.856)); // Output: 86  (rounds up)
```

### Test 3: Determinism

```typescript
import { generateVerdict } from '@codefactory/verdict-engine';
import { CfnFailureSignal } from '@codefactory/deploy-memory';

// Same signals should produce same verdict
const signals: CfnFailureSignal[] = [
  {
    resourceType: 'AWS::CertificateManager::Certificate',
    logicalId: 'Certificate',
    statusReason: 'DNS validation is pending',
    timestamp: new Date('2024-01-01'),
  },
];

const verdict1 = generateVerdict({
  execution_id: 'exec-1',
  policy_snapshot_id: 'policy-v1',
  signals,
});

const verdict2 = generateVerdict({
  execution_id: 'exec-2',
  policy_snapshot_id: 'policy-v1',
  signals,
});

// These should be identical
console.log(verdict1.confidence_score === verdict2.confidence_score); // true
console.log(verdict1.error_class === verdict2.error_class);           // true
console.log(verdict1.fingerprint_id === verdict2.fingerprint_id);     // true
```

## Validation via Database

```sql
-- Check consistency for ACM DNS Validation errors
SELECT 
  fingerprint_id,
  error_class,
  confidence_score,
  COUNT(*) as verdict_count
FROM verdicts
WHERE error_class = 'ACM_DNS_VALIDATION_PENDING'
GROUP BY fingerprint_id, error_class, confidence_score
ORDER BY verdict_count DESC;

-- Should return groups where all verdicts have confidence_score = 90
```

## Expected Results Summary

| Error Class | Raw Confidence | Normalized Score | Deterministic? |
|-------------|----------------|------------------|----------------|
| ACM_DNS_VALIDATION_PENDING | 0.9 | 90 | ✅ Yes |
| ROUTE53_DELEGATION_PENDING | 0.9 | 90 | ✅ Yes |
| CFN_IN_PROGRESS_LOCK | 0.95 | 95 | ✅ Yes |
| CFN_ROLLBACK_LOCK | 0.95 | 95 | ✅ Yes |
| MISSING_SECRET | 0.85 | 85 | ✅ Yes |
| MISSING_ENV_VAR | 0.8 | 80 | ✅ Yes |
| DEPRECATED_CDK_API | 0.75 | 75 | ✅ Yes |
| UNIT_MISMATCH | 0.8 | 80 | ✅ Yes |
| UNKNOWN | 0.5 | 50 | ✅ Yes |

## References

- [Confidence Score Schema](../CONFIDENCE_SCORE_SCHEMA.md) - Complete documentation
- [Factory Status API](../FACTORY_STATUS_API.md) - API documentation
- [Verdict Engine Tests](../../packages/verdict-engine/__tests__/engine.test.ts) - Test suite
