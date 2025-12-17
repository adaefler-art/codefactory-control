# Prompt & Action Library

**EPIC 6: Standardized Factory Intelligence through Prompt & Action Canon**

## Overview

The Prompt & Action Library provides versioned, traceable, and governed management of prompts and actions used in AFU-9 Factory Intelligence. This system ensures transparency, quality control, and stability in autonomous code fabrication operations.

## Key Features

- **Semantic Versioning**: All prompts and actions follow semantic versioning (major.minor.patch)
- **Breaking Change Detection**: Automatic detection and documentation of breaking changes
- **Usage Tracking**: Complete traceability of which prompts/actions are used in each workflow run
- **Deprecation Management**: Controlled deprecation with migration paths
- **KPI Metrics**: Prompt Stability and Action Usage metrics for quality monitoring

## Architecture

### Database Schema

The library consists of four main tables:

1. **prompts** - Prompt definitions
2. **prompt_versions** - Version history for prompts
3. **actions** - Action/tool definitions
4. **action_versions** - Version history for actions

Usage tracking is integrated into existing tables:
- **agent_runs** - Tracks which prompt version was used
- **mcp_tool_calls** - Tracks which action version was called

### Semantic Versioning Rules

Version numbers follow the format: `MAJOR.MINOR.PATCH`

#### MAJOR Version (Breaking Changes)
Increment when:
- Removing required variables from prompt template
- Changing variable types or structure incompatibly
- Changing action input/output schema incompatibly
- Modifying system prompt behavior significantly (>50% change)

**Requirements:**
- Must document breaking changes
- Must provide migration guide
- Should specify replacement prompt/action if deprecated

#### MINOR Version (Non-Breaking Additions)
Increment when:
- Adding optional variables
- Enhancing prompt without changing core behavior
- Adding optional parameters to action schema
- Improving performance without changing interface

**Requirements:**
- Document changes and improvements
- No migration needed

#### PATCH Version (Bug Fixes)
Increment when:
- Fixing typos or grammatical errors
- Correcting minor prompt issues
- Bug fixes that don't change behavior
- Documentation updates

**Requirements:**
- Brief description of fix

## API Reference

### Prompt Management

#### List Prompts
```bash
GET /api/prompts?category=analysis&limit=50
```

Response:
```json
{
  "prompts": [
    {
      "id": "uuid",
      "name": "issue_analyzer",
      "category": "analysis",
      "description": "Analyzes GitHub issues...",
      "currentVersion": {
        "version": "1.0.0",
        "systemPrompt": "You are an expert...",
        "variables": {...}
      },
      "versionCount": 3,
      "deprecated": false
    }
  ]
}
```

#### Get Prompt by Name
```bash
GET /api/prompts/issue_analyzer?byName=true
```

#### Create Prompt
```bash
POST /api/prompts
Content-Type: application/json

{
  "name": "code_reviewer",
  "category": "review",
  "description": "Reviews code changes",
  "purpose": "Used in PR review workflows",
  "systemPrompt": "You are an expert code reviewer...",
  "userPromptTemplate": "Review the following code:\n${diff}",
  "variables": {
    "diff": "Git diff content",
    "pr_title": "PR title"
  },
  "modelConfig": {
    "temperature": 0.3,
    "maxTokens": 3000
  }
}
```

#### Create New Version
```bash
POST /api/prompts/{promptId}/versions
Content-Type: application/json

{
  "changeType": "minor",
  "changeDescription": "Added context about repository structure",
  "systemPrompt": "You are an expert code reviewer familiar with...",
  "userPromptTemplate": "Review the following code:\n${diff}\nRepo: ${repo_name}",
  "variables": {
    "diff": "Git diff content",
    "pr_title": "PR title",
    "repo_name": "Repository name"
  }
}
```

#### List Versions
```bash
GET /api/prompts/{promptId}/versions
```

#### Deprecate Prompt
```bash
PATCH /api/prompts/{promptId}
Content-Type: application/json

{
  "deprecate": true,
  "reason": "Replaced with more accurate analysis model",
  "replacementPromptId": "new-prompt-uuid"
}
```

