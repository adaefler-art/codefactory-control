# E9.2-CONTROL-01 Implementation Summary

## ✅ All Requirements Met

### Requirement 1: UI must use the single allowed S1 transition
**Status:** ✅ Implemented

- Added canonical API route constant in API_ROUTES (afu9.s1s3.pick)
- React hook `usePickIssue()` provides type-safe access
- Example component demonstrates usage
- Hook encapsulates all fetch logic (no direct HTTP calls)

### Requirement 2: Using existing pick(repo, issueNumber) endpoint
**Status:** ✅ Implemented

- Existing endpoint: `/api/afu9/s1s3/issues/pick/route.ts`
- Added to canonical API routes for UI discovery
- Contract documented in `docs/contracts/s1-pick-api.v1.md`

### Requirement 3: Idempotency guaranteed
**Status:** ✅ Documented & Verified

- Database upsert on `(repo_full_name, github_issue_number)` unique key
- Multiple calls return same issue without duplication
- Contract explicitly documents idempotency behavior
- Tests verify idempotent behavior

### Requirement 4: Returns all relevant Issue & Mirror data
**Status:** ✅ Implemented

Response structure:
```typescript
{
  issue: {
    id, public_id, repo_full_name, github_issue_number,
    github_issue_url, owner, canonical_id, status, timestamps
  },
  run: {
    id, type, issue_id, request_id, actor, status, timestamps
  },
  step: {
    id, run_id, step_id, step_name, status, evidence_refs, timestamp
  }
}
```

### Requirement 5: Pick from UI creates/opens AFU-9 Issue
**Status:** ✅ Implemented

- Hook: `usePickIssue()` provides clean API
- Example component: `PickIssueButton` shows integration
- Creates issue in `CREATED` state
- Returns issue ID for navigation

### Requirement 6: State Machine remains consistent
**Status:** ✅ Verified

- Pick only executes S1 transition (creates `CREATED` state)
- No side effects on state machine
- Subsequent steps handled by Loop API
- Contract documents separation of concerns

## 🔒 Guardrails Compliance

### Contract-First ✅
- Contract documented: `docs/contracts/s1-pick-api.v1.md`
- Implementation matches contract exactly
- No implementation without contract

### UI: Engine Access via Central Client ✅
- API route in `API_ROUTES` constant
- Hook encapsulates fetch logic
- No direct HTTP calls in components
- Type-safe interface

### Fail-Closed ✅
- Repo allowlist enforced (403 if denied)
- No silent fallbacks
- All errors return proper status codes
- Detailed error messages with request IDs

### Auth & DB ✅
- Idempotent via database upsert
- No secrets in code
- Session-based auth (cookies)
- Proper error handling

## 📁 Files Created/Modified

### Created Files (6)
1. `docs/contracts/s1-pick-api.v1.md` - Complete contract
2. `control-center/src/lib/ui/use-pick-issue.ts` - React hook
3. `control-center/__tests__/api/s1-pick-api.test.ts` - Tests
4. `control-center/docs/examples/PickIssueButton.example.tsx` - Example
5. `docs/E92_CONTROL_01_IMPLEMENTATION.md` - Implementation doc
6. (This file) - Summary

### Modified Files (2)
1. `control-center/src/lib/api-routes.ts` - Added pick route
2. `docs/contracts/README.md` - Updated index

## 📊 Test Coverage

Integration tests cover:
- ✅ Successful pick (first time)
- ✅ Idempotent pick (multiple calls)
- ✅ Default owner parameter
- ✅ Missing required fields (400)
- ✅ Invalid repo format (400)
- ✅ Repo not in allowlist (403)
- ✅ GitHub issue not found (404)
- ✅ Issue is a pull request (400)
- ✅ Database failure (500)
- ✅ Contract compliance
- ✅ Evidence refs validation

## 🎯 Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Pick aus UI erzeugt/öffnet AFU-9 Issue | ✅ | Hook + Example component |
| State Machine bleibt konsistent | ✅ | Contract documents S1-only behavior |
| Idempotenz garantiert | ✅ | Database upsert + tests |
| Rückgabe aller Issue & Mirror-Daten | ✅ | Response includes {issue, run, step} |
| Nutzung des bestehenden pick() Endpoints | ✅ | Added to API_ROUTES |

## 🚀 Usage Example

```typescript
import { usePickIssue } from '@/lib/ui/use-pick-issue';

function MyComponent() {
  const { pickIssue, loading, error } = usePickIssue();

  const handlePick = async () => {
    const result = await pickIssue({
      repo: 'owner/repo',
      issueNumber: 42,
      canonicalId: 'E92.1',
    });

    if (result) {
      router.push(`/issues/${result.issue.id}`);
    }
  };

  return (
    <button onClick={handlePick} disabled={loading}>
      {loading ? 'Picking...' : 'Pick Issue'}
    </button>
  );
}
```

## ✅ Ready for Review

All requirements implemented, documented, and tested.
No breaking changes.
Contract-first approach followed.
Guardrails compliance verified.
