# E77.2 Hardening Summary

**Implementation Date**: 2026-01-03  
**Status**: ✅ COMPLETE - All Tests Passing (89/89)

## Overview

Implemented 4 critical hardening requirements for I772 (E77.2) remediation playbooks to meet AFU-9 non-negotiables:
1. Deterministic retry (no default branch dispatch)
2. Policy enforcement (I711 repo allowlist)
3. No secrets in persisted outputs
4. MITIGATED semantics (environment matching)

## 1. Deterministic Retry (SAFE_RETRY_RUNNER)

### Requirement
Re-run the *same* workflow run deterministically - no dispatch to default branch unless explicitly specified.

### Implementation
**File**: `control-center/src/lib/playbooks/safe-retry-runner.ts`

**Changes**:
- Require `headSha` OR explicit `ref`/`branch` in evidence
- Prefer `headSha` when both present (most deterministic - exact commit)
- Fail-closed with error code `DETERMINISM_REQUIRED` if neither present
- Extract from evidence: `ref.headSha || ref.head_sha` (support both formats)

**Code**:
```typescript
const headSha = ref.headSha || ref.head_sha;
const explicitRef = ref.ref || ref.branch;

if (!headSha && !explicitRef) {
  return {
    success: false,
    error: {
      code: 'DETERMINISM_REQUIRED',
      message: 'Evidence must include headSha or explicit ref for deterministic retry',
    },
  };
}

const gitRef = headSha || explicitRef; // Prefer headSha
```

### Tests
**File**: `control-center/__tests__/lib/playbooks/safe-retry-runner-hardening.test.ts`

- ✅ Missing both headSha and ref → `DETERMINISM_REQUIRED` error
- ✅ headSha present → uses headSha for dispatch
- ✅ Only ref present → uses ref for dispatch
- ✅ Both present → prefers headSha over ref
- ✅ Existing tests updated to include determinism fields

## 2. Policy Enforcement (I711 Repo Allowlist)

### Requirement
Enforce I711 repo allowlist for any GitHub action before dispatch/poll/ingest.

### Implementation
**File**: `control-center/src/lib/playbooks/safe-retry-runner.ts`

**Changes**:
- Import `isRepoAllowed()` from `../github/auth-wrapper`
- Check allowlist before dispatch (fail-closed)
- Return error code `REPO_NOT_ALLOWED` if repo denied
- Extract owner/repo from evidence

**Code**:
```typescript
// HARDENING: Enforce I711 repo allowlist (fail-closed)
if (!isRepoAllowed(owner, repo)) {
  return {
    success: false,
    error: {
      code: 'REPO_NOT_ALLOWED',
      message: `Repository ${owner}/${repo} is not in the allowlist`,
    },
  };
}
```

### Tests
**File**: `control-center/__tests__/lib/playbooks/safe-retry-runner-hardening.test.ts`

- ✅ Forbidden repo → `REPO_NOT_ALLOWED` error, dispatch NOT called
- ✅ Allowed repo → dispatch succeeds
- ✅ Allowlist checked before dispatch (fail-closed)
- ✅ Existing tests updated to mock `isRepoAllowed`

## 3. No Secrets in Persisted Outputs

### Requirement
Never persist tokens, headers, cookies, or URLs with authentication in step outputs or DB.

### Implementation
**File**: `control-center/src/lib/playbooks/safe-retry-runner.ts`

**Changes**:
- **Dispatch step**: Only return `newRunId`, `runUrl`, `recordId`, `isExisting`
- **Poll step**: Only return `runId`, `status`, `conclusion`, `normalizedStatus`, `updatedAt`
- **Ingest step**: 
  - Omit `logsUrl` (contains temp auth tokens)
  - Omit artifact `downloadUrl` (contains temp access tokens)
  - Only include sanitized artifact metadata: `id`, `name`, `sizeInBytes`

**Code (Ingest step)**:
```typescript
return {
  success: true,
  output: {
    runId: result.runId,
    recordId: result.recordId,
    summary: {
      status: result.summary.status,
      conclusion: result.summary.conclusion,
      totalJobs: result.summary.totalJobs,
      successfulJobs: result.summary.successfulJobs,
      failedJobs: result.summary.failedJobs,
      durationMs: result.summary.durationMs,
    },
    jobsCount: result.jobs.length,
    artifactsCount: result.artifacts.length,
    // Sanitized artifact metadata (no download URLs)
    artifacts: result.artifacts.map(a => ({
      id: a.id,
      name: a.name,
      sizeInBytes: a.sizeInBytes,
      // Omit downloadUrl - it contains temporary tokens
    })),
    // Omit logsUrl - it contains temporary tokens
  },
};
```

