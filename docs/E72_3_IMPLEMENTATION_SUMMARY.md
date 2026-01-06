# E72.3 AFU-9 Ingestion Implementation Summary

**Issue**: I723 (E72.3) - AFU-9 Ingestion (Runs/Verdicts/Deploy Events/Test Runs) → normalized + idempotent  
**Status**: ✅ Complete  
**Date**: 2025-12-31

## Overview

Implemented server-side AFU-9 ingestion functions that fetch internal artifacts (Runs, Deploys, Verdicts, Verification Reports) from AFU-9 database tables and store them in the Timeline/Linkage Model (I721) with idempotent upsert semantics.

## Implementation Details

### 1. Core Ingestion Functions

**File**: `control-center/src/lib/afu9-ingestion/index.ts`

Implemented four core functions:

#### `ingestRun({runId}, pool)`
- Fetches run data from `runs` table
- Fetches associated steps from `run_steps` table
- Fetches associated artifacts from `run_artifacts` table
- Creates/updates RUN node with run metadata
- Creates ARTIFACT nodes for each step and artifact
- Creates RUN_HAS_ARTIFACT edges linking artifacts to run
- Stores source references with DB table IDs and SHA-256 hashes
- Returns `{ nodeId, naturalKey, isNew, runId, stepNodeIds, artifactNodeIds, edgeIds }`

#### `ingestDeploy({deployId}, pool)`
- Fetches deploy event data from `deploy_events` table
- Creates/updates DEPLOY node with deploy metadata
- Stores source reference with DB table ID and SHA-256 hash
- Returns `{ nodeId, naturalKey, isNew, deployId }`

#### `ingestVerdict({verdictId}, pool)`
- Fetches verdict data from `verdicts` table with LEFT JOIN to `policy_snapshots`
- Creates/updates VERDICT node with verdict metadata and lawbookVersion
- Propagates `lawbook_version` from policy snapshot into node
- Stores source reference with DB table ID and SHA-256 hash
- Returns `{ nodeId, naturalKey, isNew, verdictId, lawbookVersion }`

#### `ingestVerification({reportId}, pool)`
- Fetches verification report from `deploy_status_snapshots` table
- Creates/updates ARTIFACT node with verification report metadata
- Stores source reference with DB table ID and SHA-256 hash
- Returns `{ nodeId, naturalKey, isNew, reportId }`

### 2. Type Definitions and Schemas

**File**: `control-center/src/lib/afu9-ingestion/types.ts`

Defined Zod schemas for input validation:
- `IngestRunParamsSchema` - validates {runId}
- `IngestDeployParamsSchema` - validates {deployId}
- `IngestVerdictParamsSchema` - validates {verdictId}
- `IngestVerificationParamsSchema` - validates {reportId}

Custom error classes:
- `AFU9IngestionError` - base class with code and details
- `RunNotFoundError` - thrown when run doesn't exist
- `DeployNotFoundError` - thrown when deploy doesn't exist
- `VerdictNotFoundError` - thrown when verdict doesn't exist
- `VerificationNotFoundError` - thrown when verification report doesn't exist

Result types:
- `IngestionResult` - base interface with common fields
- `IngestRunResult` - run-specific result with stepNodeIds, artifactNodeIds, edgeIds
- `IngestDeployResult` - deploy-specific result
- `IngestVerdictResult` - verdict-specific result with lawbookVersion
- `IngestVerificationResult` - verification-specific result

### 3. Unit Tests

**File**: `control-center/__tests__/lib/afu9-ingestion.test.ts`

Comprehensive test suite with 10 passing tests:

#### Run Ingestion Tests
- ✅ Creates new RUN node with steps and artifacts
- ✅ Is idempotent - returns existing node on re-run
- ✅ Throws RunNotFoundError when run doesn't exist
- ✅ Generates stable source_id for same run

#### Deploy Ingestion Tests
- ✅ Creates new DEPLOY node with metadata
- ✅ Throws DeployNotFoundError when deploy doesn't exist

#### Verdict Ingestion Tests
- ✅ Creates new VERDICT node with lawbookVersion
- ✅ Throws VerdictNotFoundError when verdict doesn't exist

#### Verification Ingestion Tests
- ✅ Creates new ARTIFACT node for verification report
- ✅ Throws VerificationNotFoundError when report doesn't exist

## Acceptance Criteria ✅

All acceptance criteria met:

1. ✅ **Determinism**:
   - Stable source_id format: `run:{runId}`, `deploy:{deployId}`, `verdict:{verdictId}`, `verification:{reportId}`
   - Stable node/edge mapping via natural keys
   - Consistent timestamps within each ingestion operation
   - Deterministic ordering from database queries (ORDER BY)

