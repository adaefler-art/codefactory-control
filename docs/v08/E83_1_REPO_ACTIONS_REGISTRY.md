# Repository Actions Registry (E83.1)

**Epic E83: GH Workflow Orchestrator**

## Overview

The Repository Actions Registry is a machine-readable specification that defines what actions are automatable in a repository and under what conditions they can be executed. It serves as the single source of truth for all GitHub workflow automation in AFU-9.

## Key Features

- **Fail-Closed by Default**: Unknown actions are blocked unless explicitly allowed
- **Versioned & Auditable**: All registry changes are tracked in version history
- **Precondition-Based**: Actions can have preconditions (checks, approvals, labels, etc.)
- **Approval Gated**: Sensitive actions can require explicit approval
- **Evidence Required**: All actions must produce evidence for audit trail

## Schema

The registry is defined using Zod schemas in TypeScript and stored as JSONB in PostgreSQL.

### Core Structure

```typescript
{
  version: string;              // Registry schema version (1.0.0)
  registryId: string;           // Unique identifier
  repository: string;           // Format: "owner/repo"
  allowedActions: ActionConfig[];
  requiredChecks: RequiredCheck[];
  approvalRules: ApprovalRule;
  mergePolicy: MergePolicy;
  labelMappings: LabelMapping[];
  reviewerMappings: ReviewerMapping[];
  environments: EnvironmentConfig[];
  failClosed: boolean;          // Block unknown actions (default: true)
}
```

## Action Types

Supported action types:

### Issue Actions
- `assign_issue` - Assign user to issue
- `unassign_issue` - Remove assignee from issue
- `add_label` - Add label to issue
- `remove_label` - Remove label from issue
- `close_issue` - Close an issue
- `reopen_issue` - Reopen a closed issue
- `add_comment` - Add comment to issue

### PR Actions
- `create_pr` - Create new pull request
- `update_pr` - Update existing PR
- `assign_pr` - Assign reviewer to PR
- `request_review` - Request review on PR
- `approve_pr` - Approve a PR
- `merge_pr` - Merge a PR
- `close_pr` - Close PR without merging
- `reopen_pr` - Reopen closed PR

### Check Actions
- `rerun_checks` - Rerun all checks
- `rerun_failed_jobs` - Rerun only failed jobs
- `wait_for_checks` - Wait for checks to complete

### Branch Actions
- `cleanup_branch` - Delete merged branch
- `create_branch` - Create new branch
- `delete_branch` - Delete branch

### Other
- `dispatch_workflow` - Trigger workflow
- `collect_artifacts` - Collect workflow artifacts

## Precondition Types

Preconditions that must be met before an action can execute:

- `checks_passed` - All checks must pass
- `checks_status` - Checks must have specific status
- `review_approved` - PR must be approved
- `review_count` - Minimum number of approvals
- `label_present` - Specific label must exist
- `label_absent` - Specific label must not exist
- `assignee_set` - Issue/PR must have assignee
- `branch_protection` - Branch protection rules active
- `pr_mergeable` - PR has no conflicts
- `pr_not_draft` - PR is not in draft state
- `environment_approved` - Environment approval granted

## Action Configuration

Each action has:

```typescript
{
  actionType: ActionType;
  enabled: boolean;             // Is this action enabled?
  preconditions: Precondition[]; // Must be met before execution
  approvalRule?: ApprovalRule;  // Approval requirements
  maxRetries: number;           // Max retry attempts (default: 0)
  cooldownMinutes: number;      // Cooldown between retries (default: 0)
  requireEvidence: boolean;     // Must produce evidence (default: true)
  description?: string;
}
```

## Usage

### Creating a Registry

```typescript
import { getRepoActionsRegistryService } from './repo-actions-registry-service';

const service = getRepoActionsRegistryService();

const registry = await service.createRegistry({
  version: '1.0.0',
  registryId: 'my-repo-v1',
  repository: 'owner/repo',
  allowedActions: [
    {
      actionType: 'merge_pr',
      enabled: true,
      preconditions: [
        { type: 'checks_passed' },
        { type: 'review_approved' },
      ],
      approvalRule: {
        required: true,
        minApprovers: 1,
      },
      requireEvidence: true,
    },
  ],
  requiredChecks: [
    { name: 'CI', required: true, allowedStatuses: ['success'] },
  ],
  createdAt: new Date().toISOString(),
  createdBy: 'admin',
  failClosed: true,
});
```

### Validating an Action

```typescript
const result = await service.validateAction(
  'owner/repo',
  'merge_pr',
  {
    resourceType: 'pull_request',
    resourceNumber: 123,
    checks: [
      { name: 'CI', status: 'success' },
      { name: 'Build', status: 'success' },
    ],
    reviews: [
      { state: 'APPROVED', user: 'reviewer1' },
    ],
    mergeable: true,
    draft: false,
  }
);

if (result.allowed) {
  // Execute action
  await executeMerge();
  
  // Log to audit trail
  await service.logActionValidation(
    registry.registryId,
    'owner/repo',
    'pull_request',
    123,
    result,
    'bot-user'
  );
} else {
  console.error('Action blocked:', result.errors);
}
```

## Fail-Closed Behavior

When `failClosed: true` (default):
- Unknown actions → **BLOCKED**
- Disabled actions → **BLOCKED**
- Missing preconditions → **BLOCKED**
- Approval not met → **BLOCKED**

When `failClosed: false`:
- Unknown actions → **ALLOWED** (with warning)
- All other blocks still apply

## Database Schema

### Tables

**`repo_actions_registry`**
- Stores registry configurations
- One active registry per repository
- Full JSONB content stored

**`registry_action_audit`**
- Audit log for all action validations
- Records allowed/blocked/pending decisions
- Links to registry version used

**`repo_actions_registry_history`**
- Version history for registries
- Tracks created/updated/activated/deactivated events

### Views

**`active_repo_actions_registries`**
- Currently active registries per repository

**`recent_registry_actions`**
- Last 100 action validations

## Example Registry

See [docs/examples/repo-actions-registry.json](../examples/repo-actions-registry.json) for a complete example.

## Audit Trail

All action validations are logged with:
- Registry ID and version used
- Action type and status (allowed/blocked/pending)
- Validation result (preconditions, approvals)
- Resource (issue/PR number)
- Executor (who requested the action)
- Timestamp

## Integration with E83 Workflow

The registry integrates with other E83 components:

1. **E83.2** (`assign_copilot_to_issue`) - Validates assignment action
2. **E83.3** (`collect_copilot_output`) - Validates artifact collection
3. **E83.4** (`request_review_and_wait_checks`) - Validates check actions
4. **E83.5** (`merge_pr_with_approval`) - Validates merge action

## Best Practices

1. **Start with fail-closed**: Block unknown actions by default
2. **Version your registries**: Track changes over time
3. **Require evidence**: Enable evidence for all actions
4. **Use preconditions**: Enforce checks and approvals
5. **Monitor audit logs**: Review blocked actions regularly
6. **Test before activation**: Validate new registries in staging

## Migration from v0.7

The registry is new in v0.8. No migration needed from v0.7.

## Future Enhancements (v0.9+)

- Environment-specific registries
- Time-based restrictions (business hours only)
- Rate limiting per action type
- Cost budgets per action
- ML-based anomaly detection

## Related

- [E83: GH Workflow Orchestrator](../roadmaps/afu9_v0_8_backlog.md#epic-e83)
- [Lawbook Versioning](../v07/E80_1_LAWBOOK_VERSIONING.md)
- [Workflow Action Audit](../../database/migrations/057_workflow_action_audit.sql)