### Action Management

#### List Actions
```bash
GET /api/actions?category=github&limit=50
```

#### Get Action by Tool Reference
```bash
GET /api/actions/github.createIssue?byToolRef=true
```

#### Create Action
```bash
POST /api/actions
Content-Type: application/json

{
  "name": "create_github_issue",
  "category": "github",
  "description": "Creates a GitHub issue",
  "toolReference": "github.createIssue",
  "inputSchema": {
    "type": "object",
    "properties": {
      "owner": {"type": "string"},
      "repo": {"type": "string"},
      "title": {"type": "string"},
      "body": {"type": "string"}
    },
    "required": ["owner", "repo", "title"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "number": {"type": "integer"},
      "url": {"type": "string"}
    }
  }
}
```

#### Create New Version
```bash
POST /api/actions/{actionId}/versions
Content-Type: application/json

{
  "changeType": "minor",
  "changeDescription": "Added labels parameter",
  "toolReference": "github.createIssue",
  "inputSchema": {
    "type": "object",
    "properties": {
      "owner": {"type": "string"},
      "repo": {"type": "string"},
      "title": {"type": "string"},
      "body": {"type": "string"},
      "labels": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["owner", "repo", "title"]
  }
}
```

## Usage in Agent Runner

### Automatic Prompt Version Tracking

The agent runner automatically tracks which prompt version is used:

```typescript
import { getPromptLibraryService } from './prompt-library-service';

// Get prompt from library
const promptService = getPromptLibraryService();
const prompt = await promptService.getPromptByName('issue_analyzer');

// Use prompt in agent
const result = await agentRunner.execute(
  {
    prompt: prompt.currentVersion.systemPrompt,
    tools: availableTools,
    variables: { title: issue.title, body: issue.body }
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
    ...prompt.currentVersion.modelConfig
  }
);

// Tracking is automatic via agent_runs table
// which now includes prompt_version_id column
```

## KPI Metrics

### Prompt Stability Metrics

View prompt stability metrics:

```typescript
import { getPromptLibraryService } from './prompt-library-service';

const service = getPromptLibraryService();
const metrics = await service.getPromptStabilityMetrics({
  category: 'analysis',
  limit: 10
});

// Returns:
// - Total uses
// - Days used
// - Version count
// - Last breaking change date
// - Usage trends
```

Available via database view:
```sql
SELECT * FROM prompt_stability_metrics
ORDER BY total_uses DESC;
```

### Action Usage Metrics

Track action performance and reliability:

```typescript
import { getActionRegistryService } from './action-registry-service';

const service = getActionRegistryService();
const metrics = await service.getActionUsageMetrics({
  category: 'github',
  limit: 10
});

// Returns:
// - Total calls
// - Average duration
// - Error count
// - Usage trends
```

Available via database view:
```sql
SELECT * FROM action_usage_metrics
WHERE error_count > 0
ORDER BY total_calls DESC;
```

## Best Practices

### Creating Prompts

1. **Start Simple**: Begin with clear, focused prompts
2. **Use Variables**: Make prompts reusable with template variables
3. **Document Purpose**: Explain when and how to use the prompt
4. **Test Thoroughly**: Validate prompts before publishing
5. **Version Carefully**: Follow semantic versioning strictly

### Managing Changes

1. **Breaking Changes**: Always document and provide migration guide
2. **Gradual Rollout**: Test new versions in non-critical workflows first
3. **Monitor Metrics**: Track usage and performance after changes
4. **Deprecate Gracefully**: Provide transition period and replacement prompts

### Action Definition

1. **Clear Schemas**: Define precise input/output schemas
2. **Error Handling**: Document expected errors and edge cases
3. **Performance**: Monitor action duration and optimize if needed
4. **Validation**: Test actions against real MCP tools

## Migration Guide

### Upgrading to Breaking Version

When a prompt has a major version change:

1. Review the breaking changes documentation
2. Update variable references in workflows
3. Test thoroughly in development environment
4. Update all workflows using the prompt
5. Monitor for issues after deployment

Example migration from v1.0.0 to v2.0.0:

```typescript
// v1.0.0 - Old version
const oldPrompt = {
  variables: {
    "issue_text": "Issue description"
  }
};

// v2.0.0 - New version (renamed variable)
const newPrompt = {
  variables: {
    "issue_body": "Issue description",  // Renamed from issue_text
    "issue_title": "Issue title"         // New required variable
  }
};

// Update workflow to use new variable names
```

## Database Queries

### Find Most Used Prompts
```sql
SELECT 
  prompt_name,
  current_version,
  total_uses,
  days_used
FROM prompt_stability_metrics
ORDER BY total_uses DESC
LIMIT 10;
```

### Find Deprecated Prompts Still in Use
```sql
SELECT 
  p.name,
  p.deprecation_reason,
  COUNT(ar.id) as recent_uses
FROM prompts p
JOIN prompt_versions pv ON p.current_version_id = pv.id
JOIN agent_runs ar ON ar.prompt_version_id = pv.id
WHERE p.deprecated = true
  AND ar.started_at > NOW() - INTERVAL '7 days'
GROUP BY p.id, p.name, p.deprecation_reason;
```

### Track Version Adoption
```sql
SELECT 
  pv.version,
  COUNT(DISTINCT ar.execution_id) as execution_count,
  MIN(ar.started_at) as first_use,
  MAX(ar.started_at) as last_use
FROM prompt_versions pv
JOIN agent_runs ar ON ar.prompt_version_id = pv.id
WHERE pv.prompt_id = 'your-prompt-uuid'
GROUP BY pv.version
ORDER BY pv.created_at DESC;
```

## Integration with Workflows

Prompts and actions integrate seamlessly with the workflow engine:

```json
{
  "name": "analyze_and_fix",
  "steps": [
    {
      "name": "analyze_issue",
      "tool": "agent.analyze",
      "params": {
        "prompt": "@prompt:issue_analyzer",
        "context": {
          "title": "${input.issue_title}",
          "body": "${input.issue_body}"
        }
      },
      "assign": "analysis"
    }
  ]
}
```

The `@prompt:` prefix automatically loads the current version from the library.

## Monitoring and Alerts

### Recommended Alerts

1. **High Error Rate**: Alert when action error rate > 10%
2. **Breaking Change Impact**: Monitor usage drop after major version
3. **Deprecated Usage**: Alert on deprecated prompt usage after grace period
4. **Performance Degradation**: Track action duration increases

### CloudWatch Metrics

Custom metrics to track:
- Prompt version switches
- Breaking change deployments
- Deprecated prompt usage count
- Action error rates by version

## Future Enhancements

- [ ] Visual prompt editor in Control Center UI
- [ ] A/B testing framework for prompt versions
- [ ] Automatic prompt optimization suggestions
- [ ] Integration with external prompt libraries
- [ ] Prompt performance benchmarking
- [ ] Rollback mechanism for bad versions
- [ ] Approval workflow for major versions
- [ ] Prompt template marketplace

## Support

For questions or issues with the Prompt & Action Library:

1. Check this documentation
2. Review example prompts in the database
3. Check prompt stability metrics for insights
4. Consult the AFU-9 architecture documentation

## Appendix

### Prompt Categories

- **analysis**: Issue analysis, code analysis, error diagnosis
- **generation**: Code generation, documentation generation
- **review**: Code review, PR review, quality checks
- **planning**: Task planning, estimation, architecture decisions
- **debugging**: Error investigation, root cause analysis
- **deployment**: Deployment planning, configuration generation
- **monitoring**: Health checks, alert analysis

### Action Categories

- **github**: GitHub API operations
- **deploy**: Deployment and infrastructure operations
- **observability**: Monitoring and logging operations
- **workflow**: Workflow management and orchestration
- **agent**: LLM agent operations

### Example Prompts

See database seed data in migration `008_prompt_action_library.sql` for example prompts:
- `issue_analyzer` - Analyzes GitHub issues
- `code_reviewer` - Reviews code changes

### Example Actions

See database seed data for example actions:
- `create_github_issue` - Creates GitHub issues
- `create_pull_request` - Creates pull requests
