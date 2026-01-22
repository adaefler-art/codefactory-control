# E9.1-CTRL-6 Implementation Summary

## Task: Step Executor S2: Spec Gate

### Objective
Implement S2 step that validates "Spec ready" through existing Draft-Lifecycle logic without any redesign or duplication.

### Implementation Files

#### 1. S2 Step Executor
**File**: `control-center/src/lib/loop/stepExecutors/s2-spec-gate.ts`

**Responsibilities**:
- Check that issue has a source_session_id (from INTENT session)
- Verify draft exists for that session
- Verify draft has at least one committed version
- Validate that last_validation_status is 'valid'
- On success: transition issue status to SPEC_READY

**Key Functions**:
```typescript
export async function executeS2(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult>
```

**Error Cases Handled**:
1. **NO_DRAFT**: When source_session_id is null OR draft doesn't exist
2. **NO_COMMITTED_DRAFT**: When draft has no versions in intent_issue_draft_versions
3. **DRAFT_INVALID**: When last_validation_status is not 'valid' (e.g., 'invalid', 'unknown')

**Success Flow**:
1. Query afu9_issues for issue data
2. Check source_session_id exists
3. Query intent_issue_drafts for draft
4. Query intent_issue_draft_versions for latest version
5. Check validation status is 'valid'
6. Update issue status to SPEC_READY (in execute mode)
7. Log timeline event with name 'loop_step_s2_spec_ready'

#### 2. Execution Integration
**File**: `control-center/src/lib/loop/execution.ts`

**Changes**:
- Added import: `import { executeS2 } from './stepExecutors/s2-spec-gate';`
- Extended step dispatcher to handle `LoopStep.S2_SPEC_READY`
- Refactored step execution logic for better code organization
- Set stepNumber = 2 for S2 executions

#### 3. Tests
**File**: `control-center/__tests__/lib/loop/s2-spec-gate.test.ts`

**Test Coverage** (10 test cases):

**Blocked Scenarios**:
1. NO_DRAFT when source_session_id is null
2. NO_DRAFT when draft does not exist for session
3. NO_COMMITTED_DRAFT when no version exists
4. DRAFT_INVALID when validation status is 'invalid'
5. DRAFT_INVALID when validation status is 'unknown'

**Success Scenarios**:
6. Succeed and transition to SPEC_READY when all checks pass
7. Not update in dryRun mode but still succeed

**Timeline Event Creation**:
8. Create timeline event with correct structure for success
9. Create timeline event with blocker info when blocked

**Error Scenarios**:
10. Throw error when issue not found

**Test Results**: ✓ All 10 tests passing

#### 4. Verification Script
**File**: `verify-e91-ctrl-6.ps1`

**Checks Performed**:
1. S2 executor file exists with line count
2. Test file exists with test count
3. Integration in execution.ts (import and call)
4. Acceptance criteria implementation:
   - NO_DRAFT blocker code
   - NO_COMMITTED_DRAFT blocker code
   - DRAFT_INVALID blocker code
   - SPEC_READY state transition
5. Draft lifecycle integration:
   - source_session_id usage
   - intent_issue_drafts query
   - intent_issue_draft_versions query
   - last_validation_status check
6. Timeline event logging with custom name
7. Execute vs dryRun mode handling
8. Unit tests execution

### Design Decisions

#### 1. Direct Database Queries vs Helper Functions
**Decision**: Use direct SQL queries instead of `getIssueDraft()` and `getLatestCommittedVersion()`

**Rationale**: 
- These helper functions require `userId` for session ownership check
- Step executor runs in system context without user context
- Direct queries are simpler and avoid unnecessary ownership verification
- Still uses same tables and logic as the helper functions

#### 2. Timeline Event Type
**Decision**: Use `IssueTimelineEventType.RUN_STARTED` with custom stepName field

**Rationale**:
- Follows the pattern established in S1 executor
- Includes `stepName: 'loop_step_s2_spec_ready'` in event_data for identification
- Maintains consistency with existing timeline event structure

#### 3. State Transition
**Decision**: Direct UPDATE to SPEC_READY without state machine validation

**Rationale**:
- Step executor is called after state machine resolution
- State machine already validates the transition is legal
- Executor focuses on precondition checks and execution
- Follows the pattern from S1 which doesn't validate state transitions

### Contract Alignment

#### Anti-Drift Requirements Met:
✓ Uses existing draft lifecycle endpoints/tables (no new routes created)
✓ No direct Engine fetches (all database operations)
✓ Timeline events logged for audit trail
✓ Fail-closed behavior (all error cases explicitly handled)

#### Existing Draft Lifecycle Used:
1. `intent_issue_drafts` table - for draft existence and validation status
2. `intent_issue_draft_versions` table - for committed versions
3. `afu9_issues.source_session_id` - link to INTENT session
4. Validation status field - 'valid', 'invalid', 'unknown'

### Testing Results

#### Unit Tests:
```
PASS  __tests__/lib/loop/s2-spec-gate.test.ts
  S2 Step Executor: Spec Gate
    Blocked scenarios
      ✓ should block with NO_DRAFT when source_session_id is null
      ✓ should block with NO_DRAFT when draft does not exist for session
      ✓ should block with NO_COMMITTED_DRAFT when no version exists
      ✓ should block with DRAFT_INVALID when validation status is not valid
      ✓ should block with DRAFT_INVALID when validation status is unknown
    Success scenarios
      ✓ should succeed and transition to SPEC_READY when all checks pass
      ✓ should not update in dryRun mode but still succeed
    Timeline event creation
      ✓ should create timeline event with correct structure for success
      ✓ should create timeline event with blocker info when blocked
    Error scenarios
      ✓ should throw error when issue not found

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

#### Integration Tests (All Loop Tests):
```
Test Suites: 6 passed, 6 total
Tests:       100 passed, 100 total
```

### Files Modified/Created

**Created**:
1. `control-center/src/lib/loop/stepExecutors/s2-spec-gate.ts` (295 lines)
2. `control-center/__tests__/lib/loop/s2-spec-gate.test.ts` (448 lines)
3. `verify-e91-ctrl-6.ps1` (175 lines)

**Modified**:
1. `control-center/src/lib/loop/execution.ts` - Added S2 dispatcher logic

**Total Changes**: +918 lines of code (including tests and documentation)

### Acceptance Criteria Verification

✅ **No draft → NO_DRAFT**: Implemented with two checks:
- Check for null source_session_id
- Check for non-existent draft in database

✅ **Not committed → NO_COMMITTED_DRAFT**: Implemented:
- Query intent_issue_draft_versions table
- Return blocker if no rows found

✅ **Validation fehlerhaft → DRAFT_INVALID**: Implemented:
- Check last_validation_status !== 'valid'
- Handles both 'invalid' and 'unknown' states

✅ **Success → SPEC_READY, Timeline-Event**: Implemented:
- UPDATE afu9_issues SET status = 'SPEC_READY'
- logTimelineEvent with stepName 'loop_step_s2_spec_ready'
- Includes draft metadata (draftId, versionId, versionNumber)

### Next Steps

This implementation is complete and ready for:
1. Code review
2. Integration testing with real database
3. Deployment to staging environment
4. End-to-end testing with actual INTENT sessions

### Notes

- Implementation follows minimal-change principle
- Uses existing infrastructure without introducing new dependencies
- All error cases explicitly handled with specific blocker codes
- Timeline events provide full audit trail
- Tests provide comprehensive coverage of all scenarios
