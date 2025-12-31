# E72.1 Timeline/Linkage Model Implementation Summary

**Issue**: I721 (E72.1) - Timeline/Linkage Model (Issue/PR/Run/Deploy/Verdict/Artifact + Links)  
**Status**: ✅ Complete  
**Date**: 2025-12-31

## Overview

Implemented the canonical, normalized Timeline/Linkage Model to connect Issue ↔ PR ↔ Run ↔ Deploy ↔ Verdict ↔ Artifact with deterministic querying and idempotent ingestion support.

## Implementation Details

### 1. Database Schema (Migration 029)

**File**: `database/migrations/029_timeline_linkage_model.sql`

Created four core tables:

#### `timeline_nodes`
- **Purpose**: Generic node table for tracking all entities (Issue, PR, Run, Deploy, Verdict, Artifact, Comment)
- **Natural Key**: Composite of (source_system, source_type, source_id)
- **Unique Constraint**: `UNIQUE (source_system, source_type, source_id)` - enables idempotent upserts
- **Columns**:
  - `id` (UUID, PK)
  - `source_system` (TEXT, CHECK: 'github' | 'afu9')
  - `source_type` (TEXT) - e.g., 'issue', 'pull_request', 'run', 'deploy_event'
  - `source_id` (TEXT) - stable external ID
  - `node_type` (TEXT, CHECK: ISSUE | PR | RUN | DEPLOY | VERDICT | ARTIFACT | COMMENT)
  - `title`, `url`, `payload_json`, `lawbook_version`
  - `created_at`, `updated_at`
- **Indexes**: node_type, source_system, created_at, updated_at

#### `timeline_edges`
- **Purpose**: Links between nodes with relationship types
- **Unique Constraint**: `UNIQUE (from_node_id, to_node_id, edge_type)` - prevents duplicate edges
- **Columns**:
  - `id` (UUID, PK)
  - `from_node_id` (UUID, FK to timeline_nodes)
  - `to_node_id` (UUID, FK to timeline_nodes)
  - `edge_type` (TEXT, CHECK: ISSUE_HAS_PR | PR_HAS_RUN | RUN_HAS_DEPLOY | etc.)
  - `payload_json`
  - `created_at`
- **Indexes**: from_node_id, to_node_id, edge_type, created_at

#### `timeline_events`
- **Purpose**: Ordered events attached to nodes for timeline tracking
- **Deterministic Ordering**: `ORDER BY occurred_at DESC, id DESC`
- **Columns**:
  - `id` (UUID, PK)
  - `node_id` (UUID, FK to timeline_nodes)
  - `event_type` (TEXT)
  - `occurred_at` (TIMESTAMPTZ) - event occurrence time
  - `payload_json`, `source_ref`
  - `created_at` (insertion time)
- **Indexes**: (node_id, occurred_at, id), occurred_at, event_type

#### `timeline_sources`
- **Purpose**: Evidence/source references with hashes for verification
- **Columns**:
  - `id` (UUID, PK)
  - `node_id` (UUID, FK to timeline_nodes)
  - `source_kind` (TEXT, CHECK: github_api | github_web | afu9_db | artifact)
  - `ref_json` (JSONB) - contains url/path/sha/snippetHash/runId/deployId
  - `sha256`, `content_hash` - for evidence verification
  - `created_at`
- **Indexes**: node_id, source_kind, sha256

### 2. TypeScript Contracts

**File**: `control-center/src/lib/contracts/timeline.ts`

#### Zod Schemas
- `TimelineNodeInputSchema` - for creating/upserting nodes
- `TimelineNodeSchema` - for DB row validation
- `TimelineEdgeInputSchema` - for creating edges
- `TimelineEdgeSchema` - for edge row validation
- `TimelineEventInputSchema` - for creating events
- `TimelineEventSchema` - for event row validation
- `TimelineSourceInputSchema` - for creating sources
- `TimelineSourceSchema` - for source row validation

