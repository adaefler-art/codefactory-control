# E9.2-CONTROL-01: Canonical S1 Pick Endpoint Wiring

**Status:** ✅ Implemented  
**Date:** 2026-02-03  
**Issue:** E9.2-CONTROL-01

## Summary

This implementation provides the canonical S1 Pick endpoint wiring from UI to Control layer, enabling the UI to use the single allowed S1 transition to create AFU-9 issues from GitHub issues.

## What Was Implemented

### 1. API Routes Registration

**File:** `control-center/src/lib/api-routes.ts`

Added the pick endpoint to the canonical API routes:

```typescript
afu9: {
  runs: { ... },
  s1s3: {
    // E9.2-CONTROL-01: Canonical S1 Pick Endpoint
    pick: '/api/afu9/s1s3/issues/pick',
  },
}
```

**Usage:**
```typescript
import { API_ROUTES } from '@/lib/api-routes';

const response = await fetch(API_ROUTES.afu9.s1s3.pick, {
  method: 'POST',
  body: JSON.stringify({ repo: 'owner/repo', issueNumber: 42 }),
});
```

### 2. Contract Documentation

**File:** `docs/contracts/s1-pick-api.v1.md`

Comprehensive contract documentation including:
- Full API specification (request/response schemas)
- Error codes and handling
- Idempotency guarantees
- State machine integration
- UI client patterns
- Example requests/responses
- Integration flow diagrams

**Key Contract Points:**
- POST endpoint: `/api/afu9/s1s3/issues/pick`
- Idempotent via database upsert on `(repo_full_name, github_issue_number)`
- Returns `{issue, run, step}` structure
- Full error handling (400, 403, 404, 500)

### 3. React Hook

**File:** `control-center/src/lib/ui/use-pick-issue.ts`

Type-safe React hook for calling the pick endpoint from UI components:

```typescript
export function usePickIssue() {
  const pickIssue = async (params: PickIssueParams) => { ... };
  return { pickIssue, loading, error, result, reset };
}
```

**Features:**
- ✅ Type-safe parameters and response
- ✅ Client-side validation
- ✅ Error handling with detailed messages
- ✅ Loading state management
- ✅ Request ID tracking
- ✅ Reset functionality

**Usage:**
```typescript
const { pickIssue, loading, error } = usePickIssue();

const handlePick = async () => {
  const result = await pickIssue({
    repo: 'owner/repo',
    issueNumber: 42,
    canonicalId: 'E92.1',
  });
  
  if (result) {
    console.log('Created issue:', result.issue.public_id);
  }
};
```

### 4. Integration Tests

**File:** `control-center/__tests__/api/s1-pick-api.test.ts`

Comprehensive test suite covering:
- ✅ Successful pick (first time)
- ✅ Idempotent pick (same issue, multiple calls)
- ✅ Default owner to "afu9"
- ✅ Error: Missing required fields
- ✅ Error: Invalid repo format
- ✅ Error: Repo not in allowlist
- ✅ Error: GitHub issue not found
- ✅ Error: Issue is a pull request
- ✅ Error: Database upsert failure
- ✅ Contract compliance (response structure)
- ✅ Evidence refs validation

### 5. Example UI Component

**File:** `control-center/docs/examples/PickIssueButton.example.tsx`

Production-ready example component showing:
- Button with loading state
- Error display
- Auto-navigation on success
- Optional success callback
- Inline usage examples

### 6. Updated Contracts README

**File:** `docs/contracts/README.md`

