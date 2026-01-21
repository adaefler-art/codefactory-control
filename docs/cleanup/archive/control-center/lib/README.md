# AFU-9 Agent Runner

The Agent Runner is a core component of AFU-9 v0.2 that provides unified LLM integration with MCP tool calling capabilities.

## Overview

The Agent Runner enables autonomous agent execution by:
- Providing a unified interface across multiple LLM providers
- Integrating LLMs with MCP tools for dynamic tool calling
- Tracking metrics like token usage, execution time, and success/failure
- Supporting multi-iteration agent workflows

## Supported LLM Providers

### OpenAI (GPT)
- **Models**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Environment Variable**: `OPENAI_API_KEY`
- **Documentation**: https://platform.openai.com/docs

### DeepSeek
- **Models**: `deepseek-chat`, `deepseek-coder`
- **Environment Variable**: `DEEPSEEK_API_KEY`
- **API**: OpenAI-compatible at `https://api.deepseek.com`
- **Documentation**: https://platform.deepseek.com/docs

### Anthropic (Claude)
- **Models**: 
  - `claude-3-5-sonnet-20241022` (recommended)
  - `claude-3-opus-20240229`
  - `claude-3-sonnet-20240229`
- **Environment Variable**: `ANTHROPIC_API_KEY`
- **Documentation**: https://docs.anthropic.com/

## Quick Start

```typescript
import { getAgentRunner } from './lib/agent-runner';
import { AgentConfig, AgentContext } from './lib/types/agent';

// Initialize agent runner
const runner = getAgentRunner();

// Load tools from MCP servers
const tools = await runner.loadToolsFromMCP(['github', 'deploy']);

// Configure agent
const config: AgentConfig = {
  provider: 'openai',  // or 'deepseek', 'anthropic'
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxIterations: 10,
  systemPrompt: 'You are a helpful assistant for managing GitHub repositories.',
};

// Execute agent
const context: AgentContext = {
  prompt: 'List all open issues in the codefactory-control repository',
  tools,
};

const result = await runner.execute(context, config);

console.log(result.response);        // Final LLM response
console.log(result.toolCalls);       // All tools called during execution
console.log(result.usage);           // Token usage statistics
console.log(result.metadata);        // Execution metadata (duration, iterations, etc.)
```

## Provider Examples

### OpenAI (GPT-4)

```typescript
const config: AgentConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxIterations: 10,
  maxTokens: 4096,
  systemPrompt: 'You are an expert DevOps engineer.',
};
```

### DeepSeek

```typescript
const config: AgentConfig = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  temperature: 0.5,
  maxIterations: 10,
  systemPrompt: 'You are a code analysis expert.',
};
```

### Anthropic Claude

```typescript
const config: AgentConfig = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxIterations: 10,
  maxTokens: 8192,
  systemPrompt: 'You are a helpful assistant that follows instructions precisely.',
};
```

## Configuration

### AgentConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `LLMProvider` | Yes | LLM provider: 'openai', 'deepseek', 'anthropic' |
| `model` | `string` | Yes | Model identifier (e.g., 'gpt-4o-mini', 'deepseek-chat') |
| `systemPrompt` | `string` | No | System prompt to guide agent behavior |
| `temperature` | `number` | No | Sampling temperature (0.0 to 2.0, default: 0.7) |
| `maxTokens` | `number` | No | Maximum tokens to generate |
| `maxIterations` | `number` | No | Maximum tool-calling iterations (default: 10) |

### AgentContext

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | `string` | Yes | User prompt/request |
| `tools` | `AgentTool[]` | Yes | Available tools for the agent |
| `variables` | `Record<string, any>` | No | Additional context variables |

## Tool Loading

Load tools from specific MCP servers:

```typescript
// Load from specific servers
const tools = await runner.loadToolsFromMCP(['github', 'deploy']);

// Load from all configured servers
const allTools = await runner.loadToolsFromMCP();
```

Tools are automatically prefixed with their server name (e.g., `github.getIssue`, `deploy.updateService`).

## Execution Result

The `AgentExecutionResult` includes:

```typescript
{
  response: string;              // Final text response from agent
  messages: AgentMessage[];      // Full conversation history
  toolCalls: Array<{             // All tools called during execution
    tool: string;
    arguments: Record<string, any>;
    result: any;
  }>;
  usage: {                       // Token usage statistics
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata: {                    // Execution metadata
    provider: LLMProvider;
    model: string;
    iterations: number;
    durationMs: number;
  };
}
```

## Error Handling

### Missing API Key

