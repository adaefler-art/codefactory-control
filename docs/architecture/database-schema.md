# Database Schema

AFU-9 v0.2 uses PostgreSQL 15 on AWS RDS for persistent storage.

## Schema Design Principles

1. **UUID Primary Keys**: All tables use UUIDs for globally unique identifiers
2. **JSONB for Flexibility**: Complex configurations stored as JSONB for schema flexibility
3. **Audit Timestamps**: All tables have `created_at` and `updated_at` fields
4. **Soft Deletes**: Where appropriate, records are marked as disabled rather than deleted

## Core Tables

### workflows

Stores workflow definitions (templates for execution).

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  definition JSONB NOT NULL,
  version INTEGER DEFAULT 1,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workflows_name ON workflows(name);
CREATE INDEX idx_workflows_enabled ON workflows(enabled);
```

**definition JSONB Structure**:
```json
{
  "steps": [
    {
      "name": "fetch_issue",
      "tool": "github.getIssue",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "number": "${input.issue_number}"
      },
      "assign": "issue"
    },
    {
      "name": "create_branch",
      "tool": "github.createBranch",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "branch": "fix/${issue.number}",
        "from": "${repo.default_branch}"
      },
      "assign": "branch"
    }
  ],
  "errorHandling": {
    "retryStrategy": "exponential",
    "maxRetries": 3
  }
}
```

### workflow_executions

Tracks individual workflow runs.

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
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

CREATE INDEX idx_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX idx_executions_status ON workflow_executions(status);
CREATE INDEX idx_executions_started_at ON workflow_executions(started_at DESC);

-- Check constraint for valid status values
ALTER TABLE workflow_executions ADD CONSTRAINT chk_execution_status 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
```

**Status Values**:
- `pending`: Execution queued but not started
- `running`: Currently executing
- `completed`: Successfully completed
- `failed`: Failed with error
- `cancelled`: Manually cancelled

### workflow_steps

Tracks execution of individual workflow steps.

```sql
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_name VARCHAR(255) NOT NULL,
  step_index INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
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

CREATE INDEX idx_steps_execution_id ON workflow_steps(execution_id);
CREATE INDEX idx_steps_status ON workflow_steps(status);
CREATE INDEX idx_steps_execution_step ON workflow_steps(execution_id, step_index);

ALTER TABLE workflow_steps ADD CONSTRAINT chk_step_status 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped'));
```

### mcp_servers

Configuration for available MCP servers.

```sql
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  endpoint VARCHAR(500) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB,
  health_check_url VARCHAR(500),
  last_health_check TIMESTAMP,
  health_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX idx_mcp_servers_enabled ON mcp_servers(enabled);
```

**config JSONB Structure**:
```json
{
  "timeout_ms": 30000,
  "retries": 3,
  "tools": [
    "github.getIssue",
    "github.createPullRequest"
  ],
  "auth": {
    "type": "secrets_manager",
    "secret_name": "afu9-github"
  }
}
```

**Example Records**:
```sql
INSERT INTO mcp_servers (name, description, endpoint, config) VALUES
  ('github', 'GitHub operations', 'http://localhost:3001', '{"timeout_ms": 30000}'),
  ('deploy', 'AWS ECS deployments', 'http://localhost:3002', '{"timeout_ms": 60000}'),
  ('observability', 'CloudWatch monitoring', 'http://localhost:3003', '{"timeout_ms": 15000}');
```

### repositories

Configured GitHub repositories.

```sql
CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(511) GENERATED ALWAYS AS (owner || '/' || name) STORED,
  default_branch VARCHAR(255) DEFAULT 'main',
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(owner, name)
);

CREATE INDEX idx_repos_owner_name ON repositories(owner, name);
CREATE INDEX idx_repos_enabled ON repositories(enabled);
CREATE INDEX idx_repos_full_name ON repositories(full_name);
```

**config JSONB Structure**:
```json
{
  "auto_workflows": {
    "issue_opened": "issue_to_pr",
    "pr_failed": "fix_ci"
  },
  "branch_patterns": {
    "bugfix": "fix/${issue.number}",
    "feature": "feat/${issue.number}"
  },
  "labels": {
    "auto_created": "afu-9:auto",
    "needs_review": "review-needed"
  }
}
```

### agent_runs

Tracks individual agent (LLM) invocations.

```sql
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_id UUID REFERENCES workflow_steps(id) ON DELETE CASCADE,
  agent_type VARCHAR(100) NOT NULL,
  model VARCHAR(100),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  cost_usd DECIMAL(10, 6),
  input JSONB,
  output JSONB,
  tool_calls JSONB,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_execution_id ON agent_runs(execution_id);
CREATE INDEX idx_agent_runs_agent_type ON agent_runs(agent_type);
CREATE INDEX idx_agent_runs_started_at ON agent_runs(started_at DESC);
```

