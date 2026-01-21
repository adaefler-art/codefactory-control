# AFU-9 Issue Lifecycle Implementation Summary

**Issue:** AFU-9: Introduce canonical AFU-9 Issue lifecycle (Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence)

**Date:** 2026-01-17

**Status:** ✅ Implementation Complete (MVP)

## Overview

Implemented canonical AFU-9 Issue lifecycle system to replace the existing INTENT-focused GitHub shortcut flow. AFU-9 is now the **System of Record** for issues, with GitHub serving as a **mirror/side-effect**.

## Key Changes

### 1. Database Schema (Migration 079)

**New Tables:**
- `issue_timeline` - Lifecycle event tracking
- `issue_evidence` - Publish receipts and audit trail
- `control_pack_assignments` - CP assignments for issues

**Extended afu9_issues Table:**
- `source_session_id` - INTENT session that created the issue
- `current_draft_id` - Current draft version ID
- `active_cr_id` - Explicit CR binding (required for publish)
- `github_synced_at` - Last GitHub mirror sync timestamp
- `kpi_context` - KPI tracking metadata (JSONB)
- `publish_batch_id` - Publish batch tracking
- `publish_request_id` - Request ID for audit trail

**New Status States:**
- `DRAFT_READY` - Draft committed, ready for CR binding
- `VERSION_COMMITTED` - Version committed
- `CR_BOUND` - CR explicitly bound to issue
- `PUBLISHING` - Publish in progress
- `PUBLISHED` - Successfully published to GitHub

**Helper Functions:**
- `get_afu9_issue_public_id()` - Get 8-char public ID from UUID
- `log_issue_timeline_event()` - Log timeline event
- `record_issue_evidence()` - Record evidence
- `assign_default_control_pack()` - Assign default CP

**Triggers:**
- Auto-log CR binding/unbinding events
- Auto-log GitHub mirror events
- Auto-log publish events

### 2. TypeScript Contracts

**New Contract Files:**
- `issueTimeline.ts` - Timeline event types and validation
- `issueEvidence.ts` - Evidence record types and validation
- `controlPackAssignment.ts` - CP assignment types and validation

**Extended Contracts:**
- `afu9Issue.ts` - Added new lifecycle fields and states

**Event Types:**
- Timeline: ISSUE_CREATED, DRAFT_COMMITTED, CR_BOUND, PUBLISHING_STARTED, PUBLISHED, GITHUB_MIRRORED, CP_ASSIGNED, etc.
- Evidence: PUBLISH_RECEIPT, GITHUB_MIRROR_RECEIPT, CR_BINDING_RECEIPT, CP_ASSIGNMENT_RECEIPT
- CP Status: active, inactive, revoked

### 3. Database Access Layer

**New DB Modules:**
- `issueTimeline.ts` - Timeline event CRUD operations
- `issueEvidence.ts` - Evidence record CRUD operations
- `controlPackAssignments.ts` - CP assignment CRUD operations

**Extended Modules:**
- `afu9Issues.ts` - Added CR binding functions, lifecycle field support

**Key Functions:**
- `logTimelineEvent()` - Log lifecycle events
- `recordEvidence()` - Record audit trail evidence
- `assignControlPack()` - Assign CP to issue
- `assignDefaultControlPack()` - Assign default CP (cp:intent-issue-authoring)
- `bindCrToIssue()` - Explicit CR binding
- `unbindCrFromIssue()` - Unbind CR from issue
- `getPublicId()` - Get 8-char public ID from UUID

### 4. Publish Orchestrator

**New Service:** `afu9-publish-orchestrator.ts`

**Core Function:** `publishAfu9Issue()`

**Orchestration Flow:**
1. Validate issue (CR binding, state checks)
2. Update issue status to PUBLISHING
3. Render issue content for GitHub
4. Create or update GitHub issue (idempotent via github_issue_number)
5. Update AFU-9 Issue mirror fields
6. Log timeline events (PUBLISHING_STARTED, PUBLISHED, GITHUB_MIRRORED)
7. Record evidence (PUBLISH_RECEIPT, GITHUB_MIRROR_RECEIPT)
8. Assign default Control Pack (cp:intent-issue-authoring)

**Idempotency:**
- Re-publishing updates existing GitHub issue (no duplicates)
- Timeline/evidence are append-only
- CP assignment uses unique constraint