```typescript
try {
  const result = await runner.execute(context, config);
} catch (error) {
  if (error.message.includes('API_KEY is not configured')) {
    console.error('Please set your API key in environment variables');
  }
}
```

### Tool Call Failures

Tool call failures are automatically caught and reported back to the LLM as errors. The agent can then decide how to proceed (retry, use different tool, or report to user).

## Logging and Metrics

The Agent Runner automatically logs:
- Agent execution start/end
- Each iteration
- Tool calls and their results
- Token usage
- Execution duration
- Errors and warnings

Example log output:

```
[Agent Runner] Starting agent execution {
  provider: 'openai',
  model: 'gpt-4o-mini',
  toolsCount: 5
}
[Agent Runner] Iteration 1/10
[Agent Runner] LLM requested 1 tool call(s)
[Agent Runner] Executing tool: github.listIssues { args: {...} }
[Agent Runner] Tool github.listIssues completed successfully
[Agent Runner] Agent execution completed after 2 iteration(s)
```

## Best Practices

1. **Choose the Right Provider**:
   - OpenAI: Best for general-purpose tasks
   - DeepSeek: Cost-effective alternative with good performance
   - Anthropic Claude: Excellent for complex reasoning and following instructions

2. **Set Appropriate Limits**:
   - Use `maxIterations` to prevent infinite loops
   - Set `maxTokens` based on your use case
   - Adjust `temperature` for more/less creative responses

3. **Provide Clear System Prompts**:
   - Guide the agent's behavior with specific instructions
   - Define the agent's role and expertise
   - Set expectations for output format

4. **Handle Errors Gracefully**:
   - Wrap execution in try-catch blocks
   - Check for specific error types
   - Provide fallback behavior

5. **Monitor Token Usage**:
   - Track `result.usage` to monitor costs
   - Log token consumption for analysis
   - Set appropriate `maxTokens` limits

## Testing

### Unit Tests

```typescript
import { AgentRunner } from './agent-runner';
import { MCPClient } from './mcp-client';

describe('AgentRunner', () => {
  it('should execute agent with OpenAI', async () => {
    const mockMCPClient = new MCPClient([]);
    const runner = new AgentRunner(mockMCPClient);
    
    const config = {
      provider: 'openai' as const,
      model: 'gpt-4o-mini',
    };
    
    const context = {
      prompt: 'Hello, world!',
      tools: [],
    };
    
    const result = await runner.execute(context, config);
    expect(result.response).toBeDefined();
  });
});
```

### Integration Tests

See `control-center/test-workflow-engine.ts` for integration test examples.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Runner                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              LLM Provider Layer                     │  │
│  │  - OpenAI Client                                   │  │
│  │  - DeepSeek Client (OpenAI-compatible)            │  │
│  │  - Anthropic Client                                │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Tool Execution Layer                   │  │
│  │  - Tool format conversion                          │  │
│  │  - MCP tool calling                                │  │
│  │  - Result aggregation                              │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Metrics & Logging Layer                │  │
│  │  - Token tracking                                  │  │
│  │  - Duration measurement                            │  │
│  │  - Error logging                                   │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │    MCP Client       │
              └─────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
     ┌────▼────┐    ┌─────▼────┐   ┌─────▼────┐
     │ GitHub  │    │  Deploy  │   │   Obs    │
     │  MCP    │    │   MCP    │   │   MCP    │
     └─────────┘    └──────────┘   └──────────┘
```

## Related Documentation

- [Workflow Engine Documentation](../../../docs/WORKFLOW-ENGINE.md)
- [MCP Client Documentation](./mcp-client.ts)
- [Type Definitions](./types/agent.ts)
- [AFU-9 Architecture](../../../docs/architecture/README.md)

## Troubleshooting

### Agent doesn't call tools

**Symptoms**: Agent responds directly without using available tools

**Solutions**:
1. Verify tools are loaded: `console.log(tools)`
2. Make prompt more explicit: "Use the github.listIssues tool to..."
3. Check system prompt encourages tool use
4. Increase `maxIterations` if agent stops early

### High token usage

**Symptoms**: Excessive token consumption

**Solutions**:
1. Reduce `maxTokens` limit
2. Shorten system prompt
3. Use more efficient models (e.g., `gpt-4o-mini` instead of `gpt-4o`)
4. Limit tool result sizes

### Rate limit errors

**Symptoms**: API rate limit exceeded errors

**Solutions**:
1. Implement exponential backoff
2. Switch to higher-tier API plan
3. Use alternative provider (DeepSeek is often more generous)
4. Add delays between requests

## License

Part of AFU-9 (Autonomous Fabrication Unit - Ninefold Architecture)
