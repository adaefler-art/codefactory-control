# MCP Protocol Implementation

## What is MCP?

The Model Context Protocol (MCP) is an architectural pattern for AI applications that separates concerns between:
- **MCP-Client**: The orchestrator (AFU-9 Control Center) that needs to perform actions
- **MCP-Server**: Specialized services that provide domain-specific tools and capabilities

## Protocol Overview

### Communication

AFU-9 uses HTTP/JSON-RPC for MCP communication:

```
Client (AFU-9) --[HTTP/JSON-RPC]--> MCP-Server (GitHub, Deploy, etc.)
```

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "tools/call",
  "params": {
    "tool": "github.getIssue",
    "arguments": {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "number": 42
    }
  }
}
```

### Response Format

**Success**:
```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"number\": 42, \"title\": \"Bug fix\", ...}"
      }
    ]
  }
}
```

**Error**:
```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32000,
    "message": "Issue not found",
    "data": {
      "status": 404,
      "details": "Repository issue #42 does not exist"
    }
  }
}
```

## MCP-Client Implementation (AFU-9 Core)

### MCPClient Class

```typescript
// lib/mcp/client.ts
import { v4 as uuidv4 } from 'uuid';

export interface MCPServer {
  name: string;
  endpoint: string;
  timeout: number;
  enabled: boolean;
}

export interface ToolCallParams {
  tool: string;
  arguments: Record<string, any>;
}

export interface ToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: any;
  }>;
}

export class MCPClient {
  private servers: Map<string, MCPServer> = new Map();

  constructor(servers: MCPServer[]) {
    servers.forEach(s => this.servers.set(s.name, s));
  }