2. ✅ **Idempotency**:
   - Uses natural keys (source_system, source_type, source_id)
   - `upsertNode()` updates existing nodes on conflict
   - Safe to re-run without creating duplicates
   - Returns `isNew` flag to indicate if node existed
   - Edges created with ON CONFLICT DO NOTHING

3. ✅ **Evidence-first**:
   - Stores source references in `timeline_sources` table
   - References back to AFU-9 DB tables (runs, deploy_events, verdicts, deploy_status_snapshots)
   - SHA-256 hashes computed via `computeSha256(JSON.stringify(row))`
   - Timestamped fetches via `fetchedAt` for audit trail
   - Full payload preserved in `payload_json` for audit

4. ✅ **Lawbook transparency**:
   - Propagates `lawbookVersion` from `policy_snapshots.version` into VERDICT nodes
   - Stored in `timeline_nodes.lawbook_version` column
   - Nullable for non-verdict nodes
   - Fetched via LEFT JOIN in verdict query

5. ✅ **No trial-and-error**:
   - Ingestion only reads from AFU-9 DB tables
   - No mutations to original run/deploy/verdict records
   - All writes go to timeline_* tables
   - Read-only operations on source tables

## Design Decisions

### Source ID Generation

**Format**: `{type}:{id}`

Examples:
- Runs: `run:test-run-123`
- Deploys: `deploy:550e8400-e29b-41d4-a716-446655440000`
- Verdicts: `verdict:550e8400-e29b-41d4-a716-446655440001`
- Verification: `verification:550e8400-e29b-41d4-a716-446655440004`
- Run Steps: `run_step:step-uuid`
- Run Artifacts: `run_artifact:artifact-uuid`

**Rationale**:
- Globally unique across all AFU-9 objects
- Human-readable and debuggable
- Simple prefix-based namespacing
- Stable across API calls (deterministic)

### Evidence Hashing Strategy

**Decision**: Use `computeSha256(JSON.stringify(row))` for all source references

**Rationale**:
- Consistent hash generation across all ingestion types
- Verifiable evidence (can re-compute hash from DB row)
- Detects any changes to source records
- No dependency on artifact-specific SHA-256 fields

### Timestamp Consistency

**Decision**: Generate `fetchedAt` timestamp once per ingestion operation

**Rationale**:
- All source references within a single ingestion share the same timestamp
- Easier audit trail (all evidence from same operation has same timestamp)
- Deterministic ordering of evidence records
- Follows code review feedback

## Files Changed

### New Files (3)
1. `control-center/src/lib/afu9-ingestion/index.ts` - Core ingestion functions (563 LOC)
2. `control-center/src/lib/afu9-ingestion/types.ts` - Type definitions and schemas (166 LOC)
3. `control-center/__tests__/lib/afu9-ingestion.test.ts` - Unit tests (497 LOC)

## Verification Results

```bash
# Test Results
✅ 10/10 tests passing
   - Run ingestion: 4 tests
   - Deploy ingestion: 2 tests
   - Verdict ingestion: 2 tests
   - Verification ingestion: 2 tests
   - Coverage: idempotency, determinism, errors, edge creation

# Repository Verification
✅ All checks passed (8/8)
   - Route-map check: PASSED
   - Forbidden paths: PASSED
   - Tracked artifacts: PASSED
   - Large files: PASSED
   - Secret files: PASSED
   - Empty folders: PASSED
   ⚠️  50 unreferenced routes (warning only, not blocking)

# Security Scan
✅ CodeQL: 0 vulnerabilities
   - No security alerts
   - No code quality issues
```

## PowerShell Commands for Local Verification

```powershell
# Run AFU-9 ingestion tests
npm --prefix control-center test -- __tests__/lib/afu9-ingestion.test.ts

# Run all tests
npm --prefix control-center test

# Run repository verification
npm run repo:verify
```

## Usage Example

