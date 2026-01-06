# E77.3 Verification Commands

Quick reference for verifying the Redeploy Last Known Good (LKG) playbook implementation.

## Test Commands

### Run All LKG Tests
```powershell
cd control-center
npm test -- --testPathPattern="(redeploy-lkg|findLastKnownGood)" --no-coverage
```

**Expected Output:**
```
Test Suites: 2 passed, 2 total
Tests:       34 passed, 34 total
```

### Run All Playbook Tests
```powershell
cd control-center
npm test -- --testPathPattern="(playbook|remediation)" --no-coverage
```

**Expected Output:**
```
Test Suites: 14 passed, 14 total
Tests:       177 passed, 177 total
```

### Run Specific Test Categories

```powershell
# LKG playbook tests only
npm test -- __tests__/lib/playbooks/redeploy-lkg.test.ts --no-coverage

# LKG query tests only
npm test -- __tests__/lib/db/findLastKnownGood.test.ts --no-coverage

# Registry tests (verify playbook registration)
npm test -- __tests__/lib/playbooks/registry.test.ts --no-coverage

# Remediation executor tests (verify lawbook gating)
npm test -- __tests__/lib/remediation-executor.test.ts --no-coverage
```

## Build Commands

### Verify TypeScript Compilation
```powershell
cd control-center
npx tsc --noEmit
```

**Note:** Pre-existing tsconfig issues may appear (zod module resolution). These are unrelated to the LKG implementation.

### Verify Repository
```powershell
# From repository root
npm run repo:verify
```

## Database Queries

### Check for LKG Deployments

```sql
-- Query deploy_status_snapshots for potential LKG records
SELECT 
  dss.id,
  dss.env,
  dss.status,
  dss.observed_at,
  dss.signals #>> '{verificationRun,status}' as verification_status,
  dss.signals #>> '{verificationRun,reportHash}' as report_hash,
  de.service,
  de.commit_hash
FROM deploy_status_snapshots dss
LEFT JOIN deploy_events de ON dss.related_deploy_event_id = de.id
WHERE dss.status = 'GREEN'
  AND dss.signals #>> '{verificationRun,status}' = 'success'
  AND dss.signals #>> '{verificationRun,reportHash}' IS NOT NULL
ORDER BY dss.observed_at DESC
LIMIT 10;
```

### Test LKG Query for Specific Environment

```sql
-- Find LKG for production environment
SELECT 
  dss.id as snapshot_id,
  dss.env,
  de.service,
  de.version,
  de.commit_hash,
  dss.observed_at,
  dss.signals #>> '{verificationRun,reportHash}' as report_hash
FROM deploy_status_snapshots dss
LEFT JOIN deploy_events de ON dss.related_deploy_event_id = de.id
WHERE dss.env = 'production'
  AND dss.status = 'GREEN'
  AND dss.signals #>> '{verificationRun,status}' = 'success'
  AND dss.signals #>> '{verificationRun,reportHash}' IS NOT NULL
ORDER BY dss.observed_at DESC
LIMIT 1;
```

### Check Remediation Runs

```sql
-- View all redeploy-lkg playbook runs
SELECT 
  rr.id,
  rr.run_key,
  rr.status,
  rr.created_at,
  rr.result_json,
  i.incident_key
FROM remediation_runs rr
JOIN incidents i ON rr.incident_id = i.id
WHERE rr.playbook_id = 'redeploy-lkg'
ORDER BY rr.created_at DESC
LIMIT 10;
```

## Code Review Checklist

### Files to Review

1. **Core Implementation:**
   - [ ] `control-center/src/lib/playbooks/redeploy-lkg.ts` - Playbook definition and executors
   - [ ] `control-center/src/lib/db/deployStatusSnapshots.ts` - LKG query function

2. **Registration:**
   - [ ] `control-center/src/lib/playbooks/registry.ts` - Playbook registration
   - [ ] `control-center/src/lib/remediation-executor.ts` - Lawbook gating

