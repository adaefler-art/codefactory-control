# E79.3 Implementation Summary: Enforce lawbookVersion in All Artifacts

**Issue:** I793 (E79.3) - Enforce lawbookVersion in all Verdicts/Reports/Incidents

**Implementation Date:** 2026-01-05

---

## Overview

Implemented systematic enforcement that all generated operational artifacts include `lawbookVersion` from the active lawbook, ensuring deterministic traceability and lawbook compliance across the AFU-9 system.

---

## Enforcement Strategy

### Fail-Closed (Gating/Automated Actions)
For automated operations that execute actions, **require** active lawbook:
- Remediation executor (E77.*)
- Uses `requireActiveLawbookVersion()` 
- Throws `LAWBOOK_NOT_CONFIGURED` error if no active lawbook
- **NON-NEGOTIABLE:** No automated action without explicit lawbook version

### Passive Ingestion (Records/Monitoring)
For passive recording and monitoring, **attach** lawbook version when available:
- Incident ingestion (E76.*)
- Deploy status monitor (E65.1)
- Outcome generation (E78.*)
- Uses `getActiveLawbookVersion()`
- Sets `lawbookVersion = null` and logs warning if not configured
- **GUARANTEE:** All records include lawbookVersion field (null if not configured)

---

## Files Created

### 1. Core Helper Module
**File:** `control-center/src/lib/lawbook-version-helper.ts`

**Functions:**
- `getActiveLawbookVersion(pool?): Promise<string | null>`
  - Returns active lawbook version or null
  - Cached for 60 seconds (short TTL)
  - Used for passive ingestion

- `requireActiveLawbookVersion(pool?): Promise<string>`
  - Returns active lawbook version or throws
  - Error code: `LAWBOOK_NOT_CONFIGURED`
  - Used for gating operations

- `attachLawbookVersion<T>(obj, pool?): Promise<T & { lawbookVersion }>`
  - Attaches lawbookVersion to object
  - Returns copy with lawbookVersion added
  - Preserves existing lawbookVersion if present

- `clearLawbookVersionCache(): void`
  - Clears cache (useful for testing)

- `getLawbookVersionCacheStats(): object`
  - Returns cache statistics

**Error Code:**
- `LAWBOOK_NOT_CONFIGURED` - Thrown when gating operation requires lawbook but none configured

---

### 2. Comprehensive Tests
**File:** `control-center/__tests__/lib/lawbook-version-helper.test.ts`

**Test Coverage:**
- ✅ getActiveLawbookVersion returns version when configured
- ✅ getActiveLawbookVersion returns null when not configured
- ✅ Cache behavior with TTL
- ✅ requireActiveLawbookVersion returns version when configured
- ✅ requireActiveLawbookVersion throws LAWBOOK_NOT_CONFIGURED when missing
- ✅ attachLawbookVersion adds version to objects
- ✅ attachLawbookVersion sets null when not configured
- ✅ Integration scenarios for all enforcement types

---

## Files Modified

### 1. Contract Schemas

#### `control-center/src/lib/contracts/deployStatus.ts`
**Change:** Added `lawbookVersion` field to `StatusSignals` interface

```typescript
export interface StatusSignals {
  checkedAt: string;
  correlationId?: string;
  verificationRun?: {...} | null;
  lawbookVersion?: string | null;  // E79.3 / I793
}
```

**Reason:** Deploy status snapshots must track lawbook version for audit trail

---

#### `control-center/src/lib/build-determinism.ts`
**Change:** Added `lawbookVersion` field to `BuildManifest` interface and updated `createBuildManifest()` function

```typescript
export interface BuildManifest {
  buildId: string;
  inputs: BuildInputs;
  inputsHash: string;
  outputs: BuildOutputs;
  outputsHash: string;
  metadata: {...};
  lawbookVersion?: string | null;  // E79.3 / I793
}

export function createBuildManifest(
  buildId: string,
  inputs: BuildInputs,
  outputs: BuildOutputs,
  startedAt: Date,
  completedAt: Date,
  lawbookVersion?: string | null  // E79.3 / I793
): BuildManifest
```

**Reason:** Build determinism reports must include lawbook version for reproducibility tracing

---

### 2. Operational Modules

#### `control-center/src/lib/incident-ingestion/index.ts`
**Changes:**
1. Import `getActiveLawbookVersion` from lawbook-version-helper
2. Update `ingestIncident()` to fetch and attach lawbookVersion
3. Log warning if lawbookVersion is null

```typescript
// E79.3 / I793: Attach lawbookVersion from active lawbook (passive ingestion)
const lawbookVersion = await getActiveLawbookVersion(pool);

if (lawbookVersion === null) {
  logger.warn('No active lawbook configured - incident lawbookVersion will be null', {
    incidentKey: incident.incident_key,
  }, 'IncidentIngestion');
}

const incidentWithLawbook = {
  ...incident,
  lawbook_version: lawbookVersion,
};
```

**Reason:** All incidents must track lawbook version for compliance audit (passive ingestion)

---

#### `control-center/src/lib/remediation-executor.ts`
**Changes:**
1. Import `requireActiveLawbookVersion` from lawbook-version-helper
2. Update `loadLawbookGateConfig()` to use `requireActiveLawbookVersion()`

```typescript
async function loadLawbookGateConfig(pool?: Pool): Promise<LawbookGateConfig> {
  // E79.3 / I793: Require active lawbook (fail-closed for gating operations)
  const lawbookVersion = await requireActiveLawbookVersion(pool);
  
  return {
    version: lawbookVersion,
    allowedPlaybooks: [...],
    allowedActionTypes: [...],
    deniedActionTypes: [...],
  };
}
```

