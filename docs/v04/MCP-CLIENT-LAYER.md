# MCP Client Layer - AFU-9 Core Integration

This document describes the MCP (Model Context Protocol) Client Layer implementation in AFU-9 Core, including timeout and retry capabilities with exponential backoff.

## Overview

The MCP Client Layer is a crucial component of AFU-9 v0.2 that handles all communication with MCP servers using the JSON-RPC 2.0 protocol. It provides a unified interface for calling tools across multiple MCP servers with built-in resilience features.

## Features

### Core Functionality

- **Generic Tool Calling**: `callTool(serverName, toolName, params)` function for executing tools on any MCP server
- **Tool Discovery**: List available tools from servers
- **Health Checking**: Monitor server availability
- **Server Management**: Add/remove servers dynamically

### Resilience Features

- **Timeout Handling**: Configurable timeouts using AbortController
- **Automatic Retries**: Retry failed requests with configurable attempts
- **Exponential Backoff**: Intelligent delay between retries (1s, 2s, 4s, ...)
- **Error Classification**: Distinguishes retryable from non-retryable errors

## Configuration

### Server Configuration

Each MCP server can be configured with timeout and retry settings:

```typescript
interface MCPServerConfig {
  name: string;              // Server identifier (e.g., "github", "deploy")
  endpoint: string;          // HTTP endpoint URL
  enabled: boolean;          // Enable/disable server
  healthCheckUrl?: string;   // Custom health check endpoint
  timeoutMs?: number;        // Request timeout in milliseconds (default: 30000)
  maxRetries?: number;       // Maximum retry attempts (default: 2)
  retryDelayMs?: number;     // Initial retry delay in ms (default: 1000)
  backoffMultiplier?: number; // Backoff multiplier (default: 2)
}
```

### Default Configuration

The MCP Client comes with sensible defaults for common MCP servers:

```typescript
const DEFAULT_SERVERS: MCPServerConfig[] = [
  {
    name: 'github',
    endpoint: process.env.MCP_GITHUB_ENDPOINT || 'http://localhost:3001',
    enabled: true,
    timeoutMs: 30000,        // 30 seconds
    maxRetries: 2,           // Up to 3 total attempts
    retryDelayMs: 1000,      // 1 second initial delay
    backoffMultiplier: 2,    // Exponential backoff
  },
  {
    name: 'deploy',
    endpoint: process.env.MCP_DEPLOY_ENDPOINT || 'http://localhost:3002',
    enabled: true,
    timeoutMs: 60000,        // 60 seconds for deployments
    maxRetries: 2,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
  },
  {
    name: 'observability',
    endpoint: process.env.MCP_OBSERVABILITY_ENDPOINT || 'http://localhost:3003',
    enabled: true,
    timeoutMs: 30000,
    maxRetries: 2,
    retryDelayMs: 1000,
    backoffMultiplier: 2,
  },
];
```

### Environment Variables

Configure MCP server endpoints via environment variables:

```bash
MCP_GITHUB_ENDPOINT=http://localhost:3001
MCP_DEPLOY_ENDPOINT=http://localhost:3002
MCP_OBSERVABILITY_ENDPOINT=http://localhost:3003
```

## Usage

### Basic Tool Calling

```typescript
import { getMCPClient } from './lib/mcp-client';

const client = getMCPClient();

// Call a tool with default server configuration
const issue = await client.callTool('github', 'getIssue', {
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  number: 42,
});
```

### Per-Call Options Override

You can override timeout and retry settings for individual calls:

```typescript
interface MCPCallOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  backoffMultiplier?: number;
}

// Long-running operation with custom timeout
const report = await client.callTool('github', 'generateReport', params, {
  timeoutMs: 120000,  // 2 minutes
  maxRetries: 5,
  retryDelayMs: 2000,
  backoffMultiplier: 2,
});

// Quick operation with no retries
const status = await client.callTool('deploy', 'getStatus', params, {
  timeoutMs: 5000,    // 5 seconds
  maxRetries: 0,      // No retries
});
```

