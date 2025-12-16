# Policy Snapshotting per Run – Implementation Guide

**Issue**: Policy Snapshotting per Run – Immutable Auditability  
**Priority**: P0  
**Status**: Implemented ✅

## Overview

This document describes the implementation of automatic policy snapshotting for every workflow run in AFU-9, ensuring complete governance traceability through immutable policy snapshots.

## Goal

Governance traceability through immutable policy snapshots that are automatically created for each workflow execution run, with full back-reference from verdicts to the policies used.

## Architecture

### Components

1. **Policy Manager** (`control-center/src/lib/policy-manager.ts`)
   - Creates policy snapshots for each execution
   - Manages policy versions
   - Provides audit trail capabilities

2. **Workflow Engine Integration** (`control-center/src/lib/workflow-engine.ts`)
   - Automatically creates policy snapshot at execution start
   - Links snapshot to workflow execution
   - Handles failures gracefully

3. **Database Schema** (`database/migrations/005_add_policy_snapshot_to_executions.sql`)
   - `workflow_executions.policy_snapshot_id` column
   - Foreign key to `policy_snapshots` table
   - Indexes for efficient lookups

4. **Factory Status API** (`control-center/src/lib/factory-status.ts`)
   - Exposes policy snapshot information
   - Includes policy version in execution details

### Data Flow

```
Workflow Execution Start
    ↓
1. Create Execution Record (workflow_executions)
    ↓
2. Create Policy Snapshot (policy_snapshots)
    ↓
3. Link Snapshot to Execution (update workflow_executions.policy_snapshot_id)
    ↓
4. Execute Workflow Steps
    ↓
[On Failure]
    ↓
5. Generate Verdict (references policy_snapshot_id)
    ↓
6. Store Verdict (verdicts table)
```

## Database Schema

### Workflow Executions Table Update

```sql
ALTER TABLE workflow_executions
ADD COLUMN policy_snapshot_id UUID REFERENCES policy_snapshots(id) ON DELETE SET NULL;

CREATE INDEX idx_executions_policy_snapshot_id ON workflow_executions(policy_snapshot_id);
```

### Relationships

```
workflow_executions
    ├─> policy_snapshots (1:1 - each execution has one snapshot)
    └─> verdicts (1:N - each execution can have multiple verdicts)
            └─> policy_snapshots (N:1 - all verdicts reference the snapshot)
```

## API Changes

### Factory Status API Response

The Factory Status API now includes policy snapshot information in execution details:

```typescript
interface FactoryRunSummary {
  id: string;
  workflowId: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  error: string | null;
  // New fields:
  policySnapshotId: string | null;
  policyVersion: string | null;
}
```

### Example Response

```json
{
  "api": {
    "version": "1.1.0"
  },
  "timestamp": "2025-01-15T10:00:00Z",
  "runs": {
    "recent": [
      {
        "id": "exec-123",
        "workflowId": "wf-456",
        "status": "completed",
        "startedAt": "2025-01-15T09:50:00Z",
        "completedAt": "2025-01-15T09:55:00Z",
        "durationMs": 300000,
        "triggeredBy": "github-actions",
        "error": null,
        "policySnapshotId": "snapshot-789",
        "policyVersion": "v1.0.0"
      }
    ]
  }
}
```

## Usage

### Automatic Policy Snapshot Creation

Policy snapshots are created automatically by the Workflow Engine. No manual intervention is required.

```typescript
// In workflow-engine.ts - automatic execution
const executionId = await createExecution(...);
const policySnapshotId = await ensurePolicySnapshotForExecution(pool, executionId);
await updateExecutionPolicySnapshot(executionId, policySnapshotId);
```

### Querying Policy Snapshots

#### Get Policy Snapshot for an Execution

```typescript
import { getPolicySnapshotForExecution } from './policy-manager';

const snapshot = await getPolicySnapshotForExecution(pool, executionId);
console.log(`Policy version: ${snapshot.version}`);
console.log(`Classification rules: ${snapshot.policies.classification_rules.length}`);
```