Added S1 Pick API to the contracts index with proper categorization.

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ UI Layer (React Component)                                  │
│                                                              │
│ const { pickIssue } = usePickIssue();                       │
│ await pickIssue({ repo, issueNumber });                     │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ POST /api/afu9/s1s3/issues/pick
                  │ { repo: "owner/repo", issueNumber: 42 }
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ API Route (/api/afu9/s1s3/issues/pick/route.ts)            │
│                                                              │
│ 1. Validate request (repo format, required fields)          │
│ 2. Create GitHub client (check allowlist)                   │
│ 3. Fetch GitHub issue (validate exists, not a PR)           │
│ 4. Upsert AFU-9 issue (idempotent via unique key)          │
│ 5. Create run record (S1_PICK_ISSUE type)                  │
│ 6. Create step events (STARTED + SUCCEEDED)                │
│ 7. Update run status (DONE)                                │
│ 8. Return {issue, run, step}                               │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ 201 Created
                  │ { issue: {...}, run: {...}, step: {...} }
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ UI Layer (React Component)                                  │
│                                                              │
│ if (result) {                                               │
│   router.push(`/issues/${result.issue.id}`);               │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
```

### State Machine Integration

The pick endpoint is the **entry point** to the loop state machine:

```
GitHub Issue → [Pick] → AFU-9 Issue (CREATED) → [Loop API] → S2, S3, ...
```

**Separation of Concerns:**
- **Pick Endpoint**: Creates AFU-9 issue from GitHub issue (S1 only)
- **Loop API**: Executes subsequent steps (S2, S3, etc.)

**Example Flow:**
1. UI calls pick: `POST /api/afu9/s1s3/issues/pick` → Issue created with status `CREATED`
2. UI calls loop: `POST /api/loop/issues/[id]/run-next-step` → Executes S2 (Spec Gate)
3. UI calls loop: `POST /api/loop/issues/[id]/run-next-step` → Executes S3 (Implementation)

## Idempotency Guarantees

### Pick Endpoint

**Mechanism:** Database upsert on `(repo_full_name, github_issue_number)` unique key

**Behavior:**
```
First call:  Creates new AFU-9 issue, returns 201 with new issue data
Second call: Returns existing AFU-9 issue, returns 201 with same issue data
Third call:  Returns existing AFU-9 issue, returns 201 with same issue data
```

**Note:** Each call creates a new run and step records for audit trail, but the issue itself is unchanged.

### Loop API (Next Step Execution)

**Mechanism:** Distributed locks + idempotency cache (E9.1-CTRL-3)

**Behavior:**
```
First call:  Executes step, returns 200 with result (lock acquired)
Second call: Returns 409 LOOP_CONFLICT (lock held)
Third call:  Returns 200 with cached result (replay)
```

## Error Handling

### Client-Side Validation (Hook)

The `usePickIssue` hook validates:
- ✅ Required fields present (`repo`, `issueNumber`)
- ✅ Repo format is `"owner/repo"`
- ✅ Issue number is positive integer

### Server-Side Validation (API)

The pick endpoint validates:
- ✅ Repo format
- ✅ Repo in allowlist (403 if not)
- ✅ Issue exists on GitHub (404 if not)
- ✅ Issue is not a PR (400 if PR)
- ✅ Database operations succeed (500 if fail)

### Error Response Format

```typescript
{
  error: string;        // Error message
  details?: string;     // Additional details
  requestId: string;    // Request UUID for tracing
}
```

## State Machine Consistency

### Guarantees

1. **Single State**: Issue has exactly one status at any time
2. **Single Transition**: Pick only executes S1, nothing else
3. **Deterministic Flow**: State transitions follow state machine rules
4. **No Side Effects**: Pick doesn't modify GitHub (read-only)

### State Validation

```typescript
// Before pick: Issue doesn't exist
const issuesBefore = await db.query('SELECT * FROM s1s3_issues WHERE ...');
// issuesBefore.rows.length === 0

// After pick: Issue exists in CREATED state
const issuesAfter = await db.query('SELECT * FROM s1s3_issues WHERE ...');
// issuesAfter.rows[0].status === 'CREATED'

// Multiple picks: Still CREATED state
const issuesMultiple = await db.query('SELECT * FROM s1s3_issues WHERE ...');
// issuesMultiple.rows[0].status === 'CREATED'
```

## Acceptance Criteria

✅ **Pick from UI creates/opens AFU-9 Issue**
- Implemented via `POST /api/afu9/s1s3/issues/pick`
- UI hook: `usePickIssue()`
- Example component: `PickIssueButton`

✅ **State Machine remains consistent**
- Pick only creates issue in `CREATED` state
- No modification of existing state
- Loop API handles subsequent transitions

✅ **Using existing `pick(repo, issueNumber)` endpoint**
- Endpoint exists at `/api/afu9/s1s3/issues/pick/route.ts`
- Added to canonical API routes
- Documented in contract

✅ **Idempotency guaranteed**
- Database upsert on unique key
- Multiple calls return same issue
- Run/step records for audit trail

✅ **Returns all relevant Issue & Mirror data**
- Response: `{issue, run, step}`
- Issue includes: ID, public_id, GitHub URL, status
- Run includes: ID, type, request_id
- Step includes: ID, status, evidence_refs

## Verification Commands

```powershell
# 1. Verify API route is registered
grep -n "pick" control-center/src/lib/api-routes.ts

# 2. Verify contract exists
ls -la docs/contracts/s1-pick-api.v1.md

# 3. Verify hook exists
ls -la control-center/src/lib/ui/use-pick-issue.ts

# 4. Verify tests exist
ls -la control-center/__tests__/api/s1-pick-api.test.ts

# 5. Verify example exists
ls -la control-center/docs/examples/PickIssueButton.example.tsx

# 6. Check for TypeScript errors (if dependencies installed)
cd control-center
npx tsc --noEmit src/lib/api-routes.ts
npx tsc --noEmit src/lib/ui/use-pick-issue.ts
```

## Usage Examples

### Basic Pick

```typescript
import { usePickIssue } from '@/lib/ui/use-pick-issue';

function MyComponent() {
  const { pickIssue, loading, error } = usePickIssue();

  const handleClick = async () => {
    const result = await pickIssue({
      repo: 'owner/repo',
      issueNumber: 42,
    });

    if (result) {
      console.log('Created:', result.issue.public_id);
    }
  };

  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? 'Picking...' : 'Pick Issue'}
    </button>
  );
}
```

### With Canonical ID

```typescript
const result = await pickIssue({
  repo: 'adaefler-art/codefactory-control',
  issueNumber: 100,
  canonicalId: 'E92.1',
});
```

### Full Integration Flow

```typescript
// 1. Pick issue
const pickResult = await pickIssue({
  repo: 'owner/repo',
  issueNumber: 42,
});

