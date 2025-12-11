# AFU-9 Workflow Model Implementation Summary

This document summarizes the implementation of the generic workflow model for AFU-9 as defined in issue #36.

## Overview

The workflow model provides a standardized, database-backed system for orchestrating autonomous code fabrication tasks. It supports:

- **Generic workflow definitions** stored in PostgreSQL
- **JSON-based convention format** for workflow specification
- **Variable substitution** for dynamic parameter values
- **Conditional execution** for adaptive workflows
- **Error handling and retries** for resilient execution
- **Comprehensive persistence** of execution history and state

## Implementation Components

### 1. Database Schema

**Location**: `database/migrations/`

#### Tables Created

- **`workflows`** - Workflow definitions (templates)
  - Stores workflow JSON with steps, parameters, and configuration
  - Versioning support for workflow evolution
  - Enable/disable flags for workflow management
  
- **`workflow_executions`** - Execution tracking
  - Status tracking (pending, running, completed, failed, cancelled)
  - Input/output/context storage as JSONB
  - Timing and error information
  - GitHub integration fields
  
- **`workflow_steps`** - Step-level execution tracking
  - Individual step status and timing
  - Input/output capture for debugging
  - Retry counting
  - Error details

#### Migrations

- **`001_initial_schema.sql`** (existing) - Core database schema with basic workflow support
- **`002_add_example_workflows.sql`** (new) - Five additional example workflows:
  - `fix_deploy_failure` - Automated deployment failure diagnosis and recovery
  - `pr_review_workflow` - Automated code review
  - `ci_failure_handler` - CI/CD failure handling
  - `issue_triage` - Automated issue classification and labeling
  - `dependency_update` - Automated dependency updates

### 2. JSON Convention Format

**Location**: `docs/WORKFLOW-SCHEMA.md`

#### Workflow Structure

```json
{
  "name": "workflow_name",
  "description": "Human-readable description",
  "steps": [
    {
      "name": "step_name",
      "tool": "server.toolName",
      "params": { /* parameters */ },
      "assign": "variable_name",
      "if": "${condition}",
      "retry": { /* retry config */ }
    }
  ],
  "config": {
    "timeoutMs": 300000,
    "continueOnError": false,
    "maxRetries": 0
  }
}
```

#### Key Features

- **Variable Substitution**: `${path}` syntax for accessing context variables
  - `${input.field}` - workflow input
  - `${repo.owner}` - repository context
  - `${stepName.field}` - previous step outputs
  
- **Conditional Execution**: `if` field for conditional steps
  - Simple existence checks: `"${variable}"`
  - Future: comparison operators, logical expressions
  
- **Error Handling**: Step-level and workflow-level retry policies
  - Exponential, linear, or fixed backoff
  - Configurable retry limits
  - Continue-on-error support

### 3. JSON Schema Validation

**Location**: `database/workflow-schema.json`

Formal JSON Schema (draft-07) for workflow validation:
- Enforces required fields
- Validates field types and formats
- Pattern matching for naming conventions
- Examples for documentation

Can be used with tools like `ajv-cli`:
```bash
npx ajv-cli validate -s database/workflow-schema.json -d workflow.json
```

### 4. Example Workflows

**Location**: `database/examples/`

#### Available Examples

1. **issue_to_pr.json**
   - Convert GitHub issue to pull request
   - 3 steps: fetch issue, create branch, create PR
   - Basic workflow demonstrating variable substitution

2. **fix_deploy_failure.json**
   - Automated deployment failure recovery
   - 7 steps: status check, log analysis, fix creation, rollback
   - Advanced features: conditional execution, retry logic
   - Demonstrates agent integration for analysis

Each example includes:
- Complete workflow JSON
- Input requirements documentation
- Expected output description
- Usage instructions

### 5. Documentation

#### Primary Documents