#### Get Executions with Policy Information

```sql
-- Use the executions_with_policy view
SELECT 
  id,
  status,
  policy_version,
  started_at
FROM executions_with_policy
WHERE status = 'failed'
ORDER BY started_at DESC
LIMIT 10;
```

#### Audit Trail Query

```sql
-- Complete audit trail: execution → policy → verdicts
SELECT 
  e.id as execution_id,
  e.status as execution_status,
  e.started_at,
  ps.version as policy_version,
  v.error_class,
  v.confidence_score,
  v.proposed_action
FROM workflow_executions e
LEFT JOIN policy_snapshots ps ON e.policy_snapshot_id = ps.id
LEFT JOIN verdicts v ON v.execution_id = e.id AND v.policy_snapshot_id = ps.id
WHERE e.id = $1;
```

## Policy Versioning Strategy

### Current Implementation: v1.0.0

The current implementation uses a static policy version `v1.0.0` defined in `policy-manager.ts`. This includes:

- 8 error class classification rules
- Confidence scores (0.75 - 0.95)
- Factory action mappings (playbooks)
- Confidence normalization configuration

### Version Format

Policy versions follow semantic versioning: `v{MAJOR}.{MINOR}.{PATCH}`

- **MAJOR**: Breaking changes to policy structure
- **MINOR**: New error classes or playbooks
- **PATCH**: Refinements to existing rules

### Future Evolution

1. **Dynamic Policy Updates**
   - Load policies from configuration
   - Support multiple policy versions
   - Policy A/B testing

2. **Policy Management UI**
   - View policy history
   - Compare policy versions
   - Rollback to previous versions

3. **Per-Repository Policies**
   - Custom policies per project
   - Policy inheritance
   - Override mechanisms

## Auditability Features

### Immutability Guarantees

1. **Policy Snapshots**: Once created, snapshots are never modified
2. **Foreign Key Constraints**: 
   - `workflow_executions.policy_snapshot_id`: `ON DELETE SET NULL` - executions remain valid if policy deleted
   - `verdicts.policy_snapshot_id`: `ON DELETE RESTRICT` - prevents policy deletion if verdicts reference it (defined in migration 004)
3. **Timestamp Tracking**: All snapshots have `created_at` timestamp
4. **Metadata**: Each snapshot includes creation context

### Audit Capabilities

```typescript
// Audit a verdict for compliance
import { auditVerdict } from '@codefactory/verdict-engine';

const verdict = await getVerdict(verdictId);
const snapshot = await getPolicySnapshot(verdict.policy_snapshot_id);
const auditResult = auditVerdict(verdict, snapshot);

console.log(`Compliant: ${auditResult.compliant}`);
console.log(`Policy version: ${auditResult.policy_version}`);
console.log(`Issues: ${auditResult.issues.join(', ')}`);
```

### Compliance Queries

```sql
-- Get all verdicts with their policy versions
SELECT 
  v.id,
  v.execution_id,
  v.error_class,
  v.confidence_score,
  ps.version as policy_version,
  ps.created_at as policy_created_at
FROM verdicts v
JOIN policy_snapshots ps ON v.policy_snapshot_id = ps.id
ORDER BY v.created_at DESC;

-- Check for verdicts without policy snapshots (should be zero)
SELECT COUNT(*) as missing_policies
FROM verdicts v
WHERE v.policy_snapshot_id IS NULL;
```

## Testing

### Unit Tests

Tests are located in `control-center/__tests__/lib/policy-manager.test.ts`:

```bash
cd control-center
npm test -- policy-manager.test.ts
```

### Integration Testing

1. Start a workflow execution
2. Verify policy snapshot is created
3. Check execution has policy_snapshot_id
4. Generate a verdict
5. Verify verdict references the same snapshot

### Manual Testing

