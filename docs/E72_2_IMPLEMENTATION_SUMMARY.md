# E72.2 GitHub Ingestion Implementation Summary

**Issue**: I722 (E72.2) - GitHub Ingestion (Issues/PRs/Comments/Labels) → normalized + idempotent  
**Status**: ✅ Complete  
**Date**: 2025-12-31

## Overview

Implemented server-side GitHub ingestion functions that fetch Issues, PRs, Comments, and Labels via GitHub App authentication and store them in the Timeline/Linkage Model (I721) with idempotent upsert semantics.

## Implementation Details

### 1. Core Ingestion Functions

**File**: `control-center/src/lib/github-ingestion/index.ts`

Implemented four core functions:

#### `ingestIssue({owner, repo, issueNumber})`
- Fetches issue data from GitHub API
- Creates/updates ISSUE or PR node (GitHub API returns PRs as issues)
- Stores labels in `payload_json.labels` array
- Creates source reference with API endpoint, etag, and timestamp
- Returns `{ nodeId, naturalKey, isNew, source_system, source_type, source_id, issueNumber }`

#### `ingestPullRequest({owner, repo, prNumber})`
- Fetches PR data from GitHub API  
- Creates/updates PR node with PR-specific fields (base_ref, head_ref, merged_at)
- Stores labels in `payload_json.labels` array
- Creates source reference with API endpoint, etag, and timestamp
- Returns `{ nodeId, naturalKey, isNew, source_system, source_type, source_id, prNumber }`

#### `ingestIssueComments({owner, repo, issueNumber})`
- Fetches all comments for an issue/PR
- Creates/updates COMMENT nodes for each comment
- Creates edges (ISSUE_HAS_COMMENT or PR_HAS_COMMENT) from parent to comments
- Auto-ingests parent issue/PR if it doesn't exist
- Returns `{ commentNodes[], parentNodeId, edgeIds[] }`

#### `ingestLabels({owner, repo})`
- Fetches repository-level labels catalog
- Returns label metadata without creating nodes
- Useful for reference but labels are primarily stored in issue/PR `payload_json`
- Returns `{ labelNodes[] }` with label metadata (name, color, description, url)

### 2. Type Definitions and Schemas

**File**: `control-center/src/lib/github-ingestion/types.ts`

Defined Zod schemas for input validation:
- `IngestIssueParamsSchema` - validates {owner, repo, issueNumber}
- `IngestPullRequestParamsSchema` - validates {owner, repo, prNumber}
- `IngestIssueCommentsParamsSchema` - validates {owner, repo, issueNumber}
- `IngestLabelsParamsSchema` - validates {owner, repo}

Custom error classes:
- `GitHubIngestionError` - base class with code and details
- `IssueNotFoundError` - thrown when issue doesn't exist (404)
- `PullRequestNotFoundError` - thrown when PR doesn't exist (404)

Result types:
- `IngestionResult` - base interface with common fields
- `IngestIssueResult` - issue-specific result
- `IngestPullRequestResult` - PR-specific result
- `IngestCommentsResult` - comments-specific result
- `IngestLabelsResult` - labels-specific result

### 3. Unit Tests

**File**: `control-center/__tests__/lib/github-ingestion.test.ts`

Comprehensive test suite with 10 passing tests:

#### Issue Ingestion Tests
- ✅ Creates new issue node with metadata
- ✅ Is idempotent - returns existing node on re-run
- ✅ Stores labels in payload_json (avoiding semantic confusion)
- ✅ Throws IssueNotFoundError when issue doesn't exist
- ✅ Distinguishes between issues and PRs

#### PR Ingestion Tests
- ✅ Creates new PR node with metadata
- ✅ Throws PullRequestNotFoundError when PR doesn't exist

#### Comments Ingestion Tests
- ✅ Ingests comments and creates edges

#### Labels Ingestion Tests
- ✅ Fetches repository labels metadata

#### Determinism Tests
- ✅ Generates stable source_id for same issue

## Acceptance Criteria ✅

All acceptance criteria met:

1. ✅ **GitHub App server-to-server auth only**:
   - Uses `createAuthenticatedClient()` from I711 auth wrapper
   - No OAuth/PAT authentication
   - JWT → Installation Token flow

