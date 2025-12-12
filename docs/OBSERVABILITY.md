# AFU-9 Observability & Security

## Overview

AFU-9 v0.2 includes comprehensive observability and security features for production-grade operation. This document provides an overview of all observability and security capabilities.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Control Center UI                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  Dashboard   │  │ Observability│  │   Settings Page    │   │
│  │   - Stats    │  │   - Alarms   │  │ - MCP Servers     │   │
│  │   - Health   │  │   - Logs     │  │ - Repositories    │   │
│  └──────────────┘  └──────────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       API Routes                                 │
│  /api/observability/alarms    /api/observability/logs          │
│  /api/infrastructure/health   /api/mcp/health                  │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Observability Server                     │
│  Tools: logs.search, metrics.getServiceHealth, getAlarmStatus  │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         AWS CloudWatch                           │
│  ┌──────────┐  ┌─────────┐  ┌────────┐  ┌──────────────────┐ │
│  │  Logs    │  │ Metrics │  │ Alarms │  │  Insights Queries│ │
│  └──────────┘  └─────────┘  └────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### 1. CloudWatch Alarms

Comprehensive alarms for infrastructure health:

**ECS Service Alarms**:
- High CPU (> 80% for 5 min) - P2
- High Memory (> 80% for 5 min) - P2  
- No Running Tasks (< 1 for 2 min) - P1

**RDS Database Alarms**:
- High CPU (> 80% for 10 min) - P2
- Low Storage (< 2 GB) - P2
- High Connections (> 80) - P2

**ALB Alarms**:
- High 5xx Rate (> 10 in 5 min) - P2
- Unhealthy Targets (≥ 1) - P1
- High Response Time (> 5 sec for 10 min) - P3

**Notification**: SNS topic with optional email subscription

### 2. Structured Logging

AFU-9 uses structured JSON logging across all components (Control Center, MCP Servers, Lambda Functions) for consistent observability.

**See [Logging Guide](LOGGING.md) for comprehensive documentation on:**
- Log level conventions (DEBUG, INFO, WARN, ERROR)
- JSON log format and schema
- Implementation examples for all components
- CloudWatch integration and log searching
- Filter patterns and CloudWatch Insights queries
- Best practices and troubleshooting

**Quick Example:**
```typescript
import { logger } from '@/lib/logger';

const log = logger.withComponent('workflow-engine');

log.info('Workflow started', {
  workflowId: 'wf-123',
  executionId: 'exec-456'
});

try {
  await executeWorkflow();
} catch (error) {
  log.error('Workflow failed', error, {
    workflowId: 'wf-123',
    step: 'create_pr'
  });
}
```

**Log Format**:
```json
{
  "timestamp": "2025-12-12T16:00:00.000Z",
  "level": "ERROR",
  "service": "control-center",
  "component": "workflow-engine",
  "message": "Workflow failed",
  "context": {
    "workflowId": "wf-123",
    "executionId": "exec-456",
    "step": "create_pr"
  },
  "error": {
    "name": "Error",
    "message": "GitHub API rate limit exceeded",
    "stack": "..."
  }
}
```

**Log Groups:**
- Control Center: `/ecs/afu9/control-center`
- MCP Servers: `/ecs/afu9/mcp-{github|deploy|observability}`
- Lambda Functions: `/aws/lambda/afu9-{orchestrator|issue-interpreter|patch-generator|pr-creator}`

### 3. Observability Dashboard

Accessible at `/observability` in Control Center:

**Features**:
- Real-time alarm status with summary cards
- Infrastructure health metrics (CPU, Memory)
- CloudWatch alarms list with state and descriptions
- Recent error logs viewer with filtering
- Auto-refresh every 30 seconds

**Log Filtering**:
- Select log group (Control Center, MCP servers)
- Time range (1 hour, 6 hours, 24 hours)
- Filter pattern (default: ERROR)

### 4. IAM Security

