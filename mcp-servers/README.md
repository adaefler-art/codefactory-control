# AFU-9 MCP Servers

This directory contains the MCP (Model Context Protocol) server implementations for AFU-9 v0.2.

## Architecture

AFU-9 uses a microservices architecture where specialized MCP servers provide domain-specific tools to the main Control Center:

```
Control Center (MCP-Client)
    ├── MCP-Server: GitHub
    ├── MCP-Server: Deploy
    └── MCP-Server: Observability
```

## MCP Servers

### Base Server (`base/`)

Common base implementation for all MCP servers. Provides:
- JSON-RPC 2.0 protocol handling
- Tool registration and discovery
- Health check endpoints
- Error handling

### GitHub Server (`github/`)

**Port**: 3001  
**Purpose**: GitHub operations

**Tools**:
- `getIssue(owner, repo, number)` - Get issue details
- `listIssues(owner, repo, state?, labels?)` - List repository issues
- `createBranch(owner, repo, branch, from)` - Create a new branch
- `commitFileChanges(owner, repo, branch, message, files)` - Commit file changes to a branch
- `createPullRequest(owner, repo, title, body, head, base)` - Create PR
- `mergePullRequest(owner, repo, pull_number, commit_title?, commit_message?, merge_method?)` - Merge PR

**Environment Variables**:
- `GITHUB_TOKEN` - GitHub personal access token or App token (supports PAT and GitHub App tokens)
- `PORT` - Server port (default: 3001)

**Authentication**:
The server supports both GitHub Personal Access Tokens (PAT) and GitHub App tokens. In production environments, tokens are loaded from AWS Secrets Manager (secret: `afu9/github`). The token must have appropriate permissions for the operations being performed (see [ADDING-TOOLS.md](github/ADDING-TOOLS.md) for required scopes).

**Error Handling**:
The server provides comprehensive error handling for common GitHub API issues:
- Rate limit errors (403 with rate limit exceeded) - includes reset time
- Authentication errors (401) - indicates invalid or expired token
- Permission errors (403) - explains missing scopes or permissions
- Resource not found (404) - suggests verifying identifiers

**Adding New Tools**:
See [github/ADDING-TOOLS.md](github/ADDING-TOOLS.md) for a comprehensive guide on how to add new GitHub tools to the server.

### Deploy Server (`deploy/`)

**Port**: 3002  
**Purpose**: AWS ECS deployments

**Tools**:
- `updateService(cluster, service, forceNewDeployment?)` - Update ECS service
- `getServiceStatus(cluster, service)` - Get service status and health

**Environment Variables**:
- `AWS_REGION` - AWS region (default: eu-central-1)
- `PORT` - Server port (default: 3002)

**IAM Permissions Required**:
- `ecs:DescribeServices`
- `ecs:UpdateService`
- `ecs:DescribeTasks`
- `ecs:ListTasks`

### Observability Server (`observability/`)

**Port**: 3003  
**Purpose**: CloudWatch logs and metrics

**Tools**:
- `logs.search(logGroupName, filterPattern?, startTime?, endTime?, limit?, nextToken?)` - Search CloudWatch logs by pattern (e.g., ERROR, RequestId, TaskId) with pagination support
- `metrics.getServiceHealth(cluster, service, loadBalancerName?, targetGroupArn?, period?)` - Get ECS service health metrics (CPU, Memory, ALB 5xx rate)
- `getAlarmStatus(alarmNames?, stateValue?)` - Get CloudWatch alarm status

**Environment Variables**:
- `AWS_REGION` - AWS region (default: eu-central-1)
- `PORT` - Server port (default: 3003)

**IAM Permissions Required**:
- `logs:FilterLogEvents`
- `logs:DescribeLogGroups`
- `cloudwatch:GetMetricStatistics`
- `cloudwatch:DescribeAlarms`
- `elasticloadbalancing:DescribeLoadBalancers` (for ALB metrics)
- `elasticloadbalancing:DescribeTargetGroups` (for ALB metrics)

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- TypeScript 5+

### Install Dependencies

```bash
# Install base dependencies
cd base
npm install

# Install server-specific dependencies
cd ../github && npm install
cd ../deploy && npm install
cd ../observability && npm install
```

### Build

```bash
# Build all servers
npm run build:all

# Or build individual servers
cd github && npm run build
cd deploy && npm run build
cd observability && npm run build
```

### Run Locally

Start each server in a separate terminal:

```bash
# Terminal 1: GitHub server
cd github
export GITHUB_TOKEN=your_token_here
npm run dev

# Terminal 2: Deploy server
cd deploy
export AWS_REGION=eu-central-1
npm run dev

# Terminal 3: Observability server
cd observability
export AWS_REGION=eu-central-1
npm run dev
```

### Test

Test a server using curl:

```bash
# Health check
curl http://localhost:3001/health

# List available tools
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/list",
    "params": {}
  }'

# Call a tool
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "tool": "getIssue",
      "arguments": {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "number": 1
      }
    }
  }'
```

## Docker

### Build Images

```bash
# Build all images
docker build -t afu9/mcp-github:latest -f github/Dockerfile .
docker build -t afu9/mcp-deploy:latest -f deploy/Dockerfile .
docker build -t afu9/mcp-observability:latest -f observability/Dockerfile .
```

### Run with Docker

