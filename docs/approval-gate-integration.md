# E87.1 Approval Gate Integration Guide

This document explains how to integrate the Approval Gate framework into existing endpoints.

## Overview

The Approval Gate framework provides a unified way to require explicit human approval for dangerous operations:
- **merge**: PR merge operations
- **prod_operation**: Operations against production environment
- **destructive_operation**: Delete/reset/force-migration/rollback operations

## Integration Pattern

### 1. Basic Integration

Add approval gate check at the beginning of your API endpoint (after auth):

```typescript
import { requireApprovalGate } from '@/lib/approvals/approval-gate-integration';
import { getPool } from '@/lib/db';
import { getRequestId, errorResponse } from '@/lib/api/response-helpers';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  
  // 1. Auth check (existing)
  const userId = request.headers.get('x-afu9-sub');
  if (!userId) {
    return errorResponse('Unauthorized', { status: 401, requestId });
  }
  
  // 2. Parse request
  const { owner, repo, prNumber } = await request.json();
  
  // 3. APPROVAL GATE CHECK (new)
  const pool = getPool();
  const approvalCheck = await requireApprovalGate({
    actionType: 'merge',
    targetType: 'pr',
    targetIdentifier: `${owner}/${repo}#${prNumber}`,
    params: { method: 'squash' },
    requestId,
  }, pool);
  
  if (approvalCheck.error) {
    return errorResponse(approvalCheck.error.message, {
      status: approvalCheck.error.status,
      requestId,
      code: approvalCheck.error.code,
      details: approvalCheck.error.details,
    });
  }
  
  // 4. Proceed with operation
  // ... existing merge logic ...
}
```

### 2. Merge PR Integration Example

For the existing `/api/github/prs/[prNumber]/merge` endpoint:

```typescript
// In route.ts, after line 100 (after input validation):

// Check if approval gate is required
import { requireApprovalGate, isApprovalGateRequired } from '@/lib/approvals/approval-gate-integration';

if (isApprovalGateRequired('merge')) {
  const pool = getPool();
  const approvalCheck = await requireApprovalGate({
    actionType: 'merge',
    targetType: 'pr',
    targetIdentifier: `${input.owner}/${input.repo}#${prNumber}`,
    params: {
      method: input.mergeMethod, // If available
    },
    requestId: requestId || '',
  }, pool);
  
  if (approvalCheck.error) {
    logger.warn('Merge blocked by approval gate', {
      repository: `${input.owner}/${input.repo}`,
      prNumber,
      reason: approvalCheck.error.details,
      requestId,
    }, 'MergePrAPI');
    
    return NextResponse.json(
      {
        error: approvalCheck.error.message,
        code: approvalCheck.error.code,
        details: approvalCheck.error.details,
      },
      { status: approvalCheck.error.status, headers: { 'x-request-id': requestId || '' } }
    );
  }
  
  logger.info('Approval gate passed', {
    approvalId: approvalCheck.approvalId,
    actionFingerprint: approvalCheck.actionFingerprint,
    requestId,
  }, 'MergePrAPI');
}

// Continue with existing merge logic...
```

### 3. Production Operations Integration

For endpoints that operate on production environment:

```typescript
import { requireApprovalGate } from '@/lib/approvals/approval-gate-integration';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const pool = getPool();
  
  // Check if this is a production operation
  const deploymentEnv = getDeploymentEnv();
  if (deploymentEnv === 'production') {
    const approvalCheck = await requireApprovalGate({
      actionType: 'prod_operation',
      targetType: 'env',
      targetIdentifier: 'production',
      params: { operation: 'deploy', version: 'v2.0.0' },
      requestId,
    }, pool);
    
    if (approvalCheck.error) {
      return errorResponse(approvalCheck.error.message, {
        status: approvalCheck.error.status,
        requestId,
        code: approvalCheck.error.code,
      });
    }
  }
  
  // Proceed with operation...
}
```

### 4. Destructive Operations Integration

For operations that modify/delete data:

```typescript
export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  const pool = getPool();
  const { database, migrationId } = await request.json();
  
  // Require approval for destructive operations
  const approvalCheck = await requireApprovalGate({
    actionType: 'destructive_operation',
    targetType: 'database',
    targetIdentifier: `db:${database}:migration:${migrationId}`,
    params: { operation: 'rollback' },
    requestId,
  }, pool);
  
  if (approvalCheck.error) {
    return errorResponse(approvalCheck.error.message, {
      status: approvalCheck.error.status,
      requestId,
      code: approvalCheck.error.code,
    });
  }
  
  // Proceed with rollback...
}
```

## UI Integration

### Client-Side Workflow

1. User attempts dangerous operation
2. Client calls approval API first
3. Shows ApprovalDialog to collect signed phrase
4. Submits approval to `/api/approvals`
5. Then calls actual operation endpoint with same requestId

Example:

```typescript
import { ApprovalDialog } from '@/app/components/ApprovalDialog';
import { useState } from 'react';

