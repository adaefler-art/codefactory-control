# Step Executor S1: Pick/Link Contract

**Version:** v1.0  
**Status:** Active  
**Issue:** E9.1-CTRL-5  
**Implementation:** `control-center/src/lib/loop/stepExecutors/s1-pick-issue.ts`

## Overview

The S1 Step Executor ("Pick/Link") brings an AFU-9 issue into a "processable" state by validating minimal criteria and setting ownership. This is an idempotent operation that ensures issues have the required fields before progressing through the loop.

## Purpose

S1 serves as the first step in the loop execution, ensuring that:
1. The issue is properly linked to a GitHub issue (has `github_url`)
2. The issue has ownership assigned (has `assignee`)

## Function Signature

```typescript
async function executeS1(
  pool: Pool,
  ctx: StepContext
): Promise<StepExecutionResult>
```

## Input: StepContext

```typescript
interface StepContext {
  issueId: string;      // UUID of the AFU-9 issue
  runId: string;        // UUID of the loop run
  requestId: string;    // UUID for request tracing
  actor: string;        // Actor executing the step
  mode: 'execute' | 'dryRun';  // Execution mode
}
```

## Output: StepExecutionResult

```typescript
interface StepExecutionResult {
  success: boolean;           // True if step completed successfully
  blocked: boolean;           // True if step is blocked
  blockerCode?: BlockerCode;  // Blocker code (e.g., NO_GITHUB_LINK)
  blockerMessage?: string;    // Human-readable blocker message
  stateBefore: string;        // Issue status before step
  stateAfter: string;         // Issue status after step
  fieldsChanged: string[];    // List of fields modified
  message: string;            // Result message
}
```

## Behavior

### Validation

1. **GitHub URL Check**: The issue must have a `github_url` field that is non-null and non-empty
   - If missing: Returns blocked with `NO_GITHUB_LINK` blocker code
   - If present: Proceeds to next check

2. **Ownership Check**: The issue should have an `assignee` field
   - If missing in `execute` mode: Sets assignee to the actor
   - If missing in `dryRun` mode: Records as needed but doesn't update
   - If present: Step is a no-op

### Idempotency

S1 is fully idempotent:
- If all required fields are present, the step does nothing (no-op)
- Multiple executions with the same context produce the same result
- No side effects if fields are already set

### Timeline Events

Every S1 execution creates a timeline event with:
- `event_type`: `RUN_STARTED`
- `event_data`:
  - `runId`: The loop run UUID
  - `step`: `S1_PICK_ISSUE`
  - `stateBefore`: Issue status before execution
  - `stateAfter`: Issue status after execution (same as before for S1)
  - `requestId`: Request UUID for tracing
  - `blocked`: Boolean indicating if step was blocked
  - `blockerCode`: Blocker code if blocked
  - `fieldsChanged`: Array of fields modified
  - `isNoOp`: Boolean indicating if step was a no-op
  - `mode`: Execution mode (execute/dryRun)

## Error Codes

| Code | When | Description |
|------|------|-------------|
| `NO_GITHUB_LINK` | GitHub URL missing | Issue must be linked to a GitHub issue before S1 can proceed |

## Examples

### Example 1: Success - No-op (all fields present)

**Input:**
```typescript
{
  issueId: '123e4567-e89b-12d3-a456-426614174000',
  runId: '123e4567-e89b-12d3-a456-426614174001',
  requestId: '123e4567-e89b-12d3-a456-426614174002',
  actor: 'system',
  mode: 'execute'
}
```

**Issue State:**
```sql
github_url = 'https://github.com/org/repo/issues/123'
assignee = 'user@example.com'
status = 'CREATED'
```

**Output:**
```typescript
{
  success: true,
  blocked: false,
  stateBefore: 'CREATED',
  stateAfter: 'CREATED',
  fieldsChanged: [],
  message: 'S1 complete: Issue already has required fields (no-op)'
}
```

### Example 2: Success - Set ownership

