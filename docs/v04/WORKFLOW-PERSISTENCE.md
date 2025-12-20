# Workflow Persistence & Logging

This document describes the workflow execution persistence and logging implementation in AFU-9 v0.2.

## Overview

The workflow engine now includes comprehensive database persistence for workflow executions, enabling:

- **Execution Tracking**: All workflow executions are recorded in PostgreSQL
- **Step Logging**: Each step execution is logged with start/end times, status, and results
- **State Reconstruction**: Execution state can be reconstructed from the database
- **Resume Capability**: Failed workflows can be analyzed and potentially resumed
- **Audit Trail**: Complete history of all workflow operations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Engine                           │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │              execute(workflow, context)            │     │
│  └────────────────────┬───────────────────────────────┘     │
│                       │                                      │
│                       ▼                                      │
│  ┌────────────────────────────────────────────────────┐     │
│  │         createExecution() → execution_id           │     │
│  └────────────────────┬───────────────────────────────┘     │
│                       │                                      │
│                       ▼                                      │
│  ┌────────────────────────────────────────────────────┐     │
│  │    For each step:                                  │     │
│  │      1. createStep() → step_id                     │     │
│  │      2. Execute MCP tool call                      │     │
│  │      3. updateStep(status, output, duration)       │     │
│  │      4. updateExecutionContext(variables)          │     │
│  └────────────────────┬───────────────────────────────┘     │
│                       │                                      │
│                       ▼                                      │
│  ┌────────────────────────────────────────────────────┐     │
│  │    updateExecutionStatus(status, output, error)    │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │   PostgreSQL RDS     │
                │                      │
                │  workflow_executions │
                │  workflow_steps      │
                └──────────────────────┘
```

## Database Schema

### workflow_executions

Stores high-level information about workflow executions.

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id),
  status VARCHAR(50) NOT NULL,
  input JSONB,
  output JSONB,
  context JSONB,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT,
  triggered_by VARCHAR(255),
  github_run_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Fields:**
- `id`: Unique execution identifier (UUID)
- `workflow_id`: Reference to the workflow definition (nullable for ad-hoc workflows)
- `status`: Current execution status (`pending`, `running`, `completed`, `failed`, `cancelled`)
- `input`: Input data provided to the workflow (JSONB)
- `output`: Final output/variables from the workflow (JSONB)
- `context`: Full execution context including variables (JSONB)
- `started_at`: Execution start timestamp
- `completed_at`: Execution completion timestamp
- `error`: Error message if execution failed
- `triggered_by`: User or system that triggered the execution
- `github_run_id`: Associated GitHub Actions run ID

### workflow_steps

Stores detailed information about individual step executions.

```sql
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id),
  step_name VARCHAR(255) NOT NULL,
  step_index INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  input JSONB,
  output JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Fields:**
- `id`: Unique step identifier (UUID)
- `execution_id`: Reference to parent execution
- `step_name`: Human-readable step name
- `step_index`: Step position in the workflow (0-indexed)
- `status`: Step status (`pending`, `running`, `completed`, `failed`, `skipped`)
- `input`: Parameters passed to the tool (JSONB)
- `output`: Result returned from the tool (JSONB)
- `started_at`: Step start timestamp
- `completed_at`: Step completion timestamp
- `duration_ms`: Execution duration in milliseconds
- `error`: Error message if step failed
- `retry_count`: Number of retry attempts

## Implementation

### Database Connection

**File:** `control-center/src/lib/db.ts`

Provides PostgreSQL connection pool management:

```typescript
import { getPool } from './lib/db';

const pool = getPool();
const result = await pool.query('SELECT * FROM workflow_executions');
```

**Configuration:**

Environment variables for database connection:

```bash
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=postgres
DATABASE_PASSWORD=<password>
```

### Persistence Layer

**File:** `control-center/src/lib/workflow-persistence.ts`

Provides CRUD operations for workflow executions and steps:

#### Create Execution

```typescript
import { createExecution } from './lib/workflow-persistence';

const executionId = await createExecution(
  workflowId,      // Workflow definition ID (or null)
  input,           // Input data
  context,         // Execution context
  'user@example',  // Triggered by
  'run-123'        // GitHub run ID
);
```

#### Update Execution Status

```typescript
import { updateExecutionStatus } from './lib/workflow-persistence';

await updateExecutionStatus(
  executionId,
  'completed',     // Status
  outputData,      // Output variables
  null             // Error (if any)
);
```

#### Create Step

```typescript
import { createStep } from './lib/workflow-persistence';

const stepId = await createStep(
  executionId,
  'fetch_issue',   // Step name
  0,               // Step index
  params           // Step parameters
);
```

