# V09-I03: Verification Commands

This document provides verification commands to test the V09-I03 implementation.

## Prerequisites

```bash
cd /home/runner/work/codefactory-control/codefactory-control/control-center
npm install
```

## Unit Tests

### 1. Schema Tests (22 tests)
```bash
npm test -- __tests__/lib/schemas/issue-draft-summary.test.ts
```

**Expected:** All 22 tests passing
- Schema validation
- Empty state generation
- Draft summary creation
- PHI/Secrets exclusion

### 2. Tool Executor Tests (10 tests)
```bash
npm test -- __tests__/lib/intent-agent-tool-get-draft-summary.test.ts
```

**Expected:** All 10 tests passing
- Returns summary with exists:true when draft exists
- Returns summary with exists:false when no draft
- Database error handling
- Validation status mapping

### 3. UI Tests (17 tests)
```bash
npm test -- __tests__/ui/intent-issue-draft-panel.test.tsx
```

**Expected:** All 17 tests passing
- Draft panel rendering
- Validation status badges
- Action buttons
- Error display
- Draft snapshot display

### 4. All Draft Tests
```bash
npm test -- --testPathPattern="draft"
```

**Expected:** All draft-related tests passing (includes above tests)

## Build Verification

### TypeScript Compilation
```bash
npx tsc --noEmit --skipLibCheck
```

**Expected:** No new compilation errors (pre-existing errors in other packages are acceptable)

## Integration Testing

### 1. Start Development Server
```bash
npm run dev
```

### 2. Test Scenarios

#### Scenario 1: Empty State (No Draft)
1. Navigate to INTENT Console
2. Create new session
3. Open Issue Draft panel
4. **Expected:** "No draft yet" message displayed
5. **Expected:** No Draft Snapshot section visible

#### Scenario 2: Draft Exists with VALID Status
1. Create a draft via INTENT conversation
2. Validate the draft
3. **Expected:** Draft Snapshot section visible with:
   - Canonical ID (purple text)
   - Status: VALID (green text)
   - Title (gray text, truncated if long)
   - Updated timestamp
   - Body hash (12 chars, gray monospace)

#### Scenario 3: Draft Exists with INVALID Status
1. Create an invalid draft (missing required fields)
2. Attempt validation
3. **Expected:** Draft Snapshot section shows:
   - Status: INVALID (red text)
   - Other fields as available

#### Scenario 4: Draft Exists with UNKNOWN Status
1. Create a draft without validating
2. **Expected:** Draft Snapshot section shows:
   - Status: UNKNOWN (yellow text)

## API Testing (Manual)

### Using curl (if auth is available)

#### Test 1: Get Draft Summary (when draft exists)
```bash
curl -X GET http://localhost:3000/api/intent/sessions/SESSION_ID/issue-draft \
  -H "Cookie: your-session-cookie" \
  -H "x-afu9-sub: USER_ID"
```

**Expected Response:**
```json
{
  "success": true,
  "draft": {
    "id": "...",
    "session_id": "...",
    "issue_json": {...},
    "issue_hash": "abc123...",
    "last_validation_status": "valid",
    "updated_at": "2026-01-16T..."
  }
}
```

#### Test 2: Tool Execution (via INTENT conversation)
1. In INTENT conversation, ask: "What's the status of the current draft?"
2. **Expected:** INTENT calls `get_issue_draft_summary` tool
3. **Expected:** INTENT responds with summary information

## Code Quality Checks

### 1. No `any` Types
```bash
grep -r "as any" control-center/src/lib/schemas/issueDraftSummary.ts
```
**Expected:** No matches (we use `unknown` instead)

### 2. Strict Mode Enabled
```bash
grep "strict()" control-center/src/lib/schemas/issueDraftSummary.ts
```
**Expected:** Match found in schema definition

### 3. Test Coverage
```bash
npm test -- --coverage --testPathPattern="issue-draft-summary"
```
**Expected:** High coverage (>90%) for new files

## Security Verification

### 1. No Secrets in Summary
```bash
# Search for potential sensitive data exposure
grep -i "password\|secret\|token\|key" control-center/src/lib/schemas/issueDraftSummary.ts
```
**Expected:** No matches

### 2. PHI/PII Test
```bash
npm test -- __tests__/lib/schemas/issue-draft-summary.test.ts -t "does not include PHI"
```
**Expected:** Test passing

### 3. Body Content Not Exposed
```bash
# Verify body is not in summary schema
grep "body:" control-center/src/lib/schemas/issueDraftSummary.ts
```
**Expected:** Only in comments/documentation, not in schema

## Performance Testing

### 1. Summary Creation Speed
```bash
npm test -- __tests__/lib/schemas/issue-draft-summary.test.ts -t "deterministic"
```
**Expected:** Fast execution (<10ms per test)

### 2. Tool Execution Speed
```bash
npm test -- __tests__/lib/intent-agent-tool-get-draft-summary.test.ts
```
**Expected:** All tests complete in <1 second

## Regression Testing

### 1. Existing Draft Tests
```bash
npm test -- __tests__/api/intent-issue-draft.test.ts
npm test -- __tests__/api/intent-issue-draft-route.test.ts
```
**Expected:** All existing tests still passing

### 2. Full Test Suite (if time permits)
```bash
npm test
```
**Expected:** No new failures (pre-existing failures in other packages are acceptable)

## Checklist

- [ ] All 32 new tests passing
- [ ] No new TypeScript errors
- [ ] UI Draft Snapshot section displays correctly
- [ ] Empty state shows "No draft yet" (no snapshot)
- [ ] Populated state shows snapshot with all fields
- [ ] Color-coded validation status works
- [ ] Body hash truncated to 12 chars
- [ ] No PHI/Secrets in summary
- [ ] No `any` types in code
- [ ] Code review feedback addressed

## Success Criteria

✅ All tests passing  
✅ No TypeScript compilation errors  
✅ UI displays Draft Snapshot correctly  
✅ Empty state handled gracefully  
✅ Security verified (no PHI/Secrets)  
✅ Code quality high (no `any`, strict mode)  
✅ No regression in existing functionality  

## Notes

- Pre-existing test failures in other packages (deploy-memory, verdict-engine) are not related to this change
- Focus verification on draft-related tests and UI
- The Draft Snapshot section is purely additive - it doesn't break existing functionality
