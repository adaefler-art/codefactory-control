# Loop API Contract v1

**Contract ID:** `loop-api.v1`  
**Schema Version:** `loop.runNextStep.v1`  
**Status:** Active  
**Owner:** Control Center  
**Created:** 2026-01-21

## Overview

The Loop API provides contract-first endpoints for controlling AFU-9 issue execution loops. This contract ensures stable, versionable API interactions with strict Zod validation and predictable error handling.

## Endpoints

### Run Next Step

Execute the next step in the loop for a given AFU-9 issue.

**Endpoint:** `POST /api/loop/issues/[issueId]/run-next-step`

#### Request

**Method:** `POST`

**Path Parameters:**
- `issueId` (string, required): The unique identifier of the AFU-9 issue

**Headers:**
- `x-afu9-sub` (string, required): User/actor identifier for authentication

**Body** (optional JSON):
```typescript
{
  mode?: "execute" | "dryRun"  // Default: "execute"
}
```

**Validation:**
- `mode` must be exactly "execute" or "dryRun" (strict enum)
- Empty body is valid (defaults to execute mode)
- Invalid JSON returns 400 error
- Extra fields cause validation failure (strict schema)

#### Response

**Success (200 OK):**

```typescript
{
  schemaVersion: "loop.runNextStep.v1",  // Contract version identifier
  requestId: string,                      // UUID for request tracing
  issueId: string,                        // Issue that was processed
  runId: string,                          // UUID of persisted run record (E9.1-CTRL-2)
  stepExecuted?: {                        // Details of the step that was executed
    stepNumber: number,                   // Positive integer
    stepType: string,                     // Type/name of the step
    status: "pending" | "running" | "completed" | "failed" | "skipped",
    startedAt: string,                    // ISO 8601 datetime
    completedAt?: string,                 // ISO 8601 datetime
    durationMs?: number                   // Non-negative integer
  },
  nextStep?: {                           // Details of the upcoming step
    stepNumber: number,                   // Positive integer
    stepType: string,                     // Type/name of the step
    estimatedDurationMs?: number          // Non-negative integer
  },
  loopStatus: "active" | "completed" | "failed" | "paused",
  message?: string                        // Optional human-readable message
}
```

**Headers:**
- `x-request-id`: Same UUID as in response body for correlation

#### Error Responses

All error responses follow this structure:

```typescript
{
  schemaVersion: "loop.runNextStep.v1",
  requestId: string,                    // UUID for request tracing
  error: {
    code: LoopErrorCode,
    message: string,
    details?: Record<string, any>
  },
  timestamp: string                     // ISO 8601 datetime
}
```

**Error Codes:**

| HTTP Status | Error Code | Description | Example Scenario |
|-------------|------------|-------------|------------------|
| 400 | `INVALID_REQUEST` | Request validation failed | Invalid JSON, wrong enum value, extra fields |
| 401 | `UNAUTHORIZED` | Authentication required | Missing or invalid `x-afu9-sub` header |
| 404 | `ISSUE_NOT_FOUND` | Issue does not exist | Issue ID not found in database |
| 409 | `LOOP_CONFLICT` | Loop already running or locked | Concurrent execution attempt, lock held by another actor (E9.1-CTRL-3) |
| 500 | `INTERNAL_ERROR` | Unexpected server error | Database error, service unavailable |

**E9.1-CTRL-3 Locking and Idempotency:**

The Loop API implements hard fail-closed locking to prevent race conditions and double execution:

1. **Lock Acquisition**: Before execution, a distributed lock is acquired based on {issueId, step, mode, actorId}
   - If lock is available: Lock acquired, execution proceeds
   - If lock is held: Returns 409 `LOOP_CONFLICT` with lock details (who, expires when)
   
2. **Idempotency Check**: Before lock acquisition, checks for cached response
   - If found: Returns 200 with cached response (deterministic replay)
   - If not found: Proceeds with lock acquisition and execution
   
3. **Lock Release**: Lock is released after completion or on error
   - TTL: 5 minutes (auto-cleanup if process crashes)
   
4. **Idempotency Cache**: Successful responses are cached for replay
   - TTL: 1 hour
   - Key: Hash of {issueId, step, mode, actorId}

**Two Quick Clicks Behavior:**
- First click: 200 OK (execution starts) → lock acquired
- Second click (during execution): 409 `LOOP_CONFLICT` → lock held
- Third click (after completion): 200 OK (replay) → cached response returned

#### Examples

**Execute Mode (Default):**

```powershell
# PowerShell example
$headers = @{
    "x-afu9-sub" = "user@example.com"
    "Content-Type" = "application/json"
}

$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/loop/issues/AFU9-123/run-next-step" `
    -Method POST `
    -Headers $headers `
    -Body '{"mode": "execute"}'

Write-Host "Schema Version: $($response.schemaVersion)"
Write-Host "Request ID: $($response.requestId)"
Write-Host "Loop Status: $($response.loopStatus)"

