# Canonical Verdict Types for AFU-9 Decision Authority

**Date**: 2025-12-20  
**Status**: Defined  
**EPIC**: B — Verdict Engine & Decision Authority

## Overview

This document defines the canonical verdict types used in the AFU-9 Verdict Engine. These types represent the overall decision outcome or status of a verdict, providing a standardized way to communicate the result of automated decision-making processes.

## Purpose

Verdict types serve as a high-level classification of decision outcomes, distinct from:
- **Error Classes** (e.g., `ACM_DNS_VALIDATION_PENDING`) - What type of error occurred
- **Factory Actions** (e.g., `WAIT_AND_RETRY`) - What action to take

Verdict types answer the question: **"What is the overall decision status?"**

## Industry Standards

These types are based on industry standards from:
- **CI/CD Systems**: Jenkins, GitLab CI, Azure DevOps, CircleCI
- **Automated Decision-Making**: OECD governance frameworks, regulatory compliance systems
- **Testing Frameworks**: JUnit, pytest, quality gate systems

## Canonical Verdict Types

### 1. APPROVED ✅

**Definition**: The deployment/change is safe and approved to proceed.

**When to Use**:
- No errors detected
- All checks passed successfully
- Automated approval criteria met
- System is operating normally

**Typical Factory Actions**:
- None needed (proceeding normally)

**Confidence Range**: 
- High confidence (85-100)
- Positive outcome confirmed

**Examples**:
```typescript
// No deployment errors, all systems operational
{
  verdict_type: VerdictType.APPROVED,
  error_class: null,
  proposed_action: null,
  confidence_score: 100
}
```

**Color Coding**: 🟢 Green

---

### 2. REJECTED ❌

**Definition**: The deployment/change must not proceed due to critical issues.

**When to Use**:
- Critical errors detected
- Security vulnerabilities found
- Policy violations identified
- Configuration errors requiring fixes

**Typical Factory Actions**:
- `OPEN_ISSUE` - Create issue for investigation and remediation

**Confidence Range**:
- Medium to high confidence (70-100)
- Clear indication of problems

**Examples**:
```typescript
// Missing required secret in Secrets Manager
{
  verdict_type: VerdictType.REJECTED,
  error_class: 'MISSING_SECRET',
  proposed_action: 'OPEN_ISSUE',
  confidence_score: 85
}

// CloudFormation rollback detected
{
  verdict_type: VerdictType.REJECTED,
  error_class: 'CFN_ROLLBACK_LOCK',
  proposed_action: 'OPEN_ISSUE',
  confidence_score: 95
}
```

**Color Coding**: 🔴 Red

---

### 3. DEFERRED ⏸️

**Definition**: Decision postponed, awaiting additional information or time.

**When to Use**:
- Transient conditions that may resolve with time
- Waiting for external dependencies (DNS propagation, certificate validation)
- Time-based delays needed
- Resource availability pending

**Typical Factory Actions**:
- `WAIT_AND_RETRY` - Retry after a delay

**Confidence Range**:
- High confidence (80-100)
- Clear understanding of temporary nature

**Examples**:
```typescript
// ACM certificate DNS validation in progress
{
  verdict_type: VerdictType.DEFERRED,
  error_class: 'ACM_DNS_VALIDATION_PENDING',
  proposed_action: 'WAIT_AND_RETRY',
  confidence_score: 90
}
```

**Typical Duration**: Minutes to hours (depends on external process)

**Color Coding**: 🟡 Yellow

---

### 4. ESCALATED 👤

**Definition**: Requires human intervention to make final decision.

**When to Use**:
- Ambiguous situation requiring human judgment
- High-risk changes needing manual approval
- Automated decision confidence too low
- Complex scenarios without clear resolution path

**Typical Factory Actions**:
- `HUMAN_REQUIRED` - Request human review and decision

**Confidence Range**:
- Low to medium confidence (0-75)
- Uncertainty in automated classification

**Examples**:
```typescript
// Route53 NS record configuration requires manual setup
{
  verdict_type: VerdictType.ESCALATED,
  error_class: 'ROUTE53_DELEGATION_PENDING',
  proposed_action: 'HUMAN_REQUIRED',
  confidence_score: 90
}

// Unknown error with low confidence
{
  verdict_type: VerdictType.ESCALATED,
  error_class: 'UNKNOWN',
  proposed_action: 'HUMAN_REQUIRED',
  confidence_score: 50
}
```

**Color Coding**: 🟣 Purple

---

### 5. WARNING ⚠️

**Definition**: Proceed with caution - issues detected but not critical.

**When to Use**:
- Minor issues that don't block deployment
- Deprecated patterns detected
- Sub-optimal configurations
- Best practice violations

**Typical Factory Actions**:
- `OPEN_ISSUE` (low priority) - Document for future improvement

**Confidence Range**:
- Medium confidence (60-90)
- Non-critical concerns identified

