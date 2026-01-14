# E86.5 - Staging DB Repair Mechanism - Verification Guide

## Overview

This guide provides PowerShell commands to verify the staging DB repair mechanism.

## Prerequisites

- Stage environment URL: `https://stage.afu-9.com` (or `http://localhost:3000` for local)
- Valid authentication token with admin privileges
- PowerShell 5.1 or later

## Verification Steps

### 1. List Available Repairs

```powershell
$base = "https://stage.afu-9.com"

# List all available repair playbooks
$response = Invoke-RestMethod "$base/api/ops/db/repairs" -Method Get -Headers @{
    "Accept" = "application/json"
}

# Display repairs
$response.repairs | Format-Table repairId, description, hash -AutoSize

# Expected output: 3 repairs (R-DB-INTENT-AUTH-EVENTS-001, R-DB-INTENT-DRAFTS-001, R-DB-MIGRATIONS-LEDGER-001)
```

### 2. Preview a Repair

```powershell
# Preview R-DB-INTENT-AUTH-EVENTS-001
$body = @{
    repairId = "R-DB-INTENT-AUTH-EVENTS-001"
} | ConvertTo-Json

$preview = Invoke-RestMethod "$base/api/ops/db/repairs/preview" -Method Post -ContentType "application/json" -Body $body

# Display preview
Write-Host "Repair ID: $($preview.repairId)"
Write-Host "Description: $($preview.description)"
Write-Host "Hash: $($preview.hash)"
Write-Host "Would Apply: $($preview.wouldApply)"
Write-Host "Required Tables Check:"
Write-Host "  Required: $($preview.requiredTablesCheck.required -join ', ')"
Write-Host "  Missing: $($preview.requiredTablesCheck.missing -join ', ')"
Write-Host "  All Present: $($preview.requiredTablesCheck.allPresent)"
Write-Host "`nPlan ($($preview.plan.Count) statements):"
$preview.plan | ForEach-Object { Write-Host "  $_" }
```

### 3. Execute a Repair

```powershell
# Execute repair (using hash from preview)
$executeBody = @{
    repairId = "R-DB-INTENT-AUTH-EVENTS-001"
    expectedHash = $preview.hash
} | ConvertTo-Json

$result = Invoke-RestMethod "$base/api/ops/db/repairs/execute" -Method Post -ContentType "application/json" -Body $executeBody

# Display result
Write-Host "Repair ID: $($result.repairId)"
Write-Host "Run ID: $($result.repairRunId)"
Write-Host "Status: $($result.status)"
Write-Host "Statements Executed: $($result.summary.statementsExecuted)"
Write-Host "Pre-Missing Tables: $($result.summary.preMissingTables -join ', ')"
Write-Host "Post-Missing Tables: $($result.summary.postMissingTables -join ', ')"

if ($result.summary.errorCode) {
    Write-Host "Error Code: $($result.summary.errorCode)" -ForegroundColor Red
    Write-Host "Error Message: $($result.summary.errorMessage)" -ForegroundColor Red
}
```

### 4. Verify Required Tables Gate

After running a repair, verify that the required tables gate is now green:

```powershell
# Check migration parity (includes required tables check)
$parity = Invoke-RestMethod "$base/api/ops/db/migrations" -Method Get

# Display required tables check
Write-Host "`nRequired Tables Check:"
Write-Host "Missing Tables: $($parity.missingTables -join ', ')"

# Expected: Empty list if repair was successful
```

## Authentication

### Using Browser Cookies (Copy as PowerShell)

1. Open browser DevTools (F12)
2. Go to Network tab
3. Make a request to the API
4. Right-click the request → Copy → Copy as PowerShell
5. Extract the `-Headers` parameter and use it in your commands

Example:
```powershell
$headers = @{
    "Cookie" = "session=your-session-cookie"
    "Accept" = "application/json"
}

$response = Invoke-RestMethod "$base/api/ops/db/repairs" -Headers $headers
```

### Using Session Token (if available)

```powershell
$token = "your-jwt-token"

$headers = @{
    "Authorization" = "Bearer $token"
    "Accept" = "application/json"
}

$response = Invoke-RestMethod "$base/api/ops/db/repairs" -Headers $headers
```

## Error Scenarios

### 401 Unauthorized
```powershell
# Missing or invalid authentication
# Response: { "error": "Unauthorized", "code": "UNAUTHORIZED" }
```

### 409 Environment Disabled
```powershell
# Attempting to run on production
# Response: { "error": "Stage-only operation", "code": "ENV_DISABLED" }
```

### 403 Forbidden
```powershell
# User is not in admin allowlist
# Response: { "error": "Admin privileges required", "code": "FORBIDDEN" }
```

### 409 Hash Mismatch
```powershell
# Expected hash doesn't match actual hash
# Response: { "error": "Hash mismatch", "code": "HASH_MISMATCH" }
```

## UI Verification

1. Navigate to: `https://stage.afu-9.com/ops/db/repairs`
2. Verify all repairs are listed
3. Click "Preview" on a repair
4. Verify preview shows:
   - Description
   - Hash
   - Required tables check
   - Plan (SQL statements)
5. Click "Execute Repair" (after preview)
6. Verify execution result shows:
   - Status (SUCCESS/FAILED)
   - Run ID
   - Statements executed
   - Pre/post missing tables

## Audit Trail

All repair executions are logged in the `db_repair_runs` table (append-only):

```sql
-- View recent repair runs
SELECT 
  id,
  repair_id,
  status,
  executed_by,
  executed_at,
  pre_missing_tables,
  post_missing_tables
FROM db_repair_runs
ORDER BY executed_at DESC
LIMIT 10;
```

## Guard Ordering Verification

The API enforces strict guard ordering:

1. **AUTH CHECK (401)** - Verify x-afu9-sub header
2. **ENV GATING (409)** - Block prod/unknown environments
3. **ADMIN CHECK (403)** - Verify admin allowlist
4. **DB OPERATIONS** - Execute repair

To verify:

```powershell
# Test without auth (should return 401)
try {
    Invoke-RestMethod "$base/api/ops/db/repairs" -Method Get
} catch {
    Write-Host "Expected 401: $($_.Exception.Message)"
}

# Test on production (should return 409)
# (requires changing BASE_URL to production)

# Test as non-admin (should return 403)
# (requires valid auth but non-admin user)
```

## Success Criteria

✅ List repairs returns 3 repair playbooks
✅ Preview returns plan without DB writes
✅ Execute creates audit record and updates tables
✅ Required tables gate is green after successful repair
✅ All guards enforce correct ordering (401 → 409 → 403 → DB ops)
✅ Hash verification prevents execution with wrong hash
✅ Stage-only enforcement blocks production
✅ Admin-only enforcement requires admin privileges