if ($response.stepExecuted) {
    Write-Host "Executed Step: $($response.stepExecuted.stepNumber) - $($response.stepExecuted.stepType)"
    Write-Host "Status: $($response.stepExecuted.status)"
}
```

**Dry Run Mode:**

```powershell
$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/loop/issues/AFU9-123/run-next-step" `
    -Method POST `
    -Headers $headers `
    -Body '{"mode": "dryRun"}'

Write-Host "Dry run result: $($response.message)"
```

**Empty Body (Default Execute):**

```powershell
$response = Invoke-RestMethod `
    -Uri "http://localhost:3000/api/loop/issues/AFU9-123/run-next-step" `
    -Method POST `
    -Headers $headers `
    -Body '{}'

# Same as mode: "execute"
```

**Error Handling:**

```powershell
try {
    $response = Invoke-RestMethod `
        -Uri "http://localhost:3000/api/loop/issues/INVALID/run-next-step" `
        -Method POST `
        -Headers $headers
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "Error Code: $($errorResponse.error.code)" -ForegroundColor Red
    Write-Host "Message: $($errorResponse.error.message)" -ForegroundColor Red
    Write-Host "Request ID: $($errorResponse.requestId)"
    
    if ($errorResponse.error.details) {
        Write-Host "Details:" -ForegroundColor Yellow
        $errorResponse.error.details | ConvertTo-Json -Depth 5
    }
}
```

## Schema Versioning

The `schemaVersion` field in responses enables:
1. **Client compatibility checks**: Clients can verify they understand the response format
2. **Gradual migration**: New fields can be added without breaking existing clients
3. **Error reporting**: Clear mismatch errors include `requestId` for debugging

**Current Version:** `loop.runNextStep.v1`

**Version Policy:**
- Additive changes (new optional fields) increment patch version
- Breaking changes require new major version
- `schemaVersion` must always be included in responses

## Implementation Details

**Source of Truth:**
- Contract: `docs/contracts/loop-api.v1.md` (this file)
- Schemas: `control-center/src/lib/loop/schemas.ts`
- Route: `control-center/app/api/loop/issues/[issueId]/run-next-step/route.ts`
- Logic: `control-center/src/lib/loop/execution.ts`

**Validation:**
- Zod schemas enforce strict type checking
- Enum values validated at compile time and runtime
- No partial validation - request either passes or fails completely

**Handler Pattern:**
- Route handler contains NO business logic
- Single function call: `runNextStep({issueId, mode, actor})`
- All logic encapsulated in `execution.ts`

## Testing

**Acceptance Criteria:**
- ✅ Route exists and compiles
- ✅ Response includes `schemaVersion: "loop.runNextStep.v1"`
- ✅ Response includes valid UUID `requestId`
- ✅ Zod validates enum values strictly (rejects invalid modes)
- ✅ Handler calls exactly one function: `runNextStep()`
- ✅ PowerShell command examples work

**Test Cases:**
1. Valid execute mode request
2. Valid dryRun mode request  
3. Empty body (defaults to execute)
4. Invalid mode value (validation error)
5. Missing authentication (401)
6. Non-existent issue (404)
7. Concurrent execution (409)
8. Verify runId is persisted in loop_runs table (E9.1-CTRL-2)

## Persistence (E9.1-CTRL-2)

Every loop execution creates a record in the `loop_runs` table:

**Run Lifecycle:**
1. **Creation**: Run record created with `status = 'pending'`
2. **Execution**: Status transitions to `running` when execution starts
3. **Completion**: Status transitions to `completed`, `failed`, or `blocked`
4. **Timestamps**: `created_at`, `started_at`, `completed_at` tracked
5. **Traceability**: `runId` returned in response for audit/replay

**Database Tables:**
- `loop_runs`: Main run records with status and timestamps
- `loop_run_steps`: Individual step execution results (future use)
- `loop_locks`: Distributed locks for concurrency control (E9.1-CTRL-3)
- `loop_idempotency`: Idempotency cache for deterministic replay (E9.1-CTRL-3)

## Locking and Idempotency (E9.1-CTRL-3)

**Guarantees:**
- No race conditions: Only one execution per {issueId, step, mode, actorId} at a time
- No double execution: Locks prevent concurrent runs
- Deterministic replay: Cached responses ensure consistent results

**Lock TTL:** 5 minutes (auto-cleanup on crash)  
**Idempotency TTL:** 1 hour (cache expiration)

**Cleanup:** Expired locks and idempotency records are automatically cleaned up on each request.

## Changelog

### v1.2 (2026-01-21) - E9.1-CTRL-3
- Added hard fail-closed locking to prevent race conditions
- Added idempotency cache for deterministic replay
- New database tables: `loop_locks`, `loop_idempotency`
- Enhanced 409 `LOOP_CONFLICT` with lock details
- Two quick clicks behavior: first 200, second 409, third 200 (replay)

### v1.1 (2026-01-21) - E9.1-CTRL-2
- Added `runId` field to response
- Run persistence in `loop_runs` table
- Track all executions (success, blocked, fail)

### v1 (2026-01-21)
- Initial contract version
- POST `/api/loop/issues/[issueId]/run-next-step` endpoint
- Request/response schemas with Zod validation
- Error codes: 401, 404, 409, 400, 500
