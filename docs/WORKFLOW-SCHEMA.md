# AFU-9 Workflow Schema

This document defines the generic workflow model for AFU-9, including the JSON convention format, database schema, and example workflows.

## Overview

AFU-9 workflows are defined as JSON documents that describe a sequence of steps to be executed. Each step invokes a tool from an MCP server with specific parameters. The workflow engine executes these steps sequentially, handling variable substitution, error handling, and state management.

## Workflow JSON Format

### Top-Level Structure

```json
{
  "name": "workflow_name",
  "description": "Human-readable description",
  "steps": [
    // Array of workflow steps
  ],
  "config": {
    // Optional workflow configuration
  }
}
```

### Workflow Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the workflow |
| `description` | string | No | Human-readable description of the workflow purpose |
| `steps` | array | Yes | Array of workflow steps to execute in sequence |
| `config` | object | No | Optional workflow-level configuration |

### Step Structure

```json
{
  "name": "step_name",
  "tool": "server.toolName",
  "params": {
    // Tool parameters with variable substitution
  },
  "assign": "variable_name",
  "if": "${condition}",
  "retry": {
    "maxAttempts": 3,
    "backoff": "exponential"
  }
}
```

### Step Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique name for this step within the workflow |
| `tool` | string | Yes | MCP tool to call in format `server.toolName` (e.g., `github.getIssue`) |
| `params` | object | Yes | Parameters to pass to the tool (supports variable substitution) |
| `assign` | string | No | Variable name to assign the step's output to |
| `if` | string | No | Condition expression - step only executes if true |
| `retry` | object | No | Retry configuration for failed steps |

## Variable Substitution

Variables are referenced using the `${path}` syntax and can access:

- **Input variables**: `${input.field}` - values provided when starting the workflow
- **Repository context**: `${repo.owner}`, `${repo.name}`, `${repo.default_branch}`
- **Step outputs**: `${stepName.field}` - outputs from previous steps (when using `assign`)
- **Nested paths**: `${issue.labels[0].name}` - dot notation for nested objects

### Examples

```json
{
  "name": "create_branch",
  "tool": "github.createBranch",
  "params": {
    "owner": "${repo.owner}",
    "repo": "${repo.name}",
    "branch": "fix/${input.issue_number}",
    "from": "${repo.default_branch}"
  }
}
```

## Conditional Execution

Steps can be conditionally executed using the `if` field:

```json
{
  "name": "notify_slack",
  "tool": "slack.postMessage",
  "params": {
    "channel": "#deployments",
    "message": "Deployment failed: ${error.message}"
  },
  "if": "${deploy.status === 'failed'}"
}
```

Currently supported condition formats:
- Variable existence check: `"${variable}"` - true if variable exists and is truthy

Future planned operators:
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `&&` (and), `||` (or), `!` (not)
- Example: `"${analysis.confidence > 0.8 && analysis.has_fix}"`

## Error Handling

### Step-Level Retry

Configure retries for individual steps:

```json
{
  "name": "deploy_service",
  "tool": "deploy.updateService",
  "params": {
    "cluster": "production",
    "service": "api"
  },
  "retry": {
    "maxAttempts": 3,
    "backoff": "exponential",
    "backoffMultiplier": 2,
    "initialDelayMs": 1000
  }
}
```

### Workflow-Level Error Handling

Configure error handling for the entire workflow:

```json
{
  "name": "deploy_workflow",
  "steps": [...],
  "config": {
    "continueOnError": false,
    "timeoutMs": 300000,
    "maxRetries": 2
  }
}
```

## Database Schema

### workflows Table

Stores workflow definitions (templates).

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  definition JSONB NOT NULL,  -- Full workflow JSON
  version INTEGER DEFAULT 1,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

The `definition` column stores the complete workflow JSON:

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
    }
  ]
}
```

### workflow_executions Table

Tracks individual workflow runs.

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  input JSONB,              -- Input provided to workflow
  output JSONB,             -- Final output/results
  context JSONB,            -- Execution context (variables)
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  error TEXT,
  triggered_by VARCHAR(255),
  github_run_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_execution_status CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);
```

