# Checks Mirror Contract (E9.3-CTRL-02)

## Purpose

The Checks Mirror provides a **deterministic, stable snapshot** of GitHub PR/commit check status for S4 (Review Gate) and S5 (Merge Gate) decisions.

## Problem Statement

GitHub checks are:
- **Asynchronous**: Status changes over time
- **Non-deterministic**: Live queries return different results
- **Volatile**: Not suitable for reproducible gate decisions

Without a snapshot:
- Review decisions are not reproducible
- Merge gates are not fail-closed
- Audit/evidence is not reliable

## Solution

The Checks Mirror captures and persists check status at specific points in time, providing:
1. **Stable data** for gate decisions (no live queries during gates)
2. **Idempotent snapshots** (same ref + checks = same hash)
3. **Fail-closed semantics** (missing/pending checks block gates)
4. **Evidence trail** (all snapshots are referenceable)

## Data Model

### Checks Snapshot

```typescript
interface ChecksSnapshotRow {
  id: string;                    // UUID
  run_id: string | null;         // Optional loop run ID
  issue_id: string | null;       // Optional AFU-9 issue ID
  repo_owner: string;            // Repository owner
  repo_name: string;             // Repository name
  ref: string;                   // Commit SHA or PR ref
  captured_at: string;           // Snapshot timestamp
  checks: CheckEntry[];          // Array of check entries
  total_checks: number;          // Total number of checks
  failed_checks: number;         // Number of failed checks
  pending_checks: number;        // Number of pending checks
  snapshot_hash: string;         // SHA-256 hash (idempotency)
  request_id: string | null;     // Optional request ID
  created_at: string;
  updated_at: string;
}
```

### Check Entry

```typescript
interface CheckEntry {
  name: string;                  // Check name
  status: CheckStatus;           // queued | in_progress | completed
  conclusion: CheckConclusion | null;  // success | failure | neutral | ...
  details_url?: string;          // GitHub URL to check details
  run_id?: number;               // GitHub workflow run ID
  job_id?: number;               // GitHub job ID
  step_name?: string;            // GitHub step name
}
```

### Check Status

```typescript
type CheckStatus = 'queued' | 'in_progress' | 'completed';
```

### Check Conclusion

```typescript
type CheckConclusion = 
  | 'success' 
  | 'failure' 
  | 'neutral' 
  | 'cancelled' 
  | 'skipped' 
  | 'timed_out' 
  | 'action_required';
```

## API Operations

### 1. Capture Checks Snapshot

Fetches current check status from GitHub and persists it.

```typescript
async function captureChecksSnapshot(
  pool: Pool,
  input: CaptureChecksSnapshotInput
): Promise<CaptureChecksSnapshotResult>
```

**Input:**
```typescript
interface CaptureChecksSnapshotInput {
  repo_owner: string;
  repo_name: string;
  ref: string;              // Commit SHA or PR ref
  run_id?: string;          // Optional loop run ID
  issue_id?: string;        // Optional AFU-9 issue ID
  request_id?: string;      // Optional request ID
}
```

**Output:**
```typescript
interface CaptureChecksSnapshotResult {
  success: boolean;
  snapshot?: ChecksSnapshotRow;
  error?: string;
  is_existing?: boolean;    // True if snapshot already existed
}
```

**Behavior:**
- Fetches checks from GitHub using Checks API
- Calculates snapshot hash from (repo_owner + repo_name + ref + checks)
- If snapshot with same hash exists, returns existing (idempotent)
- Otherwise, creates new snapshot
- **Fail-closed**: If GitHub fetch fails, operation fails (no silent fallback)

### 2. Get Latest Snapshot

Retrieves the most recent snapshot for a ref.

```typescript
async function getLatestSnapshot(
  pool: Pool,
  repo_owner: string,
  repo_name: string,
  ref: string
): Promise<OperationResult<ChecksSnapshotRow | null>>
```

**Use Case:** S4/S5 gates retrieve snapshot created at gate entry.

### 3. Get Snapshot by ID

Retrieves a specific snapshot by UUID.

```typescript
async function getSnapshotById(
  pool: Pool,
  snapshot_id: string
): Promise<OperationResult<ChecksSnapshotRow | null>>
```

**Use Case:** Evidence references, audit trail.

### 4. Capture Snapshot for PR