**Examples**:
```typescript
// Deprecated CDK API usage
{
  verdict_type: VerdictType.WARNING,
  error_class: 'DEPRECATED_CDK_API',
  proposed_action: 'OPEN_ISSUE',
  confidence_score: 75
}

// Unit mismatch in configuration
{
  verdict_type: VerdictType.WARNING,
  error_class: 'UNIT_MISMATCH',
  proposed_action: 'OPEN_ISSUE',
  confidence_score: 80
}
```

**Color Coding**: 🟠 Orange

---

### 6. BLOCKED 🚫

**Definition**: Cannot proceed due to external constraints or resource locks.

**When to Use**:
- Resource locks prevent action
- CloudFormation stack operations in progress
- Missing prerequisites
- Conflicting operations ongoing

**Typical Factory Actions**:
- `WAIT_AND_RETRY` - Wait for lock to clear
- `HUMAN_REQUIRED` - Manual intervention if lock persists

**Confidence Range**:
- High confidence (85-100)
- Clear identification of blocking condition

**Examples**:
```typescript
// CloudFormation stack update in progress
{
  verdict_type: VerdictType.BLOCKED,
  error_class: 'CFN_IN_PROGRESS_LOCK',
  proposed_action: 'WAIT_AND_RETRY',
  confidence_score: 95
}

// CloudFormation rollback blocking new operations
{
  verdict_type: VerdictType.BLOCKED,
  error_class: 'CFN_ROLLBACK_LOCK',
  proposed_action: 'OPEN_ISSUE',
  confidence_score: 95
}
```

**Color Coding**: ⚫ Dark Gray

---

### 7. PENDING ⏳

**Definition**: Verdict generation in progress or not yet determined.

**When to Use**:
- Initial state before analysis
- Awaiting additional signals
- Classification ongoing
- Intermediate state during processing

**Typical Factory Actions**:
- None yet (decision not made)

**Confidence Range**:
- N/A (no decision yet)

**Examples**:
```typescript
// Verdict creation initiated but not completed
{
  verdict_type: VerdictType.PENDING,
  error_class: null,
  proposed_action: null,
  confidence_score: 0
}
```

**Color Coding**: ⚪ Light Gray

---

## Decision Logic

### Verdict Type Determination Algorithm

The verdict type is determined by the `determineVerdictType()` function using this logic:

```typescript
function determineVerdictType(
  errorClass: ErrorClass,
  proposedAction: FactoryAction,
  confidenceScore: number
): VerdictType {
  // 1. Special cases: CloudFormation locks
  if (errorClass === 'CFN_IN_PROGRESS_LOCK' || errorClass === 'CFN_ROLLBACK_LOCK') {
    return VerdictType.BLOCKED;
  }

  // 2. Special cases: Deprecated APIs
  if (errorClass === 'DEPRECATED_CDK_API') {
    return VerdictType.WARNING;
  }

  // 3. Low confidence threshold
  if (confidenceScore < 60) {
    return VerdictType.ESCALATED;
  }

  // 4. Default mapping by factory action
  const mapping = {
    'WAIT_AND_RETRY': VerdictType.DEFERRED,
    'OPEN_ISSUE': VerdictType.REJECTED,
    'HUMAN_REQUIRED': VerdictType.ESCALATED,
  };
  
  return mapping[proposedAction] || VerdictType.PENDING;
}
```

### Mapping Table

| Error Class | Factory Action | Confidence | Verdict Type |
|-------------|----------------|------------|--------------|
| `ACM_DNS_VALIDATION_PENDING` | `WAIT_AND_RETRY` | 90 | `DEFERRED` |
| `ROUTE53_DELEGATION_PENDING` | `HUMAN_REQUIRED` | 90 | `ESCALATED` |
| `CFN_IN_PROGRESS_LOCK` | `WAIT_AND_RETRY` | 95 | `BLOCKED` ⚡ |
| `CFN_ROLLBACK_LOCK` | `OPEN_ISSUE` | 95 | `BLOCKED` ⚡ |
| `MISSING_SECRET` | `OPEN_ISSUE` | 85 | `REJECTED` |
| `MISSING_ENV_VAR` | `OPEN_ISSUE` | 80 | `REJECTED` |
| `DEPRECATED_CDK_API` | `OPEN_ISSUE` | 75 | `WARNING` ⚡ |
| `UNIT_MISMATCH` | `OPEN_ISSUE` | 80 | `REJECTED` |
| `UNKNOWN` | `OPEN_ISSUE` | 50 | `ESCALATED` ⚡ |

⚡ = Special case override in logic

## Usage Examples

### Creating a Verdict with Type

```typescript
import { generateVerdict, VerdictType } from '@codefactory/verdict-engine';

// Generate verdict from signals
const verdict = generateVerdict({
  execution_id: 'exec-123',
  policy_snapshot_id: 'policy-v1.0.0',
  signals: [
    {
      resourceType: 'AWS::CertificateManager::Certificate',
      logicalId: 'Certificate',
      statusReason: 'DNS validation is pending',
      timestamp: new Date(),
    },
  ],
});

console.log(verdict.verdict_type); // VerdictType.DEFERRED
console.log(verdict.error_class);  // 'ACM_DNS_VALIDATION_PENDING'
console.log(verdict.proposed_action); // 'WAIT_AND_RETRY'
```