function MergePRButton({ owner, repo, prNumber }) {
  const [showApproval, setShowApproval] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const requestId = crypto.randomUUID();
  
  const handleMerge = async () => {
    setShowApproval(true);
  };
  
  const handleApprove = async (signedPhrase: string, reason?: string) => {
    setIsProcessing(true);
    
    try {
      // 1. Submit approval
      await fetch('/api/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionContext: {
            actionType: 'merge',
            targetType: 'pr',
            targetIdentifier: `${owner}/${repo}#${prNumber}`,
          },
          approvalContext: {
            requestId,
          },
          signedPhrase,
          reason,
          decision: 'approved',
        }),
      });
      
      // 2. Perform actual merge (with same requestId)
      const response = await fetch(`/api/github/prs/${prNumber}/merge`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-request-id': requestId,
        },
        body: JSON.stringify({ owner, repo }),
      });
      
      if (response.ok) {
        alert('PR merged successfully!');
      }
    } catch (error) {
      console.error('Merge failed:', error);
    } finally {
      setIsProcessing(false);
      setShowApproval(false);
    }
  };
  
  return (
    <>
      <button onClick={handleMerge}>Merge PR</button>
      
      <ApprovalDialog
        isOpen={showApproval}
        actionType="merge"
        actionSummary={{
          title: 'Merge Pull Request',
          target: `${owner}/${repo}#${prNumber}`,
          impact: 'Will merge PR into main branch',
          riskFlags: ['Production deployment'],
        }}
        onApprove={handleApprove}
        onCancel={() => setShowApproval(false)}
        isProcessing={isProcessing}
      />
    </>
  );
}
```

## Configuration

### Environment Variables

```bash
# Disable approval gate (for testing/staging)
APPROVAL_GATE_ENABLED=false

# Approval window (seconds)
APPROVAL_WINDOW_SECONDS=300  # 5 minutes default
```

### Required Phrases

The framework requires exact phrase matching (case-sensitive):

- **merge**: `YES MERGE`
- **prod_operation**: `YES PROD`
- **destructive_operation**: `YES DESTRUCTIVE`

These phrases are defined in `src/lib/approvals/approval-gate.ts` and can be customized if needed.

## Audit Trail

All approvals are recorded in the `approval_gates` table with:

- Action fingerprint (deterministic hash)
- Signed phrase hash
- Actor (user ID)
- Lawbook version/hash
- Context summary
- Decision (approved/denied/cancelled)
- Timestamp (append-only)

Query approvals:

```sql
-- Recent approvals
SELECT * FROM recent_approvals LIMIT 100;

-- Approved actions in last 24h
SELECT * FROM approved_actions_24h;

-- Approvals by user
SELECT * FROM approval_gates WHERE actor = 'user-123' ORDER BY created_at DESC;
```

## Testing

Use the verification script to test approval gate:

```powershell
# Local test
pwsh scripts/verify-e87-1.ps1

# With auth
pwsh scripts/verify-e87-1.ps1 -BaseUrl http://localhost:3000 -AuthToken "test-user"
```

## Security Considerations

1. **Fail-Closed**: Missing approval → operation blocked
2. **Time Window**: Approvals expire (default: 5 minutes)
3. **Phrase Verification**: Exact match required (case-sensitive)
4. **Audit Trail**: Append-only, includes context hashes
5. **No Bypass**: Approval gate cannot be skipped via API
6. **Deterministic**: Same action → same fingerprint (idempotency)

## Future Enhancements

1. **Lawbook Integration**: Configure approval requirements in lawbook
2. **Multi-Approver**: Require N approvals for critical operations
3. **Approval Templates**: Pre-defined approval flows
4. **Approval Delegation**: Temporary approval authority transfer
5. **Approval Notifications**: Alert on approval requests
