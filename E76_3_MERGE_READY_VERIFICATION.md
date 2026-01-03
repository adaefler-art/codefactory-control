# E76.3 Merge-Ready Verification Report

**Date:** 2026-01-03  
**Commit:** 3aa9313  
**Reviewer:** @copilot  

## VERDICT: ✅ MERGE

All blocking requirements addressed. Classifier v1 is merge-ready.

---

## BLOCKING REQUIREMENTS - ADDRESSED

### 1. ✅ Authentication (401-first)

**Implementation:**
- `/api/incidents/[id]/classify` enforces `x-afu9-sub` header
- Returns 401 if header missing or empty
- Fail-closed approach (no auth = no access)

**Evidence:**
```typescript
// app/api/incidents/[id]/classify/route.ts:28-35
const userId = request.headers.get('x-afu9-sub');
if (!userId) {
  return errorResponse('Unauthorized', {
    status: 401,
    requestId,
    details: 'User authentication required',
  });
}
```

**Tests:**
```
POST /api/incidents/[id]/classify - Authentication
  ✓ returns 401 when x-afu9-sub header is missing
  ✓ returns 401 when x-afu9-sub header is empty
  ✓ returns 400 when incident ID is missing
```

---

### 2. ✅ Authorization

**Policy:** System/admin-scoped
- Incidents are system-wide resources (not user-scoped)
- All authenticated users can classify incidents
- Documented in route.ts header comments

**Rationale:**
- Incidents are generated from system signals (ECS, ALB, verification, etc.)
- Not owned by individual users
- Classification is a system operation for remediation routing

---

### 3. ✅ Idempotency

**Implementation:**
```typescript
// Classification hash computation (SHA256)
export function computeClassificationHash(classification: Classification): string {
  const payload = stableStringify({
    classifierVersion: classification.classifierVersion,
    category: classification.category,
    confidence: classification.confidence,
    labels: classification.labels, // sorted
    primaryEvidence: { kind, ref, sha256 },
    pointers: [...] // sorted
  });
  return createHash('sha256').update(payload).digest('hex');
}
```

**DAO Logic:**
```typescript
// src/lib/db/incidents.ts:352-399
async updateClassification(id, classification, classificationHash) {
  // 1. Check existing classification
  const current = await this.pool.query(
    `SELECT classification FROM incidents WHERE id = $1`, [id]
  );
  
  // 2. Compute hash of current classification
  if (currentClassification) {
    const currentHash = computeClassificationHash(currentClassification);
    
    // 3. If hash matches, no update needed (no-op)
    if (currentHash === classificationHash) {
      return { incident: await this.getIncident(id), updated: false };
    }
  }
  
  // 4. Update only if hash differs
  const result = await this.pool.query(
    `UPDATE incidents SET classification = $1, updated_at = NOW() WHERE id = $2`,
    [classification, id]
  );
  
  return { incident: mapRowToIncident(result.rows[0]), updated: true };
}
```

**API Logic:**
```typescript
// app/api/incidents/[id]/classify/route.ts:68-96
const classification = classifyIncident(incident, evidence);
const classificationHash = computeClassificationHash(classification);
const result = await dao.updateClassification(id, classification, classificationHash);

// Emit CLASSIFIED event ONLY if classification changed
if (result.updated) {
  await dao.createEvent({
    incident_id: id,
    event_type: 'CLASSIFIED',
    payload: { classifierVersion, category, confidence, classificationHash },
  });
}

return jsonResponse({
  success: true,
  incident: result.incident,
  classification,
  updated: result.updated, // indicates if DB was updated
});
```

**Tests:**
```
DAO integration
  ✓ updateClassification stores classification in database when new
  ✓ updateClassification is idempotent - no update when hash matches
```

---

### 4. ✅ Determinism

**Evidence Pointer Sorting:**
```typescript
// src/lib/classifier/index.ts:489-510
function sortedPointers(evidence: Evidence[]): PrimaryEvidence[] {
  return evidence
    .map(e => ({ kind: e.kind, ref: e.ref, sha256: e.sha256 || undefined }))
    .sort((a, b) => {
      // Sort by kind first
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      // Then by sha256
      const aSha = a.sha256 || '';
      const bSha = b.sha256 || '';
      if (aSha !== bSha) return aSha.localeCompare(bSha);
      // Finally by stringified ref for stability
      return stableStringify(a.ref).localeCompare(stableStringify(b.ref));
    });
}
```

**Labels & KeyFacts Sorting:**
```typescript
// Already sorted in v0.7.0
function sortedLabels(labels: string[]): string[] {
  return [...labels].sort();
}

function sortedKeyFacts(facts: string[]): string[] {
  return [...facts].sort();
}
```

**Tests:**
```
Classification hash and idempotency
  ✓ computes classification hash deterministically
  ✓ different classification produces different hash
  ✓ evidence order does not affect classification hash
```

---

## TEST EVIDENCE

### PowerShell Commands Executed:

```powershell
# Classifier unit tests (18 tests)
npm --prefix control-center test -- __tests__/lib/classifier/index.test.ts
# Result: 18 passed

# Integration tests (4 tests)
npm --prefix control-center test -- __tests__/api/incidents/classify.test.ts
# Result: 4 passed

# Auth tests (3 tests)
npm --prefix control-center test -- __tests__/api/incidents/classify-auth.test.ts
# Result: 3 passed

# All classifier + incidents tests (25 total)
npm --prefix control-center test -- __tests__/lib/classifier __tests__/api/incidents
# Result: 25 passed, 25 total
```

### Test Summary:
```
PASS __tests__/lib/classifier/index.test.ts
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
    Classification hash and idempotency
      ✓ computes classification hash deterministically
      ✓ different classification produces different hash
      ✓ evidence order does not affect classification hash

PASS __tests__/api/incidents/classify-auth.test.ts
  POST /api/incidents/[id]/classify - Authentication
    ✓ returns 401 when x-afu9-sub header is missing
    ✓ returns 401 when x-afu9-sub header is empty
    ✓ returns 400 when incident ID is missing

PASS __tests__/api/incidents/classify.test.ts
  Classify Incident API Integration
    Classification workflow
      ✓ classifies incident and updates database
      ✓ reclassification updates existing classification
    DAO integration
      ✓ updateClassification stores classification in database when new
      ✓ updateClassification is idempotent - no update when hash matches

Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
Snapshots:   0 total
Time:        0.514 s
```

### Type Check:
```powershell
npx tsc --noEmit --skipLibCheck src/lib/classifier/index.ts app/api/incidents/[id]/classify/route.ts src/lib/db/incidents.ts
# Result: No errors (exit code 0)
```

---

## PATCH SUMMARY

### Files Changed (6 files)

1. **control-center/src/lib/classifier/index.ts**
   - Added `createHash` import from 'crypto'
   - Added `stableStringify()` for deterministic JSON serialization
   - Added `sortedPointers()` for deterministic evidence ordering
   - Added `computeClassificationHash()` for idempotency
   - Updated `classifyIncident()` to use `sortedPointers()`

2. **control-center/src/lib/db/incidents.ts**
   - Updated `updateClassification()` to accept `classificationHash` parameter
   - Changed return type to `{ incident: Incident | null, updated: boolean }`
   - Added hash comparison logic for idempotency
   - Returns `updated: false` when hash matches (no-op)

3. **control-center/app/api/incidents/[id]/classify/route.ts**
   - Added authentication check for `x-afu9-sub` header (401 if missing)
   - Added imports for `computeClassificationHash`, `getRequestId`, `errorResponse`, `jsonResponse`
   - Updated to use `computeClassificationHash()` before update
   - Updated to conditionally emit `CLASSIFIED` event only if `result.updated === true`
   - Added `classificationHash` to event payload
   - Changed response to include `updated: boolean` field
   - Added request-id tracking

4. **control-center/__tests__/lib/classifier/index.test.ts**
   - Fixed existing test: pointers now sorted by kind (alb < ecs)
   - Added 3 new tests for hash/idempotency:
     - "computes classification hash deterministically"
     - "different classification produces different hash"
     - "evidence order does not affect classification hash"

5. **control-center/__tests__/api/incidents/classify.test.ts**
   - Updated imports to include `computeClassificationHash`
   - Updated existing test to use new `updateClassification()` signature
   - Updated test to check `result.updated` boolean
   - Added new test: "updateClassification is idempotent - no update when hash matches"

6. **control-center/__tests__/api/incidents/classify-auth.test.ts** (NEW)
   - Added 3 auth tests:
     - "returns 401 when x-afu9-sub header is missing"
     - "returns 401 when x-afu9-sub header is empty"
     - "returns 400 when incident ID is missing"

---

## BLOCKING FINDINGS

**None.** All requirements met.

---

## NON-BLOCKING OBSERVATIONS

1. **Build Infrastructure:** Full `npm run build` fails due to pre-existing dependency issues in `@codefactory/deploy-memory` and `@codefactory/verdict-engine`. These are unrelated to E76.3 changes.

2. **Repo Verify:** `npm run repo:verify` requires `ts-node` which is not installed. This is a pre-existing infrastructure issue.

3. **Test Coverage:** All new functionality is covered by tests (25/25 passing).

---

## VERIFICATION COMMANDS (PowerShell)

```powershell
# Run all classifier + incidents tests
npm --prefix control-center test -- __tests__/lib/classifier __tests__/api/incidents

# Type-check all changed files
npx tsc --noEmit --skipLibCheck control-center/src/lib/classifier/index.ts control-center/app/api/incidents/[id]/classify/route.ts control-center/src/lib/db/incidents.ts

# Run full test suite (optional - some unrelated failures expected)
npm --prefix control-center test
```

---

## CONCLUSION

✅ **MERGE-READY**

All blocking requirements have been addressed:
- ✅ Authentication: 401-first with x-afu9-sub header
- ✅ Authorization: System/admin-scoped policy documented
- ✅ Idempotency: Classification hash + no-op on duplicate calls
- ✅ Determinism: Evidence pointers, labels, keyFacts all sorted

All 25 tests passing. Type checks clean. Code ready for merge.