3. **Tests:**
   - [ ] `control-center/__tests__/lib/playbooks/redeploy-lkg.test.ts` - Playbook tests
   - [ ] `control-center/__tests__/lib/db/findLastKnownGood.test.ts` - Query tests

### Key Features to Verify

- [ ] **LKG Definition:** Status=GREEN + Verification=PASS + reportHash + deploy reference
- [ ] **Evidence Gating:** Returns NO_LKG_FOUND when no LKG exists
- [ ] **Lawbook Gating:** ROLLBACK_DEPLOY only allowed for redeploy-lkg playbook
- [ ] **Frequency Limiting:** Idempotency key includes hour timestamp
- [ ] **Environment Normalization:** prod/production handled correctly
- [ ] **Idempotency:** Same inputs produce same run_key
- [ ] **Audit Trail:** All steps recorded in remediation_runs/steps tables

## Integration Test (Manual)

### Prerequisites
1. Database with deploy_status_snapshots and deploy_events tables
2. At least one GREEN deployment with verification PASS

### Test Scenario 1: Successful LKG Selection

```typescript
import { findLastKnownGood } from '@/lib/db/deployStatusSnapshots';
import { pool } from '@/lib/db/pool';

// Test LKG selection
const result = await findLastKnownGood(pool, 'production', 'api');
console.log('LKG Result:', result);

// Expected: success=true, lkg contains commit_hash or imageDigest
```

### Test Scenario 2: NO_LKG_FOUND

```typescript
import { executeSelectLkg } from '@/lib/playbooks/redeploy-lkg';
import { StepContext } from '@/lib/contracts/remediation-playbook';

const context: StepContext = {
  incidentId: 'test-incident',
  incidentKey: 'test:incident:1',
  runId: 'test-run',
  lawbookVersion: 'v1',
  evidence: [
    {
      kind: 'deploy_status',
      ref: { env: 'staging' } // No LKG for staging
    }
  ],
  inputs: {},
};

const result = await executeSelectLkg(pool, context);
console.log('Result:', result);

// Expected: success=false, error.code='NO_LKG_FOUND'
```

## Troubleshooting

### Test Failures

**Issue:** `findLastKnownGood` tests fail
- **Cause:** Mock not properly configured
- **Fix:** Ensure `jest.mock('@/lib/db/deployStatusSnapshots')` is at top of test file

**Issue:** Environment normalization tests fail
- **Cause:** Expected 'prod' but got 'production'
- **Fix:** Use 'production' in expectations (canonical value)

### Build Issues

**Issue:** TypeScript errors in zod modules
- **Cause:** Pre-existing tsconfig issue (esModuleInterop)
- **Fix:** Ignore - these are unrelated to LKG implementation

**Issue:** Module not found in packages/
- **Cause:** Pre-existing dependency issues in verdict-engine/deploy-memory
- **Fix:** Ignore - these are unrelated to LKG implementation

### Runtime Issues

**Issue:** No LKG found in production
- **Cause:** No GREEN deployments with verification PASS
- **Check:** Run database query above to verify GREEN snapshots exist

**Issue:** Playbook execution skipped
- **Cause:** Lawbook gating or evidence missing
- **Check:** Verify playbook in allowed list and evidence includes env

## Success Criteria

✅ All tests passing (177 total)
✅ LKG query returns null when no GREEN verification exists
✅ LKG query returns most recent GREEN+PASS deployment
✅ Frequency limiting enforces once per hour
✅ Idempotency keys are deterministic
✅ Environment normalization works (prod → production)
✅ Lawbook gating allows only redeploy-lkg for ROLLBACK_DEPLOY
✅ Full audit trail in remediation tables

## Next Steps

After verification:
1. Integrate with E64.1 Runner Adapter for actual deploy dispatch
2. Integrate with E65.2 Verification Playbook for real verification
3. Integrate with E65.1 Status Monitor for status updates
4. Test in staging environment with real deployments
5. Monitor frequency limiting in production
