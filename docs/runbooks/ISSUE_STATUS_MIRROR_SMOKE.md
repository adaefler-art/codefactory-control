# Issue Status Mirror Smoke Test Runbook

**Version:** 1.0  
**Date:** 2025-01-04  
**Part of:** I5 — Guardrails + Backfill + Smoke Runbook

## Overview

This runbook provides step-by-step instructions for validating that the State Model v1 issue status mirroring is working correctly in staging. It ensures that:

1. **Sync operations update GitHub mirror status** in the database
2. **Effective status is computed and visible** in the UI
3. **No regressions** where sync succeeds but nothing changes

## Prerequisites

- Access to staging environment
- Valid smoke test credentials
- `curl` or equivalent HTTP client
- PostgreSQL client (optional, for direct DB inspection)

## Environment Setup

### Staging Base URL

```powershell
# PowerShell
$StageBase = "https://your-staging-url.amazonaws.com"

# Bash/Zsh
export STAGE_BASE="https://your-staging-url.amazonaws.com"
```

### Authentication Headers

The staging environment uses two authentication headers:

- `x-afu9-smoke-key`: Staging smoke test key (from AWS Secrets Manager)
- `x-afu9-sub`: User identifier (e.g., `smoke-user-a`)

**Security Note:** The `x-afu9-smoke-key` is only valid in staging and is rotated regularly. Never use production credentials for smoke tests.

### Retrieve Smoke Key

```powershell
# PowerShell (requires AWS CLI and appropriate IAM permissions)
$SmokeKey = aws secretsmanager get-secret-value `
  --secret-id afu9/stage/smoke-key `
  --query SecretString `
  --output text

# Bash/Zsh
export SMOKE_KEY=$(aws secretsmanager get-secret-value \
  --secret-id afu9/stage/smoke-key \
  --query SecretString \
  --output text)
```

## Test Scenarios

### Scenario 1: Fresh Issue Refresh (GitHub → AFU9)

**Goal:** Verify that refreshing issues from GitHub creates snapshots and updates mirror status.

#### Step 1.1: Trigger Issue Refresh

```powershell
# PowerShell
curl.exe -i "$StageBase/api/issues/refresh" `
  -X POST `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a" `
  -H "Content-Type: application/json"
```

```bash
# Bash/Zsh
curl -i "$STAGE_BASE/api/issues/refresh" \
  -X POST \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a" \
  -H "Content-Type: application/json"
```

**Expected Response:**

- **Status:** `200 OK`
- **Body:**
  ```json
  {
    "ok": true,
    "total": <number>,
    "upserted": <number>,
    "statusSynced": <number>,
    "syncedAt": "<ISO timestamp>"
  }
  ```

**Success Criteria:**
- ✅ `statusSynced > 0` (indicates github_mirror_status was updated)
- ✅ `upserted > 0` (indicates snapshots were created/updated)
- ✅ Response time < 30s (indicates efficient sync)

#### Step 1.2: Verify Issue Status

Query the issues API to verify that effective status is returned:

```powershell
# PowerShell
curl.exe -i "$StageBase/api/issues" `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a"
```

```bash
# Bash/Zsh
curl -i "$STAGE_BASE/api/issues" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a"
```

**Expected Response:**

- **Status:** `200 OK`
- **Body:** Array of issues with State Model v1 fields:
  ```json
  {
    "issues": [
      {
        "id": "<uuid>",
        "publicId": "<8-hex>",
        "title": "...",
        "localStatus": "SPEC_READY",
        "githubMirrorStatus": "IN_PROGRESS",
        "executionState": "IDLE",
        "handoffState": "SYNCED",
        "effectiveStatus": "IMPLEMENTING",
        "githubStatusRaw": "status: in progress",
        "githubLastSyncedAt": "<ISO timestamp>",
        ...
      }
    ]
  }
  ```

**Success Criteria:**
- ✅ All issues have `effectiveStatus` field (not null)
- ✅ `githubMirrorStatus` is not `UNKNOWN` for synced issues
- ✅ `effectiveStatus` differs from `localStatus` when GitHub status is available
- ✅ `githubLastSyncedAt` is recent (within last hour)

### Scenario 2: Explicit Sync Operation

**Goal:** Verify that the sync endpoint works correctly and updates mirror status.

#### Step 2.1: Trigger Sync

```powershell
# PowerShell
curl.exe -i "$StageBase/api/issues/sync" `
  -X POST `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a" `
  -H "Content-Type: application/json" `
  -d '{}'
```

```bash
# Bash/Zsh
curl -i "$STAGE_BASE/api/issues/sync" \
  -X POST \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**

- **Status:** `200 OK`
- **Body:**
  ```json
  {
    "ok": true,
    "total": <number>,
    "upserted": <number>,
    "statusSynced": <number>,
    "syncedAt": "<ISO timestamp>"
  }
  ```

**Success Criteria:**
- ✅ `statusSynced > 0` (confirms mirror status updates)
- ✅ Response time < 60s
- ✅ No error messages in response

#### Step 2.2: Check Issue Status Snapshots

```powershell
# PowerShell
curl.exe -i "$StageBase/api/issues/status" `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a"
```

