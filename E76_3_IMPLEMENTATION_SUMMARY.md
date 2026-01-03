# E76.3 Implementation Summary: Classifier v1 (Rule-Based)

**Issue:** I763 (E76.3) - Classifier v1 (rule-based labels + evidence pack; deterministic)

**Date:** 2026-01-03

**Classifier Version:** 0.7.0

## Overview

Implemented a deterministic rule-based incident classifier that assigns classification labels and produces evidence packs for incidents. The classifier is fully transparent, versioned, and operates without network calls or LLM inference.

## Files Changed

### 1. Classification Schema Types
**File:** `control-center/src/lib/contracts/incident.ts`
- Added `CLASSIFICATION_CATEGORIES` enum (7 categories)
- Added `CLASSIFICATION_CONFIDENCE` enum (low, medium, high)
- Added `ClassificationSchema` type with:
  - `classifierVersion`: string
  - `category`: ClassificationCategory
  - `confidence`: ClassificationConfidence
  - `labels`: string[]
  - `primaryEvidence`: PrimaryEvidence
  - `evidencePack`: EvidencePack
- Added supporting schemas: `EvidencePointerSchema`, `EvidencePackSchema`, `PrimaryEvidenceSchema`

### 2. Classifier Implementation
**File:** `control-center/src/lib/classifier/index.ts`
- Implemented `classifyIncident(incident, evidence)` function
- Implemented 7 classification rules (priority-ordered):
  1. **DEPLOY_VERIFICATION_FAILED** - verification failures (high confidence)
  2. **ALB_TARGET_UNHEALTHY** - ALB target health issues (high confidence)
  3. **ECS_TASK_CRASHLOOP** - ECS container crashes with non-zero exit (high confidence)
  4. **ECS_IMAGE_PULL_FAILED** - ECS image pull errors (high confidence)
  5. **IAM_POLICY_VALIDATION_FAILED** - IAM validation failures (high confidence)
  6. **RUNNER_WORKFLOW_FAILED** - GitHub Actions failures (medium confidence)
  7. **UNKNOWN** - fallback for unmatched patterns (low confidence)
- Deterministic output:
  - Labels sorted alphabetically
  - keyFacts sorted alphabetically
  - Same input → same output

### 3. Database Access Layer
**File:** `control-center/src/lib/db/incidents.ts`
- Added `updateClassification(id, classification)` method
- Stores classification as JSONB in `incidents.classification` column
- Updates `updated_at` timestamp automatically

### 4. API Endpoint
**File:** `control-center/app/api/incidents/[id]/classify/route.ts`
- **POST /api/incidents/[id]/classify**
- Fetches incident and evidence from database
- Runs classifier
- Updates incident with classification
- Emits `CLASSIFIED` event
- Returns classification result

### 5. Unit Tests
**File:** `control-center/__tests__/lib/classifier/index.test.ts`
- 15 comprehensive tests covering:
  - All 7 classification rules
  - Edge cases (e.g., exitCode=0 should not match crashloop)
  - Deterministic output (labels and keyFacts sorted)
  - Evidence pack generation
  - Reclassification scenarios
- **All tests passing** ✅

### 6. Integration Tests
**File:** `control-center/__tests__/api/incidents/classify.test.ts`
- 3 integration tests covering:
  - End-to-end classification workflow
  - Reclassification with updated evidence
  - Database update integration
- **All tests passing** ✅

## Classification Rules (v0.7.0)

### Rule 1: DEPLOY_VERIFICATION_FAILED
- **Trigger:** Evidence kind=`verification` with status `FAILED` or `TIMEOUT`
- **Confidence:** high
- **Labels:** `["config", "infra", "needs-redeploy"]` (sorted)
- **Evidence:** Verification run details (runId, playbookId, env, status)

### Rule 2: ALB_TARGET_UNHEALTHY
- **Trigger:** Evidence kind=`alb` with `targetHealth="unhealthy"` or `state="unhealthy"`
- **Confidence:** high
- **Labels:** `["alb", "infra", "needs-investigation"]` (sorted)
- **Evidence:** ALB target details (targetId, reason)

### Rule 3: ECS_TASK_CRASHLOOP
- **Trigger:** Evidence kind=`ecs` with:
  - `stoppedReason` contains "Essential container in task exited"
  - AND `exitCode != 0`
- **Confidence:** high
- **Labels:** `["code", "crashloop", "ecs", "needs-investigation"]` (sorted)
- **Evidence:** ECS task details (cluster, taskArn, exitCode, stoppedReason)

### Rule 4: ECS_IMAGE_PULL_FAILED
- **Trigger:** Evidence kind=`ecs` with `stoppedReason` contains:
  - "CannotPullContainerError" OR "pull image"
- **Confidence:** high
- **Labels:** `["ecs", "image", "infra", "needs-redeploy"]` (sorted)
- **Evidence:** ECS task details (cluster, taskArn, stoppedReason)