**Determinism:**
- Same inputs → same result
- Explicit CR binding (no implicit selection)
- Clear error messages for validation failures

### 5. API Endpoints

**New Endpoints:**

#### POST /api/intent/issues/[id]/publish
- Publish AFU-9 Issue to GitHub via canonical orchestrator
- Requires: active CR binding, authentication, admin privileges
- Returns: GitHub issue details + audit trail (timeline, evidence, CP assignments)
- Status codes: 200 (success), 400 (invalid), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (no active CR or production blocked), 500 (error)

#### POST /api/intent/issues/[id]/bind-cr
- Bind Change Request to AFU-9 Issue
- Requires: cr_id (UUID)
- Logs timeline event and records evidence
- Returns: Updated issue with active_cr_id

#### GET /api/intent/issues/[id]/timeline
- Get timeline events for AFU-9 Issue
- Returns: Chronological list of lifecycle events

#### GET /api/intent/issues/[id]/evidence
- Get evidence records for AFU-9 Issue
- Returns: Audit trail evidence (publish receipts, etc.)

**Guards:**
1. 401 - Authentication required
2. 409 - Production block (ISSUE_SET_PUBLISHING_ENABLED=false)
3. 403 - Admin check (AFU9_ADMIN_SUBS)
4. Validation - Issue exists, has active CR
5. Orchestration - GitHub publish, timeline, evidence, CP assignment

## Architecture Decisions

### AFU-9 as System of Record

**Before:** INTENT directly created GitHub issues (GitHub was source of truth)

**After:** AFU-9 creates canonical issues → GitHub is mirror/side-effect

**Benefits:**
- Deterministic lifecycle management
- Complete audit trail (timeline + evidence)
- Explicit CR binding (no ambiguity)
- Idempotent publish (safe to retry)
- KPI tracking at source
- Control Pack assignment

### Explicit CR Binding

**Requirement:** Publish requires active CR binding (active_cr_id)

**Rationale:**
- No implicit "find CR" logic
- Clear ownership and traceability
- Prevents accidental publishes
- Supports future multi-CR scenarios

**Error Handling:** 409 Conflict if no active CR bound

### Timeline + Evidence Pattern

**Timeline:** Lifecycle events (what happened, when, who)

**Evidence:** Audit receipts (proof of actions, immutable)

**Benefits:**
- Comprehensive audit trail
- Supports compliance requirements
- Debugging and troubleshooting
- KPI analysis and reporting

### Control Pack Assignment

**Default CP:** `cp:intent-issue-authoring`

**Assignment:** Automatic on first publish

**Idempotency:** Unique constraint prevents duplicates

**Future:** Rule-based CP selection, multi-CP support

## Testing & Verification

### Manual Verification

See `AFU9_ISSUE_LIFECYCLE_VERIFICATION.md` for PowerShell commands.

**Checklist:**
- ✅ AFU-9 Issue created with canonical ID
- ✅ CR binding (active_cr_id set)
- ✅ Publish via AFU-9 orchestrator
- ✅ GitHub mirror idempotency
- ✅ Timeline events logged
- ✅ Evidence records created
- ✅ CP assignment
- ✅ Error handling (no active CR → 409)

### Database Verification

```sql
-- Check issue lifecycle
SELECT id, title, status, active_cr_id, github_issue_number, github_synced_at
FROM afu9_issues
WHERE id = 'issue-id';

-- Check timeline
SELECT event_type, created_at, actor FROM issue_timeline
WHERE issue_id = 'issue-id' ORDER BY created_at ASC;

-- Check evidence
SELECT evidence_type, created_at FROM issue_evidence
WHERE issue_id = 'issue-id' ORDER BY created_at ASC;

-- Check CP assignments
SELECT control_pack_id, control_pack_name, status
FROM control_pack_assignments WHERE issue_id = 'issue-id';
```

## Migration Path

### Existing Issues

- Existing afu9_issues rows compatible (new fields nullable)
- No data migration required
- New lifecycle fields populated on next update

### INTENT Integration

**Phase 1 (Current):**
- API endpoints available
- Manual CR binding via POST /api/intent/issues/[id]/bind-cr
- Manual publish via POST /api/intent/issues/[id]/publish

**Phase 2 (Future):**
- INTENT UI updates to show AFU-9 Issue state
- Auto-bind CR on commit
- "Publish to GitHub" button uses new orchestrator
- Timeline/evidence display in UI

