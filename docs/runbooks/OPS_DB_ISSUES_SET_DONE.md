# Runbook: Ops DB - Bulk Set Issues to DONE

**Purpose**: Admin-only operation to bulk update issue status to DONE  
**Environments**: Staging, Development only (Production blocked)  
**Authentication**: Requires admin privileges (AFU9_ADMIN_SUBS)

---

## Overview

This runbook documents how to use the Control Center UI and API to bulk set AFU9 issues to DONE status. The operation includes:

- ✅ 401-first authentication (x-afu9-sub header)
- ✅ Stage-only enforcement (production → 409)
- ✅ Admin-only access (AFU9_ADMIN_SUBS → 403)
- ✅ Preview before execute
- ✅ Bounded output (max 200 rows)
- ✅ Audit trail in ops_admin_actions table
- ✅ Deterministic ordering (github_issue_number ASC)

---

## Guard Ordering (Fail-Closed)

The API enforces guards in strict order with **ZERO DB calls** before all guards pass:

1. **AUTH (401)**: Missing/invalid x-afu9-sub → 401 MISSING_AUTH
2. **ENV (409)**: Production/unknown environment → 409 PROD_DISABLED/ENV_DISABLED
3. **ADMIN (403)**: Non-admin sub → 403 NOT_ADMIN
4. **VALIDATION (400)**: Invalid params → 400 VALIDATION_ERROR
5. **DB OPERATIONS**: Only after all guards pass

---

## UI Access

### Navigate to Ops DB Issues Page

```
URL: https://your-control-center.com/ops/db/issues
```

**Prerequisites**:
1. Authenticated session with admin privileges
2. Running in staging or development environment

**UI Flow**:
1. Select target statuses (CREATED, SPEC_READY)
2. Optionally set GitHub issue number range
3. Click **Preview** to see affected issues
4. Review counts and sample rows
5. Type "CONFIRM" in input field
6. Click **Execute** to perform update

---

## API Usage (PowerShell)

### Prerequisites

```powershell
# Set authentication header (from your session token)
$headers = @{
    "x-afu9-sub" = "your-sub-id-here"
    "Content-Type" = "application/json"
}

# Base URL (staging)
$baseUrl = "https://staging.your-control-center.com"
```

---

### Example 1: Preview (Default Statuses)

**Purpose**: See which CREATED + SPEC_READY issues would be updated

```powershell
# Preview with default statuses (CREATED, SPEC_READY)
$previewUrl = "$baseUrl/api/ops/db/issues/preview-set-done?statuses=CREATED,SPEC_READY"

$response = Invoke-WebRequest -Uri $previewUrl -Headers $headers -Method GET
$data = $response.Content | ConvertFrom-Json

Write-Host "Request ID: $($data.requestId)" -ForegroundColor Cyan
Write-Host "Affected Count: $($data.affectedCount)" -ForegroundColor Yellow
Write-Host "Environment: $($data.environment)" -ForegroundColor Green

# Display status distribution
$data.statusDistribution | Format-Table -AutoSize

# Display sample rows
$data.sampleRows | Format-Table -Property githubIssueNumber, title, status -AutoSize
```

**Expected Output**:

```
Request ID: 12345678-90ab-cdef-1234-567890abcdef
Affected Count: 23
Environment: staging

status       count
------       -----
CREATED         15
DONE           105
SPEC_READY       8
...

githubIssueNumber title                                status
----------------- -----                                ------
               80 E80.1 New Feature                    CREATED
               81 E81.1 Bug Fix                        SPEC_READY
...
```

---

### Example 2: Preview with Range Filter

**Purpose**: Preview specific range of issues

```powershell
# Preview issues #100-200 only
$params = @{
    statuses = "CREATED,SPEC_READY"
    githubIssueMin = 100
    githubIssueMax = 200
}

$queryString = ($params.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "&"
$previewUrl = "$baseUrl/api/ops/db/issues/preview-set-done?$queryString"

$response = Invoke-WebRequest -Uri $previewUrl -Headers $headers -Method GET
$data = $response.Content | ConvertFrom-Json

# Display results (same as Example 1)
```

---

### Example 3: Execute Update

**Purpose**: Perform the actual status update

```powershell
# Execute with confirmation
$executeUrl = "$baseUrl/api/ops/db/issues/set-done"

$body = @{
    confirm = "CONFIRM"
    statuses = @("CREATED", "SPEC_READY")
    # Optional range filters
    # githubIssueMin = 100
    # githubIssueMax = 200
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri $executeUrl -Headers $headers -Method POST -Body $body
$data = $response.Content | ConvertFrom-Json

Write-Host "✅ Execute Complete" -ForegroundColor Green
Write-Host "Request ID: $($data.requestId)" -ForegroundColor Cyan
Write-Host "Updated Count: $($data.result.updatedCount)" -ForegroundColor Yellow

# Display updated rows (sample)
$data.result.sampleRows | Format-Table -Property githubIssueNumber, title, status -AutoSize

if ($data.result.truncated) {
    Write-Host "⚠️ Sample truncated (showing $($data.result.returnedSampleCount) of $($data.result.updatedCount))" -ForegroundColor Yellow
}
```