**Reason:** Remediation actions MUST have lawbook version (fail-closed gating)

---

#### `control-center/src/lib/deploy-status/verification-resolver.ts`
**Changes:**
1. Add `lawbookVersion` parameter to function signature
2. Include lawbookVersion in all StatusSignals returned

```typescript
export async function resolveDeployStatusFromVerificationRuns(
  pool: Pool,
  options: {
    env: DeployEnvironment;
    correlationId?: string;
    lawbookVersion?: string | null;  // E79.3 / I793
  }
): Promise<CreateDeployStatusInput>
```

**Reason:** Deploy status snapshots must include lawbook version

---

#### `control-center/src/lib/generators/postmortem-generator.ts`
**Changes:**
1. Import `getActiveLawbookVersion` from lawbook-version-helper
2. Update lawbookVersion fallback chain to include active lawbook

```typescript
// E79.3 / I793: Use lawbookVersion from parameter, incident, or active lawbook (passive)
const finalLawbookVersion = lawbookVersion 
  || incident.lawbook_version 
  || await getActiveLawbookVersion(pool);
```

**Reason:** Outcome records should use active lawbook version as fallback

---

### 3. API Routes

#### `control-center/app/api/deploy/status/route.ts`
**Changes:**
1. Import `getActiveLawbookVersion` from lawbook-version-helper
2. Fetch lawbookVersion before resolving deploy status
3. Pass lawbookVersion to verification resolver

```typescript
// E79.3 / I793: Get active lawbook version (passive ingestion - null if not configured)
const lawbookVersion = await getActiveLawbookVersion(pool);

const resolved = await resolveDeployStatusFromVerificationRuns(pool, {
  env,
  correlationId,
  lawbookVersion,
});
```

**Reason:** Deploy status API must include lawbook version in responses

---

## Artifact Schemas Updated

All the following schemas now include `lawbookVersion` field:

| Artifact Type | Schema Location | Field Name | Required? |
|--------------|----------------|------------|-----------|
| Incidents | `contracts/incident.ts` | `lawbook_version` | No (nullable) |
| Remediation Runs | `contracts/remediation-playbook.ts` | `lawbook_version` | Yes (from gating) |
| Remediation Audit Events | `contracts/remediation-playbook.ts` | `lawbook_version` | Yes |
| Deploy Status Snapshots | `contracts/deployStatus.ts` | `lawbookVersion` (in signals) | No (nullable) |
| Build Manifests | `build-determinism.ts` | `lawbookVersion` | No (nullable) |
| Outcome Records | `contracts/outcome.ts` | `lawbook_version` | No (nullable) |

---

## Testing & Verification Commands

### Run Unit Tests
```powershell
# Test lawbook version helper
npm --prefix control-center test -- __tests__/lib/lawbook-version-helper.test.ts

# Run all tests
npm --prefix control-center test
```

### Build
```powershell
# Build control-center
npm --prefix control-center run build
```

### Repository Verification
```powershell
# Verify repository integrity
npm run repo:verify
```

---

## Acceptance Criteria ✅

- [x] All newly produced artifacts include lawbookVersion field
- [x] Fail-closed behavior for automated actions when lawbook missing
  - Remediation executor throws `LAWBOOK_NOT_CONFIGURED` error
- [x] Passive ingestion sets null and logs warning when lawbook missing
  - Incident ingestion attaches null and logs warning
  - Deploy status includes lawbookVersion in signals
- [x] Tests cover all scenarios
  - ✅ Active lawbook configured
  - ✅ No lawbook configured (passive → null, gating → error)
  - ✅ Cache behavior
  - ✅ Integration scenarios

---

## Security Considerations

1. **Fail-Closed by Default**
   - Automated actions (remediation) REQUIRE lawbook
   - Cannot execute without explicit lawbook version
   - Prevents unauthorized or untracked actions

2. **Audit Trail**
   - Every artifact includes lawbookVersion
   - Enables forensic analysis of which lawbook was active
   - Supports compliance and debugging

3. **No Secrets**
   - LawbookVersion is just a version string
   - No sensitive data in cached values
   - Cache TTL is short (60 seconds) for freshness

---

## Future Enhancements

1. **Backward Compatibility**
   - Current implementation sets null for records without lawbook
   - No retroactive mutation of existing records
   - Only enforces on new artifacts going forward

2. **Cache Optimization**
   - Consider Redis-based cache for distributed systems
   - Add cache invalidation on lawbook activation

3. **Metrics**
   - Track percentage of artifacts with vs without lawbookVersion
   - Alert on high rate of null lawbookVersion

---

## References

- **Issue:** I793 (E79.3) - Enforce lawbookVersion in all Verdicts/Reports/Incidents
- **Related Issues:**
  - E76.* (Incident Management)
  - E77.* (Remediation Playbooks)
  - E78.* (Outcome Records)
  - E65.1 (Deploy Status Monitor)
  - E65.2 (Post-Deploy Verification)
  - E64.2 (Determinism Gate)

---

## Implementation Notes

1. **Centralized Enforcement**
   - Single helper module prevents drift
   - All modules use same functions
   - Consistent behavior across system

2. **Minimal Changes**
   - Only added lawbookVersion field to existing flows
   - No breaking changes to existing APIs
   - Backward compatible (nullable fields)

3. **Testing Strategy**
   - Comprehensive unit tests for helper functions
   - Integration scenarios for all enforcement types
   - Existing module tests validate schema compatibility

---

**Implementation Status:** ✅ Complete

**Author:** GitHub Copilot (adaefler-art)

**Date:** 2026-01-05
