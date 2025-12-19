# Issue State Machine Usage Examples

This document provides practical examples of how to use the canonical issue state machine in AFU-9.

## Basic Import and Usage

```typescript
import { 
  IssueState, 
  isValidTransition, 
  isValidIssueState,
  getIssueStateDescription,
  isTerminalState,
  isActiveState
} from '@/lib/types/issue-state';
```

## Example 1: State Transition Validation

```typescript
/**
 * Validate and perform a state transition
 */
async function transitionIssueState(
  issueId: string,
  currentState: IssueState,
  targetState: IssueState,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  // Validate the transition
  if (!isValidTransition(currentState, targetState)) {
    return {
      success: false,
      error: `Cannot transition from ${currentState} to ${targetState}. ` +
             `This transition is not allowed by the state machine.`
    };
  }
  
  // Perform the transition (database update)
  try {
    await db.query(`
      UPDATE issue_tracking 
      SET 
        previous_state = $1,
        state = $2,
        state_changed_at = NOW(),
        state_changed_by = $3,
        state_change_reason = $4
      WHERE id = $5
    `, [currentState, targetState, 'system', reason, issueId]);
    
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Database error: ${error.message}`
    };
  }
}

// Usage
const result = await transitionIssueState(
  'issue-123',
  IssueState.IMPLEMENTING,
  IssueState.VERIFIED,
  'All tests passing, code reviewed'
);

if (!result.success) {
  console.error('Transition failed:', result.error);
}
```

## Example 2: GitHub Webhook Handler

```typescript
/**
 * Handle GitHub pull request events and update issue state
 */
async function handlePullRequestEvent(event: any) {
  const issueNumber = event.pull_request.number;
  const action = event.action; // opened, closed, merged, etc.
  
  // Get current issue state from database
  const currentIssue = await getIssueFromDB(issueNumber);
  
  let newState: IssueState | null = null;
  let reason = '';
  
  switch (action) {
    case 'opened':
      if (currentIssue.state === IssueState.SPEC_READY) {
        newState = IssueState.IMPLEMENTING;
        reason = 'Pull request opened';
      }
      break;
      
    case 'ready_for_review':
      if (currentIssue.state === IssueState.IMPLEMENTING) {
        newState = IssueState.VERIFIED;
        reason = 'PR marked ready for review';
      }
      break;
      
    case 'closed':
      if (event.pull_request.merged) {
        newState = IssueState.DONE;
        reason = 'Pull request merged';
      } else {
        newState = IssueState.KILLED;
        reason = 'Pull request closed without merge';
      }
      break;
  }
  
  if (newState && isValidTransition(currentIssue.state, newState)) {
    await transitionIssueState(
      currentIssue.id,
      currentIssue.state,
      newState,
      reason
    );
  }
}
```

## Example 3: Workflow Step with State Checking

```typescript
/**
 * Workflow step that checks if issue is in correct state
 */
async function executeWorkflowStep(context: WorkflowContext) {
  // Check if issue is in an active state
  if (context.issue?.state && !isActiveState(context.issue.state)) {
    throw new Error(
      `Cannot execute workflow: Issue is in ${context.issue.state} state. ` +
      `Workflows can only run on active issues.`
    );
  }
  
  // Execute the workflow step
  // ...
}
```

## Example 4: Dashboard Filtering

```typescript
/**
 * Filter issues for dashboard display
 */
function getIssuesForDashboard(filter: string) {
  let stateFilter: IssueState[] = [];
  
  switch (filter) {
    case 'active':
      // All active work states
      stateFilter = Object.values(IssueState).filter(isActiveState);
      break;
      
    case 'completed':
      // Terminal states only
      stateFilter = Object.values(IssueState).filter(isTerminalState);
      break;
      
    case 'in-progress':
      // Currently being worked on
      stateFilter = [
        IssueState.IMPLEMENTING,
        IssueState.VERIFIED,
        IssueState.MERGE_READY
      ];
      break;
      
    case 'blocked':
      stateFilter = [IssueState.HOLD];
      break;
  }
  
  return db.query(`
    SELECT * FROM issue_tracking
    WHERE state = ANY($1)
    ORDER BY state_changed_at DESC
  `, [stateFilter]);
}
```

## Example 5: State Metrics and Analytics

```typescript
/**
 * Calculate cycle time metrics by state
 */
async function getStateCycleTimeMetrics() {
  const result = await db.query(`
    SELECT 
      from_state,
      to_state,
      COUNT(*) as transition_count,
      AVG(
        EXTRACT(EPOCH FROM (
          LEAD(transition_at) OVER (PARTITION BY issue_tracking_id ORDER BY transition_at) 
          - transition_at
        )) / 3600
      ) as avg_hours_in_state
    FROM issue_state_history
    WHERE from_state IS NOT NULL
    GROUP BY from_state, to_state
    ORDER BY from_state, to_state
  `);
  
  return result.rows.map(row => ({
    fromState: row.from_state,
    toState: row.to_state,
    transitionCount: parseInt(row.transition_count),
    averageHoursInState: parseFloat(row.avg_hours_in_state),
    description: `${getIssueStateDescription(row.from_state)} → ${getIssueStateDescription(row.to_state)}`
  }));
}
```

## Example 6: State-Based Notifications

```typescript
/**
 * Send notifications based on state transitions
 */