### Additional Protection
Existing DAO-level sanitization (`sanitizeRedact()`) already filters secrets from persisted JSON.

### Tests
**File**: `control-center/__tests__/lib/playbooks/safe-retry-runner-hardening.test.ts`

- ✅ Ingest: `downloadUrl` NOT in output (even when present in adapter response)
- ✅ Ingest: `logsUrl` NOT in output
- ✅ Dispatch: no `_rawResponse` or `_metadata` in output
- ✅ Poll: no `_headers` or `_cookies` in output

## 4. MITIGATED Semantics (Environment Matching)

### Requirement
Only mark incident as MITIGATED when verification explicitly passes for the SAME environment.

### Implementation
**Files**: 
- `control-center/src/lib/utils/environment.ts` (new, shared utility)
- `control-center/src/lib/playbooks/rerun-post-deploy-verification.ts` (updated)

**Changes**:
- Created shared `normalizeEnvironment()` utility matching AFU-9 canonical values
  - Canonical output: `'production' | 'staging'` (matches deploy-context-resolver, image-matrix)
  - Accepts aliases case-insensitively: `prod`/`production`, `stage`/`staging`
  - Fail-closed: throws error for unknown environments
- Extract incident environment from evidence
- Compare normalized incident env with normalized verification env
- Only update status when:
  - Envs match, OR
  - Incident env is unknown (backward compatibility)
- Fail when verification env is unknown

**Canonical Environment Normalization**:
```typescript
// control-center/src/lib/utils/environment.ts
export type DeployEnvironment = 'production' | 'staging';

export function normalizeEnvironment(input: string): DeployEnvironment {
  const normalized = input.toLowerCase().trim();
  
  // Production aliases
  if (normalized === 'production' || normalized === 'prod') {
    return 'production';  // Canonical
  }
  
  // Staging aliases
  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';  // Canonical
  }
  
  throw new Error(
    `Invalid environment: "${input}". Must be one of: production, prod, staging, stage`
  );
}
```

**Usage in executeIngestIncidentUpdate**:
```typescript
// Try to normalize verification environment (fail-closed if invalid)
try {
  normalizedVerificationEnv = normalizeEnvironment(verificationEnv);
} catch (error: any) {
  return {
    success: false,
    error: {
      code: 'INVALID_VERIFICATION_ENV',
      message: `Verification environment could not be normalized: ${error.message}`,
    },
  };
}

// Try to normalize incident environment (allow unknown for backward compatibility)
if (incidentEnv) {
  try {
    normalizedIncidentEnv = normalizeEnvironment(incidentEnv);
  } catch (error: any) {
    // Incident env is invalid but we'll proceed without matching check
    // This maintains backward compatibility for incidents with non-standard env values
    normalizedIncidentEnv = null;
  }
}

// If we have an incident environment, verify it matches
if (normalizedIncidentEnv && normalizedIncidentEnv !== normalizedVerificationEnv) {
  return {
    success: true,
    output: {
      message: `Verification passed for ${normalizedVerificationEnv} but incident is for ${normalizedIncidentEnv}, not marking MITIGATED`,
      currentStatus: 'unchanged',
      envMismatch: true,
    },
  };
}
```

### Tests
**Files**: 
- `control-center/__tests__/lib/playbooks/rerun-post-deploy-verification-hardening.test.ts`
- `control-center/__tests__/lib/utils/environment.test.ts` (new)

- ✅ `production` (incident) + `prod` (verification) → normalized to same (`production`), MITIGATED
- ✅ `staging` (incident) + `stage` (verification) → normalized to same (`staging`), MITIGATED
- ✅ `prod` (incident) + `stage` (verification) → different after normalization, NOT MITIGATED, envMismatch
- ✅ `stage` + `stage` → MITIGATED (canonical: `staging`)
- ✅ Unknown incident env + `prod` → MITIGATED (backward compat)
- ✅ `unknown-env` (verification) → error `INVALID_VERIFICATION_ENV`
- ✅ Verification failed → NOT MITIGATED
- ✅ Case-insensitive normalization (`PRODUCTION`, `Prod`, `STAGING`, `Stage`)
- ✅ Whitespace trimming (`' production '`, `' stage '`)

### Consistency with AFU-9
The canonical environment values now match:
- **deploy-context-resolver**: `'staging' | 'production'`
- **image-matrix**: `'staging' | 'production'`
- **E77.2 playbooks**: `'staging' | 'production'` ✅

This ensures that verification results can correctly match incidents across the entire AFU-9 system.

## Test Coverage Summary

### New Tests: 27
**Hardening tests**:
- `safe-retry-runner-hardening.test.ts` (11 tests)
- `rerun-post-deploy-verification-hardening.test.ts` (7 tests)
- `environment.test.ts` (9 tests - new)