```bash
# 1. Run a workflow
curl -X POST http://localhost:3000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d '{"workflowId": "test-workflow"}'

# 2. Check Factory Status API
curl http://localhost:3000/api/v1/factory/status

# 3. Verify policy snapshot in response
# Look for policySnapshotId and policyVersion fields
```

## Acceptance Criteria

✅ **Snapshots are immutable**
- Policy snapshots cannot be modified after creation
- Database constraints enforce immutability

✅ **Back-reference in Verdict**
- Every verdict has `policy_snapshot_id` field
- Verdicts reference the execution's policy snapshot
- Foreign key constraints maintain referential integrity

✅ **Auditability**
- Complete audit trail from verdict → policy → execution
- Policy version visible in Factory Status API
- Query views for easy auditability
- Compliance audit functions available

## KPI: Auditability

### Metrics

1. **Policy Coverage**: 100% of executions have policy snapshots
2. **Verdict Linkage**: 100% of verdicts reference policy snapshots
3. **Traceability**: Complete chain from verdict to execution to policy
4. **Immutability**: Zero policy modifications post-creation

### Monitoring

```sql
-- KPI: Policy Coverage
SELECT 
  COUNT(*) FILTER (WHERE policy_snapshot_id IS NOT NULL) * 100.0 / COUNT(*) as coverage_percentage
FROM workflow_executions
WHERE created_at > NOW() - INTERVAL '7 days';

-- KPI: Verdict Linkage
SELECT 
  COUNT(*) FILTER (WHERE policy_snapshot_id IS NOT NULL) * 100.0 / COUNT(*) as linkage_percentage
FROM verdicts
WHERE created_at > NOW() - INTERVAL '7 days';
```

## Migration Guide

### Database Migration

```bash
# Apply migration 005
psql -U afu9 -d codefactory_control -f database/migrations/005_add_policy_snapshot_to_executions.sql
```

### Verification Steps

```sql
-- 1. Check column exists
\d workflow_executions

-- 2. Check index exists
\di idx_executions_policy_snapshot_id

-- 3. Check view exists
\dv executions_with_policy

-- 4. Test query
SELECT * FROM executions_with_policy LIMIT 1;
```

### Rollback (if needed)

```sql
-- Remove policy snapshot column
ALTER TABLE workflow_executions DROP COLUMN policy_snapshot_id;

-- Drop index
DROP INDEX IF EXISTS idx_executions_policy_snapshot_id;

-- Drop view
DROP VIEW IF EXISTS executions_with_policy;
```

## Troubleshooting

### Issue: Policy snapshot creation fails

**Symptoms**: Workflow executions succeed but have `null` policy_snapshot_id

**Solution**:
1. Check database connectivity
2. Verify `policy_snapshots` table exists
3. Check logs for policy creation errors
4. Ensure migration 004 (verdict engine) was applied

### Issue: Verdicts don't reference policy snapshots

**Symptoms**: Verdicts created but policy_snapshot_id is null

**Solution**:
1. Ensure execution has policy_snapshot_id before verdict creation
2. Check verdict generation code passes correct policy_snapshot_id
3. Verify foreign key constraints are in place

## Future Enhancements

1. **Policy Comparison Tool**: Compare two policy versions side-by-side
2. **Policy Analytics**: Analyze which policy versions produce best results
3. **Policy Optimization**: ML-based policy refinement suggestions
4. **Policy Templates**: Reusable policy templates for common scenarios
5. **Policy Governance Dashboard**: Visual policy management interface

## References

- [Verdict Engine Implementation Summary](../VERDICT_ENGINE_IMPLEMENTATION_SUMMARY.md)
- [Database Migrations](../database/migrations/)
- [Factory Status API Documentation](./FACTORY_STATUS_API.md)
- [Workflow Engine Documentation](./WORKFLOW-ENGINE.md)

## Support

For questions or issues:
- Review logs: `control-center/logs/policy-manager.log`
- Check database: `SELECT * FROM policy_snapshots ORDER BY created_at DESC LIMIT 10;`
- Contact: AFU-9 Development Team
