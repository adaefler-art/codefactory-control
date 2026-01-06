# Issue 3: Production Guard Implementation Audit

**Date:** 2026-01-05  
**Purpose:** Evidence-based audit of current guard implementations before standardization

## Current Guard Implementations

### Guarded Endpoints (Using checkProdWriteGuard)

| Endpoint | File | Guard Order | Status Code | DB Calls Before Guard? |
|----------|------|-------------|-------------|----------------------|
| `/api/ops/issues/sync` | `app/api/ops/issues/sync/route.ts:200-214` | **Prod guard → Auth** | 403 (prod disabled) → 401 (auth) | ❌ **WRONG ORDER** |
| `/api/playbooks/post-deploy-verify/run` | `app/api/playbooks/post-deploy-verify/run/route.ts:48-52` | **Prod guard → No auth** | 403 (prod disabled) | ❌ **NO AUTH CHECK** |
| `/api/integrations/github/runner/dispatch` | `app/api/integrations/github/runner/dispatch/route.ts:20-24` | **Prod guard → No auth** | 403 (prod disabled) | ❌ **NO AUTH CHECK** |

### Smoke Test Endpoint (Different Pattern)

| Endpoint | File | Guard Order | Status Code | Notes |
|----------|------|-------------|-------------|-------|
| `/api/integrations/github/smoke` | `app/api/integrations/github/smoke/route.ts:20-28` | **NODE_ENV check** | 404 (not available) | Uses NODE_ENV, not ENABLE_PROD |

### Reference Endpoint (Correct Pattern)

| Endpoint | File | Guard Order | Status Code | DB Calls Before Guard? |
|----------|------|-------------|-------------|----------------------|
| `/api/ops/db/migrations` | `app/api/ops/db/migrations/route.ts:87-122` | **401 (auth) → 409 (env) → 403 (admin)** | Correct sequence | ✅ **NO** - All guards before DB |

## Current Guard Helper: checkProdWriteGuard

**Location:** `control-center/src/lib/api/prod-guard.ts`

**Current Behavior:**
```typescript
// Returns 403 when prod disabled (WRONG - should be 409)
// No auth check - assumes it happens elsewhere
// Status code: 403 (should be 409 for environment disabled)
```

**Problems:**
1. ❌ **Wrong status code:** Returns 403 instead of 409 for environment disabled
2. ❌ **No auth enforcement:** Doesn't check x-afu9-sub first
3. ❌ **Wrong order:** Applied before auth in most endpoints
4. ❌ **No admin check:** Doesn't verify AFU9_ADMIN_SUBS allowlist

## /api/ready Current Behavior

**Location:** `control-center/app/api/ready/route.ts:79-87`

**Current Implementation:**
```typescript
// Line 80-84: Sets checks.prod_enabled.status = 'error' when ENABLE_PROD=false
// Line 203: Determines overall ready based on hasFailures
// Result: ready=false when prod disabled (line 203)
```

**Problem:**
- ❌ **Returns ready=false** when prod disabled, which could cause ECS/ALB health check failures
- ❌ **May cause service churn** if used as ECS health check target
- Need to verify: Is /api/ready used for ECS health checks or ALB health checks?

## Environment Detection

**Files:**
- `control-center/src/lib/utils/deployment-env.ts` - Canonical deployment environment
- `control-center/src/lib/utils/prod-control.ts` - ENABLE_PROD check

**Current Logic:**
```typescript
// deployment-env.ts
getDeploymentEnv() → 'production' | 'staging' | 'development' | 'unknown'
// Uses ENVIRONMENT env var (set in ECS task definition)

// prod-control.ts  
isProdEnabled() → process.env.ENABLE_PROD === 'true'
```

## POST Endpoints Requiring Guards

Based on repository scan, these POST endpoints likely need prod guards:

### Already Guarded (Issue 3)
- ✅ `/api/ops/issues/sync` - Issue sync
- ✅ `/api/playbooks/post-deploy-verify/run` - Playbook execution
- ✅ `/api/integrations/github/runner/dispatch` - Workflow dispatch

