# Logging Quick Start Guide

Quick reference for using the AFU-9 structured logging system.

**📖 For comprehensive documentation, see [LOGGING.md](LOGGING.md)**

## Quick Examples

### Control Center (Next.js)

```typescript
import { logger } from '@/lib/logger';

// Component-specific logger
const log = logger.withComponent('api-handler');

// Info log
log.info('Request processed', { userId: 'user-123', duration: 234 });

// Error log
try {
  await processRequest();
} catch (error) {
  log.error('Request failed', error, { userId: 'user-123' });
}
```

### MCP Server

```typescript
// Logger is automatically available in all MCP servers via this.logger

export class GitHubMCPServer extends MCPServer {
  private async getIssue(args: any) {
    this.logger.info('Fetching issue', { 
      owner: args.owner, 
      repo: args.repo,
      issueNumber: args.number 
    });

    try {
      const result = await this.fetchIssue(args);
      this.logger.info('Issue fetched successfully', { issueNumber: args.number });
      return result;
    } catch (error) {
      this.logger.error('Failed to fetch issue', error, { 
        issueNumber: args.number 
      });
      throw error;
    }
  }
}
```

### Lambda Function

```typescript
import { LambdaLogger } from './logger';

const logger = new LambdaLogger('my-function-name');

export const handler = async (event: any) => {
  logger.info('Function started', { eventType: event.type });

  try {
    const result = await processEvent(event);
    logger.info('Function completed', { resultId: result.id });
    return result;
  } catch (error) {
    logger.error('Function failed', error, { eventType: event.type });
    throw error;
  }
};
```

## Log Levels

| Level | When to Use | Production |
|-------|-------------|------------|
| DEBUG | Development diagnostics | ❌ Disabled |
| INFO  | Normal operations | ✅ Enabled |
| WARN  | Potential issues | ✅ Enabled |
| ERROR | Errors and failures | ✅ Enabled |

## Searching Logs

### Via Control Center UI
1. Navigate to `/observability`
2. Select log group
3. Choose time range (1h, 6h, 24h)
4. Enter filter pattern (e.g., `ERROR`, `workflowId`)

### Via AWS CLI

```bash
# Follow logs in real-time
aws logs tail /ecs/afu9/control-center --follow --filter-pattern ERROR

# Search historical logs
aws logs filter-log-events \
  --log-group-name /ecs/afu9/mcp-github \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern '{ $.level = "ERROR" }'
```

### Via CloudWatch Insights

```sql
-- All errors in the last hour
fields @timestamp, service, message, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 20

-- Slow operations
fields @timestamp, message, context.duration
| filter context.duration > 5000
| sort context.duration desc
```

## Log Groups

| Component | Log Group |
|-----------|-----------|
| Control Center | `/ecs/afu9/control-center` |
| MCP GitHub | `/ecs/afu9/mcp-github` |
| MCP Deploy | `/ecs/afu9/mcp-deploy` |
| MCP Observability | `/ecs/afu9/mcp-observability` |

## Common Filter Patterns

```bash
# All errors
ERROR

# Specific workflow
"workflowId":"wf-123"

# Specific tool
"tool":"getIssue"

# JSON filter for multiple conditions
{ $.level = "ERROR" && $.context.tool = "getIssue" }

# Duration threshold
{ $.context.duration > 5000 }
```

## Best Practices

✅ **DO:**
- Use consistent field names in context
- Include enough context for debugging
- Log at appropriate levels
- Use timed operations for performance tracking

❌ **DON'T:**
- Log sensitive data (tokens, passwords, API keys)
- Use DEBUG level in production
- Log excessively (consider log volume)
- Ignore error context

## Example Log Output

```json
{
  "timestamp": "2025-12-12T17:00:00.000Z",
  "level": "INFO",
  "service": "mcp-github",
  "message": "Issue fetched successfully",
  "context": {
    "requestId": "req-1702396800-abc123",
    "tool": "getIssue",
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "issueNumber": 42,
    "duration": 234
  }
}
```

## Troubleshooting

**Logs not appearing?**
1. Check CloudWatch log group exists
2. Verify ECS task role has CloudWatch permissions
3. Check container logs with `docker logs` locally

**Can't find specific logs?**
1. Verify time range is correct
2. Check filter pattern syntax
3. Try broader search first, then narrow down

**Need more help?**
See [LOGGING.md](LOGGING.md) for comprehensive documentation.