### Tool Discovery

```typescript
// List available tools from a server
const tools = await client.listTools('github');

tools.forEach(tool => {
  console.log(`${tool.name}: ${tool.description}`);
});
```

### Health Checking

```typescript
// Check health of a specific server
const health = await client.checkHealth('github');
console.log(`GitHub server status: ${health.status}`);

// Check health of all servers
const allHealth = await client.checkAllHealth();
allHealth.forEach((health, serverName) => {
  console.log(`${serverName}: ${health.status}`);
});
```

## Retry Behavior

### Error Classification

The MCP Client automatically classifies errors as retryable or non-retryable:

**Retryable Errors** (will trigger retries):
- Network errors (connection refused, connection reset)
- Timeout errors
- HTTP 5xx errors (server errors)
- HTTP 429 (rate limit exceeded)
- Fetch failures

**Non-Retryable Errors** (immediate failure):
- HTTP 4xx errors (except 429) - client errors
- Invalid parameters
- Authentication failures
- Permission errors

### Exponential Backoff

The retry delay increases exponentially with each attempt:

```
Attempt 1: Immediate (0ms)
Attempt 2: Wait retryDelayMs (e.g., 1000ms)
Attempt 3: Wait retryDelayMs × backoffMultiplier (e.g., 2000ms)
Attempt 4: Wait retryDelayMs × backoffMultiplier² (e.g., 4000ms)
...
```

**Example with default settings** (retryDelayMs=1000, backoffMultiplier=2, maxRetries=2):
- Attempt 1: Immediate
- Attempt 2: Wait 1 second (1000ms)
- Attempt 3: Wait 2 seconds (2000ms)
- Total max time: ~3 seconds + operation time

## Integration

### Workflow Engine Integration

The Workflow Engine automatically uses the MCP Client for all tool calls:

```typescript
import { WorkflowEngine } from './lib/workflow-engine';

const workflow = {
  steps: [
    {
      name: 'fetch_issue',
      tool: 'github.getIssue',  // Uses MCP Client with timeout/retry
      params: {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        number: 42,
      },
      assign: 'issue',
    },
  ],
};

const engine = new WorkflowEngine();
const result = await engine.execute(workflow, context);
```

The Workflow Engine benefits from:
- Automatic timeout handling for each step
- Automatic retries with exponential backoff
- Proper error classification and reporting

### Agent Runner Integration

The Agent Runner uses the MCP Client for LLM tool calling:

```typescript
import { AgentRunner } from './lib/agent-runner';

const runner = new AgentRunner();
const tools = await runner.loadToolsFromMCP(['github', 'deploy']);

const result = await runner.execute({
  prompt: 'Create a new branch for issue #42',
  tools,
}, {
  provider: 'openai',
  model: 'gpt-4o-mini',
});
```

The Agent Runner benefits from:
- Resilient tool calls even when LLM makes multiple requests
- Automatic handling of transient failures
- Per-server timeout configuration for different tool types

## Testing

### Unit Tests

Run the comprehensive test suite:

```bash
cd control-center
npx tsx test-mcp-timeout-retry.ts
```

The test suite validates:
- Configuration model
- Call options override
- Exponential backoff calculation
- Error classification
- Integration with Workflow Engine
- Integration with Agent Runner
- Default configuration fallback

### Integration Tests

Test with real MCP servers:

```bash
# Start MCP servers
cd mcp-servers/github && npm run dev &
cd mcp-servers/deploy && npm run dev &

# Run workflow engine tests
cd control-center
npx tsx test-workflow-engine.ts

# Run agent runner tests (requires API keys)
export OPENAI_API_KEY=your-key
npx tsx test-agent-runner.ts
```

## Error Handling

### Timeout Errors

When a request times out, the MCP Client throws a specific error:

```typescript
try {
  const result = await client.callTool('github', 'longOperation', params);
} catch (error) {
  if (error.message.includes('timed out')) {
    console.error('Operation timed out, consider increasing timeout');
  }
}
```

### Retry Exhaustion

After all retries are exhausted, the last error is thrown:

```typescript
try {
  const result = await client.callTool('github', 'unreliableOperation', params);
} catch (error) {
  console.error('Operation failed after all retries:', error.message);
  // Handle permanent failure
}
```

### Logging

The MCP Client provides detailed logging for debugging:

```
[MCP Client] Calling tool github.getIssue {requestId, args, timeoutMs, maxRetries}
[MCP Client] Retrying github.getIssue (attempt 2/3) after 1000ms
[MCP Client] Tool call failed (retryable error) {serverName, toolName, attempt, error}
[MCP Client] Tool call failed after all retries {serverName, toolName, error}
```

## Best Practices

### Timeout Configuration

- **Quick operations** (status checks, health checks): 5-10 seconds
- **Standard operations** (CRUD operations): 30 seconds (default)
- **Long operations** (deployments, reports): 60-120 seconds
- **Very long operations** (builds, migrations): 300+ seconds

### Retry Configuration

- **Idempotent operations**: Enable retries (maxRetries=2-5)
- **Non-idempotent operations**: Disable retries (maxRetries=0)
- **Critical operations**: More retries (maxRetries=5)
- **Non-critical operations**: Fewer retries (maxRetries=1)

### Backoff Configuration

- **Default backoff**: 2x multiplier is reasonable for most cases
- **Aggressive backoff**: 3x multiplier for rate-limited APIs
- **Conservative backoff**: 1.5x multiplier for frequently accessed APIs

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │            Workflow Engine / Agent Runner              │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  MCP Client Layer                       │  │
│  │  ┌───────────────────────────────────────────────────┐ │  │
│  │  │           callTool() with Retry Loop              │ │  │
│  │  │  - Attempt 1 (immediate)                          │ │  │
│  │  │  - Attempt 2 (after backoff delay)                │ │  │
│  │  │  - Attempt 3 (after exponential delay)            │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  │  ┌───────────────────────────────────────────────────┐ │  │
│  │  │     executeToolCall() with Timeout                │ │  │
│  │  │  - AbortController for timeout                    │ │  │
│  │  │  - JSON-RPC 2.0 request/response                  │ │  │
│  │  │  - Error classification                            │ │  │
│  │  └───────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐        ┌─────▼────┐       ┌─────▼────┐
    │ GitHub  │        │  Deploy  │       │   Obs    │
    │  MCP    │        │   MCP    │       │   MCP    │
    └─────────┘        └──────────┘       └──────────┘
```

## Performance Considerations

### Timeout Selection

- Too short: Legitimate requests may fail unnecessarily
- Too long: Failed operations take too long to detect
- **Recommendation**: Start with 30s, adjust based on actual operation times

### Retry Count

- Too few: Transient failures not handled properly
- Too many: Wasted time on permanent failures
- **Recommendation**: 2 retries (3 total attempts) is a good balance

### Backoff Strategy

- Prevents overwhelming struggling servers
- Gives time for transient issues to resolve
- **Recommendation**: Exponential backoff with 2x multiplier

## Future Enhancements

- [ ] Circuit breaker pattern for failing servers
- [ ] Request queuing and rate limiting
- [ ] Metrics and monitoring integration
- [ ] Custom retry strategies per tool
- [ ] Jitter in backoff delays
- [ ] Parallel request handling
- [ ] Request deduplication
- [ ] Response caching

## Related Documentation

- [Workflow Engine & Agent Runner Documentation](./WORKFLOW-ENGINE.md)
- [MCP Protocol Specification](./architecture/mcp-protocol.md)
- [AFU-9 Architecture Overview](./architecture/README.md)

## References

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [Exponential Backoff Best Practices](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