Least-privilege IAM roles:

**Task Execution Role** (ECS operations):
- Pull container images from ECR
- Write logs to CloudWatch
- Read secrets from Secrets Manager

**Task Role** (Application operations):
- Query CloudWatch logs and metrics
- Read secrets
- Update ECS services (for deploy MCP server)
- Put CloudWatch metrics

### 5. Secrets Management

All secrets stored in AWS Secrets Manager:

**Secrets**:
- `afu9/database` - Database connection (auto-managed)
- `afu9/github` - GitHub token and repository info
- `afu9/llm` - OpenAI and Anthropic API keys

**Features**:
- Encryption at rest with KMS
- Automatic database password rotation (90 days)
- IAM-based access control
- CloudTrail audit logging

### 6. Network Security

Multi-layer security:

**VPC Architecture**:
- Private subnets for ECS and RDS
- NAT Gateway for outbound internet
- No direct internet access to application

**Security Groups**:
- ALB: HTTPS from internet
- ECS: Port 3000 from ALB only
- RDS: Port 5432 from ECS only

**Encryption**:
- HTTPS/TLS for all external traffic
- TLS for RDS connections
- Encrypted EBS volumes
- Encrypted CloudWatch Logs

## API Reference

### GET /api/observability/alarms

Fetch CloudWatch alarm status.

**Response**:
```json
{
  "status": "success",
  "data": {
    "alarms": [...],
    "summary": {
      "total": 9,
      "ok": 7,
      "alarm": 1,
      "insufficientData": 1
    },
    "groupedAlarms": {
      "ok": [...],
      "alarm": [...],
      "insufficientData": [...]
    }
  },
  "timestamp": "2025-12-12T16:00:00.000Z",
  "durationMs": 234
}
```

### GET /api/observability/logs

Search CloudWatch logs.

**Query Parameters**:
- `logGroup` - Log group name (default: /ecs/afu9/control-center)
- `filterPattern` - Search pattern (default: ERROR)
- `hours` - Hours to look back (default: 1)
- `limit` - Max events to return (default: 100)

**Response**:
```json
{
  "status": "success",
  "data": {
    "events": [
      {
        "timestamp": 1702396800000,
        "message": "{\"level\":\"error\",...}",
        "logStreamName": "ecs/control-center/task-123"
      }
    ],
    "searchedLogStreams": [...],
    "nextToken": "...",
    "query": {...}
  },
  "timestamp": "2025-12-12T16:00:00.000Z",
  "durationMs": 456
}
```

### GET /api/infrastructure/health

Get ECS service health metrics.

**Response**:
```json
{
  "status": "ok",
  "cluster": "afu9-cluster",
  "service": "afu9-control-center",
  "metrics": {
    "cpu": {
      "datapoints": [
        {
          "timestamp": "2025-12-12T16:00:00.000Z",
          "average": 45.2,
          "maximum": 62.8
        }
      ],
      "unit": "Percent"
    },
    "memory": {...}
  },
  "timestamp": "2025-12-12T16:00:00.000Z"
}
```

## Deployment

See [Observability Deployment Guide](OBSERVABILITY-DEPLOYMENT.md) for step-by-step deployment instructions.

**Quick Start**:
```bash
# Deploy alarms with email notifications
npx cdk deploy Afu9AlarmsStack -c afu9-alarm-email=ops@yourdomain.com

# Update secrets
aws secretsmanager update-secret --secret-id afu9/github --secret-string '{...}'
aws secretsmanager update-secret --secret-id afu9/llm --secret-string '{...}'

# Restart service
aws ecs update-service --cluster afu9-cluster --service afu9-control-center --force-new-deployment
```

## Operations

See [Observability Runbook](OBSERVABILITY-RUNBOOK.md) for operational procedures.

**Common Tasks**:

**View Recent Errors**:
```bash
aws logs tail /ecs/afu9/control-center --follow --filter-pattern ERROR
```

