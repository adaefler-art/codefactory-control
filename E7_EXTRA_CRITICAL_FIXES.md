# E7_extra: Critical Fixes Summary

**Commit:** `ed467f7`  
**Date:** 2026-01-04  
**Addresses:** PR comment feedback from @adaefler-art

---

## Issues Fixed

### 1. Semantic Error: Closed State Mapping

**Problem:**  
GitHub `state=closed` was being mapped to AFU9 `DONE` without checking for an explicit "done" signal. This caused semantic errors where closed issues without completion (e.g., closed as "won't fix", "duplicate") were incorrectly marked as DONE.

**Solution:**
- Added `isFromIssueState: boolean` parameter to `mapGitHubStatusToAfu9()`
- When `isFromIssueState === true` and status is "closed", return `null` (no mapping)
- Only map to DONE with explicit positive signals:
  - Project v2 field: "Done", "Completed"
  - Labels: "status: done", "status: completed"
  
**Code Changes:**
```typescript
// Before
case 'closed':
  return Afu9IssueStatus.DONE;

// After
if (isFromIssueState && normalized === 'closed') {
  console.log('[status-mapping] Issue state is "closed" but no explicit done signal - no mapping applied');
  return null;
}
```

**Tests:**
- `closed-without-done-signal`: Validates null return for state=closed
- `closed-with-done-signal`: Validates DONE mapping with explicit signal

---

### 2. Manual Protection: Prevent Override

**Problem:**  
Manually set AFU9 statuses (`status_source === "manual"`) were being overwritten by GitHub sync, breaking operator steering control.

**Solution:**
- Check `status_source === Afu9StatusSource.MANUAL` before sync
- Skip GitHub sync when manual (deny-by-default)
- Add optional `allowManualOverride` parameter for explicit override
- Log protection event for observability

**Code Changes:**
```typescript
// New protection check
if (
  currentIssue.status_source === Afu9StatusSource.MANUAL &&
  !allowManualOverride
) {
  console.log(`Issue ${issueId} has manual status - skipping GitHub sync (deny-by-default)`);
  return { success: true, changed: false, ... };
}
```

**Function Signature:**
```typescript
export async function syncGitHubStatusToAfu9(
  pool: Pool,
  issueId: string,
  githubIssue: GitHubIssueForSync,
  allowManualOverride: boolean = false  // New parameter
): Promise<StatusSyncResult>
```

**Tests:**
- `github-status-sync-manual-protection.test.ts`:
  - Manual status protected (default)
  - Manual override when flag enabled
  - Non-manual sources sync normally
  - Legacy data (null source) syncs normally

---

### 3. Determinism: Label Selection

**Problem:**  
When multiple `status:*` labels exist on a GitHub issue, the first label in the array was selected. Since label order is not guaranteed, this caused non-deterministic behavior across sync runs.

**Solution:**
- Collect all `status:*` labels with normalized names
- Sort alphabetically by normalized label name
- Select first after sorting
- Log warning when multiple status labels detected
- Normalize casing and whitespace before sorting

**Code Changes:**
```typescript
// Before: First match wins (non-deterministic)
for (const label of labels) {
  if (name.startsWith('status:')) {
    return { raw: statusValue, ... };
  }
}

// After: Deterministic alphabetical selection
const statusLabels = [];
for (const label of labels) {
  if (name.startsWith('status:')) {
    statusLabels.push({ normalized: name, value: statusValue });
  }
}
statusLabels.sort((a, b) => a.normalized.localeCompare(b.normalized));
if (statusLabels.length > 1) {
  console.warn(`Multiple status labels found: [...]. Using first alphabetically.`);
}
return { raw: statusLabels[0].value, ... };
```

**Behavior:**
```
Labels: ["status: implementing", "status: done", "status: blocked"]
Normalized: ["status: blocked", "status: done", "status: implementing"]
Selected: "blocked" (first alphabetically)
```

**Tests:**
- `multiple-labels-tie-breaker`: Validates alphabetical selection
- `case-insensitive sorting`: Validates normalization
- `whitespace normalization`: Validates trimming

---

## Test Coverage

### New Test Files
1. `__tests__/lib/github-status-sync-manual-protection.test.ts` (150+ lines)
   - Manual protection scenarios
   - Override flag behavior
   - Legacy data handling

### Updated Test Files
1. `__tests__/lib/status-mapping.test.ts` (+80 lines)
   - Semantic protection tests
   - Determinism tests
   - Integration scenarios

### Test Scenarios Covered
- ✅ Closed without done signal (no mapping)
- ✅ Closed with done signal (maps to DONE)
- ✅ Manual protection (deny-by-default)
- ✅ Manual override (when flag enabled)
- ✅ Multiple labels tie-breaker (deterministic)
- ✅ Case-insensitive sorting
- ✅ Whitespace normalization

---

## Files Changed

1. `control-center/src/lib/utils/status-mapping.ts`
   - Added `isFromIssueState` parameter to `mapGitHubStatusToAfu9()`
   - Added deterministic label sorting to `extractGitHubStatus()`
   - Updated return type to include `isFromIssueState` flag

2. `control-center/src/lib/github-status-sync.ts`
   - Added manual protection check
   - Added `allowManualOverride` parameter
   - Updated to use new `isFromIssueState` flag

3. `control-center/__tests__/lib/status-mapping.test.ts`
   - Added semantic protection tests
   - Added determinism tests
   - Added integration scenarios

4. `control-center/__tests__/lib/github-status-sync-manual-protection.test.ts`
   - New file with manual protection tests

---

## Verification Commands

```powershell
# Run all tests
npm --prefix control-center test

# Run specific test files
npm --prefix control-center test -- __tests__/lib/status-mapping.test.ts
npm --prefix control-center test -- __tests__/lib/github-status-sync-manual-protection.test.ts

# Repository verification
npm run repo:verify

# Build check
npm --prefix control-center run build
```

---

## Behavioral Changes

### Before
- ❌ Closed issues → DONE (incorrect)
- ❌ Manual statuses overwritten by GitHub
- ❌ Non-deterministic label selection

### After
- ✅ Closed issues → null (fail-closed)
- ✅ Explicit done signals → DONE
- ✅ Manual statuses protected (deny-by-default)
- ✅ Deterministic alphabetical label selection

---

## Backward Compatibility

- All changes are **backward compatible**
- New parameter `allowManualOverride` defaults to `false`
- Existing calls work without modification
- Legacy data (null `status_source`) syncs normally

---

## Security & Safety

- **Fail-closed**: Unknown states don't change AFU9 status
- **Deny-by-default**: Manual protection requires explicit override
- **Deterministic**: Same inputs → same outputs (always)
- **Observability**: Logged warnings for multiple labels, manual protection

---

**Status:** ✅ All critical issues resolved  
**Next Steps:** Verification and merge