**Status Values:**
- `pending` - Queued but not started
- `running` - Currently executing
- `completed` - Successfully completed all steps
- `failed` - Failed with error
- `cancelled` - Manually cancelled

### workflow_steps Table

Tracks execution of individual steps within a workflow.

```sql
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_name VARCHAR(255) NOT NULL,
  step_index INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  input JSONB,              -- Parameters passed to tool
  output JSONB,             -- Result from tool
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_step_status CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'skipped')
  )
);
```

**Status Values:**
- `pending` - Not yet started
- `running` - Currently executing
- `completed` - Successfully completed
- `failed` - Failed with error
- `skipped` - Skipped due to condition

## Example Workflows

### 1. issue_to_pr

Convert a GitHub issue into a pull request with automated fix.

```json
{
  "name": "issue_to_pr",
  "description": "Convert a GitHub issue into a pull request with automated fix",
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
    },
    {
      "name": "create_pull_request",
      "tool": "github.createPullRequest",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "title": "Fix: ${issue.title}",
        "body": "Automated fix for #${issue.number}\n\n${issue.body}",
        "head": "fix/${issue.number}",
        "base": "${repo.default_branch}"
      },
      "assign": "pull_request"
    }
  ]
}
```

**Input:**
```json
{
  "issue_number": 42
}
```

**Context:**
```json
{
  "repo": {
    "owner": "adaefler-art",
    "name": "codefactory-control",
    "default_branch": "main"
  }
}
```

### 2. fix_deploy_failure

Automatically diagnose and fix deployment failures.

```json
{
  "name": "fix_deploy_failure",
  "description": "Diagnose and fix deployment failures by analyzing logs and creating a fix PR",
  "steps": [
    {
      "name": "get_service_status",
      "tool": "deploy.getServiceStatus",
      "params": {
        "cluster": "${input.cluster}",
        "service": "${input.service}"
      },
      "assign": "service_status"
    },
    {
      "name": "fetch_logs",
      "tool": "observability.getServiceLogs",
      "params": {
        "logGroup": "/ecs/${input.cluster}/${input.service}",
        "startTime": "${input.failure_time}",
        "limit": 100
      },
      "assign": "logs"
    },
    {
      "name": "analyze_failure",
      "tool": "agent.analyze",
      "params": {
        "prompt": "Analyze these deployment logs and identify the root cause: ${logs}",
        "context": {
          "service": "${input.service}",
          "cluster": "${input.cluster}",
          "status": "${service_status}"
        }
      },
      "assign": "analysis"
    },
    {
      "name": "create_fix_branch",
      "tool": "github.createBranch",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "branch": "fix/deploy-${input.service}-${input.failure_time}",
        "from": "${repo.default_branch}"
      },
      "assign": "fix_branch",
      "if": "${analysis.has_fix}"
    },
    {
      "name": "create_fix_pr",
      "tool": "github.createPullRequest",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "title": "Fix: ${input.service} deployment failure",
        "body": "Automated fix for deployment failure\n\n## Analysis\n${analysis.description}\n\n## Root Cause\n${analysis.root_cause}\n\n## Proposed Fix\n${analysis.fix_description}",
        "head": "fix/deploy-${input.service}-${input.failure_time}",
        "base": "${repo.default_branch}",
        "labels": ["automated-fix", "deployment"]
      },
      "assign": "fix_pr",
      "if": "${analysis.has_fix}"
    },
    {
      "name": "create_issue_if_no_fix",
      "tool": "github.createIssue",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "title": "Manual intervention needed: ${input.service} deployment failure",
        "body": "Automated analysis could not determine a fix.\n\n## Analysis\n${analysis.description}\n\n## Logs\n${logs}",
        "labels": ["needs-manual-fix", "deployment"]
      },
      "assign": "manual_issue"
    },
    {
      "name": "rollback_deployment",
      "tool": "deploy.rollbackService",
      "params": {
        "cluster": "${input.cluster}",
        "service": "${input.service}",
        "targetRevision": "${service_status.previous_revision}"
      },
      "assign": "rollback_result",
      "retry": {
        "maxAttempts": 3,
        "backoff": "exponential"
      }
    }
  ]
}
```

