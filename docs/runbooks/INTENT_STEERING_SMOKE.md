# INTENT Steering Smoke Test - v0.8 Gate

**Issue:** I908 - Regression Pack: "INTENT Steering Smoke" (v0.8 Gate)  
**Purpose:** Minimal, repeatable test pack that proves INTENT usability as a v0.8 gate  
**Runtime:** < 10 minutes  
**Status:** ✅ Active

## Overview

This runbook documents the automated smoke test suite for INTENT Steering functionality. The test pack verifies that the core INTENT features implemented in v0.8 are operational and ready for release.

## Prerequisites

### Required
- Control Center running (local or staging)
- Valid authentication (user ID or smoke key)
- Database migrations applied (up to migration 077+)

### Optional
- Admin privileges (for activity log and publish tests)
- GitHub App credentials (for publish tests)
- `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true` (for publish tests)

## Running the Tests

### Quick Start

```powershell
# Local development
./scripts/verify-intent-steering.ps1

# Staging environment
./scripts/verify-intent-steering.ps1 `
  -BaseUrl "https://stage.afu-9.com" `
  -SmokeKey $env:AFU9_SMOKE_KEY

# Skip publish test
./scripts/verify-intent-steering.ps1 -SkipPublish
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `BaseUrl` | No | `http://localhost:3000` | Base URL of the AFU-9 instance |
| `UserId` | No | `smoke-test-user` | User ID for authentication |
| `SmokeKey` | No | `$env:AFU9_SMOKE_KEY` | Smoke key for staging/production |
| `SkipPublish` | No | `false` | Skip GitHub publish test |

## Test Coverage

The smoke test verifies the following v0.8 features:

### Test 1: UI Stable (I901) ✅

**What it tests:**
- `/intent` page loads without errors
- Page contains expected INTENT UI elements
- No layout regressions (header, composer, messages)

**Expected outcome:**
- HTTP 200 response
- Page content includes INTENT-related keywords ("intent", "session", "DISCUSS")

**Success criteria:**
```
✓ PASS: UI page loads successfully (status 200, contains expected content)
```

**Troubleshooting:**
- **404 Not Found:** Check Next.js routes configuration
- **500 Server Error:** Check application logs for runtime errors
- **Missing content:** Verify Control Center build and deployment

### Test 2: Draft GET/PATCH/COMMIT (I902) ✅

**What it tests:**
- Session creation
- Draft GET (NO_DRAFT state)
- Draft save/create
- Draft patch (idempotency)
- Draft validation
- Version commit

**Expected outcomes:**
- Session created: HTTP 201, returns `sessionId`
- GET draft: HTTP 200, `success: true`, `reason: "NO_DRAFT"`
- Save draft: HTTP 200/201
- Patch draft: HTTP 200/201 (idempotent)
- Validate draft: HTTP 200, `status: "VALID"`
- Commit version: HTTP 200/201

**Success criteria:**
```
✓ PASS: Session created: <session-id>
✓ PASS: GET draft returns deterministic NO_DRAFT state (200)
✓ PASS: Draft saved successfully
✓ PASS: Draft patched successfully (idempotent)
✓ PASS: Draft validation passed (status: VALID)
✓ PASS: Draft version committed successfully
```

**Troubleshooting:**
- **500 on session create:** Check `intent_sessions` table exists, `user_id` column present
- **NO_DRAFT missing:** Verify API returns proper empty state (not 404)
- **Validation fails:** Check draft schema against Zod validation rules
- **Commit fails:** Verify `intent_issue_set_versions` table exists

### Test 3: DISCUSS→ACT Mode Switching (I903) ✅

**What it tests:**
- Read current conversation mode
- Switch from DISCUSS to ACT
- Switch from ACT back to DISCUSS

**Expected outcomes:**
- GET session: HTTP 200, includes `conversation_mode` field
- PATCH to ACT: HTTP 200, `conversation_mode: "ACT"`
- PATCH to DISCUSS: HTTP 200, `conversation_mode: "DISCUSS"`

**Success criteria:**
```
✓ PASS: Current mode: DISCUSS
✓ PASS: Mode switched to ACT successfully
✓ PASS: Mode switched back to DISCUSS successfully
```

**Troubleshooting:**
- **Invalid mode:** Check migration 077 applied (DISCUSS, DRAFTING, ACT constraint)
- **PATCH fails:** Verify `updateSessionMode()` function accepts new modes
- **Mode not persisted:** Check database UPDATE query succeeds

### Test 4: Publish to GitHub (I907) ⚠️

**What it tests:**
- Publish committed draft versions to GitHub
- Batch summary response
- GitHub issue creation

**Expected outcomes:**
- HTTP 200/201: Publish successful
- Response includes `batch_id` and `summary` (total, created, updated, failed)
- HTTP 403: User not in admin list (acceptable)
- HTTP 409: Publishing disabled in environment (acceptable)

**Success criteria:**
```
✓ PASS: Publish completed with batch ID: <batch-id>
⊘ SKIP: Publish test (403 Forbidden - requires admin privileges)
⊘ SKIP: Publish test (409 Conflict - publishing disabled in this environment)
```

**Troubleshooting:**
- **403 Forbidden:** Add user to `AFU9_ADMIN_SUBS` environment variable
- **409 Conflict:** Set `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true`
- **GitHub API errors:** Check GitHub App credentials and permissions
- **Repo not allowed:** Verify repo in allowlist

### Test 5: Activity Log Trail (I904) ⚠️

**What it tests:**
- Activity log API accessible
- Events are recorded
- Response schema valid