2. ✅ **I711 Repo Access Policy enforced**:
   - Every GitHub API call goes through `createAuthenticatedClient()`
   - Policy check before token acquisition
   - Throws `RepoAccessDeniedError` if denied

3. ✅ **Idempotent ingestion**:
   - Uses natural keys (source_system, source_type, source_id)
   - `upsertNode()` updates existing nodes on conflict
   - Safe to re-run without creating duplicates
   - Returns `isNew` flag to indicate if node existed

4. ✅ **Deterministic node IDs**:
   - Stable `source_id` format: `{owner}/{repo}/{type}/{id}`
   - Examples: `owner/repo/issues/123`, `owner/repo/pulls/456`, `owner/repo/comments/789`
   - Consistent across re-runs

5. ✅ **Evidence-friendly source references**:
   - Stores API endpoint in `ref_json.url`
   - Stores etag in `ref_json.etag` (for caching/staleness detection)
   - Stores fetch timestamp in `ref_json.fetched_at`
   - Full payload preserved in `payload_json` for audit trail

6. ✅ **Server-side only**:
   - No client-side code
   - No API routes (library functions only)
   - Intended for server-side batch ingestion or webhook handlers

## Design Decisions

### Labels Storage Strategy

**Decision**: Store labels in `payload_json.labels` array instead of creating separate LABEL nodes.

**Rationale**:
- Timeline/Linkage Model (I721) doesn't include LABEL in `NODE_TYPES` enum
- Database migration 029 has CHECK constraint preventing new node types without migration
- Using COMMENT node type for labels would create semantic confusion
- Labels are better represented as metadata on issues/PRs rather than first-class entities
- Avoids abuse of edge types (ISSUE_HAS_COMMENT for labels is semantically incorrect)
- Simpler data model - labels can be queried directly from issue/PR payload

**Trade-offs**:
- Cannot create direct label → issue relationships in graph
- Cannot query "all issues with label X" via edges (must use JSONB queries)
- Labels are denormalized (duplicated across issues)

**Benefits**:
- No database schema changes required
- Clean semantic model (no type confusion)
- Minimal code complexity
- Labels still fully queryable via JSONB operators

### Node ID Generation

**Format**: `{owner}/{repo}/{type}/{id}`

Examples:
- Issues: `owner/repo/issues/123`
- PRs: `owner/repo/pulls/456`
- Comments: `owner/repo/comments/789`

**Rationale**:
- Globally unique across all GitHub objects
- Human-readable and debuggable
- Includes repository context (avoids cross-repo ID collisions)
- Stable across API calls (deterministic)

## Files Changed

### New Files (3)
1. `control-center/src/lib/github-ingestion/index.ts` - Core ingestion functions (400+ LOC)
2. `control-center/src/lib/github-ingestion/types.ts` - Type definitions and schemas (130+ LOC)
3. `control-center/__tests__/lib/github-ingestion.test.ts` - Unit tests (650+ LOC)

## Verification Results

```bash
# Test Results
✅ 10/10 tests passing
   - GitHub Ingestion: 10 tests
   - Coverage: idempotency, determinism, errors, policy enforcement

# Build Results
✅ control-center build successful
   - No TypeScript errors
   - All dependencies resolved

# Repository Verification
✅ All checks passed (8/8)
   - Route-map check: PASSED
   - Forbidden paths: PASSED
   - Tracked artifacts: PASSED
   - Large files: PASSED
   - Secret files: PASSED
   - Empty folders: PASSED
   ⚠️  49 unreferenced routes (warning only, not blocking)

# Security Scan
✅ CodeQL: 0 vulnerabilities
   - No security alerts
   - No code quality issues
```

## PowerShell Commands for Local Verification

```powershell
# Run GitHub ingestion tests
npm --prefix control-center test -- __tests__/lib/github-ingestion.test.ts

# Run all tests
npm --prefix control-center test

# Build control-center
npm --prefix control-center run build

# Run repository verification
npm run repo:verify
```

## Usage Example

