# Prompt Library Integration Guide

**Version:** 1.0.0  
**Last Updated:** 2024-12-17

## Overview

This guide provides instructions for integrating the Canonical Prompt Library into AFU-9 workflows and agent executions, ensuring full traceability and governance compliance.

## Database Schema

The prompt library traceability is built on the following schema:

### Tables
- `prompts` - Prompt definitions
- `prompt_versions` - Version history
- `agent_runs` - Agent execution records with prompt tracking
- `mcp_tool_calls` - Tool call records with action tracking

### Tracking Columns in `agent_runs`

```sql
ALTER TABLE agent_runs ADD COLUMN prompt_version_id UUID REFERENCES prompt_versions(id);
ALTER TABLE agent_runs ADD COLUMN prompt_content TEXT;
ALTER TABLE agent_runs ADD COLUMN prompt_variables JSONB;
```

These columns enable:
- **prompt_version_id**: Links to specific prompt version used
- **prompt_content**: Snapshot of actual prompt content (immutable record)
- **prompt_variables**: Variable values used in template substitution

## Integration Steps

### 1. Load Prompt from Library

Use the `AgentRunner.loadPromptFromLibrary()` method:

```typescript
import { getAgentRunner } from './agent-runner';

const agentRunner = getAgentRunner();

// Load versioned prompt with variable substitution
const promptData = await agentRunner.loadPromptFromLibrary('issue_analyzer', {
  title: issue.title,
  body: issue.body,
  labels: issue.labels.join(', '),
});

// Returns:
// {
//   prompt: string,           // Fully substituted prompt
//   promptVersionId: string,  // UUID of prompt version
//   systemPrompt?: string     // System prompt if defined
// }
```

### 2. Execute Agent with Prompt

```typescript
import { AgentConfig, AgentContext } from './types/agent';

const context: AgentContext = {
  prompt: promptData.prompt,
  tools: await agentRunner.loadToolsFromMCP(['github']),
};

const config: AgentConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  systemPrompt: promptData.systemPrompt,
  // Use model config from prompt version if available
};

const result = await agentRunner.execute(context, config);
```

### 3. Persist Agent Run with Prompt Tracking

**Current State:** The database schema is ready, but persistence code needs to be implemented.

**Required Implementation:**

