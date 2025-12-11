# AFU-9 Workflow Examples

This directory contains example workflow definitions demonstrating various AFU-9 use cases.

## Available Examples

### 1. issue_to_pr.json
**Use Case**: Convert a GitHub issue into a pull request with automated fix

**Description**: Basic workflow that fetches an issue, creates a branch, and opens a pull request.

**Required Input**:
```json
{
  "issue_number": 42
}
```

**Required Context**:
```json
{
  "repo": {
    "owner": "adaefler-art",
    "name": "codefactory-control",
    "default_branch": "main"
  }
}
```

**Expected Output**:
- `issue`: GitHub issue object
- `branch`: Created branch information
- `pull_request`: Created PR object

---

### 2. fix_deploy_failure.json
**Use Case**: Diagnose and fix deployment failures automatically

**Description**: Comprehensive workflow that analyzes deployment failures, creates fixes, and performs rollbacks if needed.

**Required Input**:
```json
{
  "cluster": "production",
  "service": "api-service",
  "failure_time": "2024-12-11T20:00:00Z"
}
```

**Required Context**:
```json
{
  "repo": {
    "owner": "adaefler-art",
    "name": "codefactory-control",
    "default_branch": "main"
  }
}
```

**Expected Output**:
- `service_status`: Current service status
- `logs`: Service logs from failure time
- `analysis`: AI-generated failure analysis
- `fix_branch`: Created fix branch (conditional)
- `fix_pr`: Created fix PR (conditional)
- `manual_issue`: Created issue for manual intervention (conditional)
- `rollback_result`: Rollback operation result

**Features**:
- Conditional execution (creates PR only if fix available)
- Retry logic for rollback operation
- Extended timeout (10 minutes)
- Comprehensive error handling

---

## Using These Examples

### Testing Workflows Locally

1. **Start MCP Servers**:
```bash
# Terminal 1: GitHub server
cd mcp-servers/github && npm run dev

# Terminal 2: Deploy server
cd mcp-servers/deploy && npm run dev

# Terminal 3: Observability server
cd mcp-servers/observability && npm run dev
```

2. **Start Control Center**:
```bash
cd control-center && npm run dev
```

3. **Execute Workflow via API**:
```bash
curl -X POST http://localhost:3000/api/workflow/execute \
  -H "Content-Type: application/json" \
  -d @database/examples/issue_to_pr.json \
  --data-raw '{
    "workflow": '"$(cat database/examples/issue_to_pr.json)"',
    "context": {
      "variables": {},
      "input": {
        "issue_number": 1
      },
      "repo": {
        "owner": "adaefler-art",
        "name": "codefactory-control",
        "default_branch": "main"
      }
    }
  }'
```

### Loading Examples into Database

Execute the migration to load all example workflows:

```bash
# Using psql
psql -f database/migrations/002_add_example_workflows.sql

# Or using the deployment script
./scripts/deploy-migrations.sh
```

### Creating Custom Workflows

1. Copy an example as a template
2. Modify steps to match your use case
3. Test locally with the workflow engine
4. Add to database via migration or API

## Workflow Structure

All workflows follow this structure:

```json
{
  "name": "workflow_name",
  "description": "Human-readable description",
  "steps": [
    {
      "name": "step_name",
      "tool": "server.toolName",
      "params": {
        // Tool parameters
      },
      "assign": "variable_name",
      "if": "${condition}",
      "retry": {
        "maxAttempts": 3,
        "backoff": "exponential"
      }
    }
  ],
  "config": {
    "timeoutMs": 300000,
    "continueOnError": false,
    "maxRetries": 0
  }
}
```

## Available Tools

### GitHub Server (github)
- `github.getIssue` - Fetch issue details
- `github.createBranch` - Create a new branch
- `github.createPullRequest` - Open a PR
- `github.createIssue` - Create an issue
- `github.addLabels` - Add labels to issue/PR
- `github.getPullRequest` - Get PR details
- `github.getPRDiff` - Get PR diff
- `github.getWorkflowRun` - Get workflow run details
- `github.getWorkflowJobs` - Get workflow jobs
- `github.getJobLogs` - Get job logs

### Deploy Server (deploy)
- `deploy.getServiceStatus` - Get ECS service status
- `deploy.updateService` - Update ECS service
- `deploy.rollbackService` - Rollback service to previous version

### Observability Server (observability)
- `observability.getServiceLogs` - Fetch CloudWatch logs
- `observability.getMetrics` - Get CloudWatch metrics

### Agent Tools (agent)
- `agent.analyze` - AI-powered analysis
- `agent.reviewCode` - Code review
- `agent.applyFix` - Apply code fixes
- `agent.classifyIssue` - Issue classification

## Best Practices

1. **Use Descriptive Names**: Step names should clearly indicate their purpose
2. **Handle Errors**: Use retry logic for unreliable operations
3. **Conditional Steps**: Use `if` to make workflows adaptable
4. **Variable Assignment**: Assign outputs to variables for later steps
5. **Timeouts**: Set appropriate timeouts based on workflow complexity
6. **Documentation**: Include clear descriptions and input requirements

## Validation

Validate workflow JSON against the schema:

```bash
# Using ajv-cli (install: npm install -g ajv-cli)
ajv validate -s database/workflow-schema.json -d database/examples/issue_to_pr.json
```

## Contributing

When adding new examples:

1. Create a new JSON file in this directory
2. Document inputs, outputs, and use case in this README
3. Add corresponding migration in `database/migrations/`
4. Test the workflow locally before committing

## See Also

- [Workflow Schema Documentation](../../docs/WORKFLOW-SCHEMA.md)
- [Workflow Engine Documentation](../../docs/WORKFLOW-ENGINE.md)
- [Database Schema](../../docs/architecture/database-schema.md)