### Rule 5: IAM_POLICY_VALIDATION_FAILED
- **Trigger:** Evidence kind=`runner` or `github_run` with:
  - `stepName` contains "validate-iam" OR
  - `message` contains "IAM policy validation failed"
- **Confidence:** high
- **Labels:** `["iam", "infra", "needs-fix", "policy"]` (sorted)
- **Evidence:** Runner details (runId, stepName, message)

### Rule 6: RUNNER_WORKFLOW_FAILED
- **Trigger:** Evidence kind=`runner` or `github_run` with `conclusion="failure"`
- **Confidence:** medium
- **Labels:** `["ci", "needs-investigation", "runner"]` (sorted)
- **Evidence:** Runner details (runId, stepName, runUrl)

### Rule 7: UNKNOWN (Fallback)
- **Trigger:** No other rules match
- **Confidence:** low
- **Labels:** `["needs-classification"]`
- **Evidence:** Uses incident's `source_primary`

## Evidence Pack Structure

Each classification includes an evidence pack with:

```typescript
{
  summary: string,           // e.g., "ECS_TASK_CRASHLOOP: ECS task stopped"
  keyFacts: string[],        // Sorted array of key observations
  pointers: EvidencePointer[] // All evidence items for remediation
}
```

## API Usage Example

```bash
# Classify an incident
curl -X POST http://localhost:3000/api/incidents/{incident-id}/classify

# Response
{
  "success": true,
  "incident": { ... },
  "classification": {
    "classifierVersion": "0.7.0",
    "category": "ECS_TASK_CRASHLOOP",
    "confidence": "high",
    "labels": ["code", "crashloop", "ecs", "needs-investigation"],
    "primaryEvidence": { ... },
    "evidencePack": {
      "summary": "ECS_TASK_CRASHLOOP: ECS task stopped",
      "keyFacts": [
        "Cluster: prod-cluster",
        "ECS task crashed with exit code 1",
        "Reason: Essential container in task exited",
        "Stopped at: 2024-01-01T00:05:00Z",
        "Task: task-123"
      ],
      "pointers": [ ... ]
    }
  }
}
```

## Reclassification Support

- Calling classify on an already-classified incident updates the classification
- Latest classification is stored (replaces previous)
- Event history is maintained via `CLASSIFIED` events
- Deterministic: same evidence produces same classification

## Verification Commands

```powershell
# Run classifier tests
npm --prefix control-center test -- __tests__/lib/classifier/index.test.ts

# Run integration tests
npm --prefix control-center test -- __tests__/api/incidents/classify.test.ts

# Type-check classifier
npx tsc --noEmit --skipLibCheck control-center/src/lib/classifier/index.ts

# Type-check API route
npx tsc --noEmit --skipLibCheck control-center/app/api/incidents/[id]/classify/route.ts
```

## Test Results

```
Incident Classifier v1
  Rule 1: DEPLOY_VERIFICATION_FAILED
    ✓ classifies verification failure with FAILED status
    ✓ classifies verification failure with TIMEOUT status
  Rule 2: ALB_TARGET_UNHEALTHY
    ✓ classifies ALB target unhealthy
  Rule 3: ECS_TASK_CRASHLOOP
    ✓ classifies ECS task crashloop
    ✓ does not match if exitCode is 0
  Rule 4: ECS_IMAGE_PULL_FAILED
    ✓ classifies CannotPullContainerError
    ✓ classifies generic pull image error
  Rule 5: IAM_POLICY_VALIDATION_FAILED
    ✓ classifies IAM validation failure by step name
    ✓ classifies IAM validation failure by message
  Rule 6: RUNNER_WORKFLOW_FAILED
    ✓ classifies runner workflow failure
  Rule 7: UNKNOWN (fallback)
    ✓ classifies as UNKNOWN when no rules match
  Deterministic output
    ✓ labels are sorted alphabetically
    ✓ keyFacts are sorted alphabetically
    ✓ same incident and evidence produces same classification
  Evidence pack
    ✓ includes all evidence pointers

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

## Design Principles Met

✅ **Deterministic:** Same incident + evidence → same classification  
✅ **Rule-based only:** No LLM, no external API calls  
✅ **Transparent:** Rules explicitly coded and versioned  
✅ **No network calls:** Pure function on incident + evidence  
✅ **Versioned:** classifierVersion: "0.7.0"  
✅ **Testable:** 100% test coverage of all rules  
✅ **Idempotent:** Reclassification supported  

## Acceptance Criteria

✅ Classifier assigns expected category for common evidence patterns  
✅ Fully deterministic, transparent rules  
✅ Tests/build green (classifier tests all passing)  
✅ Classification stored in DB  
✅ CLASSIFIED event emitted  
✅ API endpoint functional  

## Future Extensions

- Add more classification categories as new incident patterns emerge
- Store classification rule explanations for transparency
- Add bulk classify endpoint for batch processing
- Integrate with remediation playbook selection
- Add classification confidence thresholds for auto-remediation

## Security Notes

- No secrets in code
- No external network calls
- Pure function execution
- JSONB storage validated by database schema