async function notifyStateChange(
  issue: any,
  fromState: IssueState,
  toState: IssueState
) {
  const message = {
    issueNumber: issue.number,
    repository: issue.repository,
    transition: `${fromState} → ${toState}`,
    description: getIssueStateDescription(toState)
  };
  
  // Different notification channels based on state
  if (toState === IssueState.HOLD) {
    // Alert: Issue blocked
    await sendSlackNotification('#alerts', {
      ...message,
      severity: 'warning',
      text: `⚠️ Issue #${issue.number} is on hold`
    });
  } else if (toState === IssueState.DONE) {
    // Success: Issue completed
    await sendSlackNotification('#completed', {
      ...message,
      severity: 'success',
      text: `✅ Issue #${issue.number} completed`
    });
  } else if (toState === IssueState.KILLED) {
    // Info: Issue cancelled
    await sendSlackNotification('#updates', {
      ...message,
      severity: 'info',
      text: `❌ Issue #${issue.number} cancelled`
    });
  }
}
```

## Example 7: State Machine Visualization

```typescript
/**
 * Generate state transition graph data for visualization
 */
function generateStateTransitionGraph() {
  const nodes = Object.values(IssueState).map(state => ({
    id: state,
    label: state.replace('_', ' '),
    description: getIssueStateDescription(state),
    isTerminal: isTerminalState(state),
    isActive: isActiveState(state)
  }));
  
  const edges = Object.entries(ISSUE_STATE_TRANSITIONS).flatMap(
    ([from, toStates]) => 
      toStates.map(to => ({
        from,
        to,
        label: `${from} → ${to}`,
        isBackward: isBackwardTransition(from as IssueState, to)
      }))
  );
  
  return { nodes, edges };
}

function isBackwardTransition(from: IssueState, to: IssueState): boolean {
  const normalFlow = [
    IssueState.CREATED,
    IssueState.SPEC_READY,
    IssueState.IMPLEMENTING,
    IssueState.VERIFIED,
    IssueState.MERGE_READY,
    IssueState.DONE
  ];
  
  const fromIndex = normalFlow.indexOf(from);
  const toIndex = normalFlow.indexOf(to);
  
  return fromIndex > toIndex && fromIndex !== -1 && toIndex !== -1;
}
```

## Example 8: Issue Creation with Initial State

```typescript
/**
 * Create a new issue with initial state tracking
 */
async function createIssueWithState(
  githubIssueNumber: number,
  repository: string,
  metadata?: any
) {
  const result = await db.query(`
    INSERT INTO issue_tracking (
      github_issue_number,
      repository,
      state,
      state_changed_at,
      state_changed_by,
      metadata
    ) VALUES ($1, $2, $3, NOW(), $4, $5)
    RETURNING id
  `, [
    githubIssueNumber,
    repository,
    IssueState.CREATED,
    'system',
    metadata || {}
  ]);
  
  return result.rows[0].id;
}
```

## Example 9: Bulk State Operations

```typescript
/**
 * Put multiple issues on hold
 */
async function bulkHoldIssues(
  issueIds: string[],
  reason: string
) {
  const results = [];
  
  for (const issueId of issueIds) {
    const issue = await getIssueFromDB(issueId);
    
    if (isValidTransition(issue.state, IssueState.HOLD)) {
      const result = await transitionIssueState(
        issueId,
        issue.state,
        IssueState.HOLD,
        reason
      );
      results.push({ issueId, ...result });
    } else {
      results.push({
        issueId,
        success: false,
        error: `Cannot put issue in ${issue.state} state on hold`
      });
    }
  }
  
  return results;
}
```

## Example 10: REST API Endpoint

```typescript
/**
 * API endpoint to transition issue state
 */
export async function POST(request: Request) {
  try {
    const { issueId, targetState, reason } = await request.json();
    
    // Validate target state
    if (!isValidIssueState(targetState)) {
      return Response.json(
        { error: 'Invalid target state' },
        { status: 400 }
      );
    }
    
    // Get current issue
    const issue = await getIssueFromDB(issueId);
    
    if (!issue) {
      return Response.json(
        { error: 'Issue not found' },
        { status: 404 }
      );
    }
    
    // Attempt transition
    const result = await transitionIssueState(
      issueId,
      issue.state,
      targetState as IssueState,
      reason
    );
    
    if (!result.success) {
      return Response.json(
        { error: result.error },
        { status: 400 }
      );
    }
    
    return Response.json({
      success: true,
      previousState: issue.state,
      currentState: targetState,
      reason
    });
    
  } catch (error) {
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

## Best Practices

1. **Always validate transitions**: Use `isValidTransition()` before attempting state changes
2. **Log reasons**: Always provide a reason when transitioning states for audit trail
3. **Handle errors gracefully**: Provide clear error messages when transitions fail
4. **Use type guards**: Use `isValidIssueState()` when accepting string input
5. **Check state types**: Use `isTerminalState()` and `isActiveState()` for business logic
6. **Document transitions**: Add comments explaining why specific transitions occur
7. **Monitor state metrics**: Track time in each state to identify bottlenecks
8. **Test edge cases**: Ensure HOLD and KILLED states work correctly in all scenarios

## Related Documentation

- [Issue State Machine Documentation](../ISSUE_STATE_MACHINE.md)
- [Workflow Schema](../WORKFLOW-SCHEMA.md)
- [Database Schema](../architecture/database-schema.md)