```bash
# Bash/Zsh
curl -i "$STAGE_BASE/api/issues/status" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a"
```

**Expected Response:**

- **Status:** `200 OK`
- **Body:**
  ```json
  {
    "items": [ ... ],
    "hasMore": false,
    "nextCursor": null,
    "staleness": {
      "lastSyncedAt": "<ISO timestamp>",
      "stalenessHours": <number>,
      "totalSnapshots": <number>
    },
    "recentSyncRuns": [
      {
        "id": "<uuid>",
        "startedAt": "<ISO timestamp>",
        "finishedAt": "<ISO timestamp>",
        "status": "SUCCESS",
        "totalCount": <number>,
        "upsertedCount": <number>,
        "error": null
      }
    ]
  }
  ```

**Success Criteria:**
- ✅ `staleness.lastSyncedAt` is recent (within last 5 minutes)
- ✅ `recentSyncRuns[0].status` is `"SUCCESS"`
- ✅ `items` array is not empty
- ✅ Each item has `githubMirrorStatus` and `effectiveStatus`

### Scenario 3: UI Visibility Check

**Goal:** Verify that effective status is visible in the UI.

#### Step 3.1: Navigate to Issues Page

Open the staging UI in a browser:

```
https://your-staging-url.amazonaws.com/issues
```

#### Step 3.2: Visual Inspection

**Success Criteria:**
- ✅ Issues table shows "Effective Status" column (or primary status badge)
- ✅ Status badges display effective status values (SPEC_READY, IMPLEMENTING, etc.)
- ✅ Hover tooltips show state dimensions (GitHub mirror, execution state, etc.)
- ✅ Filter by status uses effective status
- ✅ Active-only filter shows issues with effectiveStatus=SPEC_READY

**Screenshot Verification:**

Take screenshots showing:
1. Issues list with effective status column
2. Issue detail page with all state dimensions
3. Status filter dropdown using effective status values

### Scenario 4: Regression Guard (Sync OK but Nothing Changes)

**Goal:** Ensure that sync operations actually persist changes, not just return 200 OK.

#### Step 4.1: Record Baseline

```powershell
# Get current state
$Before = curl.exe -s "$StageBase/api/issues/status" `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a" | ConvertFrom-Json

