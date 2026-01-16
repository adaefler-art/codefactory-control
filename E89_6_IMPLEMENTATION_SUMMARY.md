# E89.6 Implementation Summary

## IssueDraft Version → GitHub Issues Batch Publish

### Overview
Implemented idempotent batch publishing of IssueDraft versions to GitHub issues with bounded execution, deterministic ordering, and comprehensive audit trail.

### Key Components

#### 1. Service Layer: `issue-draft-version-publisher.ts`
- **Location**: `control-center/src/lib/github/issue-draft-version-publisher.ts`
- **Functions**:
  - `publishIssueDraftVersionBatch()`: Main batch publisher
  - `loadDraftsFromVersions()`: Load and sort drafts
  - `generateBatchHash()`: Deterministic hash generation

#### 2. API Route: `/api/intent/sessions/[id]/issue-draft/versions/publish`
- **Location**: `control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts`
- **Method**: POST
- **Guards** (in order):
  1. Authentication (401)
  2. Production block (409) - via `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED`
  3. Admin check (403) - via `AFU9_ADMIN_SUBS`
  4. Business logic (400/404/500)

### Features Implemented

#### ✅ Deterministic Batch Hash
- Stable ordering by canonicalId
- Hash includes: `session_id + sorted_version_ids + owner + repo`
- Same input always produces same hash

#### ✅ Idempotency
- Check existing batches by hash before publishing
- Second run with same input returns all items as 'skipped'
- No duplicate GitHub issues created
- Audit trail preserved

#### ✅ Bounded Batch Size
- Maximum 25 issues per batch (via `MAX_BATCH_SIZE` constant)
- Warning returned when batch is clamped
- Remaining issues not published (requires new batch)

#### ✅ Partial Success Handling
- Individual failures don't abort batch
- All results reported (created/updated/skipped/failed)
- Error messages preserved per item

#### ✅ Audit Ledger
- Batch-level events in `intent_issue_set_publish_batch_events`
- Includes: batch_hash, counts, timestamps
- Per-item events preserved from underlying publisher

#### ✅ Guardrails
- Production blocked by default (env var required)
- Admin allowlist enforced
- Repo allowlist (delegated to auth-wrapper)
- Retries via E82.4 (existing infrastructure)

### Request Format

```json
{
  "version_id": "uuid",           // Single version OR
  "issue_set_id": "uuid",         // All versions from set
  "owner": "github-owner",
  "repo": "github-repo"
}
```

### Response Format

```json
{
  "success": true,
  "batch_id": "uuid",
  "summary": {
    "total": 3,
    "created": 1,
    "updated": 1,
    "skipped": 1,
    "failed": 0
  },
  "items": [
    {
      "canonical_id": "E89.1",
      "action": "created",
      "status": "success",
      "github_issue_number": 123,
      "github_issue_url": "https://github.com/...",
      "rendered_issue_hash": "abc...",
      "labels_applied": ["epic:E89", "v0.8"]
    }
  ],
  "links": {
    "batch_id": "uuid",
    "request_id": "uuid"
  },
  "warnings": [
    "Batch size clamped from 30 to 25 issues."
  ]
}
```

### Test Coverage

#### Unit Tests
- **File**: `__tests__/lib/github/issue-draft-version-publisher.test.ts`
- Tests:
  - MAX_BATCH_SIZE constant
  - Deterministic ordering by canonicalId
  - Batch hash generation
  - Warning generation
  - Partial success handling
  - Result structure validation

#### Integration Tests
- **File**: `__tests__/api/intent-issue-draft-version-publish.test.ts`
- Tests:
  - Guard order: 401 → 409 → 403 → 400
  - Request validation
  - Success response structure
  - Warnings inclusion

### Idempotency Verification

**Test Scenario**: Run twice with same input
1. First run:
   - Generates batch hash
   - No existing batch found
   - Publishes to GitHub
   - Records in ledger
   - Returns: 1 created, 0 skipped

2. Second run (same input):
   - Generates same batch hash
   - Finds existing batch
   - No GitHub API calls
   - Returns: 0 created, 1 skipped
   - Same batch_id returned

### Environment Variables

- `ISSUE_DRAFT_VERSION_PUBLISHING_ENABLED=true` - Enable in production
- `AFU9_ADMIN_SUBS=user1,user2` - Admin allowlist (required)

### Dependencies

- Existing: `issue-draft-publisher.ts` (E82.1)
- Existing: `intentIssueDraftVersions.ts` (E81.2)
- Existing: `auth-wrapper.ts` (repo allowlist)
- Database: `intent_issue_set_publish_batch_events` table

### Migration Required

None - uses existing database tables from E82.3.

### Acceptance Criteria Status

- ✅ Run twice with same input: second run yields only skipped/no duplicates
- ✅ Batch size clamp + clear warning
- ✅ Partial failures don't abort; overall status includes failed items
- ✅ Ledger contains batch summary + per-item record + hashes

### Next Steps (E89.9 Staging Runbook)

1. Deploy to staging
2. Create test session with issue draft versions
3. Test single version publish
4. Test batch publish with >25 items
5. Test idempotency (run twice)
6. Test partial failures
7. Verify audit trail
8. Test production guards

### Files Created

1. `control-center/src/lib/github/issue-draft-version-publisher.ts` (281 lines)
2. `control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts` (237 lines)
3. `control-center/__tests__/lib/github/issue-draft-version-publisher.test.ts` (174 lines)
4. `control-center/__tests__/api/intent-issue-draft-version-publish.test.ts` (404 lines)

**Total**: 1,096 lines of production code and tests.