#### Update Step

```typescript
import { updateStep } from './lib/workflow-persistence';

await updateStep(
  stepId,
  'completed',     // Status
  output,          // Step output
  null,            // Error (if any)
  1234             // Duration in ms
);
```

### Enhanced Workflow Engine

**File:** `control-center/src/lib/workflow-engine.ts`

The workflow engine automatically persists execution state when database is available:

```typescript
import { WorkflowEngine } from './lib/workflow-engine';

const engine = new WorkflowEngine(mcpClient, true); // Enable persistence

const result = await engine.execute(workflow, context);
// Execution is automatically persisted to database
```

**Key Features:**

1. **Graceful Degradation**: Engine works without database, logging warnings
2. **Automatic Persistence**: All executions and steps are logged automatically
3. **Context Updates**: Variables are saved after each assignment
4. **Error Tracking**: Failures and retry attempts are recorded
5. **Duration Tracking**: Step and execution durations are measured

## API Endpoints

### Get Execution Status

**Endpoint:** `GET /api/workflow/execution/[id]`

Retrieves complete execution details including all steps.

**Example Request:**

```bash
curl http://localhost:3000/api/workflow/execution/a3f2e8b4-5c7d-4e8f-9a0b-1c2d3e4f5g6h
```

**Example Response:**

```json
{
  "execution": {
    "id": "a3f2e8b4-5c7d-4e8f-9a0b-1c2d3e4f5g6h",
    "workflowId": null,
    "status": "completed",
    "input": { "issue_number": 123 },
    "output": { "issue": { ... }, "branch": { ... } },
    "context": { ... },
    "startedAt": "2025-12-11T20:00:00.000Z",
    "completedAt": "2025-12-11T20:00:05.234Z",
    "error": null,
    "triggeredBy": "user@example.com",
    "githubRunId": null
  },
  "steps": [
    {
      "id": "b4c5d6e7-f8g9-h0i1-j2k3-l4m5n6o7p8q9",
      "name": "fetch_issue",
      "index": 0,
      "status": "completed",
      "input": { "owner": "...", "repo": "...", "number": "123" },
      "output": { "number": 123, "title": "...", ... },
      "startedAt": "2025-12-11T20:00:00.100Z",
      "completedAt": "2025-12-11T20:00:01.234Z",
      "durationMs": 1134,
      "error": null,
      "retryCount": 0
    },
    ...
  ],
  "metadata": {
    "totalSteps": 3,
    "completedSteps": 3,
    "failedSteps": 0,
    "skippedSteps": 0
  }
}
```

### List Recent Executions

**Endpoint:** `GET /api/workflow/executions?limit=50`

Lists recent workflow executions.

**Example Request:**

```bash
curl http://localhost:3000/api/workflow/executions?limit=10
```

**Example Response:**

```json
{
  "executions": [
    {
      "id": "a3f2e8b4-5c7d-4e8f-9a0b-1c2d3e4f5g6h",
      "workflowId": null,
      "status": "completed",
      "startedAt": "2025-12-11T20:00:00.000Z",
      "completedAt": "2025-12-11T20:00:05.234Z",
      "error": null,
      "triggeredBy": "user@example.com",
      "githubRunId": null
    },
    ...
  ],
  "total": 10
}
```

## Querying Execution History

### Get Recent Executions

```sql
SELECT 
  id,
  status,
  started_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 as duration_ms
FROM workflow_executions
ORDER BY started_at DESC
LIMIT 50;
```

### Get Execution Steps

```sql
SELECT 
  step_name,
  step_index,
  status,
  duration_ms,
  retry_count,
  error
FROM workflow_steps
WHERE execution_id = 'a3f2e8b4-5c7d-4e8f-9a0b-1c2d3e4f5g6h'
ORDER BY step_index ASC;
```

### Find Failed Executions

```sql
SELECT 
  we.id,
  we.started_at,
  we.error,
  COUNT(ws.id) as total_steps,
  COUNT(ws.id) FILTER (WHERE ws.status = 'failed') as failed_steps
FROM workflow_executions we
LEFT JOIN workflow_steps ws ON ws.execution_id = we.id
WHERE we.status = 'failed'
GROUP BY we.id
ORDER BY we.started_at DESC;
```

### Calculate Average Step Duration

```sql
SELECT 
  step_name,
  COUNT(*) as executions,
  AVG(duration_ms) as avg_duration_ms,
  MIN(duration_ms) as min_duration_ms,
  MAX(duration_ms) as max_duration_ms
FROM workflow_steps
WHERE status = 'completed'
GROUP BY step_name
ORDER BY avg_duration_ms DESC;
```