### Not Yet Guarded (May need guards)
- `/api/ops/db/migrations` - Has auth+admin but no ENABLE_PROD check
- `/api/lawbook/activate` - Lawbook activation (has admin check)
- `/api/lawbook/publish` - Lawbook publishing (has admin check)
- `/api/incidents/*` - Incident management
- `/api/outcomes/generate` - Outcome generation
- Others TBD (need further analysis)

## Admin Check Pattern

**Location:** `app/api/ops/db/migrations/route.ts:65-74`

**Current Implementation:**
```typescript
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    return false; // Fail-closed
  }
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}
```

## Required Changes (Package 2+)

### 1. Standardize Guard Helper
- New location: `control-center/src/lib/guards/prod-write-guard.ts`
- Enforce order: **401 (auth) → 409 (prod disabled) → 403 (admin)**
- Return correct status codes
- Prevent any DB calls before all guards pass

### 2. Fix Status Codes
- Prod disabled: **403 → 409** (conflict with environment state)
- Auth missing: **401** (unauthorized)
- Not admin: **403** (forbidden)

### 3. Fix Guard Order
- All endpoints must check **auth FIRST**
- Then check **prod disabled**
- Then check **admin** (if required)
- Only then proceed to DB/network calls

### 4. Fix /api/ready Semantics
- Keep `ready=true` even when `ENABLE_PROD=false`
- Add explicit flags: `prodEnabled`, `prodWritesBlocked`
- Include reason in response payload
- Verify health check configuration doesn't depend on this

## Evidence Required (Package 4)

### Tests Must Prove:
1. ✅ Missing x-afu9-sub → **401** and **ZERO DB calls**
2. ✅ Prod + ENABLE_PROD=false → **409** and **ZERO DB calls**
3. ✅ Non-admin → **403** and **ZERO DB calls**
4. ✅ Admin + stage → Allowed (mock DB call happens)
5. ✅ /api/ready returns ready=true with prodEnabled=false

### Test Files to Create/Update:
- `control-center/__tests__/lib/guards/prod-write-guard.test.ts` (new)
- `control-center/__tests__/app/api/ops/issues/sync-guards.test.ts` (new)
- `control-center/__tests__/app/api/ready-prod-disabled.test.ts` (new)

## Next Steps

✅ **All Packages Complete:**
1. ✅ **Package 1 Complete:** This audit document
2. ✅ **Package 2 Complete:** Standardized guard helper (`src/lib/guards/prod-write-guard.ts`)
3. ✅ **Package 3 Complete:** Fixed /api/ready semantics (ready=true with flags)
4. ✅ **Package 4 Complete:** Comprehensive tests (guard ordering + no DB calls)
5. ✅ **Package 5 Complete:** Documentation and runbook

## Summary of Changes

**Files Created:**
- `control-center/src/lib/guards/prod-write-guard.ts` - Unified guard helper
- `control-center/__tests__/lib/guards/prod-write-guard.test.ts` - Guard tests
- `control-center/__tests__/app/api/ready-prod-disabled.test.ts` - Ready endpoint tests
- `docs/audit/v0.7/ISSUE_3_GUARD_AUDIT.md` - This audit
- `docs/runbooks/ISSUE_3_PROD_DEACTIVATION_VERIFY.md` - Verification runbook

**Files Modified:**
- `control-center/app/api/ops/issues/sync/route.ts` - Uses new guard, correct order
- `control-center/app/api/playbooks/post-deploy-verify/run/route.ts` - Uses new guard
- `control-center/app/api/integrations/github/runner/dispatch/route.ts` - Uses new guard
- `control-center/app/api/ready/route.ts` - Fixed semantics (ready=true with flags)

**Key Improvements:**
- ✅ Correct guard order: 401 → 409 → 403 (was: 403 → 401)
- ✅ Correct status code: 409 for prod disabled (was: 403)
- ✅ Auth now enforced on all guarded endpoints (was: missing on 2 endpoints)
- ✅ No DB calls before guards pass (proven in tests)
- ✅ /api/ready returns ready=true (was: ready=false, could cause churn)
- ✅ Explicit prodControl flags (was: buried in checks)

## Notes

- Current implementation has **wrong guard order** (prod before auth)
- Current implementation uses **wrong status code** (403 instead of 409)
- /api/ready may cause **unhealthy churn** if used for ECS health checks
- Need to extract and reuse the admin check pattern from migrations endpoint