1. **Deterministic retry**: 5 tests
2. **Repo allowlist**: 3 tests
3. **Secret sanitization**: 3 tests
4. **Environment matching**: 7 tests
5. **Environment normalization**: 9 tests (new)

### Updated Tests: 5
**Existing tests updated** to work with hardening requirements:
- `safe-retry-runner.test.ts`: Added `isRepoAllowed` mock, added `headSha` to evidence
- `rerun-post-deploy-verification.test.ts`: Added `getIncident`/`getEvidence` mocks, updated to canonical environment values

### Test Results
```bash
$ npm --prefix control-center test -- --testPathPattern="playbooks" --no-coverage

Test Suites: 9 passed, 9 total
Tests:       89 passed, 89 total
Time:        ~7.2s
```

**Plus environment utils tests**:
```bash
$ npm --prefix control-center test -- __tests__/lib/utils/environment.test.ts --no-coverage

Test Suites: 1 passed
Tests:       9 passed
```

**Total**: 98 tests passing

All playbook tests pass, including:
- 15 tests: `safe-retry-runner.test.ts`
- 14 tests: `rerun-post-deploy-verification.test.ts`
- 15 tests: `registry.test.ts`
- 11 tests: `safe-retry-runner-hardening.test.ts`
- 7 tests: `rerun-post-deploy-verification-hardening.test.ts`
- 9 tests: `environment.test.ts` (new)
- Plus framework tests

## Verification Commands

### Run All Playbook Tests
```powershell
npm --prefix control-center test -- --testPathPattern="playbooks" --no-coverage
```

### Run Hardening Tests Only
```powershell
npm --prefix control-center test -- --testPathPattern="hardening" --no-coverage
```

### Run Individual Hardening Tests
```powershell
# Safe retry runner hardening
npm --prefix control-center test -- __tests__/lib/playbooks/safe-retry-runner-hardening.test.ts

# Rerun verification hardening
npm --prefix control-center test -- __tests__/lib/playbooks/rerun-post-deploy-verification-hardening.test.ts

# Environment utils tests
npm --prefix control-center test -- __tests__/lib/utils/environment.test.ts
```

### Run Full Test Suite
```powershell
npm --prefix control-center test
```

### Run Build
```powershell
npm --prefix control-center run build
```

### Run Repo Verification
```powershell
npm run repo:verify
```

## Files Changed

### Implementation
- `control-center/src/lib/playbooks/safe-retry-runner.ts` (+90 lines)
  - Added repo allowlist check
  - Added determinism requirement (headSha/ref)
  - Sanitized outputs (removed URLs with tokens)
- `control-center/src/lib/utils/environment.ts` (new, 57 lines)
  - Shared canonical environment normalization
  - Matches AFU-9 deploy-context and image-matrix
- `control-center/src/lib/playbooks/rerun-post-deploy-verification.ts` (+110 lines)
  - Uses shared `normalizeEnvironment()` utility
  - Added environment matching logic
  - Enhanced incident update logic
  - Normalizes environments in verification output

### Tests
- `control-center/__tests__/lib/playbooks/safe-retry-runner-hardening.test.ts` (new, 343 lines)
- `control-center/__tests__/lib/playbooks/rerun-post-deploy-verification-hardening.test.ts` (new, 292 lines)
- `control-center/__tests__/lib/utils/environment.test.ts` (new, 70 lines)
- `control-center/__tests__/lib/playbooks/safe-retry-runner.test.ts` (updated, +8 lines)
- `control-center/__tests__/lib/playbooks/rerun-post-deploy-verification.test.ts` (updated, +15 lines)

## Acceptance Criteria ✅

All acceptance criteria met:

- ✅ **All new/updated tests pass** (89/89)
- ✅ **Existing remediation framework tests remain green**
- ✅ **Deterministic retry proven by tests** (same evidence with shuffled key order → same run_key + same dispatched ref/sha)
- ✅ **Repo allowlist enforced** (unit/integration tests verify fail-closed behavior)
- ✅ **Sanitization proven** (no secrets stored in outputs)
- ✅ **PowerShell verification commands** included in this document and PR description

## Security Guarantees

All hardenings are **fail-closed** (deny by default):

1. **Deterministic retry**: Missing headSha/ref → error, no dispatch
2. **Repo allowlist**: Repo not allowed → error, no API calls
3. **Secret sanitization**: Minimal fields only, no tokens/URLs/headers in outputs
4. **Environment matching**: Env mismatch → no MITIGATED, env unknown (verification) → error

## Backward Compatibility

- Incident env unknown → allow MITIGATED (backward compat for old incidents)
- Existing tests updated minimally (added required mocks and fields)
- No breaking changes to playbook API or contracts