#### Type Exports
```typescript
export type TimelineNodeInput = z.infer<typeof TimelineNodeInputSchema>;
export type TimelineNode = z.infer<typeof TimelineNodeSchema>;
export type TimelineEdgeInput = z.infer<typeof TimelineEdgeInputSchema>;
export type TimelineEdge = z.infer<typeof TimelineEdgeSchema>;
// ... etc
```

#### Helper Functions
- `generateNaturalKey(source_system, source_type, source_id)` - creates natural key string
- `parseNaturalKey(naturalKey)` - parses natural key into components
- `validateTimelineNodeInput(input)` - validates node input with Zod
- `validateTimelineEdgeInput(input)` - validates edge input with Zod
- `validateTimelineEventInput(input)` - validates event input with Zod

### 3. Data Access Layer (DAO)

**File**: `control-center/src/lib/db/timeline.ts`

Implemented `TimelineDAO` class with the following methods:

#### Node Operations
- `upsertNode(input)` - **Idempotent** node creation/update using natural key
- `getNodeByNaturalKey(source_system, source_type, source_id)` - retrieve by natural key
- `getNodeById(id)` - retrieve by UUID

#### Edge Operations
- `createEdge(input)` - **Idempotent** edge creation (returns existing on conflict)
- `upsertEdge(input)` - **Idempotent** edge creation with payload update
- `getEdgesFromNode(nodeId)` - get outgoing edges
- `getEdgesToNode(nodeId)` - get incoming edges

#### Event Operations
- `createEvent(input)` - create timeline event
- `getEventsForNode(nodeId, limit)` - get events with **deterministic ordering**

#### Source Operations
- `createSource(input)` - create source reference
- `getSourcesForNode(nodeId)` - get all sources for a node

#### Chain/Graph Operations
- `listChainForIssue(issueSourceSystem, issueSourceId)` - retrieve complete chain of nodes and edges connected to an issue using **recursive CTE**

### 4. Unit Tests

**File**: `control-center/__tests__/lib/timeline-dao.test.ts`

Comprehensive test suite with 13 passing tests:

#### Natural Key Uniqueness Tests
- ✅ Creates new node on first insert
- ✅ Updates existing node on conflict (idempotent)
- ✅ Handles natural key uniqueness correctly

#### Node Retrieval Tests
- ✅ Retrieves node by natural key components
- ✅ Returns null for non-existent node

#### Edge Tests
- ✅ Creates new edge
- ✅ Returns existing edge on conflict (idempotent)
- ✅ Updates payload on conflict (upsert)

#### Event Tests
- ✅ Creates event with occurred_at timestamp
- ✅ Returns events in deterministic order (occurred_at DESC, id DESC)

#### Chain Tests
- ✅ Retrieves connected nodes and edges (recursive query)
- ✅ Returns empty for non-existent issue

#### Helper Tests
- ✅ generateNaturalKey creates correct format (system:type:id)

## Acceptance Criteria ✅

All acceptance criteria met:

1. ✅ **DB schema supports**:
   - Multiple links per issue (via edges table)
   - Many-to-many edges (from_node_id, to_node_id)
   - Ordering timeline events deterministically (occurred_at, id)

2. ✅ **Unique constraints make ingestion idempotent**:
   - Nodes: `UNIQUE (source_system, source_type, source_id)`
   - Edges: `UNIQUE (from_node_id, to_node_id, edge_type)`
   - No duplicates on retries

3. ✅ **Basic TS types + Zod validation**:
   - All schemas defined with Zod
   - Type exports available
   - Validation functions provided

4. ✅ **Unit tests**:
   - Natural key uniqueness behavior ✅
   - Deterministic ordering query for events ✅
   - All 13 tests passing

## Files Changed