**Expected Output**:

```
✅ Execute Complete
Request ID: 23456789-01bc-def2-3456-7890abcdef12
Updated Count: 23

githubIssueNumber title                                status
----------------- -----                                ------
               80 E80.1 New Feature                    DONE
               81 E81.1 Bug Fix                        DONE
...

⚠️ Sample truncated (showing 20 of 23)
```

---

## Error Handling

### 401 Unauthorized (Missing Auth)

```powershell
{
  "error": "Unauthorized",
  "code": "MISSING_AUTH",
  "details": "x-afu9-sub header required",
  "requestId": "..."
}
```

**Solution**: Ensure x-afu9-sub header is set with valid session token.

---

### 403 Forbidden (Not Admin)

```powershell
{
  "error": "Forbidden",
  "code": "NOT_ADMIN",
  "details": "Administrative operations require admin privileges",
  "requestId": "..."
}
```

**Solution**: Ensure your sub is in AFU9_ADMIN_SUBS environment variable.

---

### 409 Production Disabled

```powershell
{
  "error": "Production Disabled",
  "code": "PROD_DISABLED",
  "details": "Administrative DB operations not allowed in production",
  "environment": "production",
  "requestId": "..."
}
```

**Solution**: Switch to staging or development environment. Production writes are blocked.

---

### 400 Validation Error (Missing Confirmation)

```powershell
{
  "error": "Validation Error",
  "code": "VALIDATION_ERROR",
  "details": [
    {
      "code": "invalid_literal",
      "expected": "CONFIRM",
      "path": ["confirm"]
    }
  ],
  "requestId": "..."
}
```

**Solution**: Ensure `confirm` field is exactly "CONFIRM" (case-sensitive).

---

### 400 Invalid Range

```powershell
{
  "error": "Invalid Range",
  "code": "INVALID_RANGE",
  "details": "githubIssueMin cannot be greater than githubIssueMax",
  "requestId": "..."
}
```

**Solution**: Fix range parameters (min ≤ max).

---

## Audit Trail

Every execute operation creates an audit record in `ops_admin_actions` table:

```sql
SELECT 
    request_id,
    sub,
    action,
    params_json,
    result_json,
    created_at
FROM ops_admin_actions
WHERE action = 'ISSUES_SET_DONE'
ORDER BY created_at DESC
LIMIT 10;
```

**Example Record**:

```json
{
  "request_id": "23456789-01bc-def2-3456-7890abcdef12",
  "sub": "user-sub-123",
  "action": "ISSUES_SET_DONE",
  "params_json": {
    "statuses": ["CREATED", "SPEC_READY"],
    "githubIssueMin": 100,
    "githubIssueMax": 200
  },
  "result_json": {
    "updatedCount": 23,
    "returnedSampleCount": 20,
    "maxReturningRows": 200
  },
  "created_at": "2026-01-08T10:30:45.123Z"
}
```

---

## Verification

After execution, verify results:

```powershell
# Check status distribution
$verifyUrl = "$baseUrl/api/ops/db/issues/preview-set-done?statuses=CREATED,SPEC_READY"
$response = Invoke-WebRequest -Uri $verifyUrl -Headers $headers -Method GET
$data = $response.Content | ConvertFrom-Json

# Should show 0 affected (all updated to DONE)
if ($data.affectedCount -eq 0) {
    Write-Host "✅ Verification PASSED: All targeted issues updated to DONE" -ForegroundColor Green
} else {
    Write-Host "⚠️ Warning: $($data.affectedCount) issues still match criteria" -ForegroundColor Yellow
}
```

---

## Safety Features

1. **Fail-Closed Design**: Missing auth/admin/env → immediate rejection (no DB calls)
2. **Stage-Only Enforcement**: Production + unknown → 409 (no DB calls)
3. **Bounded Output**: Max 200 rows in RETURNING clause
4. **Deterministic Ordering**: Always ORDER BY github_issue_number ASC
5. **Audit Trail**: Every execution logged in ops_admin_actions
6. **Preview Parity**: Preview and Execute use same WHERE clause logic
7. **No Secrets in Logs**: Bounded params/results, no sensitive data

---

## References

- **API Routes**: 
  - GET `/api/ops/db/issues/preview-set-done`
  - POST `/api/ops/db/issues/set-done`
- **UI Page**: `/ops/db/issues`
- **Migration**: `database/migrations/050_ops_admin_actions.sql`
- **Tests**: `control-center/__tests__/api/ops-db-issues-set-done.test.ts`

---

**Last Updated**: 2026-01-08  
**Maintainer**: AFU-9 Control Center Team
