# E76.3 Verification Commands

## PowerShell Commands for Testing and Building

### Run Classifier Tests

```powershell
# Run all classifier unit tests
npm --prefix control-center test -- __tests__/lib/classifier/index.test.ts

# Run API integration tests
npm --prefix control-center test -- __tests__/api/incidents/classify.test.ts

# Run all incident-related tests
npm --prefix control-center test -- __tests__/lib/db/incidents.test.ts
npm --prefix control-center test -- __tests__/lib/incident-ingestion/index.test.ts
```

### Type-Check Code

```powershell
# Type-check classifier module
npx tsc --noEmit --skipLibCheck control-center/src/lib/classifier/index.ts

# Type-check API endpoint
npx tsc --noEmit --skipLibCheck control-center/app/api/incidents/[id]/classify/route.ts

# Type-check contracts
npx tsc --noEmit --skipLibCheck control-center/src/lib/contracts/incident.ts

# Type-check database layer
npx tsc --noEmit --skipLibCheck control-center/src/lib/db/incidents.ts
```

### Build and Verify

```powershell
# Run full test suite
npm --prefix control-center test

# Note: Full build may fail due to pre-existing dependency issues in:
# - @codefactory/deploy-memory
# - @codefactory/verdict-engine
# These are unrelated to E76.3 implementation.

# Verify repository-level checks
npm run repo:verify
```

## Expected Test Output

```
PASS  __tests__/lib/classifier/index.test.ts
  Incident Classifier v1
    Rule 1: DEPLOY_VERIFICATION_FAILED
      ✓ classifies verification failure with FAILED status (3 ms)
      ✓ classifies verification failure with TIMEOUT status
    Rule 2: ALB_TARGET_UNHEALTHY
      ✓ classifies ALB target unhealthy (1 ms)
    Rule 3: ECS_TASK_CRASHLOOP
      ✓ classifies ECS task crashloop (1 ms)
      ✓ does not match if exitCode is 0 (1 ms)
    Rule 4: ECS_IMAGE_PULL_FAILED
      ✓ classifies CannotPullContainerError (1 ms)
      ✓ classifies generic pull image error (1 ms)
    Rule 5: IAM_POLICY_VALIDATION_FAILED
      ✓ classifies IAM validation failure by step name (1 ms)
      ✓ classifies IAM validation failure by message (1 ms)
    Rule 6: RUNNER_WORKFLOW_FAILED
      ✓ classifies runner workflow failure (1 ms)
    Rule 7: UNKNOWN (fallback)
      ✓ classifies as UNKNOWN when no rules match (4 ms)
    Deterministic output
      ✓ labels are sorted alphabetically
      ✓ keyFacts are sorted alphabetically
      ✓ same incident and evidence produces same classification
    Evidence pack
      ✓ includes all evidence pointers

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

```
PASS  __tests__/api/incidents/classify.test.ts
  Classify Incident API Integration
    Classification workflow
      ✓ classifies incident and updates database (3 ms)
      ✓ reclassification updates existing classification (1 ms)
    DAO integration
      ✓ updateClassification stores classification in database (2 ms)

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

## Quick Test Commands

```powershell
# Test just the classifier
cd control-center
npm test -- __tests__/lib/classifier

# Test all incidents functionality
npm test -- __tests__/lib/db/incidents.test.ts
npm test -- __tests__/lib/incident-ingestion
npm test -- __tests__/lib/classifier
npm test -- __tests__/api/incidents

# Type-check all new files
npx tsc --noEmit --skipLibCheck src/lib/classifier/index.ts app/api/incidents/[id]/classify/route.ts
```

## Files to Review

```powershell
# Core implementation
code control-center/src/lib/classifier/index.ts
code control-center/src/lib/contracts/incident.ts
code control-center/src/lib/db/incidents.ts
code control-center/app/api/incidents/[id]/classify/route.ts

# Tests
code control-center/__tests__/lib/classifier/index.test.ts
code control-center/__tests__/api/incidents/classify.test.ts

# Documentation
code E76_3_IMPLEMENTATION_SUMMARY.md
code E76_3_VERIFICATION_COMMANDS.md
```