**tool_calls JSONB Structure**:
```json
[
  {
    "tool": "github.getIssue",
    "params": {"owner": "adaefler-art", "repo": "test", "number": 123},
    "result": {"title": "Bug fix", "body": "..."},
    "duration_ms": 450
  }
]
```

### mcp_tool_calls

Tracks all MCP tool invocations for auditing and debugging.

```sql
CREATE TABLE mcp_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  server_name VARCHAR(255) NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  params JSONB,
  result JSONB,
  error TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_execution_id ON mcp_tool_calls(execution_id);
CREATE INDEX idx_tool_calls_server_tool ON mcp_tool_calls(server_name, tool_name);
CREATE INDEX idx_tool_calls_started_at ON mcp_tool_calls(started_at DESC);
```

## Migration Scripts

### Initial Migration (001_initial_schema.sql)

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create all tables in order
-- (workflows, workflow_executions, workflow_steps, etc.)

-- Create indexes

-- Insert default MCP servers
INSERT INTO mcp_servers (name, description, endpoint, enabled) VALUES
  ('github', 'GitHub operations MCP server', 'http://localhost:3001', true),
  ('deploy', 'AWS ECS deployment MCP server', 'http://localhost:3002', true),
  ('observability', 'CloudWatch observability MCP server', 'http://localhost:3003', true);
```

## Queries

### Common Queries

**Get active workflow executions**:
```sql
SELECT 
  we.id,
  w.name as workflow_name,
  we.status,
  we.started_at,
  NOW() - we.started_at as duration
FROM workflow_executions we
JOIN workflows w ON we.workflow_id = w.id
WHERE we.status IN ('pending', 'running')
ORDER BY we.started_at DESC;
```

**Get workflow execution with steps**:
```sql
SELECT 
  we.id as execution_id,
  w.name as workflow_name,
  we.status as execution_status,
  ws.step_name,
  ws.status as step_status,
  ws.duration_ms,
  ws.error
FROM workflow_executions we
JOIN workflows w ON we.workflow_id = w.id
LEFT JOIN workflow_steps ws ON ws.execution_id = we.id
WHERE we.id = $1
ORDER BY ws.step_index;
```

**Get agent performance metrics**:
```sql
SELECT 
  agent_type,
  model,
  COUNT(*) as total_runs,
  AVG(duration_ms) as avg_duration_ms,
  AVG(total_tokens) as avg_tokens,
  SUM(cost_usd) as total_cost_usd
FROM agent_runs
WHERE started_at > NOW() - INTERVAL '7 days'
  AND error IS NULL
GROUP BY agent_type, model
ORDER BY total_runs DESC;
```

**Get MCP tool usage statistics**:
```sql
SELECT 
  server_name,
  tool_name,
  COUNT(*) as call_count,
  AVG(duration_ms) as avg_duration_ms,
  COUNT(CASE WHEN error IS NOT NULL THEN 1 END) as error_count
FROM mcp_tool_calls
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY server_name, tool_name
ORDER BY call_count DESC;
```

## Database Maintenance

### Regular Tasks

1. **Vacuum and Analyze** (weekly):
   ```sql
   VACUUM ANALYZE;
   ```

2. **Archive Old Executions** (monthly):
   ```sql
   -- Archive executions older than 90 days to S3 or another DB
   -- Then delete:
   DELETE FROM workflow_executions 
   WHERE completed_at < NOW() - INTERVAL '90 days';
   ```

3. **Update Statistics** (daily):
   ```sql
   ANALYZE workflow_executions;
   ANALYZE workflow_steps;
   ANALYZE agent_runs;
   ANALYZE mcp_tool_calls;
   ```

### Backup Strategy

- **Automated Backups**: AWS RDS automated backups (7-day retention)
- **Manual Snapshots**: Before major changes
- **Point-in-Time Recovery**: Enabled on RDS
- **Export to S3**: Monthly export for long-term archival

## Performance Considerations

1. **Indexes**: Strategic indexes on foreign keys and frequently queried columns
2. **Partitioning**: Consider partitioning large tables (workflow_executions, mcp_tool_calls) by date
3. **JSONB**: Use JSONB operators for efficient queries on JSON fields
4. **Connection Pooling**: Use PgBouncer or similar for connection management
5. **Read Replicas**: Consider read replicas for reporting queries

## Security

1. **Encryption**: RDS encryption at rest enabled
2. **SSL/TLS**: Required for all connections
3. **Least Privilege**: Application uses dedicated role with minimal permissions
4. **No Secrets in DB**: Secrets stored in AWS Secrets Manager, referenced by name only
5. **Audit Logging**: Enable RDS audit logs for sensitive operations
