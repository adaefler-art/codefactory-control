# Issue B4 Quick Reference: HOLD Workflow Enforcement

**Status**: ✅ Implemented  
**Date**: 2025-12-20

## Problem Statement

**Ziel**: HOLD blockiert Pipeline vollständig. Mensch entscheidet explizit weiter oder killt.

**Acceptance**:
- HOLD stoppt automatisch
- kein Timeout-Weiterlaufen

## Solution Summary

HOLD state now **completely blocks** workflow execution with **no automatic timeout continuation**. Human intervention is **required** to resume or kill paused workflows.

## Key Implementation Points

### 1. Workflow Status Extended
```typescript
// Added 'paused' status to WorkflowStatus type
export type WorkflowStatus = 
  | 'pending' | 'running' | 'completed' 
  | 'failed' | 'cancelled' | 'paused';
```

### 2. Automatic HOLD Detection
```typescript
// Workflow engine checks for HOLD state after each step
private shouldPauseForHold(context: WorkflowContext): boolean {
  return context.issue?.state === IssueState.HOLD;
}
```

### 3. Pause Enforcement
```typescript
// When HOLD detected, workflow pauses immediately
await pauseExecution(
  executionId,
  'system',
  'HOLD state triggered - workflow paused pending human review',
  stepIndex
);
// Break execution loop - NO TIMEOUT CONTINUATION
```

### 4. Human Approval Required
```typescript
// Only explicit human action can resume
await resumeExecution(executionId, 'approver@example.com');
```

## API Endpoints

```bash
# Pause a workflow
POST /api/executions/{id}/pause
Body: { "pausedBy": "user@example.com", "reason": "..." }

# Resume a workflow (requires human approval)
POST /api/executions/{id}/resume
Body: { "resumedBy": "approver@example.com" }

# List all paused workflows
GET /api/executions/paused
```

## Database Changes

```sql
-- Migration: 012_workflow_pause_support.sql

-- Add 'paused' status
ALTER TABLE workflow_executions 
  ADD CONSTRAINT chk_execution_status 
  CHECK (status IN (..., 'paused'));

-- Add pause metadata
ALTER TABLE workflow_executions
  ADD COLUMN pause_metadata JSONB;

-- Index for paused workflows
CREATE INDEX idx_executions_paused 
  ON workflow_executions(status) 
  WHERE status = 'paused';
```

## Pause Metadata Structure

```typescript
{
  pausedAt: "2025-12-20T10:00:00Z",
  pausedBy: "system",
  reason: "HOLD state triggered",
  resumedAt?: "2025-12-20T11:00:00Z",  // If resumed
  resumedBy?: "approver@example.com",  // Who approved
  pausedAtStepIndex?: 5                // Where paused
}
```

## Integration with Issue States

```
CREATED → SPEC_READY → IMPLEMENTING → VERIFIED → MERGE_READY → DONE
    ↓         ↓             ↓              ↓           ↓
    └────────→ HOLD ←───────┴──────────────┴───────────┘
                │
                │ Workflow PAUSED
                │ No timeout
                │
                ↓
          Human Decision:
            → Resume (explicit)
            → Kill (explicit)
```

## Guarantees

✅ **HOLD stops automatically**: Workflow engine detects and pauses  
✅ **No timeout continuation**: Paused status persists indefinitely  
✅ **Human approval required**: Only explicit API call can resume  
✅ **Full audit trail**: All pause/resume actions logged  
✅ **State enforcement**: Cannot resume without 'paused' status  

## Files Changed

**Core Implementation**:
- `control-center/src/lib/types/workflow.ts` - Added 'paused' status
- `control-center/src/lib/workflow-engine.ts` - HOLD detection & auto-pause
- `control-center/src/lib/workflow-persistence.ts` - Pause/resume functions

**Database**:
- `database/migrations/012_workflow_pause_support.sql` - Schema changes

**API**:
- `control-center/app/api/executions/[id]/pause/route.ts`
- `control-center/app/api/executions/[id]/resume/route.ts`
- `control-center/app/api/executions/paused/route.ts`

**Tests**:
- `control-center/__tests__/lib/hold-workflow-enforcement.test.ts`

**Documentation**:
- `docs/HOLD_WORKFLOW_ENFORCEMENT.md` - Complete guide

## Usage Example

```typescript
// Workflow automatically pauses when HOLD detected
const context: WorkflowContext = {
  issue: { number: 123, state: IssueState.HOLD }
};

// Engine detects HOLD after step execution
// → Workflow paused
// → Status = 'paused'
// → Break execution loop
// → Wait for human decision

// Human approves resume via API
POST /api/executions/exec-123/resume
{ "resumedBy": "human@example.com" }

// Workflow resumes from where it paused
```

## Related Issues

- **Issue A3**: Human Intervention Policy - Defines when humans can intervene
- **Issue B2**: Verdict → Action Mapping - HOLD maps to FREEZE action
- **Issue B3**: Verdict as Gate - No deployment without GREEN

## Testing

```bash
# Run tests (when Jest is configured)
npm test -- hold-workflow-enforcement.test.ts
```

Test coverage includes:
- Automatic HOLD detection
- Pause functionality
- Resume with human approval
- No timeout guarantee
- Audit trail validation

---

**Quick Check**: Is HOLD enforcement working?

```bash
# Check for paused workflows
curl http://localhost:3000/api/executions/paused

# If workflow is paused, it should appear in response
# Status should be 'paused'
# pause_metadata should contain pausedAt, pausedBy, reason
```
