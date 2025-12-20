# AFU-9 Database

This directory contains database schema definitions and migrations for the AFU-9 RDS Postgres database.

## Overview

AFU-9 uses PostgreSQL 15 on AWS RDS for persistent storage of:
- Workflow definitions and executions
- MCP server configurations
- Repository settings
- Agent run history and metrics
- Tool call auditing

## Database Configuration

- **Engine**: PostgreSQL 15.5
- **Instance**: db.t4g.micro (1 vCPU, 1 GB RAM)
- **Storage**: 20 GB GP3 (auto-scaling up to 100 GB)
- **Region**: eu-central-1
- **Multi-AZ**: Configurable (default: single-AZ for cost optimization)
- **Backups**: Automated daily backups with 7-day retention
- **Encryption**: At rest with AWS KMS, in transit with SSL/TLS

## Directory Structure

```
database/
├── README.md                       # This file
├── workflow-schema.json            # JSON schema for workflow validation
├── migrations/                     # SQL migration scripts
│   ├── 001_initial_schema.sql      # Initial database schema
│   └── 002_add_example_workflows.sql # Additional example workflows
└── examples/                       # Example workflow JSON files
    ├── README.md                   # Examples documentation
    ├── issue_to_pr.json            # Basic issue-to-PR workflow
    └── fix_deploy_failure.json     # Deploy failure recovery workflow
```

## Migrations

Migration files are SQL scripts that define database schema changes. They follow a naming convention:

```
NNN_description.sql
```

Where:
- `NNN` is a 3-digit sequence number (001, 002, 003, etc.)
- `description` is a short description of the migration

### Current Migrations

#### 001_initial_schema.sql
Initial database schema for AFU-9 v0.2, including:
- Core tables: workflows, workflow_executions, workflow_steps
- MCP configuration: mcp_servers, mcp_tool_calls
- Repository management: repositories
- Agent tracking: agent_runs
- Indexes for performance
- Update triggers
- Default data (MCP server configs, example workflow)

#### 002_add_example_workflows.sql
Additional example workflows for common use cases:
- `fix_deploy_failure` - Diagnose and fix deployment failures
- `pr_review_workflow` - Automated PR review and feedback
- `ci_failure_handler` - Handle CI/CD pipeline failures
- `issue_triage` - Automatically triage and label issues
- `dependency_update` - Automated dependency updates

## Running Migrations

### Prerequisites

1. **PostgreSQL Client**: Install `psql`
   ```bash
   # macOS
   brew install postgresql
   
   # Ubuntu/Debian
   sudo apt-get install postgresql-client
   ```

2. **AWS CLI**: Configured with credentials
   ```bash
   aws configure
   ```

3. **Network Access**: Database is in private subnet
   - Use Session Manager port forwarding (recommended)
   - Use bastion host with SSH tunnel
   - Use temporary security group rule (development only)
   
   See [docs/DATABASE-LOCAL-DEVELOPMENT.md](../docs/DATABASE-LOCAL-DEVELOPMENT.md) for details.

### Using the Migration Script

The simplest way to run migrations:

```bash
# From project root
./scripts/deploy-migrations.sh

# Or run a specific migration
./scripts/deploy-migrations.sh 001_initial_schema.sql
```

The script automatically:
1. Retrieves credentials from AWS Secrets Manager
2. Tests database connectivity
3. Runs migrations in order
4. Shows statistics and results

### Manual Migration

If you prefer manual control:

```bash
# Load database credentials
export $(aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r 'to_entries|map("PG\(.key|ascii_upcase)=\(.value|tostring)")|.[]')

export PGSSLMODE=require

# Run migration
psql -f database/migrations/001_initial_schema.sql

# Or all migrations in order
for migration in database/migrations/*.sql; do
  echo "Running $migration..."
  psql -f "$migration"
done
```

## Database Schema

### Core Tables

#### workflows
Stores workflow definitions (templates).

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  definition JSONB NOT NULL,  -- Workflow steps and config
  version INTEGER DEFAULT 1,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### workflow_executions
Tracks individual workflow runs.

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES workflows(id),
  status VARCHAR(50) NOT NULL,  -- pending, running, completed, failed, cancelled
  input JSONB,
  output JSONB,
  context JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error TEXT,
  triggered_by VARCHAR(255),
  github_run_id VARCHAR(255),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### workflow_steps
Tracks execution of individual steps within a workflow.

```sql
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY,
  execution_id UUID REFERENCES workflow_executions(id),
  step_name VARCHAR(255) NOT NULL,
  step_index INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,  -- pending, running, completed, failed, skipped
  input JSONB,
  output JSONB,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### MCP Tables

#### mcp_servers
Configuration for available MCP servers.

```sql
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  endpoint VARCHAR(500) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB,  -- timeout, retries, tools, auth
  health_check_url VARCHAR(500),
  last_health_check TIMESTAMP,
  health_status VARCHAR(50),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