```typescript
// Example persistence (to be implemented)
async function persistAgentRun(
  executionId: string,
  stepId: string,
  agentType: string,
  promptVersionId: string,
  promptContent: string,
  promptVariables: Record<string, any>,
  result: AgentExecutionResult
): Promise<void> {
  const pool = getPool();
  
  await pool.query(`
    INSERT INTO agent_runs (
      execution_id,
      step_id,
      agent_type,
      model,
      prompt_version_id,
      prompt_content,
      prompt_variables,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      duration_ms,
      cost_usd,
      input,
      output,
      tool_calls,
      started_at,
      completed_at,
      error
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
  `, [
    executionId,
    stepId,
    agentType,
    result.metadata.model,
    promptVersionId,           // Track version used
    promptContent,             // Snapshot for audit
    JSON.stringify(promptVariables),  // Variables used
    result.usage.promptTokens,
    result.usage.completionTokens,
    result.usage.totalTokens,
    result.metadata.durationMs,
    result.usage.totalCostUSD,
    JSON.stringify(result.metadata),
    JSON.stringify({ response: result.response }),
    JSON.stringify(result.toolCalls),
    result.metadata.startTime,
    result.metadata.endTime,
    null
  ]);
}
```

### 4. Query Prompt Usage

Once persistence is implemented, query usage like this:

```sql
-- Find all runs using a specific prompt
SELECT 
  ar.id,
  ar.started_at,
  pv.version,
  ar.duration_ms,
  ar.total_tokens
FROM agent_runs ar
JOIN prompt_versions pv ON ar.prompt_version_id = pv.id
JOIN prompts p ON pv.prompt_id = p.id
WHERE p.name = 'issue_analyzer'
ORDER BY ar.started_at DESC;
```

```sql
-- Get prompt stability metrics
SELECT * FROM prompt_stability_metrics
WHERE prompt_name = 'issue_analyzer';
```

## Workflow Integration

### Using Prompts in Workflow Definitions

Workflows can reference prompts from the canonical library:

```json
{
  "name": "analyze_issue",
  "steps": [
    {
      "name": "analyze",
      "tool": "agent.analyze",
      "params": {
        "prompt": "@prompt:issue_analyzer",
        "context": {
          "title": "${input.issue_title}",
          "body": "${input.issue_body}",
          "labels": "${input.labels}"
        }
      },
      "assign": "analysis"
    }
  ]
}
```

The `@prompt:` prefix indicates loading from the canonical library.

## Best Practices

### 1. Always Use Versioned Prompts

❌ **Don't:**
```typescript
const result = await agentRunner.execute({
  prompt: "Analyze this issue: " + issue.body,  // Hardcoded
  tools,
}, config);
```

✅ **Do:**
```typescript
const promptData = await agentRunner.loadPromptFromLibrary('issue_analyzer', {
  body: issue.body,
});
const result = await agentRunner.execute({
  prompt: promptData.prompt,
  tools,
}, config);
```

### 2. Always Track Prompt Version in Agent Runs

Ensure every agent execution persists:
- `prompt_version_id` - Which version was used
- `prompt_content` - Snapshot of actual content
- `prompt_variables` - Values substituted

This enables:
- Debugging issues with specific prompt versions
- Measuring prompt effectiveness
- Compliance and audit trails

### 3. Handle Deprecated Prompts

Check if a prompt is deprecated:

```typescript
const prompt = await promptService.getPromptByName('old_analyzer');

if (prompt?.deprecated) {
  console.warn(
    `Prompt '${prompt.name}' is deprecated: ${prompt.deprecationReason}`
  );
  
  if (prompt.replacementPromptId) {
    // Use replacement prompt instead
    const replacement = await promptService.getPromptById(
      prompt.replacementPromptId
    );
    // ... use replacement
  }
}
```

### 4. Monitor Prompt Stability KPIs

Regularly check prompt metrics:

```typescript
const metrics = await promptService.getPromptStabilityMetrics({
  category: 'analysis',
});

metrics.forEach(metric => {
  // Alert on high error rate or low usage
  if (metric.isDeprecated && metric.totalUses > 0) {
    console.warn(`Deprecated prompt still in use: ${metric.promptName}`);
  }
});
```

## API Integration

### REST API Endpoints

All prompt operations are available via REST API:

```bash
# Load prompt by name
GET /api/prompts?name=issue_analyzer

# Get prompt with current version
GET /api/prompts/{id}

# List all versions
GET /api/prompts/{id}/versions

# Create new version
POST /api/prompts/{id}/versions
```

See [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) for complete API reference.

## Testing Integration

### Unit Tests

Test prompt loading and variable substitution:

```typescript
describe('Prompt Library Integration', () => {
  it('should load prompt with variables', async () => {
    const agentRunner = new AgentRunner();
    
    const data = await agentRunner.loadPromptFromLibrary('issue_analyzer', {
      title: 'Test Issue',
      body: 'Test Description',
      labels: 'bug, high',
    });
    
    expect(data.promptVersionId).toBeDefined();
    expect(data.prompt).toContain('Test Issue');
    expect(data.prompt).toContain('Test Description');
  });
});
```

### Integration Tests

Test end-to-end workflow with prompt tracking:

```typescript
describe('Workflow with Prompt Tracking', () => {
  it('should track prompt version in agent run', async () => {
    const engine = getWorkflowEngine();
    const workflow = {
      name: 'test',
      steps: [{
        name: 'analyze',
        tool: '@prompt:issue_analyzer',
        params: { /* ... */ }
      }]
    };
    
    const result = await engine.execute(workflow, {});
    
    // Verify prompt tracking (once implemented)
    const agentRun = await getAgentRunByExecutionId(result.executionId);
    expect(agentRun.prompt_version_id).toBeDefined();
  });
});
```

## Migration Path

### Adding Prompt Tracking to Existing Code

If you have existing agent execution code without prompt tracking:

1. **Identify Agent Executions:**
   Find all places where `AgentRunner.execute()` is called

2. **Add Prompt Loading:**
   Replace hardcoded prompts with library loading

3. **Add Persistence:**
   Implement agent_run persistence with tracking fields

4. **Verify Tracking:**
   Query `agent_runs` table to verify prompt_version_id is populated

5. **Monitor Metrics:**
   Start tracking Prompt Stability KPIs

## Troubleshooting

### Issue: Prompt Not Found

```typescript
// Error: Prompt not found in library: unknown_prompt
```

**Solution:** Check canonical registry ([PROMPT_LIBRARY_CANON.md](./PROMPT_LIBRARY_CANON.md)) for available prompts.

### Issue: Missing Variables

```typescript
// Variables not substituted: ${missing_var}
```

**Solution:** Ensure all required variables are provided when loading prompt.

### Issue: Deprecated Prompt Used

```typescript
// Warning: Using deprecated prompt
```

**Solution:** Migrate to replacement prompt specified in deprecation metadata.

## Next Steps

To complete the integration:

1. **Implement Agent Run Persistence:**
   - Add `persistAgentRun()` function to workflow engine
   - Ensure all agent executions are persisted with prompt tracking

2. **Add Workflow Integration:**
   - Implement `@prompt:` syntax in workflow engine
   - Add automatic prompt loading for workflow steps

3. **Create Monitoring Dashboard:**
   - Display Prompt Stability KPIs
   - Show prompt version adoption
   - Alert on deprecated prompt usage

4. **Add Automated Tests:**
   - Integration tests for prompt tracking
   - E2E tests for workflow with prompts

## Related Documentation

- [PROMPT_LIBRARY_CANON.md](./PROMPT_LIBRARY_CANON.md) - Canonical prompt registry
- [PROMPT_GOVERNANCE.md](./PROMPT_GOVERNANCE.md) - Governance framework
- [PROMPT_LIBRARY.md](./PROMPT_LIBRARY.md) - API reference
- [WORKFLOW-SCHEMA.md](./WORKFLOW-SCHEMA.md) - Workflow specification

---

**Maintained by:** AFU-9 Factory Intelligence Team  
**Last Updated:** 2024-12-17