**Expected outcomes:**
- HTTP 200: Activity log accessible
- Response includes `ok: true`, `events` array, `pagination` object
- HTTP 401: Unauthorized (acceptable if not admin)

**Success criteria:**
```
✓ PASS: Activity log accessible (found X/Y events)
⊘ SKIP: Activity log test (401 Unauthorized - requires admin access)
```

**Troubleshooting:**
- **401 Unauthorized:** Use admin user or smoke key
- **Empty events:** No events logged yet (acceptable)
- **Schema errors:** Check `unified_timeline_events` table structure

## Output Format

### Success (All Tests Pass)

```
════════════════════════════════════════════════════════════════
  Test Summary
════════════════════════════════════════════════════════════════

Total Tests:    15
Passed:         13
Failed:         0
Skipped:        2

Duration:       45.32 seconds
Target:         < 600 seconds (10 minutes)

✓ GATE PASSED - v0.8 INTENT Steering is operational

Next Steps:
  1. Review skipped tests (if any) and address if needed
  2. Verify manual UI interaction at http://localhost:3000/intent
  3. Include this output as 'Gate Evidence' in PR
```

### Failure (Some Tests Fail)

```
════════════════════════════════════════════════════════════════
  Test Summary
════════════════════════════════════════════════════════════════

Total Tests:    15
Passed:         10
Failed:         3
Skipped:        2

Duration:       38.21 seconds
Target:         < 600 seconds (10 minutes)

✗ GATE FAILED - 3 test(s) failed

Next Steps:
  1. Review failed tests above for specific error messages
  2. Check application logs for detailed error information
  3. Verify environment configuration (DB schema, env vars, etc.)
  4. Re-run script after fixes
```

## Gate Criteria

The v0.8 gate is considered **PASSED** when:

1. ✅ All critical tests pass (Test 1, 2, 3)
2. ⚠️ Admin-only tests may skip (Test 4, 5) if user lacks privileges
3. ✅ Total runtime < 10 minutes
4. ✅ No unhandled exceptions or crashes

The v0.8 gate is considered **FAILED** when:

1. ❌ Any critical test fails (Test 1, 2, 3)
2. ❌ Unhandled exceptions occur
3. ❌ Runtime > 10 minutes

## Manual Verification Steps

After automated tests pass, perform these manual checks:

### 1. UI Interaction Test

```
1. Navigate to /intent
2. Create new session (click "New Session")
3. Verify chat interface loads:
   - Message input visible
   - Send button enabled
   - No error banners
4. Send test message: "Create a draft issue for testing"
5. Verify:
   - Message appears in chat
   - INTENT responds
   - No console errors
```

### 2. Draft Panel Test

```
1. Click "Issue Draft" panel button
2. Verify draft panel opens
3. Check draft content appears
4. Click "Validate" button
5. Verify validation status updates
6. Click "Commit Version" button
7. Verify success message
```

### 3. Mode Switching Test

```
1. In session, check current mode badge
2. Click mode dropdown/selector
3. Switch to "ACT" mode
4. Verify mode badge updates
5. Switch back to "DISCUSS" mode
6. Verify mode badge updates
```

### 4. Activity Log Test (Admin Only)

```
1. Navigate to /admin/activity
2. Verify event list loads
3. Apply filter (e.g., by type)
4. Verify filtered results
5. Click event to view details
6. Verify detail panel shows full info
```

## Integration with CI/CD

### Pre-deployment Check

```yaml
- name: Run INTENT Steering Smoke Test
  run: |
    ./scripts/verify-intent-steering.ps1 \
      -BaseUrl "https://stage.afu-9.com" \
      -SmokeKey ${{ secrets.AFU9_SMOKE_KEY }}
```

### Post-deployment Verification

```yaml
- name: Verify v0.8 Gate
  run: |
    ./scripts/verify-intent-steering.ps1 \
      -BaseUrl ${{ env.DEPLOY_URL }} \
      -SmokeKey ${{ secrets.AFU9_SMOKE_KEY }}
  continue-on-error: false
```

## Related Issues

- **I901:** INTENT Console UI Hotfix (Chat sicht-/scrollbar, Composer überlappt nicht)
- **I902:** Draft Access Reliability (INTENT kann Draft lesen/patchen/committen)
- **I903:** Steering Modes "DISCUSS" vs "ACT" (Guardrails erst bei Act/Commit)
- **I904:** Activity Log (UI + API)
- **I907:** In-App Flow for Issue Creation and Publishing

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-17 | Initial release for v0.8 gate |

## Support

If tests fail repeatedly:

1. Check Control Center logs: `docker logs <container-id>` or `npm --prefix control-center run dev`
2. Check database state: `psql` and verify tables exist
3. Check environment variables: Review `.env` or ECS task definition
4. Review recent code changes: May need migration or schema updates
5. Escalate to development team with full test output

## References

- Script: `scripts/verify-intent-steering.ps1`
- Related runbooks:
  - `docs/runbooks/INTENT_STAGE_ENABLE.md`
  - `docs/runbooks/INTENT_ISSUE_AUTHORING_SMOKE.md`
- Implementation summaries:
  - `I901_IMPLEMENTATION_SUMMARY.md`
  - `I902_IMPLEMENTATION_SUMMARY.md`
  - `I903_IMPLEMENTATION_SUMMARY.md` (in `docs/`)
  - `I904_IMPLEMENTATION_SUMMARY.md`
  - `I907_IMPLEMENTATION_SUMMARY.md`