if (!pickResult) {
  console.error('Pick failed');
  return;
}

// 2. Execute next step (S2, S3, etc.)
const loopResponse = await fetch(
  `/api/loop/issues/${pickResult.issue.id}/run-next-step`,
  {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ mode: 'execute' }),
  }
);

const loopResult = await loopResponse.json();
console.log('Loop status:', loopResult.loopStatus);
```

## Security & Guardrails

### Contract-First ✅

- Contract documented: `docs/contracts/s1-pick-api.v1.md`
- Implementation follows contract
- No drift between contract and code

### UI: Engine Access via Central Client ✅

- API route in `API_ROUTES` constant
- Hook encapsulates fetch logic
- No direct HTTP calls in components

### Fail-Closed ✅

- Repo allowlist enforced (403 if denied)
- No silent fallbacks on errors
- All errors return proper status codes

### Auth & DB ✅

- Idempotent via database upsert
- No secrets in code
- Session-based auth (cookies)

## Files Changed

1. `control-center/src/lib/api-routes.ts` - Added pick route
2. `docs/contracts/s1-pick-api.v1.md` - Contract documentation
3. `docs/contracts/README.md` - Updated index
4. `control-center/src/lib/ui/use-pick-issue.ts` - React hook
5. `control-center/__tests__/api/s1-pick-api.test.ts` - Integration tests
6. `control-center/docs/examples/PickIssueButton.example.tsx` - Example component

## Next Steps (Optional Enhancements)

1. **Add TypeScript Build Validation**
   - Run `npm run build` to verify no TypeScript errors
   - Add to CI/CD pipeline

2. **Add Integration Tests to CI**
   - Configure Jest to run in CI
   - Add test coverage reporting

3. **Create UI Component Library Entry**
   - Add PickIssueButton to component library
   - Create Storybook stories

4. **Add Metrics & Observability**
   - Track pick success/failure rates
   - Monitor pick latency
   - Alert on high error rates

## References

- **Issue:** E9.2-CONTROL-01
- **Contract:** docs/contracts/s1-pick-api.v1.md
- **Existing Implementation:** control-center/app/api/afu9/s1s3/issues/pick/route.ts
- **Loop API Contract:** docs/contracts/loop-api.v1.md
- **Step Executor S1 Contract:** docs/contracts/step-executor-s1.v1.md
