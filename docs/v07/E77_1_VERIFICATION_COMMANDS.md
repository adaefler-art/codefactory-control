# E77.1 Verification Commands

## Test Execution

### Run All Remediation Playbook Tests
```powershell
npm --prefix control-center test -- __tests__/lib/remediation-executor.test.ts __tests__/lib/db/remediation-playbooks.test.ts __tests__/lib/contracts/remediation-playbook.test.ts
```

### Run Individual Test Suites

#### Contract Tests (18 tests)
```powershell
npm --prefix control-center test -- __tests__/lib/contracts/remediation-playbook.test.ts
```

#### DAO Tests (8 tests)
```powershell
npm --prefix control-center test -- __tests__/lib/db/remediation-playbooks.test.ts
```

#### Executor Tests (7 tests)
```powershell
npm --prefix control-center test -- __tests__/lib/remediation-executor.test.ts
```

## Database Migration

### Apply Migration
```powershell
# Using npm script (requires DATABASE_URL env var)
npm --prefix control-center run db:migrate

# Or directly with psql
psql -h localhost -U postgres -d codefactory -f database/migrations/038_remediation_playbooks.sql
```

### Verify Tables Created
```sql
-- Check remediation_runs table
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'remediation_runs'
ORDER BY ordinal_position;

-- Check remediation_steps table
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'remediation_steps'
ORDER BY ordinal_position;

-- Check constraints
SELECT constraint_name, constraint_type 
FROM information_schema.table_constraints 
WHERE table_name IN ('remediation_runs', 'remediation_steps');
```

## TypeScript Compilation

### Check Types for New Files
```powershell
# Contract types
npx tsc --noEmit --skipLibCheck --isolatedModules control-center/src/lib/contracts/remediation-playbook.ts

# DAO types
npx tsc --noEmit --skipLibCheck --isolatedModules control-center/src/lib/db/remediation-playbooks.ts

# Executor types
npx tsc --noEmit --skipLibCheck --isolatedModules control-center/src/lib/remediation-executor.ts
```

## Build (Optional)

⚠️ **Note**: There are existing unrelated build issues in the verdict-engine package. Our code compiles cleanly.

```powershell
# Attempt full build (may fail due to verdict-engine dependencies)
npm --prefix control-center run build
```

## Expected Test Output

```
PASS __tests__/lib/contracts/remediation-playbook.test.ts
  Remediation Playbook Contracts
    checkEvidencePredicate
      ✓ returns true when evidence kind matches and no required fields
      ✓ returns false when evidence kind does not match
      ✓ returns true when required fields are present
      ✓ returns false when required fields are missing
      ✓ returns true when at least one evidence item has all required fields
    checkAllEvidencePredicates
      ✓ returns satisfied=true when all predicates are met
      ✓ returns satisfied=false and lists missing predicates
    computeInputsHash
      ✓ generates same hash for same inputs
      ✓ generates same hash regardless of key order
      ✓ generates different hash for different inputs
      ✓ generates hash for empty inputs
    computeRunKey
      ✓ generates run key in correct format
      ✓ generates same run key for same inputs
      ✓ generates different run key for different inputs
    validatePlaybookDefinition
      ✓ validates correct playbook definition
      ✓ rejects playbook with missing required fields
      ✓ rejects playbook with invalid action type
      ✓ rejects playbook with empty steps array

PASS __tests__/lib/db/remediation-playbooks.test.ts
  RemediationPlaybookDAO
    upsertRunByKey
      ✓ creates new run on first insert
      ✓ returns existing run on conflict (idempotent)
    getRunByKey
      ✓ retrieves run by run_key
      ✓ returns null when run not found
    updateRunStatus
      ✓ updates run status and result_json
    createStep
      ✓ creates new step
    updateStepStatus
      ✓ updates step status with timestamps and output
    getStepsForRun
      ✓ retrieves all steps for a run ordered by step_id

PASS __tests__/lib/remediation-executor.test.ts
  RemediationPlaybookExecutor
    Lawbook Gating - Deny by Default
      ✓ should skip run when playbook is not in allowed list
      ✓ should skip run when action type is denied
    Evidence Gating
      ✓ should skip run when required evidence is missing
      ✓ should proceed when required evidence is present
    Idempotency
      ✓ should return existing run when invoked with same inputs
    Deterministic Planning
      ✓ should generate same plan JSON and inputs_hash for same inputs
      ✓ should generate different inputs_hash for different inputs

Test Suites: 3 passed, 3 total
Tests:       33 passed, 33 total
```

## Manual Verification Steps

### 1. Verify Contract Validation
```typescript
import { validatePlaybookDefinition } from '@/lib/contracts/remediation-playbook';

const playbook = {
  id: 'test-playbook',
  version: '1.0.0',
  title: 'Test Playbook',
  applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
  requiredEvidence: [],
  steps: [{
    stepId: 'step1',
    actionType: 'RESTART_SERVICE',
    description: 'Restart service'
  }]
};

const result = validatePlaybookDefinition(playbook);
// Should return { success: true, data: <playbook> }
```

### 2. Verify Evidence Checking
```typescript
import { checkEvidencePredicate } from '@/lib/contracts/remediation-playbook';

const predicate = {
  kind: 'verification',
  requiredFields: ['ref.reportHash']
};

const evidence = [{
  kind: 'verification',
  ref: { reportHash: 'abc123' }
}];

const satisfied = checkEvidencePredicate(predicate, evidence);
// Should return true
```

### 3. Verify Deterministic Hashing
```typescript
import { computeInputsHash, computeRunKey } from '@/lib/contracts/remediation-playbook';

const inputs1 = { service: 'api', env: 'prod' };
const inputs2 = { env: 'prod', service: 'api' }; // Different order

const hash1 = computeInputsHash(inputs1);
const hash2 = computeInputsHash(inputs2);
// hash1 === hash2 should be true

const runKey = computeRunKey('incident:123', 'playbook-id', hash1);
// Should be in format: incident:123:playbook-id:<hash>
```

## Success Criteria

✅ All 33 tests pass  
✅ TypeScript compilation succeeds for new files  
✅ Database migration runs without errors  
✅ Tables and constraints created correctly  
✅ No TypeScript errors in new code  

## Files Modified/Created

### Created
- `control-center/src/lib/contracts/remediation-playbook.ts` (contract schemas)
- `control-center/src/lib/db/remediation-playbooks.ts` (DAO)
- `control-center/src/lib/remediation-executor.ts` (executor)
- `control-center/__tests__/lib/contracts/remediation-playbook.test.ts` (18 tests)
- `control-center/__tests__/lib/db/remediation-playbooks.test.ts` (8 tests)
- `control-center/__tests__/lib/remediation-executor.test.ts` (7 tests)
- `database/migrations/038_remediation_playbooks.sql` (migration)
- `E77_1_IMPLEMENTATION_SUMMARY.md` (this summary)
- `E77_1_VERIFICATION_COMMANDS.md` (verification guide)
