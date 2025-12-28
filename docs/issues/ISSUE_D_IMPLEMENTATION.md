# Issue D Implementation Summary

**Issue ID**: AFU9-D  
**Title**: Issue Lifecycle Invariants & System Truth  
**Priority**: Medium  
**Status**: Complete

## Problem Statement

The original issue identified four key problems:

1. **Lifecycle invariants not server-side enforced**: Critical state combinations (e.g., `SYNCED` handoff_state with `CREATED` status) were not blocked
2. **"Untitled Issue" activation**: Issues without titles could be activated, breaking workflow expectations
3. **"No labels" UX unclear**: The text "No labels" was too prominent and not subtle enough
4. **System info showing fake data**: Concern about placeholder/fake system information being displayed

## Solution Overview

### 1. Server-Side Lifecycle Invariants

**Added Invariant**: `SYNCED` handoff_state cannot occur with `CREATED` status

**Implementation Locations**:
- `control-center/app/api/issues/[id]/handoff/route.ts` - Validates before handoff
- `control-center/app/api/issues/[id]/route.ts` - Validates on PATCH updates

**Validation Logic**:
```typescript
// In handoff route - Line 53-62
if (issue.status === Afu9IssueStatus.CREATED && issue.handoff_state === Afu9HandoffState.SYNCED) {
  return NextResponse.json(
    {
      error: 'Invalid state combination',
      details: 'Issue with status CREATED cannot have handoff_state SYNCED. This violates lifecycle invariants.',
    },
    { status: 400 }
  );
}

// In PATCH route - Lines 162-173
const finalStatus = updates.status ?? currentIssue.status;
const finalHandoffState = updates.handoff_state ?? currentIssue.handoff_state;

if (finalStatus === Afu9IssueStatus.CREATED && finalHandoffState === Afu9HandoffState.SYNCED) {
  return apiError(
    'Invalid state combination',
    400,
    'Issue with status CREATED cannot have handoff_state SYNCED. This violates lifecycle invariants.'
  );
}
```

### 2. Title Requirement for Activation and Handoff

**Requirement**: Both activation and handoff operations require a non-empty title

**Implementation**:

**Server-Side** (API Routes):
- `control-center/app/api/issues/[id]/activate/route.ts` (Lines 51-60)
- `control-center/app/api/issues/[id]/handoff/route.ts` (Lines 53-62)

```typescript
// Validation in both routes
if (!issue.title || issue.title.trim().length === 0) {
  return NextResponse.json(
    { 
      error: 'Cannot activate/handoff issue without a title',
      details: 'Operation requires a non-empty title. Please set a title before proceeding.',
    },
    { status: 400 }
  );
}
```

**Client-Side** (UI Validation):
- `control-center/app/issues/[id]/page.tsx` (Lines 228-235, 275-281)

```typescript
// In handleActivate
if (!issue.title || issue.title.trim().length === 0) {
  setSaveError('Cannot activate issue without a title. Please set a title first.');
  return;
}

// In handleHandoff  
if (!issue.title || issue.title.trim().length === 0) {
  setSaveError('Cannot handoff issue without a title. Please set a title first.');
  return;
}
```

**Benefits**:
- Immediate feedback on the client (no network roundtrip)
- Server-side enforcement prevents API bypass
- Clear, actionable error messages

### 3. Improved "No Labels" UX

**Change**: Replaced prominent "No labels" text with subtle em dash

**Implementation**: `control-center/app/issues/[id]/page.tsx` (Line 724)

**Before**:
```tsx
<span className="text-sm text-gray-500">No labels</span>
```

**After**:
```tsx
<span className="text-sm text-gray-600 italic">—</span>
```

**Rationale**:
- Less visual noise when there are no labels
- Maintains UI consistency (empty state is still visible)
- More subtle and professional appearance

### 4. System Information Verification

**Finding**: No fake/placeholder data detected

**Verification**:
- Reviewed `control-center/app/api/system/config/route.ts`
- All values come from environment variables:
  - `version`: Real version string "v0.2 (ECS)"
  - `architecture`: Real architecture "AFU-9 (Ninefold)"
  - `environment`: From `process.env.NODE_ENV`
  - `database`: From `process.env.DATABASE_NAME`
  - GitHub/AWS/LLM config: From respective env vars

**Conclusion**: System info displays actual configuration data, not fake/placeholder values.