  async callTool(
    serverName: string,
    tool: string,
    args: Record<string, any>
  ): Promise<ToolCallResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server '${serverName}' not configured`);
    }

    if (!server.enabled) {
      throw new Error(`MCP server '${serverName}' is disabled`);
    }

    const requestId = uuidv4();
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        tool,
        arguments: args
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), server.timeout);

    try {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(
          `MCP Error: ${result.error.message} (code: ${result.error.code})`
        );
      }

      return result.result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`MCP call to ${serverName} timed out after ${server.timeout}ms`);
      }
      throw error;
    }
  }

  async listTools(serverName: string): Promise<string[]> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server '${serverName}' not configured`);
    }

    const request = {
      jsonrpc: '2.0',
      id: uuidv4(),
      method: 'tools/list',
      params: {}
    };

    const response = await fetch(server.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    const result = await response.json();
    return result.result.tools.map((t: any) => t.name);
  }

  async healthCheck(serverName: string): Promise<boolean> {
    const server = this.servers.get(serverName);
    if (!server) return false;

    try {
      const request = {
        jsonrpc: '2.0',
        id: uuidv4(),
        method: 'health',
        params: {}
      };

      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(5000)
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### Usage in Workflow Engine

```typescript
// lib/workflow/engine.ts
import { MCPClient } from '../mcp/client';
import { db } from '../db';

export class WorkflowEngine {
  constructor(private mcpClient: MCPClient) {}

  async executeStep(executionId: string, step: WorkflowStep) {
    const startTime = Date.now();
    
    try {
      // Parse tool name: "github.getIssue" -> server="github", tool="getIssue"
      const [serverName, ...toolParts] = step.tool.split('.');
      const toolName = toolParts.join('.');

      console.log(`Calling MCP tool: ${serverName}.${toolName}`, step.params);

      const result = await this.mcpClient.callTool(
        serverName,
        toolName,
        step.params
      );

      const duration = Date.now() - startTime;

      // Log tool call
      await db.mcpToolCalls.create({
        executionId,
        serverName,
        toolName,
        params: step.params,
        result: result.content,
        durationMs: duration,
        completedAt: new Date()
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      await db.mcpToolCalls.create({
        executionId,
        serverName,
        toolName,
        params: step.params,
        error: error.message,
        durationMs: duration,
        completedAt: new Date()
      });

      throw error;
    }
  }
}
```

## MCP-Server Implementation (Base)

### Base Server Structure

```typescript
// mcp-servers/base/server.ts
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export abstract class MCPServer {
  protected app = express();
  protected tools: Map<string, Tool> = new Map();

  constructor(protected port: number) {
    this.app.use(express.json());
    this.setupRoutes();
  }

  protected abstract registerTools(): void;
  protected abstract handleToolCall(
    tool: string,
    args: Record<string, any>
  ): Promise<any>;

  private setupRoutes() {
    this.app.post('/', async (req, res) => {
      const { jsonrpc, id, method, params } = req.body;

      if (jsonrpc !== '2.0') {
        return res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32600,
            message: 'Invalid JSON-RPC version'
          }
        });
      }

      try {
        switch (method) {
          case 'health':
            return res.json({
              jsonrpc: '2.0',
              id,
              result: { status: 'ok', timestamp: new Date().toISOString() }
            });

          case 'tools/list':
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                tools: Array.from(this.tools.values())
              }
            });

          case 'tools/call':
            const { tool, arguments: args } = params;
            const result = await this.handleToolCall(tool, args);
            return res.json({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: JSON.stringify(result) }]
              }
            });

          default:
            return res.json({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Method not found: ${method}`
              }
            });
        }
      } catch (error) {
        console.error('MCP Server error:', error);
        return res.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: error.message,
            data: { stack: error.stack }
          }
        });
      }
    });
  }

  start() {
    this.registerTools();
    this.app.listen(this.port, () => {
      console.log(`MCP Server listening on port ${this.port}`);
      console.log(`Tools: ${Array.from(this.tools.keys()).join(', ')}`);
    });
  }
}
```

## Error Handling

### Standard Error Codes

| Code | Meaning | Usage |
|------|---------|-------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Invalid JSON-RPC format |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Missing/invalid parameters |
| -32603 | Internal error | Server-side error |
| -32000 | Application error | Tool-specific error |

### Retry Strategy

The MCP-Client implements exponential backoff for transient errors:

```typescript
async function callWithRetry(
  client: MCPClient,
  server: string,
  tool: string,
  args: any,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await client.callTool(server, tool, args);
    } catch (error) {
      const isRetryable = 
        error.message.includes('timeout') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('503');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      console.log(`Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## Security

### Authentication

MCP-Servers authenticate using:
1. **Shared Secret**: `X-MCP-Secret` header (for internal services)
2. **AWS IAM**: IAM roles for AWS service access
3. **GitHub Token**: From AWS Secrets Manager

```typescript
// Middleware for authentication
app.use((req, res, next) => {
  const secret = req.headers['x-mcp-secret'];
  if (secret !== process.env.MCP_SHARED_SECRET) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Unauthorized'
      }
    });
  }
  next();
});
```

### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests from this IP'
});

app.use(limiter);
```

## Monitoring

### Metrics to Track

- Tool call count (by tool, by server)
- Tool call duration (p50, p95, p99)
- Error rate
- Timeout rate
- Retry rate

### Logging

All tool calls should be logged with structured format:

```json
{
  "timestamp": "2025-12-11T15:00:00.000Z",
  "level": "info",
  "component": "mcp-server-github",
  "tool": "getIssue",
  "params": {"owner": "adaefler-art", "repo": "test", "number": 42},
  "duration_ms": 234,
  "status": "success"
}
```

## Testing

### Unit Tests

```typescript
describe('MCPClient', () => {
  it('should call tool successfully', async () => {
    const client = new MCPClient([
      { name: 'test', endpoint: 'http://localhost:3001', timeout: 5000, enabled: true }
    ]);

    const result = await client.callTool('test', 'echo', { message: 'hello' });
    
    expect(result.content[0].text).toBe('{"message":"hello"}');
  });

  it('should handle timeout', async () => {
    const client = new MCPClient([
      { name: 'test', endpoint: 'http://localhost:3001', timeout: 100, enabled: true }
    ]);

    await expect(
      client.callTool('test', 'slow', {})
    ).rejects.toThrow('timed out');
  });
});
```

### Integration Tests

Use Docker Compose to run all MCP servers locally for integration testing.

## References

- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