#### mcp_tool_calls
Audits all MCP tool invocations.

```sql
CREATE TABLE mcp_tool_calls (
  id UUID PRIMARY KEY,
  execution_id UUID REFERENCES workflow_executions(id),
  agent_run_id UUID REFERENCES agent_runs(id),
  server_name VARCHAR(255) NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  params JSONB,
  result JSONB,
  error TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP
);
```

### Repository Tables

#### repositories
Configured GitHub repositories.

```sql
CREATE TABLE repositories (
  id UUID PRIMARY KEY,
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  full_name VARCHAR(511) GENERATED,  -- owner/name
  default_branch VARCHAR(255) DEFAULT 'main',
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB,  -- auto_workflows, branch_patterns, labels
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(owner, name)
);
```

### Agent Tables

#### agent_runs
Tracks LLM agent invocations.

```sql
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY,
  execution_id UUID REFERENCES workflow_executions(id),
  step_id UUID REFERENCES workflow_steps(id),
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
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP
);
```

## Connecting to the Database

### From Application (ECS)

The application automatically reads credentials from AWS Secrets Manager:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Pool } from 'pg';

// Get credentials from Secrets Manager
const client = new SecretsManagerClient({ region: 'eu-central-1' });
const secret = await client.send(
  new GetSecretValueCommand({ SecretId: 'afu9-database' })
);
const credentials = JSON.parse(secret.SecretString);

