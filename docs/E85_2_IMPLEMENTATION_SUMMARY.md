# E85.2: Bi-directional Sync (AFU-9 ↔ GitHub) - Implementation Summary

**Date:** 2026-01-13  
**Status:** ✅ COMPLETE  
**Issue:** E85.2  
**PR Branch:** copilot/bi-directional-sync-afu9-gh

---

## Executive Summary

Successfully implemented **deterministic, bi-directional synchronization** between AFU-9 and GitHub with the following key features:

- **Pull-based sync** (no webhook dependency)
- **Event hashing** for idempotent event processing
- **State machine validation** from E85.1 spec
- **Conflict detection and marking**
- **Dry-run mode** for safe testing
- **Fail-closed error handling**
- **Evidence-based transitions**
- **Comprehensive audit trail**

**All acceptance criteria met.** Ready for review.

---

## Deliverables

### 1. Database Schema (`064_bidirectional_sync_audit.sql`)

**Tables Created:**
- `sync_audit_events` - Audit trail of all sync operations (AFU-9 ↔ GitHub)
- `sync_conflicts` - Tracked conflicts requiring manual resolution

**Key Features:**
- Event hashing (SHA-256) for idempotent event processing
- 5-minute timestamp bucketing for idempotency window
- Deterministic event recording with conflict detection
- Support for dry-run mode
- Evidence payload storage (PR merge, CI status, reviews)

**Helper Functions:**
- `generate_sync_event_hash()` - Deterministic hash generation
- `record_sync_event()` - Idempotent event recording
- Views for monitoring: `sync_audit_recent_events`, `sync_conflicts_unresolved`, `sync_event_stats`

### 2. TypeScript Contracts (`sync-audit.ts`)

**Enums Defined:**
- `SyncEventType` - 10 event types (AFU9→GH labels, GH→AFU9 PR status, etc.)
- `SyncDirection` - AFU9_TO_GITHUB, GITHUB_TO_AFU9, CONFLICT
- `SyncConflictType` - 6 conflict types (state divergence, precondition failed, etc.)
- `EvidenceType` - 9 evidence types (PR merge, CI status, review approval, etc.)

**Interfaces:**
- `SyncAuditEventInput` / `SyncAuditEventRow` - Audit event data
- `SyncConflictInput` / `SyncConflictRow` - Conflict data

### 3. Database Access Layer (`db/syncAudit.ts`)

**Functions Implemented:**
- `recordSyncAuditEvent()` - Idempotent event recording
- `querySyncAuditEventsByIssue()` - Query events by AFU-9 issue
- `querySyncAuditEventsByGitHubIssue()` - Query events by GitHub issue
- `getRecentSyncAuditEvents()` - Recent events for monitoring
- `createSyncConflict()` - Create conflict record
- `getUnresolvedSyncConflicts()` - Query unresolved conflicts
- `resolveSyncConflict()` - Resolve a conflict
- `querySyncConflictsByIssue()` - Query conflicts by issue

### 4. State Machine Loader (`state-machine/loader.ts`)

**Purpose:** Load and validate state machine spec from E85.1

**Functions Implemented:**
- `loadStateMachineSpec()` - Load YAML specs from `docs/state-machine/v1/`
- `isTransitionAllowed()` - Validate if state transition is allowed
- `getTransition()` - Get transition definition for state change
- `checkPreconditions()` - Check if preconditions are met
- `mapGitHubStatusToAfu9()` - Map GitHub status to AFU-9 status
- `getGitHubLabelsForStatus()` - Get GitHub labels for AFU-9 status
- `getRequiredChecks()` - Get required CI checks for state
- `isTerminalState()` - Check if state is terminal
- `getValidNextStates()` - Get valid next states from current state

**Data Structures:**
- `StateDefinition` - State metadata (terminal, successors, UI, etc.)
- `TransitionDefinition` - Transition rules with preconditions and evidence
- `GitHubMapping` - Bi-directional mappings between AFU-9 and GitHub

### 5. Bi-directional Sync Engine (`bidirectional-sync.ts`)

**Core Class:** `BidirectionalSyncEngine`

**Key Methods:**

**GitHub → AFU-9 Sync:**
- `syncGitHubToAfu9()` - Sync GitHub status to AFU-9
  - Fetches PR data, reviews, and checks
  - Determines new status from GitHub (PR merged, checks pass, reviews)
  - Validates transition against state machine spec
  - Checks preconditions (tests pass, review approved, etc.)
  - Records audit events and conflicts
  - Respects manual override protection
  - Supports dry-run mode