**Check Alarm Status**:
```bash
aws cloudwatch describe-alarms --alarm-name-prefix afu9
```

**Query Logs with Insights**:
```bash
aws logs start-query \
  --log-group-name /ecs/afu9/control-center \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter level = "error" | sort @timestamp desc | limit 20'
```

## Monitoring Best Practices

### Daily

- Check observability dashboard for any ALARM states
- Review error count trends
- Verify backup completion

### Weekly  

- Review CloudWatch metrics for anomalies
- Check disk space trends
- Review slow query logs
- Test one disaster recovery procedure

### Monthly

- Rotate GitHub token (if needed)
- Review and optimize database indexes
- Review CloudWatch costs and adjust retention
- Update security patches
- Conduct full disaster recovery test

## Security Best Practices

### Secrets

- Never commit secrets to code
- Rotate database passwords every 90 days
- Rotate API keys quarterly
- Use Secrets Manager for all credentials
- Monitor secret access via CloudTrail

### IAM

- Follow least privilege principle
- Use separate roles for different components
- Regularly audit IAM policies
- Enable MFA for console access
- Use role-based access for applications

### Network

- Keep ECS and RDS in private subnets
- Use security groups for fine-grained access control
- Enable VPC Flow Logs
- Use HTTPS/TLS for all external traffic
- Regularly review security group rules

### Application

- Validate all API inputs
- Sanitize user inputs
- Use rate limiting
- Never expose sensitive data in errors
- Set secure HTTP headers

## Troubleshooting

### Service Unavailable

1. Check ECS service status
2. Check ALB target health
3. Review container logs
4. Verify database connectivity
5. Check security group rules

### High Error Rate

1. Check recent deployments
2. Review error logs for patterns
3. Check external service status (GitHub, LLM APIs)
4. Verify secrets are valid
5. Check rate limits

### Alarm Fatigue

1. Review alarm thresholds based on actual usage
2. Adjust evaluation periods
3. Use anomaly detection for dynamic thresholds
4. Group related alarms
5. Set appropriate severities

## Metrics

### Application Metrics

Custom metrics published to CloudWatch:

- `WorkflowExecutionTime` - Time to complete workflow (ms)
- `MCPToolCallDuration` - Time for MCP tool call (ms)
- `LLMAPILatency` - LLM API response time (ms)
- `WorkflowSuccessRate` - Percentage of successful workflows
- `MCPToolCallSuccessRate` - Percentage of successful tool calls

### Infrastructure Metrics

AWS-provided metrics:

**ECS**:
- CPUUtilization, MemoryUtilization
- RunningTaskCount, DesiredTaskCount

**RDS**:
- CPUUtilization, FreeStorageSpace
- DatabaseConnections, ReadLatency, WriteLatency

**ALB**:
- RequestCount, TargetResponseTime
- HTTPCode_Target_5XX_Count, HealthyHostCount

## Cost Optimization

### CloudWatch Logs

- Set appropriate retention periods
- Use log filters to reduce storage
- Archive old logs to S3
- Use CloudWatch Logs Insights instead of exporting

### CloudWatch Alarms

- Use composite alarms to reduce costs
- Group related metrics
- Use anomaly detection instead of fixed thresholds

### Secrets Manager

- Limit number of secrets
- Use automatic rotation to reduce manual operations
- Store non-sensitive config in Parameter Store

## References

- [Logging Guide](LOGGING.md) - Comprehensive logging concept and best practices
- [Observability Deployment Guide](OBSERVABILITY-DEPLOYMENT.md)
- [Observability Runbook](OBSERVABILITY-RUNBOOK.md)
- [Security & IAM Guide](SECURITY-IAM.md)
- [Architecture Overview](architecture/afu9-v0.2-overview.md)

## Support

For questions or issues:
- Platform team: ops@yourdomain.com
- Security concerns: security@yourdomain.com
- Emergency escalation: Follow runbook escalation path