### Querying Verdicts by Type

```typescript
import { queryVerdicts, VerdictType } from '@codefactory/verdict-engine';

// Get all rejected verdicts
const rejected = await queryVerdicts(pool, {
  verdict_type: VerdictType.REJECTED,
});

// Get all verdicts requiring human intervention
const needsHuman = await queryVerdicts(pool, {
  verdict_type: VerdictType.ESCALATED,
});
```

### Filtering in UI

```typescript
// Display verdicts by severity
const criticalVerdicts = verdicts.filter(v => 
  v.verdict_type === VerdictType.REJECTED || 
  v.verdict_type === VerdictType.BLOCKED
);

const actionableVerdicts = verdicts.filter(v =>
  v.verdict_type === VerdictType.ESCALATED
);

const temporaryIssues = verdicts.filter(v =>
  v.verdict_type === VerdictType.DEFERRED
);
```

## Extensibility

### Adding New Verdict Types

To add a new verdict type in the future:

1. **Add to enum** in `packages/verdict-engine/src/types.ts`:
   ```typescript
   export enum VerdictType {
     // ... existing types
     NEW_TYPE = 'NEW_TYPE',
   }
   ```

2. **Document the type** in this file with:
   - Definition
   - When to use
   - Typical factory actions
   - Confidence range
   - Examples
   - Color coding

3. **Update determination logic** in `packages/verdict-engine/src/engine.ts`:
   ```typescript
   export function determineVerdictType(...) {
     // Add new logic for when to use NEW_TYPE
   }
   ```

4. **Add to constants** in `packages/verdict-engine/src/constants.ts`:
   ```typescript
   export const VERDICT_TYPES = [
     // ... existing types
     VerdictType.NEW_TYPE,
   ] as const;
   ```

5. **Update tests** to cover the new type

6. **Update database** if needed (migration for new constraint values)

### Backward Compatibility

- New verdict types should be additive (don't remove existing types)
- Database schema should use CHECK constraints that can be extended
- API responses should include version information
- Clients should gracefully handle unknown verdict types

## Database Schema

### Verdict Table Extension

The `verdicts` table includes a `verdict_type` column:

```sql
ALTER TABLE verdicts ADD COLUMN verdict_type VARCHAR(50) NOT NULL DEFAULT 'PENDING';

ALTER TABLE verdicts 
  ADD CONSTRAINT chk_verdict_type 
  CHECK (verdict_type IN (
    'APPROVED',
    'REJECTED', 
    'DEFERRED',
    'ESCALATED',
    'WARNING',
    'BLOCKED',
    'PENDING'
  ));

CREATE INDEX idx_verdicts_verdict_type ON verdicts(verdict_type);
```

## API Integration

### Factory Status API

The verdict type is included in all verdict responses:

```json
{
  "verdicts": {
    "enabled": true,
    "summary": [
      {
        "id": "verdict-123",
        "executionId": "exec-456",
        "verdictType": "DEFERRED",
        "errorClass": "ACM_DNS_VALIDATION_PENDING",
        "confidenceScore": 90,
        "proposedAction": "WAIT_AND_RETRY",
        "policyVersion": "v1.0.0",
        "createdAt": "2025-12-20T10:00:00Z"
      }
    ],
    "kpis": {
      "totalVerdicts": 245,
      "byType": {
        "approved": 0,
        "rejected": 100,
        "deferred": 95,
        "escalated": 25,
        "warning": 15,
        "blocked": 10,
        "pending": 0
      }
    }
  }
}
```

## Best Practices

1. **Consistency**: Always use the canonical verdict types, don't create custom statuses
2. **Clarity**: Verdict types should be self-explanatory and match industry standards
3. **Actionability**: Each verdict type should have clear next steps
4. **Auditability**: All verdict type assignments should be logged and traceable
5. **UI/UX**: Use consistent color coding and icons across all interfaces
6. **Documentation**: Keep this document updated when adding new types or changing logic

## References

- [EPIC B — Verdict Engine & Decision Authority](../README.md)
- [Verdict Engine README](../packages/verdict-engine/README.md)
- [Confidence Score Schema](./CONFIDENCE_SCORE_SCHEMA.md)
- [Factory Status API](./FACTORY_STATUS_API.md)
- Industry Standards:
  - [Azure DevOps Pipeline Status](https://learn.microsoft.com/en-us/azure/devops/pipelines/)
  - [GitLab CI/CD Pipeline Status](https://docs.gitlab.com/ee/ci/pipelines/)
  - [OECD AI Principles](https://oecd.ai/en/ai-principles)

---

**Last Updated**: 2025-12-20  
**Version**: 1.0.0  
**Maintainer**: AFU-9 Team