```typescript
import { Pool } from 'pg';
import { 
  ingestIssue, 
  ingestPullRequest, 
  ingestIssueComments, 
  ingestLabels 
} from '@/lib/github-ingestion';

// Initialize database connection
const pool = new Pool({ /* config */ });

// Ingest an issue
const issueResult = await ingestIssue(
  { owner: 'owner', repo: 'repo', issueNumber: 123 },
  pool
);

console.log(issueResult);
// {
//   nodeId: 'uuid-...',
//   naturalKey: 'github:issue:owner/repo/issues/123',
//   isNew: true,
//   source_system: 'github',
//   source_type: 'issue',
//   source_id: 'owner/repo/issues/123',
//   issueNumber: 123
// }

// Ingest a PR
const prResult = await ingestPullRequest(
  { owner: 'owner', repo: 'repo', prNumber: 456 },
  pool
);

// Ingest comments for an issue/PR
const commentsResult = await ingestIssueComments(
  { owner: 'owner', repo: 'repo', issueNumber: 123 },
  pool
);

console.log(commentsResult);
// {
//   commentNodes: [{ nodeId, naturalKey, isNew, ... }, ...],
//   parentNodeId: 'uuid-...',
//   edgeIds: ['edge-uuid-1', 'edge-uuid-2', ...]
// }

// Fetch repository labels
const labelsResult = await ingestLabels(
  { owner: 'owner', repo: 'repo' },
  pool
);
```

## Idempotency Demonstration

```typescript
// First run - creates new node
const result1 = await ingestIssue(
  { owner: 'owner', repo: 'repo', issueNumber: 123 },
  pool
);
console.log(result1.isNew); // true

// Second run - returns existing node
const result2 = await ingestIssue(
  { owner: 'owner', repo: 'repo', issueNumber: 123 },
  pool
);
console.log(result2.isNew); // false
console.log(result2.nodeId === result1.nodeId); // true (same node)
```

## Error Handling

All functions throw typed errors that can be caught and handled:

```typescript
import { 
  IssueNotFoundError, 
  PullRequestNotFoundError, 
  GitHubIngestionError,
  RepoAccessDeniedError 
} from '@/lib/github-ingestion';

try {
  await ingestIssue({ owner: 'owner', repo: 'repo', issueNumber: 999 }, pool);
} catch (error) {
  if (error instanceof IssueNotFoundError) {
    console.log('Issue not found:', error.details);
  } else if (error instanceof RepoAccessDeniedError) {
    console.log('Repo access denied by I711 policy');
  } else if (error instanceof GitHubIngestionError) {
    console.log('GitHub API error:', error.code, error.message);
  }
}
```

## Non-Negotiables Compliance

✅ **GitHub App server-to-server auth only**: Uses `createAuthenticatedClient()` exclusively

✅ **I711 Repo Access Policy enforcement**: Every GitHub call goes through policy check

✅ **Idempotent ingestion**: Upsert semantics via natural keys; safe to re-run

✅ **Deterministic node IDs**: Stable `source_id` generation based on repo + type + number

✅ **Evidence-friendly**: Source references with API endpoints, etags, timestamps, full payloads

✅ **Server-side only**: No client-side code, no API routes

## Integration Points

This implementation integrates with:
- **I721 (E72.1)** - Timeline/Linkage Model: Uses TimelineDAO for node/edge/source creation
- **I711 (E71.1)** - Repo Access Policy: Uses `createAuthenticatedClient()` for all GitHub calls
- **GitHub App Auth** - Uses existing `getGitHubInstallationToken()` infrastructure

## Next Steps (Out of Scope for I722)

The following items are for future work:
- **I723**: Webhook-based ingestion (GitHub events → timeline nodes on push)
- **I724**: Scheduled batch ingestion (periodic sync of issues/PRs)
- **API routes**: Server-side API endpoints for triggering ingestion
- **LABEL node type**: Database migration to add LABEL to NODE_TYPES (if needed)
- **Timeline events**: Ingest issue timeline events (label_added, closed, reopened, etc.)

## Summary

Successfully implemented GitHub ingestion (I722/E72.2) with:
- Four idempotent ingestion functions (issues, PRs, comments, labels)
- GitHub App server-to-server auth with I711 policy enforcement
- Deterministic node IDs via natural keys
- Evidence-friendly source references with etags and timestamps
- Comprehensive unit tests (10/10 passing)
- Build and verification passing
- Zero security vulnerabilities (CodeQL clean)

The ingestion functions are now ready for use in:
- Server-side batch ingestion scripts
- GitHub webhook handlers
- Scheduled sync jobs
- Manual data imports