## Execution Reconstruction

To reconstruct a workflow execution from the database:

```typescript
import { getExecution, getExecutionSteps } from './lib/workflow-persistence';

async function reconstructExecution(executionId: string) {
  // Get execution record
  const execution = await getExecution(executionId);
  if (!execution) {
    throw new Error('Execution not found');
  }

  // Get all steps
  const steps = await getExecutionSteps(executionId);

  // Reconstruct execution state
  const state = {
    executionId: execution.id,
    status: execution.status,
    input: execution.input,
    context: execution.context,
    steps: steps.map(step => ({
      name: step.step_name,
      status: step.status,
      output: step.output,
      duration: step.duration_ms,
      retries: step.retry_count,
    })),
  };

  return state;
}
```

## Resume/Retry Failed Workflows

While automatic resume is not yet implemented, you can manually retry a failed workflow:

1. Query the failed execution to understand what failed:

```typescript
const execution = await getExecution(failedExecutionId);
const steps = await getExecutionSteps(failedExecutionId);

// Find the failed step
const failedStep = steps.find(s => s.status === 'failed');
console.log('Failed step:', failedStep.step_name);
console.log('Error:', failedStep.error);
```

2. Create a new workflow starting from the failed step:

```typescript
// Load the original workflow context
const context = execution.context;

// Create a new workflow with remaining steps
const remainingSteps = originalWorkflow.steps.slice(failedStep.step_index);
const retryWorkflow = { steps: remainingSteps };

// Execute the retry
const result = await engine.execute(retryWorkflow, context);
```

## Best Practices

### 1. Enable Persistence in Production

Always enable persistence in production environments:

```typescript
const engine = new WorkflowEngine(mcpClient, true);
```

### 2. Monitor Database Size

Workflow executions can accumulate. Consider:

- Archiving old executions to S3
- Implementing retention policies
- Creating summary tables for analytics

```sql
-- Archive old completed executions (older than 90 days)
DELETE FROM workflow_executions
WHERE status = 'completed'
  AND completed_at < NOW() - INTERVAL '90 days';
```

### 3. Index Performance

Ensure indexes are optimized for common queries:

```sql
-- Already created in migration, but ensure they exist
CREATE INDEX IF NOT EXISTS idx_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_started_at ON workflow_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_steps_execution_id ON workflow_steps(execution_id);
```

### 4. Error Handling

Always check execution status:

```typescript
const result = await engine.execute(workflow, context);

if (result.status === 'failed') {
  console.error('Workflow failed:', result.error);
  // Query database for detailed error information
  const steps = await getExecutionSteps(result.executionId);
  const failedSteps = steps.filter(s => s.status === 'failed');
  console.log('Failed steps:', failedSteps);
}
```

### 5. Context Size

Be mindful of context size - large contexts are serialized to JSONB:

```typescript
// Avoid storing large binary data in context
// Instead, store references (URLs, IDs)
context.variables.largeFile = {
  url: 's3://bucket/file.zip',
  size: 1024000,
  // Don't store: content: <binary data>
};
```

## Troubleshooting

### Database Connection Issues

If persistence fails, the engine logs warnings but continues:

```
[Workflow Engine] Database not available, running without persistence
```

**Solutions:**
- Check database credentials in environment variables
- Verify database is running: `pg_isready -h $DATABASE_HOST -p $DATABASE_PORT`
- Check network connectivity to RDS instance
- Verify security group rules allow connections

### Missing Execution Records

If executions are not being persisted:

1. Check database connection:

```typescript
import { checkDatabase } from './lib/db';
const available = await checkDatabase();
console.log('Database available:', available);
```

2. Check for errors in logs:

```bash
grep "Workflow Persistence" logs/application.log
```

3. Verify table exists:

```sql
SELECT tablename FROM pg_tables WHERE tablename = 'workflow_executions';
```

## Future Enhancements

- [ ] Automatic workflow resume after failure
- [ ] Workflow execution pause/resume
- [ ] Execution step replay
- [ ] Workflow execution analytics dashboard
- [ ] Real-time execution monitoring via WebSocket
- [ ] Execution timeline visualization
- [ ] Cost tracking per execution
- [ ] Execution history comparison

## See Also

- [Workflow Engine Documentation](./WORKFLOW-ENGINE.md)
- [Workflow Schema](./WORKFLOW-SCHEMA.md)
- [Database Schema](./architecture/database-schema.md)
- [MCP Client Documentation](../mcp-servers/README.md)