**AFU-9 → GitHub Sync:**
- `syncAfu9ToGitHub()` - Sync AFU-9 status to GitHub
  - Gets GitHub labels for current status
  - Updates GitHub issue labels
  - Records audit events
  - Supports dry-run mode

**Private Methods:**
- `fetchGitHubData()` - Fetch PR, reviews, and checks from GitHub
- `determineStatusFromGitHub()` - Determine AFU-9 status from GitHub data
- `extractEvidenceFromGitHub()` - Extract evidence for precondition checking
- `handleConflict()` - Handle and record sync conflicts
- `recordSyncEvent()` - Record sync audit event

**Conflict Detection:**
- Transition not allowed by state machine spec
- Preconditions not met (missing evidence)
- Evidence missing for required transition
- Manual override blocked

### 6. Sync Job Runner (`sync-job-runner.ts`)

**Core Class:** `SyncJobRunner`

**Key Methods:**
- `runSyncJob()` - Run sync job for list of issues
  - Supports dry-run mode (default: true for safety)
  - Supports bi-directional sync or single direction
  - Records sync run metadata
  - Aggregates results (synced, failed, conflicts, blocked)
- `syncSingleIssue()` - Convenience method for single issue sync
- `syncAllOpenIssues()` - Sync all open AFU-9 issues with GitHub
- `getSyncStats()` - Get sync job statistics

**Options:**
- `dryRun` - Enable dry-run mode (default: true)
- `direction` - AFU9_TO_GITHUB, GITHUB_TO_AFU9, or BOTH
- `allowManualOverride` - Allow overriding manual status
- `createdBy` - User/agent who initiated sync

### 7. Unit Tests (`__tests__/lib/bidirectional-sync.test.ts`)

**Test Cases:**
- ✅ Sync merged PR to DONE status
- ✅ Detect conflict for invalid transition
- ✅ Respect dry-run mode for GitHub→AFU-9
- ✅ Sync AFU-9 status to GitHub labels
- ✅ Respect dry-run mode for AFU-9→GitHub

**Mocking:**
- State machine spec
- Database operations
- GitHub API calls
- Audit event recording

---

## Statistics

| Metric | Value |
|--------|-------|
| **Files Created** | 7 |
| **Database Tables** | 2 |
| **Database Functions** | 2 |
| **TypeScript Files** | 5 |
| **Test Files** | 1 |
| **Lines of Code** | ~2,000 |
| **Sync Event Types** | 10 |
| **Conflict Types** | 6 |
| **Evidence Types** | 9 |

---

## Acceptance Criteria Verification

✅ **Sync-Job reads GitHub Status deterministically**
- Pull-based sync fetches PR status, reviews, and checks
- Deterministic status extraction from GitHub data
- Priority: PR merged > PR status > checks > reviews > labels

✅ **AFU-9 Status only changed when Spec-Transition allowed**
- State machine spec loaded from E85.1
- Transition validation before status change
- Terminal states (DONE, KILLED) cannot transition
- Successors checked for valid transitions

✅ **Every Sync creates Audit-Event**
- All sync operations recorded in `sync_audit_events`
- Event hashing for idempotency (5-minute bucket)
- Evidence payload stored (PR merge, CI status, reviews)
- Sync direction tracked (AFU9→GH, GH→AFU9, CONFLICT)

✅ **Conflicts marked as SYNC_CONFLICT, not overwritten**
- Conflict detection for invalid transitions
- Conflict detection for missing preconditions
- Conflict records created in `sync_conflicts` table
- No status override when conflict detected
- Manual resolution required flag

✅ **Dry-run mode available**
- Default dry-run mode for safety
- No database updates in dry-run mode
- No GitHub API writes in dry-run mode
- Audit events still recorded with `dry_run=true`

---

## Guards Verification

❌ **No Auto-Merge**
- ✅ Verified: No auto-merge logic in sync engine
- ✅ Transition to DONE requires explicit PR merge from GitHub

❌ **No Status-Override without Evidence**
- ✅ Verified: Evidence checked for all transitions
- ✅ Preconditions must be met
- ✅ Missing evidence triggers conflict

✅ **Fail-Closed**
- ✅ Errors logged and returned, not thrown
- ✅ Failed syncs recorded in audit trail
- ✅ Sync job continues on single-issue failures
- ✅ Overall job status reflects failures

---

## Key Design Decisions

### 1. Pull-Based Sync (Not Webhook-Based)
**Rationale:** More reliable, easier to debug, no webhook configuration required
**Trade-off:** Slightly higher latency (polling interval)

