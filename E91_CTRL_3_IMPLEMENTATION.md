# E9.1-CTRL-3 Implementation Summary

## Overview
Implemented hard fail-closed locking and idempotency for the Loop execution system to prevent race conditions and double execution.

## Files Created/Modified

### Database
- **`database/migrations/084_loop_locks_idempotency.sql`** (NEW)
  - Created `loop_locks` table for distributed locking
  - Created `loop_idempotency` table for replay cache
  - Added indexes for performance

### Core Implementation
- **`control-center/src/lib/loop/lock.ts`** (NEW)
  - `LoopLockManager` class for lock/idempotency operations
  - Stable hash-based keys using SHA-256
  - Lock TTL: 5 minutes
  - Idempotency cache TTL: 1 hour
  - `LockConflictError` for explicit conflicts
  - Type-safe with `Record<string, string>` and `unknown`

- **`control-center/src/lib/loop/execution.ts`** (MODIFIED)
  - Added idempotency check first (replay if found)
  - Lock acquisition before execution
  - Store idempotency record after completion
  - Release lock on success or error

- **`control-center/app/api/loop/issues/[issueId]/run-next-step/route.ts`** (MODIFIED)
  - Added `LockConflictError` handling
  - Return 409 with lock details on conflict

### Documentation
- **`docs/contracts/loop-api.v1.md`** (MODIFIED)
  - Documented locking and idempotency behavior
  - Updated LOOP_CONFLICT error code details
  - Added "two quick clicks" behavior description
  - Added v1.2 changelog entry

### Testing
- **`control-center/__tests__/lib/loop/lock.test.ts`** (NEW)
  - Unit tests for lock acquisition/release
  - Tests for race condition handling
  - Tests for idempotency check/store
  - Mock-based tests using Jest

- **`verify-e91-ctrl-3.ps1`** (NEW)
  - PowerShell integration test script
  - Tests first execution, idempotent replay, concurrent execution
  - Validates two-quick-clicks behavior

## Key Features

### 1. Locking Mechanism
- **Hash-based Lock Keys**: Stable keys derived from `{issueId, step, mode, actorId}`
- **Atomic Acquisition**: Uses PostgreSQL `INSERT ... ON CONFLICT DO NOTHING`
- **TTL**: 5 minutes with automatic cleanup
- **Fail-Closed**: Lock conflicts throw `LockConflictError`

### 2. Idempotency
- **Hash-based Keys**: Stable keys derived from `{issueId, step, mode, actorId?}`
- **Replay Cache**: Stores successful responses for 1 hour
- **Deterministic**: Same parameters always return same cached response
- **Request ID Update**: Cached response includes current requestId

### 3. Two Quick Clicks Behavior
1. **First Click**: 200 OK - Lock acquired, execution proceeds
2. **Second Click (during execution)**: 409 LOOP_CONFLICT - Lock held
3. **Third Click (after completion)**: 200 OK - Cached response returned

### 4. Error Handling
- **LockConflictError**: Explicit error with lock details (who, expires when)
- **409 Response**: Includes lockKey, lockedBy, expiresAt in error details
- **Lock Release**: Always released on success or error (fail-safe)

## Implementation Details

### Lock Acquisition Flow
```typescript
1. Check idempotency cache
   - If found: Return cached response (200)
   - If not found: Continue
2. Try to acquire lock
   - If acquired: Continue
   - If conflict: Throw LockConflictError (409)
3. Execute loop step
4. Store idempotency record
5. Release lock
```

### Database Schema

**loop_locks:**
```sql
- id: UUID (primary key)
- lock_key: TEXT (unique, hash-based)
- locked_by: TEXT (actor who acquired)
- locked_at: TIMESTAMPTZ
- expires_at: TIMESTAMPTZ (TTL-based)
- request_id: TEXT (for tracing)
- metadata: JSONB
```

**loop_idempotency:**
```sql
- id: UUID (primary key)
- idempotency_key: TEXT (unique, hash-based)
- request_id: TEXT
- run_id: UUID (references loop_runs)
- response_data: JSONB (cached response)
- created_at: TIMESTAMPTZ
- expires_at: TIMESTAMPTZ (TTL-based)
- metadata: JSONB
```

## Verification Steps

### 1. Database Migration
```bash
cd /home/runner/work/codefactory-control/codefactory-control
npm run db:migrate
```

### 2. Build Verification
```bash
cd control-center
npm run build
```

### 3. Run Tests
```bash
cd control-center
npm test -- __tests__/lib/loop/lock.test.ts
```

### 4. Integration Testing
```powershell
# Start control center
npm --prefix control-center run dev

# In another terminal, run verification script
pwsh verify-e91-ctrl-3.ps1 -BaseUrl http://localhost:3000
```

## Contract Compliance

### Contract-First ✅
- Contract source of truth: `docs/contracts/loop-api.v1.md`
- Implementation follows contract exactly
- No implementation without contract entry

### Fail-Closed ✅
- Lock conflicts throw explicit errors
- No silent failures
- All errors properly typed and documented

### Schema Versioning ✅
- `schemaVersion: "loop.runNextStep.v1"` in all responses
- Contract changelog updated (v1.2)
- Additive changes only (no breaking changes)

## Acceptance Criteria

✅ **No Race Conditions**: Distributed locks prevent concurrent execution  
✅ **No Double Execution**: Lock conflicts return 409, idempotency returns cached  
✅ **Deterministic Replay**: Same parameters → same response  
✅ **Two Quick Clicks**: First 200, second 409, third 200 (replay)  
✅ **TTL and Cleanup**: Both locks and cache expire automatically  
✅ **Contract-First**: All changes documented in contract  
✅ **Type Safety**: Proper TypeScript types, no `any` in public APIs  
✅ **Error Handling**: Explicit errors with details  

## Code Quality

### Code Review Feedback Addressed
1. ✅ Type safety: `Record<string, string>` instead of implicit any
2. ✅ Expires check: Added `expires_at >= NOW()` in conflict lock query
3. ✅ Unique IDs: Changed to timestamp-based for verification script
4. ✅ Unknown type: Used `unknown` instead of `any` for responseData

### Testing Coverage
- Unit tests for all public methods
- Race condition handling tested
- Mock-based tests (no database required)
- Integration test script for E2E validation

## PowerShell Verification Commands

After implementation is deployed:

```powershell
# Run repository verification
npm run repo:verify

# Run control center tests
npm --prefix control-center test

# Run control center build
npm --prefix control-center run build

# Run E9.1-CTRL-3 integration tests
pwsh verify-e91-ctrl-3.ps1 -BaseUrl http://localhost:3000
```

## Next Steps

1. Deploy database migration 084
2. Deploy control center with updated code
3. Run integration tests to verify behavior
4. Monitor lock cleanup (check expired records are removed)
5. Monitor idempotency cache hit rate

## References

- **Issue**: E9.1-CTRL-3 - Locking + Idempotency (hard, fail-closed)
- **Contract**: `docs/contracts/loop-api.v1.md`
- **Migration**: `database/migrations/084_loop_locks_idempotency.sql`
- **Implementation**: `control-center/src/lib/loop/lock.ts`
- **Tests**: `control-center/__tests__/lib/loop/lock.test.ts`
- **Verification**: `verify-e91-ctrl-3.ps1`