Convenience function that resolves PR number to head SHA and captures snapshot.

```typescript
async function captureSnapshotForPR(
  pool: Pool,
  owner: string,
  repo: string,
  pr_number: number,
  options?: {
    run_id?: string;
    issue_id?: string;
    request_id?: string;
  }
): Promise<CaptureChecksSnapshotResult>
```

## Gate Decision Logic

### Fail-Closed Semantics

Gates BLOCK if:
1. **Any checks are pending** (status != 'completed')
2. **Any checks failed** (conclusion != 'success' | 'neutral' | 'skipped')
3. **No checks found** (total_checks == 0)

Gates PROCEED only if:
- All checks completed
- All checks have success/neutral/skipped conclusion
- At least one check present

### Decision Helper

```typescript
function getGateDecision(snapshot: ChecksSnapshotRow): {
  decision: 'PROCEED' | 'BLOCK';
  reason: string;
}
```

**Examples:**

```typescript
// PROCEED: All checks passed
{
  total_checks: 5,
  failed_checks: 0,
  pending_checks: 0
}
// Decision: PROCEED, Reason: "All 5 checks passed"

// BLOCK: Pending checks
{
  total_checks: 5,
  failed_checks: 0,
  pending_checks: 2
}
// Decision: BLOCK, Reason: "2 check(s) still pending"

// BLOCK: Failed checks
{
  total_checks: 5,
  failed_checks: 1,
  pending_checks: 0
}
// Decision: BLOCK, Reason: "1 check(s) failed"

// BLOCK: No checks (fail-closed)
{
  total_checks: 0,
  failed_checks: 0,
  pending_checks: 0
}
// Decision: BLOCK, Reason: "No checks found (fail-closed)"
```

## Evidence Integration

### Issue Evidence Type

A new evidence type is added to `IssueEvidenceType`:

```typescript
enum IssueEvidenceType {
  // ... existing types ...
  CHECKS_SNAPSHOT_RECEIPT = 'CHECKS_SNAPSHOT_RECEIPT',
}
```

### Evidence Data Structure

```typescript
interface ChecksSnapshotReceiptData {
  snapshot_id: string;          // UUID of snapshot
  repo_owner: string;
  repo_name: string;
  ref: string;
  snapshot_hash: string;        // Idempotency hash
  total_checks: number;
  failed_checks: number;
  pending_checks: number;
  captured_at: string;
  gate_step?: 'S4' | 'S5';      // Which gate captured this
}
```

### Recording Evidence

When a snapshot is captured at a gate:

```typescript
await recordEvidence(pool, {
  issue_id: 'issue-uuid',
  evidence_type: IssueEvidenceType.CHECKS_SNAPSHOT_RECEIPT,
  evidence_data: {
    snapshot_id: snapshot.id,
    repo_owner: snapshot.repo_owner,
    repo_name: snapshot.repo_name,
    ref: snapshot.ref,
    snapshot_hash: snapshot.snapshot_hash,
    total_checks: snapshot.total_checks,
    failed_checks: snapshot.failed_checks,
    pending_checks: snapshot.pending_checks,
    captured_at: snapshot.captured_at,
    gate_step: 'S4', // or 'S5'
  },
  request_id: 'request-id',
});
```

## Usage in S4/S5 Gates

### S4 (Review Gate) Entry

When entering S4:

1. **Capture snapshot**:
   ```typescript
   const result = await captureChecksSnapshot(pool, {
     repo_owner: 'owner',
     repo_name: 'repo',
     ref: prHeadSha,
     run_id: loopRunId,
     issue_id: issueId,
     request_id: requestId,
   });
   ```

2. **Record evidence**:
   ```typescript
   await recordEvidence(pool, {
     issue_id,
     evidence_type: IssueEvidenceType.CHECKS_SNAPSHOT_RECEIPT,
     evidence_data: { /* snapshot receipt data */ },
     request_id,
   });
   ```

3. **Store snapshot ID** in S4 execution context

### S4 Gate Decision

Use stored snapshot (no live queries):

```typescript
const snapshot = await getSnapshotById(pool, snapshotId);
const decision = getGateDecision(snapshot);

if (decision.decision === 'BLOCK') {
  // Block S4 → S5 transition
  // Record HOLD or wait for checks to complete
  logger.warn('S4 gate blocked', { reason: decision.reason });
  return { canProceed: false, reason: decision.reason };
}

// Proceed to S5
return { canProceed: true };
```