## Testing

### New Test Suite
**File**: `control-center/__tests__/api/issue-lifecycle-invariants.test.ts`

**Test Coverage** (8 tests):

1. **Activation Invariants**:
   - ✓ Blocks activation of issue without title
   - ✓ Blocks activation with whitespace-only title
   - ✓ Allows activation with valid title

2. **Handoff Invariants**:
   - ✓ Blocks handoff of issue without title
   - ✓ Blocks handoff if CREATED status with SYNCED handoff_state
   - ✓ Allows handoff with valid title and state

3. **Update Invariants**:
   - ✓ Blocks update that would create CREATED + SYNCED combination
   - ✓ Allows valid status updates

### Test Results
- **New tests**: 8/8 passing
- **All issue API tests**: 43/43 passing
- **Build**: ✓ SUCCESS

### Updated Tests
- Fixed `control-center/__tests__/api/issues-delete.test.ts` to use `fetchIssueRowByIdentifier` mock

## Files Changed

1. `control-center/app/api/issues/[id]/activate/route.ts` - Added title validation
2. `control-center/app/api/issues/[id]/handoff/route.ts` - Added title + invariant validation
3. `control-center/app/api/issues/[id]/route.ts` - Added invariant validation for PATCH
4. `control-center/app/issues/[id]/page.tsx` - Client-side validation + UX improvements
5. `control-center/__tests__/api/issue-lifecycle-invariants.test.ts` - New test suite
6. `control-center/__tests__/api/issues-delete.test.ts` - Updated mocks

## API Contract Changes

### New Error Responses (400 Bad Request)

**Missing Title on Activation**:
```json
{
  "error": "Cannot activate issue without a title",
  "details": "Activation requires a non-empty title. Please set a title before activating."
}
```

**Missing Title on Handoff**:
```json
{
  "error": "Cannot handoff issue without a title",
  "details": "Handoff requires a non-empty title. Please set a title before handing off to GitHub."
}
```

**Invalid State Combination**:
```json
{
  "error": "Invalid state combination",
  "details": "Issue with status CREATED cannot have handoff_state SYNCED. This violates lifecycle invariants."
}
```

## Acceptance Criteria Status

✅ **API blocks invalid transitions (400)**
- SYNCED + CREATED combination blocked in handoff route
- SYNCED + CREATED combination blocked in PATCH route
- Returns 400 with clear error message

✅ **UI blocks activation without title with clear message**
- Client-side validation provides immediate feedback
- Server-side validation provides backup enforcement
- Error message clearly states requirement

✅ **"No labels" improved UX**
- Changed from "No labels" to "—"
- Styling more subtle (gray-600, italic)

✅ **System info shows real data**
- Verified all system config comes from environment variables
- No fake/placeholder data found

✅ **npm run build passes**
- Build successful
- All tests passing (51/51)

## Security Considerations

### Invariant Enforcement
- **Defense in Depth**: Both client and server validation
- **API Security**: Server-side validation prevents bypass via API
- **Clear Errors**: Informative error messages don't leak sensitive info

### Data Integrity
- Prevents invalid state combinations that could break workflows
- Ensures issues have minimum viable data (title) before activation
- Maintains referential integrity between status and handoff_state

## Future Enhancements

While not required for this issue, potential future improvements:

1. **Additional Invariants**: 
   - Status transition rules (e.g., CREATED → SPEC_READY → IMPLEMENTING)
   - Execution state validation with issue status

2. **Database Constraints**:
   - Consider adding CHECK constraint in PostgreSQL for state combinations
   - Add trigger to validate state transitions

3. **Audit Trail**:
   - Log invariant violation attempts
   - Track who tried to perform invalid operations

## Migration Notes

**No breaking changes** - this is purely additive:
- New validation rules only affect invalid operations
- Valid operations continue to work as before
- No database schema changes required
- No configuration changes needed

## Conclusion

All requirements from Issue AFU9-D have been successfully implemented:
- ✅ Server-side lifecycle invariants enforced
- ✅ Title requirement for activation/handoff
- ✅ Improved "No labels" UX
- ✅ Verified system info authenticity
- ✅ Comprehensive test coverage
- ✅ Build passing

The implementation follows best practices:
- Defense in depth (client + server validation)
- Clear, actionable error messages
- Comprehensive test coverage
- No breaking changes
- Maintains backward compatibility