$BeforeTimestamp = $Before.staleness.lastSyncedAt
```

```bash
# Bash/Zsh
BEFORE=$(curl -s "$STAGE_BASE/api/issues/status" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a")

BEFORE_TIMESTAMP=$(echo "$BEFORE" | jq -r '.staleness.lastSyncedAt')
```

#### Step 4.2: Trigger Sync

```powershell
curl.exe -i "$StageBase/api/issues/sync" `
  -X POST `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a" `
  -H "Content-Type: application/json"
```

```bash
curl -i "$STAGE_BASE/api/issues/sync" \
  -X POST \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a" \
  -H "Content-Type: application/json"
```

#### Step 4.3: Verify State Changed

```powershell
# Wait 2 seconds for propagation
Start-Sleep -Seconds 2

$After = curl.exe -s "$StageBase/api/issues/status" `
  -H "x-afu9-smoke-key: $SmokeKey" `
  -H "x-afu9-sub: smoke-user-a" | ConvertFrom-Json

$AfterTimestamp = $After.staleness.lastSyncedAt

# Compare timestamps
if ($BeforeTimestamp -ne $AfterTimestamp) {
  Write-Host "✅ PASS: Sync updated lastSyncedAt"
  Write-Host "   Before: $BeforeTimestamp"
  Write-Host "   After:  $AfterTimestamp"
} else {
  Write-Host "❌ FAIL: Sync did not update state"
  Write-Host "   Timestamp unchanged: $BeforeTimestamp"
  exit 1
}
```

```bash
# Bash/Zsh
# Wait 2 seconds for propagation
sleep 2

AFTER=$(curl -s "$STAGE_BASE/api/issues/status" \
  -H "x-afu9-smoke-key: $SMOKE_KEY" \
  -H "x-afu9-sub: smoke-user-a")

AFTER_TIMESTAMP=$(echo "$AFTER" | jq -r '.staleness.lastSyncedAt')

# Compare timestamps
if [ "$BEFORE_TIMESTAMP" != "$AFTER_TIMESTAMP" ]; then
  echo "✅ PASS: Sync updated lastSyncedAt"
  echo "   Before: $BEFORE_TIMESTAMP"
  echo "   After:  $AFTER_TIMESTAMP"
else
  echo "❌ FAIL: Sync did not update state"
  echo "   Timestamp unchanged: $BEFORE_TIMESTAMP"
  exit 1
fi
```

**Success Criteria:**
- ✅ `lastSyncedAt` timestamp changes after sync
- ✅ At least one `githubMirrorStatus` value changes (if GitHub status changed)
- ✅ `recentSyncRuns` shows new run entry

## Database Verification (Optional)

For deep validation, connect directly to the staging database:

```sql
-- Check recent sync runs
SELECT id, status, started_at, finished_at, total_count, upserted_count, error
FROM issue_sync_runs
ORDER BY started_at DESC
LIMIT 5;

-- Check issues with GitHub mirror status
SELECT id, public_id, title, 
       status AS local_status,
       github_mirror_status,
       github_status_raw,
       github_issue_last_sync_at
FROM afu9_issues
WHERE github_issue_number IS NOT NULL
ORDER BY github_issue_last_sync_at DESC
LIMIT 10;

-- Check issues with UNKNOWN mirror status (should be rare after sync)
SELECT COUNT(*) as unknown_count
FROM afu9_issues
WHERE github_issue_number IS NOT NULL
  AND (github_mirror_status = 'UNKNOWN' OR github_mirror_status IS NULL);
```

**Success Criteria:**
- ✅ Recent sync run has `status = 'SUCCESS'`
- ✅ `upserted_count > 0` in recent run
- ✅ Most synced issues have `github_mirror_status != 'UNKNOWN'`
- ✅ `github_issue_last_sync_at` is recent for synced issues

## Troubleshooting

### Issue: Sync returns 200 but statusSynced=0

**Symptoms:**
- `/api/issues/sync` returns 200 OK
- Response has `upserted > 0` but `statusSynced = 0`

**Diagnosis:**
1. Check if issues have `github_issue_number` (required for status sync)
2. Verify GitHub status extraction logic in sync route
3. Check database logs for update failures

**Resolution:**
- Review sync route implementation for `extractGithubMirrorStatus()` usage
- Check database permissions for `afu9_issues` table updates
- Run backfill script to update existing issues: `ts-node scripts/backfill-state-model.ts --apply`

### Issue: effectiveStatus not showing in UI

**Symptoms:**
- API returns `effectiveStatus` field
- UI shows old `status` field instead

**Diagnosis:**
1. Check browser console for JavaScript errors
2. Verify API response includes `effectiveStatus`
3. Inspect UI component code for `issue.effectiveStatus` usage

**Resolution:**
- Clear browser cache and reload
- Check UI code uses `issue.effectiveStatus ?? mapToCanonicalStatus(issue.status)`
- Run guardrails check: `npm run repo:verify`

### Issue: githubMirrorStatus always UNKNOWN

**Symptoms:**
- Sync completes successfully
- All issues have `githubMirrorStatus = 'UNKNOWN'`

**Diagnosis:**
1. Check if GitHub issues have status labels or Project fields
2. Verify `extractGithubMirrorStatus()` mapping logic
3. Check `github_status_raw` field has data

**Resolution:**
- Add status labels to GitHub issues (e.g., "status: in progress")
- Or use GitHub Projects with status field
- Or update mapping logic in `stateModel.ts` for custom labels

### Issue: Authentication Failure (401 Unauthorized)

**Symptoms:**
- API returns 401 Unauthorized
- Headers appear correct

**Diagnosis:**
1. Verify smoke key is not expired
2. Check `x-afu9-sub` header is set
3. Verify staging environment URL is correct

**Resolution:**
- Rotate smoke key: See deployment runbook
- Ensure headers are sent correctly (check curl syntax)
- Verify staging ECS task is running: `aws ecs list-tasks --cluster afu9-stage`

## Success Checklist

Use this checklist to verify a complete successful smoke test:

- [ ] **Scenario 1:** Issue refresh returns `statusSynced > 0`
- [ ] **Scenario 1:** API returns issues with `effectiveStatus` field
- [ ] **Scenario 2:** Explicit sync updates `githubMirrorStatus`
- [ ] **Scenario 2:** Sync staleness updates to recent timestamp
- [ ] **Scenario 3:** UI displays effective status in issues table
- [ ] **Scenario 3:** UI filter by status uses effective status
- [ ] **Scenario 4:** Sync operation changes state (not just 200 OK)
- [ ] **Scenario 4:** Database shows recent sync run with SUCCESS
- [ ] **Overall:** No 5xx errors in any API call
- [ ] **Overall:** Response times < 60s for sync operations

## References

- **State Model v1 Documentation:** `docs/state/STATE_MODEL_V1.md`
- **API Routes Documentation:** `docs/AFU9-ISSUES-API.md`
- **Deployment Process:** `docs/runbooks/deploy-process.md`
- **Guardrails Check:** `scripts/repo-verify.ts`
- **Backfill Tool:** `scripts/backfill-state-model.ts`

## Change Log

- **2026-01-04:** Initial version for I5 (State Model v1 Guardrails)