**Input:**
```json
{
  "cluster": "production",
  "service": "api-service",
  "failure_time": "2024-12-11T20:00:00Z"
}
```

### 3. pr_review_workflow

Automated PR review and feedback workflow.

```json
{
  "name": "pr_review_workflow",
  "description": "Automatically review pull requests and provide feedback",
  "steps": [
    {
      "name": "fetch_pr",
      "tool": "github.getPullRequest",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "number": "${input.pr_number}"
      },
      "assign": "pr"
    },
    {
      "name": "get_pr_diff",
      "tool": "github.getPRDiff",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "number": "${input.pr_number}"
      },
      "assign": "diff"
    },
    {
      "name": "run_tests",
      "tool": "github.triggerWorkflow",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "workflow": "test.yml",
        "ref": "${pr.head.ref}"
      },
      "assign": "test_run"
    },
    {
      "name": "code_review",
      "tool": "agent.reviewCode",
      "params": {
        "diff": "${diff}",
        "context": {
          "title": "${pr.title}",
          "description": "${pr.body}"
        }
      },
      "assign": "review"
    },
    {
      "name": "post_review_comment",
      "tool": "github.createReviewComment",
      "params": {
        "owner": "${repo.owner}",
        "repo": "${repo.name}",
        "number": "${input.pr_number}",
        "body": "${review.summary}",
        "event": "COMMENT"
      },
      "if": "${review.has_feedback}"
    }
  ]
}
```

## Workflow Execution Flow

1. **Initialization**
   - Load workflow definition from database
   - Create workflow_execution record with status 'pending'
   - Initialize context with input variables

2. **Step Execution**
   - For each step in sequence:
     - Create workflow_step record with status 'pending'
     - Evaluate condition (if present)
     - Substitute variables in parameters
     - Call MCP tool via JSON-RPC
     - Update step record with result
     - If `assign` specified, store output in context
     - Handle errors according to retry policy

3. **Completion**
   - Update workflow_execution status
   - Store final output and context
   - Calculate duration and metadata

## Best Practices

1. **Naming Conventions**
   - Use snake_case for workflow and step names
   - Use descriptive names that indicate purpose
   - Prefix related workflows (e.g., `deploy_*`, `fix_*`)

2. **Variable Naming**
   - Use clear, descriptive variable names
   - Avoid overwriting context variables
   - Use namespacing for complex workflows (e.g., `deploy.status`)

3. **Error Handling**
   - Set appropriate retry policies for flaky operations
   - Use conditions to handle optional steps
   - Always provide meaningful error messages

4. **Step Granularity**
   - Keep steps focused on single operations
   - Break complex operations into multiple steps
   - Use intermediate variables to improve readability

5. **Documentation**
   - Include workflow description
   - Document expected inputs
   - Comment complex variable substitutions

## Migration Strategy

Workflows can be version-controlled in the database using the `version` field. When updating a workflow:

1. Create new workflow definition with incremented version
2. Keep old version for running executions
3. New executions use latest version
4. Archive old versions after grace period

## Future Enhancements

- [ ] Parallel step execution
- [ ] Loop/iteration support
- [ ] Sub-workflow invocation
- [ ] Advanced condition expressions (comparison, logical operators)
- [ ] Workflow templates with parameters
- [ ] Workflow marketplace/library
- [ ] Visual workflow editor
- [ ] Real-time execution monitoring
- [ ] Workflow debugging and replay
- [ ] Integration with external workflow engines (Step Functions, Temporal)