### 2. Event Hashing for Idempotency
**Rationale:** Prevents duplicate event recording
**Implementation:** SHA-256 hash of (event_type, issue_id, github_issue, timestamp_bucket, payload)
**Bucket:** 5-minute intervals for idempotency window

### 3. Dry-Run Default
**Rationale:** Safety first - prevent accidental changes
**Override:** Explicit `dryRun: false` required for live sync

### 4. Conflict Detection (Not Override)
**Rationale:** Preserve data integrity, require manual resolution
**Conflict Types:**
- State divergence (AFU-9 vs GitHub)
- Transition not allowed
- Precondition failed
- Evidence missing

### 5. Fail-Closed Error Handling
**Rationale:** Errors should not silently succeed
**Implementation:**
- Errors logged with full context
- Failed syncs recorded in audit trail
- Sync job returns overall failure status
- No status changes on error

---

## Integration Points

### State Machine Spec (E85.1)
- Loads from `/docs/state-machine/v1/`
- Files: `state-machine.yaml`, `transitions.yaml`, `github-mapping.yaml`
- Validates all transitions against spec
- Enforces preconditions and evidence requirements

### GitHub API
- Fetches PR data, reviews, and checks
- Updates issue labels
- No webhook dependency (pull-based)

### AFU-9 Database
- Reads/updates `afu9_issues` table
- Records audit events in `sync_audit_events`
- Tracks conflicts in `sync_conflicts`

---

## Usage Examples

### Example 1: Sync Single Issue (Dry-Run)
```typescript
const syncEngine = new BidirectionalSyncEngine(pool, octokit);
const result = await syncEngine.syncGitHubToAfu9(
  'issue-uuid',
  'owner',
  'repo',
  123,
  { dryRun: true }
);

// result.statusChanged: false (dry-run)
// result.conflictDetected: false
// result.transitionAllowed: true
```

### Example 2: Sync All Open Issues (Live)
```typescript
const syncRunner = new SyncJobRunner(pool, octokit);
const jobResult = await syncRunner.syncAllOpenIssues({
  dryRun: false,
  direction: 'BOTH',
  createdBy: 'sync-job',
});

// jobResult.syncedIssues: 42
// jobResult.conflictsDetected: 2
// jobResult.transitionsBlocked: 1
```

### Example 3: Query Unresolved Conflicts
```typescript
const conflicts = await getUnresolvedSyncConflicts(pool);
// conflicts.data: [{ issue_id, conflict_type, description, ... }]
```

### Example 4: Resolve Conflict
```typescript
await resolveSyncConflict(pool, 'conflict-id', {
  resolved_by: 'admin',
  resolution_action: 'manual_override',
  resolution_notes: 'Manually set status to DONE after verifying PR merge',
});
```

---

## Next Steps (Out of Scope)

Future enhancements beyond E85.2:

1. **E85.3**: Webhook-based sync (push events)
2. **E85.4**: Automated conflict resolution rules
3. **E85.5**: Sync dashboard and monitoring UI
4. **E85.6**: Batch sync optimization
5. **E85.7**: Sync policy configuration

---

## References

### Related Documentation
- **E85.1:** `/docs/state-machine/v1/README.md`
- **State Machine Spec:** `/docs/state-machine/v1/state-machine.yaml`
- **Transitions Spec:** `/docs/state-machine/v1/transitions.yaml`
- **GitHub Mapping:** `/docs/state-machine/v1/github-mapping.yaml`

### Implementation Files
- **Migration:** `database/migrations/064_bidirectional_sync_audit.sql`
- **Contracts:** `control-center/src/lib/contracts/sync-audit.ts`
- **DB Layer:** `control-center/src/lib/db/syncAudit.ts`
- **State Machine:** `control-center/src/lib/state-machine/loader.ts`
- **Sync Engine:** `control-center/src/lib/bidirectional-sync.ts`
- **Job Runner:** `control-center/src/lib/sync-job-runner.ts`
- **Tests:** `control-center/__tests__/lib/bidirectional-sync.test.ts`

---

## Conclusion

✅ **All deliverables complete**  
✅ **All acceptance criteria met**  
✅ **All guards verified**  
✅ **Comprehensive audit trail**  
✅ **State machine integration**  
✅ **Conflict detection and marking**  
✅ **Dry-run mode**  
✅ **Fail-closed error handling**  
✅ **Ready for review and deployment**

**Status:** COMPLETE  
**Next:** Code review and testing in staging

---

**Implementation Date:** 2026-01-13  
**Version:** 1.0  
**Maintained By:** AFU-9 Team