```bash
# Run GitHub server
docker run -d \
  --name mcp-github \
  -p 3001:3001 \
  -e GITHUB_TOKEN=your_token \
  afu9/mcp-github:latest

# Run Deploy server
docker run -d \
  --name mcp-deploy \
  -p 3002:3002 \
  -e AWS_REGION=eu-central-1 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  afu9/mcp-deploy:latest

# Run Observability server
docker run -d \
  --name mcp-observability \
  -p 3003:3003 \
  -e AWS_REGION=eu-central-1 \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  afu9/mcp-observability:latest
```

### Docker Compose

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  mcp-github:
    build:
      context: .
      dockerfile: github/Dockerfile
    ports:
      - "3001:3001"
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - PORT=3001

  mcp-deploy:
    build:
      context: .
      dockerfile: deploy/Dockerfile
    ports:
      - "3002:3002"
    environment:
      - AWS_REGION=${AWS_REGION:-eu-central-1}
      - PORT=3002
    # In production, use IAM roles instead of credentials
    # credentials_arn: arn:aws:iam::...

  mcp-observability:
    build:
      context: .
      dockerfile: observability/Dockerfile
    ports:
      - "3003:3003"
    environment:
      - AWS_REGION=${AWS_REGION:-eu-central-1}
      - PORT=3003
```

Start all servers:

```bash
docker-compose up -d
```

## ECS Deployment

In production, these servers run as sidecars in the same ECS task as the Control Center:

```yaml
Task Definition:
  - Container: control-center (port 3000)
  - Container: mcp-github (port 3001)
  - Container: mcp-deploy (port 3002)
  - Container: mcp-observability (port 3003)
```

All containers share the same network namespace and can communicate via localhost.

## MCP Protocol

All servers implement the JSON-RPC 2.0 based MCP protocol. See [docs/architecture/mcp-protocol.md](../docs/architecture/mcp-protocol.md) for details.

### Request Format

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "method": "tools/call",
  "params": {
    "tool": "toolName",
    "arguments": {
      "param1": "value1"
    }
  }
}
```

### Response Format

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"result\": \"data\"}"
      }
    ]
  }
}
```

### Error Format

```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": -32000,
    "message": "Error description",
    "data": {
      "details": "..."
    }
  }
}
```

## Adding a New Tool

To add a new tool to an existing server:

1. **Register the tool** in `registerTools()`:

```typescript
this.tools.set('myNewTool', {
  name: 'myNewTool',
  description: 'Does something useful',
  inputSchema: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter 1' },
    },
    required: ['param1'],
  },
});
```

2. **Implement the handler** in `handleToolCall()`:

```typescript
protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
  switch (tool) {
    case 'myNewTool':
      return this.myNewTool(args);
    // ... other cases
  }
}

private async myNewTool(args: { param1: string }) {
  // Implementation
  return { result: 'success' };
}
```

3. **Test the tool**:

```bash
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "test",
    "method": "tools/call",
    "params": {
      "tool": "myNewTool",
      "arguments": {
        "param1": "test value"
      }
    }
  }'
```

## Creating a New MCP Server

To create a new MCP server for a different domain:

1. **Create directory structure**:
```bash
mkdir -p mcp-servers/my-server/src
cd mcp-servers/my-server
```

2. **Create package.json**:
```json
{
  "name": "@afu9/mcp-my-server",
  "version": "0.2.0",
  "dependencies": {
    "@afu9/mcp-base": "file:../base",
    "express": "^4.18.2"
  }
}
```

3. **Implement server** in `src/index.ts`:
```typescript
import { MCPServer } from '../../base/src/server';

export class MyMCPServer extends MCPServer {
  constructor(port: number = 3004) {
    super(port, 'mcp-my-server');
  }

  protected registerTools(): void {
    // Register your tools
  }

  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    // Implement tool handlers
  }
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3004', 10);
  const server = new MyMCPServer(port);
  server.start();
}
```

4. **Create Dockerfile**
5. **Update ECS task definition** to include new container
6. **Document the new server** in this README

## Troubleshooting

### Server won't start

- Check that the port isn't already in use
- Verify environment variables are set correctly
- Check logs for specific error messages

### Tool calls fail

- Verify the tool name is correct (case-sensitive)
- Check that required parameters are provided
- Ensure credentials/permissions are configured
- Check server logs for detailed error messages

### Connection refused

- Verify the server is running: `curl http://localhost:PORT/health`
- Check firewall rules (in AWS security groups)
- Ensure the correct port is exposed in Docker/ECS

## Security

- **Never commit secrets**: Use environment variables or AWS Secrets Manager
- **Least privilege**: Grant only necessary IAM permissions
- **Network isolation**: In production, servers are in private subnets
- **Authentication**: Consider adding authentication for production use
- **Rate limiting**: Implement rate limiting for public-facing endpoints

## Performance

- **Connection pooling**: Reuse connections to external services
- **Caching**: Cache frequently accessed data
- **Async operations**: Use async/await for all I/O operations
- **Timeouts**: Set appropriate timeouts for external calls
- **Monitoring**: Track response times and error rates

## Monitoring

All MCP servers should log:
- Request/response for each tool call
- Errors with stack traces
- Performance metrics (duration, success rate)
- Health check results

Use structured JSON logging:

```json
{
  "timestamp": "2025-12-11T15:00:00.000Z",
  "level": "info",
  "component": "mcp-github",
  "tool": "getIssue",
  "duration_ms": 234,
  "status": "success"
}
```

## Future Enhancements

- [ ] Authentication/authorization layer
- [ ] Rate limiting
- [ ] Request caching
- [ ] Batch operations
- [ ] WebSocket support for streaming responses
- [ ] Metrics and tracing with OpenTelemetry
- [ ] Circuit breaker for external dependencies
- [ ] Tool versioning
- [ ] More comprehensive test coverage
