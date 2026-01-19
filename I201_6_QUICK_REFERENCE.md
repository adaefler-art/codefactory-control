# I201.6 Evidence Link/Refresh - Implementation Quick Reference

## Overview
Implementation of Evidence Link/Refresh functionality for AFU-9 runs. Control stores only a reference to Engine evidence (URL + hash + fetchedAt + version) without duplicating the evidence data.

## Changes Made

### 1. Database Migration
**File:** `database/migrations/082_runs_evidence_ref_i201_6.sql`

Added evidence reference columns to the `runs` table:
- `evidence_url` (TEXT): URL to Engine evidence
- `evidence_hash` (VARCHAR(64)): SHA256 hash for verification
- `evidence_fetched_at` (TIMESTAMPTZ): Timestamp when evidence was fetched
- `evidence_version` (VARCHAR(50)): Evidence format/schema version

Indexes:
- `runs_evidence_hash_idx`: For deduplication lookups
- `runs_evidence_fetched_at_idx`: For fetch tracking

### 2. Contract Updates
**File:** `control-center/src/lib/contracts/afu9Runner.ts`

Added:
- `EvidenceRefSchema`: Zod schema for evidence reference
- `EvidenceRef`: TypeScript type for evidence reference
- Updated `RunResultSchema` to include optional `evidenceRef` field

### 3. DAO Updates
**File:** `control-center/src/lib/db/afu9Runs.ts`

Added:
- `updateEvidenceRef()`: Method to update evidence reference fields
- Updated `reconstructRunResult()`: Includes evidenceRef in RunResult when present

### 4. API Endpoint
**File:** `control-center/app/api/afu9/runs/[runId]/evidence/refresh/route.ts`

New endpoint: `POST /api/afu9/runs/:runId/evidence/refresh`

Request body:
```json
{
  "url": "s3://bucket/evidence/run-123.json",
  "evidenceHash": "1234567890abcdef...",
  "version": "1.0"  // optional
}
```

Response:
```json
{
  "runId": "run-123",
  "evidenceRef": {
    "url": "s3://bucket/evidence/run-123.json",
    "evidenceHash": "1234567890abcdef...",
    "fetchedAt": "2024-01-01T12:00:00.000Z",
    "version": "1.0"
  }
}
```

Side effects:
- Updates run evidence reference (deterministic, bounded)
- Logs `EVIDENCE_LINKED` timeline event if run has `issue_id`

### 5. API Routes Registry
**File:** `control-center/src/lib/api-routes.ts`

Added AFU-9 routes section:
```typescript
afu9: {
  runs: {
    start: (issueId: string) => `/api/afu9/issues/${issueId}/runs/start`,
    evidenceRefresh: (runId: string) => `/api/afu9/runs/${runId}/evidence/refresh`,
  },
}
```

### 6. Tests
**Files:**
- `control-center/__tests__/api/afu9-evidence-refresh.test.ts`: API endpoint tests
- `control-center/__tests__/integration/evidence-refresh-flow.test.ts`: Integration flow tests

## Usage Example

```typescript
import { API_ROUTES } from '@/lib/api-routes';

// Refresh evidence for a run
const response = await fetch(API_ROUTES.afu9.runs.evidenceRefresh('run-123'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 's3://bucket/evidence/run-123.json',
    evidenceHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    version: '1.0',
  }),
});

const { runId, evidenceRef } = await response.json();

// Get run details (includes evidenceRef)
const runResponse = await fetch(API_ROUTES.runs.get('run-123'));
const runDetails = await runResponse.json();
console.log(runDetails.evidenceRef); // { url, evidenceHash, fetchedAt, version }
```

## Acceptance Criteria Met

✅ Run Details show EvidenceRef (hash + fetchedAt)
- GET /api/runs/:runId includes evidenceRef when present

✅ EvidenceRef update is deterministic and bounded
- Single database UPDATE with atomic timestamp
- Idempotent (can be called multiple times)
- No data duplication (only reference stored)

✅ Optional timeline event
- EVIDENCE_LINKED event logged when run has issue_id

## Migration Command

```bash
# Run database migration
npm --prefix control-center run db:migrate
```

## Verification Commands

```powershell
# Verify implementation
npm run repo:verify

# Build control-center
npm --prefix control-center run build

# Run tests
npm --prefix control-center test
```