**Input:**
```typescript
{
  issueId: '123e4567-e89b-12d3-a456-426614174000',
  runId: '123e4567-e89b-12d3-a456-426614174001',
  requestId: '123e4567-e89b-12d3-a456-426614174002',
  actor: 'system',
  mode: 'execute'
}
```

**Issue State (before):**
```sql
github_url = 'https://github.com/org/repo/issues/123'
assignee = NULL
status = 'CREATED'
```

**Issue State (after):**
```sql
github_url = 'https://github.com/org/repo/issues/123'
assignee = 'system'
status = 'CREATED'
```

**Output:**
```typescript
{
  success: true,
  blocked: false,
  stateBefore: 'CREATED',
  stateAfter: 'CREATED',
  fieldsChanged: ['assignee'],
  message: 'S1 complete: Set ownership (assignee)'
}
```

### Example 3: Blocked - No GitHub URL

**Input:**
```typescript
{
  issueId: '123e4567-e89b-12d3-a456-426614174000',
  runId: '123e4567-e89b-12d3-a456-426614174001',
  requestId: '123e4567-e89b-12d3-a456-426614174002',
  actor: 'system',
  mode: 'execute'
}
```

**Issue State:**
```sql
github_url = NULL
assignee = NULL
status = 'CREATED'
```

**Output:**
```typescript
{
  success: false,
  blocked: true,
  blockerCode: 'NO_GITHUB_LINK',
  blockerMessage: 'S1 (Pick Issue) requires GitHub issue link',
  stateBefore: 'CREATED',
  stateAfter: 'CREATED',
  fieldsChanged: [],
  message: 'Step blocked: GitHub URL is required'
}
```

### Example 4: Dry Run - No changes made

**Input:**
```typescript
{
  issueId: '123e4567-e89b-12d3-a456-426614174000',
  runId: '123e4567-e89b-12d3-a456-426614174001',
  requestId: '123e4567-e89b-12d3-a456-426614174002',
  actor: 'system',
  mode: 'dryRun'
}
```

**Issue State:**
```sql
github_url = 'https://github.com/org/repo/issues/123'
assignee = NULL
status = 'CREATED'
```

**Output:**
```typescript
{
  success: true,
  blocked: false,
  stateBefore: 'CREATED',
  stateAfter: 'CREATED',
  fieldsChanged: [],  // No changes in dryRun mode
  message: 'S1 complete: Issue already has required fields (no-op)'
}
```

**Note:** In `dryRun` mode, no database updates are performed even if fields are missing.

## Integration

S1 is integrated into the loop execution via `control-center/src/lib/loop/execution.ts`:

1. The loop calls `resolveNextStep()` from the state machine
2. If the resolved step is `S1_PICK_ISSUE`, `executeS1()` is called
3. The result is used to update the loop run status and construct the response

## Testing

**Test File:** `control-center/__tests__/lib/loop/s1-pick-issue.test.ts`

Test coverage includes:
- ✅ Blocked scenarios (missing GitHub URL)
- ✅ Idempotent no-op scenarios (all fields present)
- ✅ Execution scenarios (setting ownership)
- ✅ Dry run mode (no database changes)
- ✅ Timeline event creation
- ✅ Error scenarios (issue not found)

## Database Schema

### Fields Read

- `afu9_issues.id` (UUID)
- `afu9_issues.status` (VARCHAR)
- `afu9_issues.github_url` (VARCHAR)
- `afu9_issues.assignee` (VARCHAR)
- `afu9_issues.handoff_state` (VARCHAR)

### Fields Updated

- `afu9_issues.assignee` (only if missing and in execute mode)
- `afu9_issues.updated_at` (automatic trigger)

### Timeline Events Created

- `issue_timeline` table entry with event_type `RUN_STARTED`

## Version History

- **v1.0** (2026-01-21): Initial implementation (E9.1-CTRL-5)

## Related Contracts

- [Loop State Machine v1](./loop-state-machine.v1.md) - Defines when S1 is available
- [Loop API v1](./loop-api.v1.md) - Loop execution API
- [Issue Timeline Contract](../control-center/src/lib/contracts/issueTimeline.ts) - Timeline event types