// Create connection pool
const pool = new Pool({
  host: credentials.host,
  port: credentials.port,
  database: credentials.database,
  user: credentials.username,
  password: credentials.password,
  ssl: { rejectUnauthorized: true },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
```

### From Local Development

See [docs/DATABASE-LOCAL-DEVELOPMENT.md](../docs/DATABASE-LOCAL-DEVELOPMENT.md) for detailed instructions on:
- Setting up port forwarding with Session Manager
- Using SSH tunnels via bastion host
- Configuring local database tools (pgAdmin, DBeaver, VS Code)
- Running queries and migrations locally

### Quick Local Connection

```bash
# Load credentials
source <(aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq -r 'to_entries|map("export PG\(.key|ascii_upcase)=\(.value|tostring)")|.[]')

export PGSSLMODE=require

# Connect (requires port forwarding or network access)
psql
```

## Common Operations

### View All Tables

```sql
\dt
```

### View Table Schema

```sql
\d workflows
```

### Query Workflow Executions

```sql
SELECT 
  we.id,
  w.name AS workflow_name,
  we.status,
  we.started_at,
  we.completed_at,
  we.error
FROM workflow_executions we
JOIN workflows w ON we.workflow_id = w.id
ORDER BY we.started_at DESC
LIMIT 10;
```

### Query MCP Tool Statistics

```sql
SELECT 
  server_name,
  tool_name,
  COUNT(*) AS call_count,
  AVG(duration_ms) AS avg_duration_ms,
  COUNT(CASE WHEN error IS NOT NULL THEN 1 END) AS error_count
FROM mcp_tool_calls
WHERE started_at > NOW() - INTERVAL '24 hours'
GROUP BY server_name, tool_name
ORDER BY call_count DESC;
```

### Query Agent Performance

```sql
SELECT 
  agent_type,
  model,
  COUNT(*) AS total_runs,
  AVG(duration_ms) AS avg_duration_ms,
  AVG(total_tokens) AS avg_tokens,
  SUM(cost_usd) AS total_cost_usd
FROM agent_runs
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY agent_type, model
ORDER BY total_runs DESC;
```

## Backup and Recovery

### Automated Backups

AWS RDS automatically creates daily backups:
- **Retention**: 7 days
- **Backup Window**: 02:00-03:00 UTC
- **Point-in-Time Recovery**: Available for up to 7 days

### Manual Snapshot

```bash
# Create manual snapshot
aws rds create-db-snapshot \
  --db-instance-identifier afu9-postgres \
  --db-snapshot-identifier afu9-manual-$(date +%Y%m%d-%H%M%S) \
  --region eu-central-1
```

### Restore from Snapshot

```bash
# List available snapshots
aws rds describe-db-snapshots \
  --db-instance-identifier afu9-postgres \
  --region eu-central-1

# Restore from snapshot (creates new instance)
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier afu9-postgres-restored \
  --db-snapshot-identifier afu9-manual-20241211-120000 \
  --region eu-central-1
```

### Export to S3

```bash
# Export snapshot to S3 for long-term archival
aws rds start-export-task \
  --export-task-identifier afu9-export-$(date +%Y%m%d) \
  --source-arn arn:aws:rds:eu-central-1:xxx:snapshot:afu9-manual-20241211 \
  --s3-bucket-name afu9-backups \
  --iam-role-arn arn:aws:iam::xxx:role/rds-export-role \
  --kms-key-id arn:aws:kms:eu-central-1:xxx:key/xxx \
  --region eu-central-1
```

## Monitoring

### CloudWatch Metrics

Key RDS metrics to monitor:
- `CPUUtilization`
- `DatabaseConnections`
- `FreeableMemory`
- `FreeStorageSpace`
- `ReadLatency` / `WriteLatency`
- `ReadIOPS` / `WriteIOPS`

### Query Performance

Enable slow query logging:

```sql
-- Show current settings
SHOW log_min_duration_statement;

-- Enable slow query logging (requires parameter group change)
-- Set log_min_duration_statement = 1000 (1 second)
```

View slow queries in CloudWatch Logs:
```bash
aws logs tail /aws/rds/instance/afu9-postgres/postgresql --follow
```

## Maintenance

### Regular Tasks

1. **Vacuum** (automated by AWS): Reclaim space and update statistics
2. **Analyze** (periodic): Update query planner statistics
3. **Archive Old Data** (monthly): Move old executions to S3 or archive table
4. **Review Indexes**: Check for missing or unused indexes

### Manual Vacuum and Analyze

```sql
-- Analyze tables for query optimization
ANALYZE;

-- Vacuum and analyze (run during low traffic)
VACUUM ANALYZE;
```

### Check Database Size

```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('afu9'));

-- Table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Security

### Best Practices

1. **Never commit credentials**: Always use Secrets Manager
2. **Use SSL/TLS**: Enforce `sslmode=require`
3. **Least privilege**: Use read-only users for queries
4. **Audit logging**: Enable RDS audit logs
5. **Network isolation**: Database in private subnet only
6. **Regular backups**: Automated daily + manual before changes
7. **Encryption**: At rest (KMS) and in transit (SSL/TLS)

### Create Read-Only User

For development and reporting:

```sql
-- Create read-only role
CREATE ROLE afu9_readonly WITH LOGIN PASSWORD 'secure-password';

-- Grant permissions
GRANT CONNECT ON DATABASE afu9 TO afu9_readonly;
GRANT USAGE ON SCHEMA public TO afu9_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO afu9_readonly;

-- Grant on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO afu9_readonly;
```

## Troubleshooting

### Connection Issues

1. **Check RDS instance status**:
   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier afu9-postgres \
     --region eu-central-1 \
     --query "DBInstances[0].DBInstanceStatus"
   ```

2. **Verify security group rules**:
   ```bash
   aws ec2 describe-security-groups \
     --group-ids $(aws cloudformation describe-stacks \
       --stack-name Afu9NetworkStack \
       --query "Stacks[0].Outputs[?OutputKey=='DbSecurityGroupId'].OutputValue" \
       --output text) \
     --region eu-central-1
   ```

3. **Test network connectivity**:
   ```bash
   nc -zv <db-endpoint> 5432
   ```

### Performance Issues

1. **Check active connections**:
   ```sql
   SELECT count(*) FROM pg_stat_activity WHERE state = 'active';
   ```

2. **Identify slow queries**:
   ```sql
   SELECT pid, now() - query_start as duration, query
   FROM pg_stat_activity
   WHERE state = 'active' AND now() - query_start > interval '5 seconds';
   ```

3. **Check locks**:
   ```sql
   SELECT * FROM pg_locks WHERE granted = false;
   ```

## Workflow Model

AFU-9 uses a generic workflow model for orchestrating autonomous code fabrication. See these resources for details:

- **[Workflow Schema Documentation](../docs/WORKFLOW-SCHEMA.md)** - Complete workflow JSON format specification
- **[Workflow Examples](examples/README.md)** - Example workflows with detailed documentation
- **[JSON Schema](workflow-schema.json)** - JSON schema for workflow validation

### Quick Start with Workflows

1. **View example workflows**: Check `database/examples/` directory
2. **Validate workflow JSON**: Use `workflow-schema.json` for validation
3. **Load workflows to database**: Run migrations to add example workflows
4. **Create custom workflows**: Follow the schema and examples

## Additional Resources

- [PostgreSQL 15 Documentation](https://www.postgresql.org/docs/15/)
- [AWS RDS PostgreSQL Guide](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html)
- [AFU-9 Architecture Overview](../docs/architecture/afu9-v0.2-overview.md)
- [Database Schema Documentation](../docs/architecture/database-schema.md)
- [Workflow Engine Documentation](../docs/WORKFLOW-ENGINE.md)
- [Local Development Guide](../docs/DATABASE-LOCAL-DEVELOPMENT.md)
- [Deployment Guide](../docs/DEPLOYMENT.md)