```typescript
import { Pool } from 'pg';
import { 
  ingestRun, 
  ingestDeploy, 
  ingestVerdict, 
  ingestVerification 
} from '@/lib/afu9-ingestion';

// Initialize database connection
const pool = new Pool({ /* config */ });

// Ingest a run
const runResult = await ingestRun(
  { runId: 'test-run-123' },
  pool
);

console.log(runResult);
// {
//   nodeId: 'uuid-...',
//   naturalKey: 'afu9:run:run:test-run-123',
//   isNew: true,
//   source_system: 'afu9',
//   source_type: 'run',
//   source_id: 'run:test-run-123',
//   runId: 'test-run-123',
//   stepNodeIds: ['uuid-step-1', 'uuid-step-2'],
//   artifactNodeIds: ['uuid-artifact-1'],
//   edgeIds: ['edge-uuid-1', 'edge-uuid-2', 'edge-uuid-3']
// }

// Ingest a deploy
const deployResult = await ingestDeploy(
  { deployId: '550e8400-e29b-41d4-a716-446655440000' },
  pool
);

// Ingest a verdict
const verdictResult = await ingestVerdict(
  { verdictId: '550e8400-e29b-41d4-a716-446655440001' },
  pool
);

console.log(verdictResult);
// {
//   nodeId: 'uuid-...',
//   naturalKey: 'afu9:verdict:verdict:550e8400-...',
//   isNew: true,
//   source_system: 'afu9',
//   source_type: 'verdict',
//   source_id: 'verdict:550e8400-...',
//   verdictId: '550e8400-e29b-41d4-a716-446655440001',
//   lawbookVersion: 'v1.0.0'
// }

// Ingest a verification report
const verificationResult = await ingestVerification(
  { reportId: '550e8400-e29b-41d4-a716-446655440004' },
  pool
);
```

## Idempotency Demonstration

```typescript
// First run - creates new node
const result1 = await ingestRun(
  { runId: 'test-run-123' },
  pool
);
console.log(result1.isNew); // true

// Second run - returns existing node
const result2 = await ingestRun(
  { runId: 'test-run-123' },
  pool
);
console.log(result2.isNew); // false
console.log(result2.nodeId === result1.nodeId); // true (same node)
```

## Error Handling

All functions throw typed errors that can be caught and handled:

```typescript
import { 
  RunNotFoundError, 
  DeployNotFoundError, 
  VerdictNotFoundError,
  VerificationNotFoundError,
  AFU9IngestionError 
} from '@/lib/afu9-ingestion';

try {
  await ingestRun({ runId: 'nonexistent-run' }, pool);
} catch (error) {
  if (error instanceof RunNotFoundError) {
    console.log('Run not found:', error.details);
  } else if (error instanceof AFU9IngestionError) {
    console.log('Ingestion error:', error.code, error.message);
  }
}
```

## Non-Negotiables Compliance

✅ **Determinism**: Stable node/edge mapping; stable timestamps; stable ordering

✅ **Idempotency**: Ingestion is upsert; unique constraints prevent duplicates

✅ **Evidence-first**: Store source refs back to AFU-9 DB rows/artifact IDs + hashes

✅ **Lawbook transparency**: Propagate lawbookVersion into VERDICT nodes/events

✅ **No trial-and-error**: Ingestion does not mutate original run/deploy records

## Integration Points

This implementation integrates with:
- **I721 (E72.1)** - Timeline/Linkage Model: Uses TimelineDAO for node/edge/source creation
- **Migration 026** - AFU-9 Runs Ledger: Reads from runs, run_steps, run_artifacts tables
- **Migration 013** - Deploy Events: Reads from deploy_events table
- **Migration 004** - Verdict Engine: Reads from verdicts and policy_snapshots tables
- **Migration 027** - Deploy Status Snapshots: Reads from deploy_status_snapshots table

## Next Steps (Out of Scope for I723)

The following items are for future work:
- **I724**: Query API "Chain for Issue" + minimal UI node view
- **Webhook-based ingestion**: Auto-ingest on run/deploy/verdict creation
- **Scheduled batch ingestion**: Periodic sync of runs/deploys/verdicts
- **API routes**: Server-side API endpoints for triggering ingestion
- **Timeline events**: Ingest run state transitions (QUEUED → RUNNING → SUCCEEDED/FAILED)
- **Edge creation**: Link RUN nodes to ISSUE nodes, DEPLOY nodes to RUN nodes, VERDICT nodes to DEPLOY nodes

## Summary

Successfully implemented AFU-9 ingestion (I723/E72.3) with:
- Four idempotent ingestion functions (runs, deploys, verdicts, verification reports)
- Deterministic node IDs via natural keys
- Evidence-first source references with SHA-256 hashes and timestamps
- Lawbook transparency via lawbookVersion propagation
- Comprehensive unit tests (10/10 passing)
- Repository and security verification passing
- Zero security vulnerabilities (CodeQL clean)

The ingestion functions are now ready for use in:
- Server-side batch ingestion scripts
- Webhook handlers for auto-ingestion
- Scheduled sync jobs
- Manual data imports
- Timeline/Linkage query API (I724)