1. **[WORKFLOW-SCHEMA.md](WORKFLOW-SCHEMA.md)**
   - Complete workflow format specification
   - Variable substitution syntax
   - Conditional execution
   - Error handling strategies
   - Example workflows with explanations
   - Best practices

2. **[Database README](../database/README.md)**
   - Database schema overview
   - Migration instructions
   - Connection guides
   - Query examples
   - Workflow model integration

3. **[Example Workflows README](../database/examples/README.md)**
   - Example workflow documentation
   - Usage instructions
   - Testing procedures
   - Tool reference

#### Supporting Documents

- **[WORKFLOW-ENGINE.md](WORKFLOW-ENGINE.md)** - Workflow execution engine
- **[database-schema.md](architecture/database-schema.md)** - Detailed schema documentation
- **Main README** - Updated with workflow documentation links

## Usage Examples

### Creating a Workflow

```sql
INSERT INTO workflows (name, description, definition) VALUES (
  'my_workflow',
  'Description of workflow purpose',
  '{
    "steps": [
      {
        "name": "example_step",
        "tool": "github.getIssue",
        "params": {
          "owner": "${repo.owner}",
          "repo": "${repo.name}",
          "number": "${input.issue_number}"
        },
        "assign": "issue"
      }
    ]
  }'::jsonb
);
```

### Executing a Workflow

Via the Workflow Engine API:

```typescript
const engine = getWorkflowEngine();
const result = await engine.execute(workflow, {
  variables: {},
  input: { issue_number: 42 },
  repo: { owner: 'owner', name: 'repo', default_branch: 'main' }
});
```

### Querying Execution History

```sql
SELECT 
  we.id,
  w.name AS workflow_name,
  we.status,
  we.started_at,
  we.completed_at,
  COUNT(ws.id) AS total_steps,
  COUNT(CASE WHEN ws.status = 'completed' THEN 1 END) AS completed_steps
FROM workflow_executions we
JOIN workflows w ON we.workflow_id = w.id
LEFT JOIN workflow_steps ws ON ws.execution_id = we.id
WHERE we.created_at > NOW() - INTERVAL '7 days'
GROUP BY we.id, w.name, we.status, we.started_at, we.completed_at
ORDER BY we.started_at DESC;
```

## Validation

All components have been validated:

✅ **JSON Schema Validation**
```bash
npx ajv-cli validate -s database/workflow-schema.json \
  -d database/examples/issue_to_pr.json \
  -d database/examples/fix_deploy_failure.json
# Result: All valid
```

✅ **SQL Migration Validation**
- All INSERT statements contain valid JSON
- 5 example workflows validated
- Proper escaping and formatting verified

✅ **TypeScript Type Definitions**
- Existing types in `control-center/src/lib/types/workflow.ts` compatible
- Workflow engine implementation supports all features

## Integration with Existing Systems

### Control Center

The workflow model integrates with existing Control Center components:
- **Workflow Engine** (`control-center/src/lib/workflow-engine.ts`) - Already implements execution
- **MCP Client** (`control-center/src/lib/mcp-client.ts`) - Tool invocation
- **Agent Runner** (`control-center/src/lib/agent-runner.ts`) - LLM integration

### MCP Servers

Workflows invoke tools from MCP servers:
- **GitHub Server** (`mcp-servers/github`) - Issue/PR/branch operations
- **Deploy Server** (`mcp-servers/deploy`) - ECS deployments
- **Observability Server** (`mcp-servers/observability`) - CloudWatch logs/metrics

### Database

Workflow state is persisted in RDS PostgreSQL:
- Workflow definitions in `workflows` table
- Execution tracking in `workflow_executions` and `workflow_steps`
- Integration with existing agent_runs and mcp_tool_calls tracking

## Future Enhancements

Potential improvements identified for future work:

1. **Parallel Execution** - Execute independent steps concurrently
2. **Loop/Iteration Support** - Repeat steps over collections
3. **Sub-workflow Invocation** - Compose workflows from smaller workflows
4. **Advanced Conditions** - Comparison and logical operators
5. **Workflow Templates** - Parameterized workflow definitions
6. **Visual Workflow Editor** - UI for workflow creation
7. **Real-time Monitoring** - Live execution progress tracking
8. **Workflow Marketplace** - Share and discover workflows
9. **Debugging Tools** - Step-through debugging, replay capabilities
10. **External Integration** - AWS Step Functions, Temporal compatibility

## Deployment

### Prerequisites

- PostgreSQL 15+ database (RDS or local)
- AWS Secrets Manager (for production)
- MCP servers running (for workflow execution)

### Migration Deployment

```bash
# Using the deployment script
./scripts/deploy-migrations.sh

# Or manually with psql
psql -f database/migrations/001_initial_schema.sql
psql -f database/migrations/002_add_example_workflows.sql
```

### Verification

```sql
-- Check workflows are loaded
SELECT name, description, enabled FROM workflows;

-- Should show 6 workflows:
-- - issue_to_pr (from 001)
-- - fix_deploy_failure (from 002)
-- - pr_review_workflow (from 002)
-- - ci_failure_handler (from 002)
-- - issue_triage (from 002)
-- - dependency_update (from 002)
```

## Testing

### Unit Tests

Workflow engine unit tests exist in Control Center:
```bash
cd control-center
npm test
```

### Integration Tests

Test workflows with MCP servers:
```bash
# Start MCP servers
cd mcp-servers/github && npm run dev &
cd mcp-servers/deploy && npm run dev &
cd mcp-servers/observability && npm run dev &

# Start Control Center
cd control-center && npm run dev

# Execute test workflow
curl -X POST http://localhost:3000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d @database/examples/issue_to_pr.json
```

### Database Tests

Test migration rollout on test database:
```bash
# Create test database
createdb afu9_test

# Run migrations
psql afu9_test -f database/migrations/001_initial_schema.sql
psql afu9_test -f database/migrations/002_add_example_workflows.sql

# Verify
psql afu9_test -c "SELECT COUNT(*) FROM workflows;"
```

## References

- **Issue**: #36 - Workflow-Modell und Persistenz für AFU-9 definieren
- **Parent Epic**: #35 - AFU-9 v0.2 Implementation
- **Related Issues**:
  - Workflow engine implementation
  - MCP server integration
  - Database migration system

## Change Summary

### Files Created

- `docs/WORKFLOW-SCHEMA.md` - Workflow format specification (15KB)
- `database/workflow-schema.json` - JSON schema for validation (5KB)
- `database/migrations/002_add_example_workflows.sql` - Example workflows migration (13KB)
- `database/examples/issue_to_pr.json` - Basic example workflow (1KB)
- `database/examples/fix_deploy_failure.json` - Advanced example workflow (3KB)
- `database/examples/README.md` - Example documentation (6KB)
- `docs/WORKFLOW-MODEL-IMPLEMENTATION.md` - This summary document

### Files Modified

- `database/README.md` - Added workflow model section and references
- `README.md` - Added workflow documentation links

### Total Changes

- 7 new files created
- 2 existing files updated
- ~45KB of documentation added
- 5 new example workflows
- 1 new database migration
- Complete workflow model specification

## Conclusion

The workflow model implementation provides AFU-9 with a robust, flexible system for orchestrating autonomous code fabrication. The combination of:

- **Standardized JSON format** for workflow definitions
- **Database persistence** for execution history and state
- **Comprehensive documentation** with examples
- **Validation tooling** for quality assurance
- **Integration** with existing AFU-9 components

creates a solid foundation for building and executing complex autonomous workflows.

All requirements from issue #36 have been fulfilled:
- ✅ Data model (DB schema) for workflows, steps, execution status, inputs/outputs
- ✅ JSON convention format for workflows (name, steps, tool, params, assign, if)
- ✅ Migrations in the database
- ✅ Example workflows (issue_to_pr, fix_deploy_failure, plus 3 more)