## Known Limitations (MVP)

1. **No automatic CR binding** - Manual API call required
2. **No UI integration** - API-only for now
3. **Single CP per issue** - Default CP only
4. **No multi-CR branching** - One active CR at a time
5. **No production deployment** - Staging only (guarded)

## Next Steps (Out of Scope for MVP)

1. INTENT UI integration
   - Show AFU-9 Issue state/timeline
   - Auto-bind CR on commit
   - Update "Publish to GitHub" button
   - Display CP assignments

2. Advanced features
   - Multi-CR branching
   - Rule-based CP selection
   - Full automation playbooks
   - KPI dashboard integration

3. Testing
   - Unit tests for DB layer
   - Integration tests for orchestrator
   - API endpoint tests
   - E2E tests with INTENT

4. Documentation
   - API reference
   - State machine diagram
   - Runbook for operators
   - Migration guide

## Files Changed

### Database
- `database/migrations/079_afu9_issue_lifecycle_enhancements.sql` (new)

### Contracts
- `control-center/src/lib/contracts/afu9Issue.ts` (modified)
- `control-center/src/lib/contracts/issueTimeline.ts` (new)
- `control-center/src/lib/contracts/issueEvidence.ts` (new)
- `control-center/src/lib/contracts/controlPackAssignment.ts` (new)

### Database Access Layer
- `control-center/src/lib/db/afu9Issues.ts` (modified)
- `control-center/src/lib/db/issueTimeline.ts` (new)
- `control-center/src/lib/db/issueEvidence.ts` (new)
- `control-center/src/lib/db/controlPackAssignments.ts` (new)

### Services
- `control-center/src/lib/afu9-publish-orchestrator.ts` (new)

### API Endpoints
- `control-center/app/api/intent/issues/[id]/publish/route.ts` (new)
- `control-center/app/api/intent/issues/[id]/bind-cr/route.ts` (new)
- `control-center/app/api/intent/issues/[id]/timeline/route.ts` (new)
- `control-center/app/api/intent/issues/[id]/evidence/route.ts` (new)

### Documentation
- `AFU9_ISSUE_LIFECYCLE_VERIFICATION.md` (new)

## Acceptance Criteria - Status

✅ **AFU-9 Issue exists** - Issue table extended with lifecycle fields

✅ **CR is bound** - Explicit binding via active_cr_id, API endpoint available

✅ **Single-click Publish** - POST /api/intent/issues/[id]/publish orchestrates entire flow

✅ **GitHub mirror idempotent** - Re-publish updates existing issue via github_issue_number

✅ **Control Pack assignment** - Default CP assigned on publish

✅ **Timeline/Evidence present** - Events logged, evidence recorded

❌ **UX clarity** - UI not yet integrated (out of scope for MVP)

## Security Considerations

1. **Authentication** - All endpoints require x-afu9-sub header
2. **Authorization** - Publish requires admin privileges (AFU9_ADMIN_SUBS)
3. **Production guard** - Publish blocked in production unless ISSUE_SET_PUBLISHING_ENABLED=true
4. **Input validation** - Owner/repo format validation, CR ID validation
5. **Error messages** - Deterministic, no sensitive data exposure
6. **SQL injection** - Parameterized queries throughout
7. **No secrets in code** - Environment variables for sensitive config

## Performance Considerations

1. **Atomic operations** - Transactions used where needed
2. **Indexed queries** - All FK lookups indexed
3. **JSONB fields** - Used for flexible metadata (kpi_context, event_data)
4. **Pagination** - Timeline/evidence queries support limits
5. **Database overhead** - Minimal (3 new tables, <10 new columns)

## Compliance & Audit

1. **Complete audit trail** - Every action logged in timeline + evidence
2. **Immutable evidence** - Evidence records never modified
3. **Request ID tracking** - All operations include request_id
4. **Actor tracking** - Timeline events record who performed action
5. **Determinism** - Same inputs → same results (reproducible audit)

## Conclusion

The AFU-9 Issue lifecycle implementation successfully transforms the system into a canonical system of record with deterministic, auditable issue management. The publish orchestrator replaces direct GitHub integration with a controlled flow that ensures CR binding, comprehensive audit trails, and proper lifecycle management.

The MVP is complete and ready for integration testing on staging. Future work will focus on INTENT UI integration and advanced features like multi-CR support and rule-based CP selection.