### S5 (Merge Gate) Entry

Optionally capture fresh snapshot before merge:

```typescript
const result = await captureChecksSnapshot(pool, {
  repo_owner: 'owner',
  repo_name: 'repo',
  ref: prHeadSha,
  run_id: loopRunId,
  issue_id: issueId,
  request_id: requestId,
});

const decision = getGateDecision(result.snapshot);

if (decision.decision === 'BLOCK') {
  // Block merge
  return { merged: false, reason: decision.reason };
}

// Proceed with merge
```

## Idempotency Guarantees

### Snapshot Hash

The snapshot hash is calculated as:

```
SHA-256(repo_owner + repo_name + ref + normalized_checks)
```

Where `normalized_checks` is:
- Sorted by: name → status → conclusion
- Only includes: name, status, conclusion (no URLs or IDs)

### Idempotent Behavior

Calling `captureChecksSnapshot` multiple times with the same ref and checks:
- Returns the **same snapshot** (by hash)
- Does **not create duplicates**
- Ensures **reproducible gate decisions**

## Error Handling

### Fail-Closed Principle

All errors result in **blocking gate decisions**:

1. **GitHub API failure**: 
   - Cannot fetch checks → error
   - Gate decision: BLOCK

2. **Database failure**:
   - Cannot persist snapshot → error
   - Gate decision: BLOCK

3. **Missing checks**:
   - Zero checks found → snapshot created with total_checks=0
   - Gate decision: BLOCK (fail-closed)

### Error Classification

- **Transient errors** (network, rate limit):
  - Retry with exponential backoff (handled by retry-policy)
  - After retries exhausted → fail (BLOCK)

- **Hard errors** (auth, permissions):
  - No retry
  - Immediate fail (BLOCK)

## Database Schema

### Table: `checks_snapshots`

```sql
CREATE TABLE checks_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id VARCHAR(255) NULL,
  issue_id UUID NULL,
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  ref VARCHAR(500) NOT NULL,
  captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  pending_checks INTEGER NOT NULL DEFAULT 0,
  snapshot_hash VARCHAR(64) NOT NULL,
  request_id VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### Indexes

```sql
-- Query by run_id
CREATE INDEX idx_checks_snapshots_run_id 
  ON checks_snapshots(run_id) WHERE run_id IS NOT NULL;

-- Query by issue_id
CREATE INDEX idx_checks_snapshots_issue_id 
  ON checks_snapshots(issue_id) WHERE issue_id IS NOT NULL;

-- Query by ref
CREATE INDEX idx_checks_snapshots_ref 
  ON checks_snapshots(repo_owner, repo_name, ref);

-- Idempotency lookup
CREATE INDEX idx_checks_snapshots_snapshot_hash 
  ON checks_snapshots(snapshot_hash);

-- Latest snapshot query
CREATE INDEX idx_checks_snapshots_ref_captured 
  ON checks_snapshots(repo_owner, repo_name, ref, captured_at DESC);
```

## Testing

### Unit Tests

- Hash calculation (consistency, normalization)
- Summary calculation (total, failed, pending)
- Input validation
- Gate decision logic (fail-closed scenarios)

### Integration Tests

- Snapshot creation (idempotent behavior)
- Database operations (CRUD)
- GitHub API integration
- Evidence recording

## Migration Path

### Migration: 088_checks_snapshots.sql

Creates `checks_snapshots` table with:
- Schema definition
- Indexes
- Constraints
- Comments

### Deployment Steps

1. Run migration: `npm run db:migrate`
2. Deploy code with new contracts
3. Test snapshot capture in staging
4. Verify idempotency
5. Deploy to production

## References

- **Epic**: E9.3 (Loop Implementation: S4/S5)
- **Issue**: E9.3-CTRL-02
- **Database Migration**: 088_checks_snapshots.sql
- **Contracts**: `control-center/src/lib/contracts/checksSnapshot.ts`
- **DB Layer**: `control-center/src/lib/db/checksSnapshots.ts`
- **Service**: `control-center/src/lib/github/checks-mirror-service.ts`
- **Evidence**: `control-center/src/lib/contracts/issueEvidence.ts`