### New Files (4)
1. `database/migrations/029_timeline_linkage_model.sql` - DB schema migration
2. `control-center/src/lib/contracts/timeline.ts` - TypeScript contracts and Zod schemas
3. `control-center/src/lib/db/timeline.ts` - TimelineDAO data access layer
4. `control-center/__tests__/lib/timeline-dao.test.ts` - Unit tests

### Modified Files (1)
1. `control-center/.gitignore` - Added `.swc/` to ignore build artifacts

## PowerShell Commands for Local Verification

```powershell
# Run timeline-specific tests
npm --prefix control-center test -- __tests__/lib/timeline-dao.test.ts

# Run all tests
npm --prefix control-center test

# Build control-center
npm --prefix control-center run build

# Run repository verification
npm run repo:verify

# Apply migrations (requires DATABASE_URL or DATABASE_* env vars)
npm --prefix control-center run db:migrate
```

## Database Schema Overview

### Tables + Indexes + Constraints

**timeline_nodes** (8 columns, 4 indexes, 2 constraints)
- PK: `id`
- UQ: `(source_system, source_type, source_id)` - Natural key
- CHECK: `source_system IN ('github', 'afu9')`
- CHECK: `node_type IN ('ISSUE', 'PR', 'RUN', 'DEPLOY', 'VERDICT', 'ARTIFACT', 'COMMENT')`
- Indexes: node_type, source_system, created_at, updated_at

**timeline_edges** (6 columns, 4 indexes, 1 unique constraint)
- PK: `id`
- UQ: `(from_node_id, to_node_id, edge_type)` - Prevents duplicate relationships
- FK: `from_node_id → timeline_nodes(id) ON DELETE CASCADE`
- FK: `to_node_id → timeline_nodes(id) ON DELETE CASCADE`
- CHECK: `edge_type IN (9 types)`
- Indexes: from_node_id, to_node_id, edge_type, created_at

**timeline_events** (7 columns, 3 indexes)
- PK: `id`
- FK: `node_id → timeline_nodes(id) ON DELETE CASCADE`
- Indexes: (node_id, occurred_at DESC, id DESC), occurred_at, event_type

**timeline_sources** (7 columns, 3 indexes)
- PK: `id`
- FK: `node_id → timeline_nodes(id) ON DELETE CASCADE`
- CHECK: `source_kind IN ('github_api', 'github_web', 'afu9_db', 'artifact')`
- Indexes: node_id, source_kind, sha256 (partial)

## Non-Negotiables Compliance

✅ **Determinism & Evidence**: Stable IDs (natural keys), timestamps (occurred_at), source references (timeline_sources), hashes (sha256, content_hash)

✅ **Idempotency**: Upsert semantics via unique constraints on nodes and edges

✅ **Transparency**: lawbook_version field included in nodes (nullable)

✅ **Server-side only**: Ingestion endpoints will be server-side (not implemented in this scope)

✅ **Existing AFU-9 DB approach**: Uses Postgres via existing migrations tooling (scripts/db-migrate.sh)

## Next Steps (Out of Scope for I721)

The following items are for I722-I724 (Timeline Ingestion):
- I722: GitHub Event Ingestion (webhook → timeline nodes/edges)
- I723: AFU-9 Run Ingestion (run completion → timeline nodes/edges)
- I724: Deploy Event Ingestion (deploy → timeline nodes/edges)

These will use the TimelineDAO provided by this implementation.

## Verification Results

```bash
# Test Results
✅ 13/13 timeline tests passing

# Build Results
✅ control-center build successful

# Repository Verification
✅ All checks passed (8/8)
⚠️  49 unreferenced routes (warning only, not blocking)
```

## Summary

Successfully implemented the Timeline/Linkage Model (I721/E72.1) with:
- Normalized DB schema with idempotent constraints
- Complete TypeScript contracts with Zod validation
- Full-featured DAO with upsert semantics
- Comprehensive unit tests (100% passing)
- Build and verification passing

The model is now ready to support deterministic querying and idempotent ingestion for Issues, PRs, Runs, Deploys, Verdicts, and Artifacts.
