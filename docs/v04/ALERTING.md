# AFU-9 Alerting and Monitoring

This document describes the alerting and monitoring system for AFU-9, including CloudWatch alarms, health indicators in the Control Center dashboard, and notification channels.

## Overview

The AFU-9 alerting system provides:

1. **CloudWatch Alarms** - Automated monitoring of infrastructure metrics
2. **Health Status Dashboard** - Visual health indicators (Red/Yellow/Green) in the Control Center
3. **Notification Channels** - Email and webhook notifications (Slack, Teams, etc.)

## CloudWatch Alarms

The `Afu9AlarmsStack` creates comprehensive CloudWatch alarms for:

### ECS Service Alarms

| Alarm Name | Metric | Threshold | Description |
|------------|--------|-----------|-------------|
| `afu9-ecs-high-cpu` | CPUUtilization | > 80% | ECS service CPU above 80% for 5 minutes |
| `afu9-ecs-high-memory` | MemoryUtilization | > 80% | ECS service memory above 80% for 5 minutes |
| `afu9-ecs-no-running-tasks` | RunningTaskCount | < 1 | No running ECS tasks for 2 minutes |

### RDS Database Alarms

| Alarm Name | Metric | Threshold | Description |
|------------|--------|-----------|-------------|
| `afu9-rds-high-cpu` | CPUUtilization | > 80% | RDS CPU above 80% for 10 minutes |
| `afu9-rds-low-storage` | FreeStorageSpace | < 2GB | RDS free storage below 2GB |
| `afu9-rds-high-connections` | DatabaseConnections | > 80 | More than 80 database connections |

### ALB (Load Balancer) Alarms

| Alarm Name | Metric | Threshold | Description |
|------------|--------|-----------|-------------|
| `afu9-alb-high-5xx-rate` | HTTPCode_Target_5XX_Count | > 10 | More than 10 5xx errors in 5 minutes |
| `afu9-alb-unhealthy-targets` | UnHealthyHostCount | >= 1 | ALB has unhealthy targets for 2 minutes |
| `afu9-alb-high-response-time` | TargetResponseTime | > 5s | Response time above 5 seconds |

## Health Status Dashboard

The Control Center dashboard displays a prominent health status indicator with three states:

### Health States

- **🟢 Healthy (Green)**: All alarms OK, infrastructure operational
- **🟡 Warning (Yellow)**: Infrastructure degraded or alarms have insufficient data
- **🔴 Critical (Red)**: One or more alarms in ALARM state

### Dashboard Features

1. **System Health Status Card** - Prominent card showing overall health with:
   - Large visual indicator (Green/Yellow/Red circle)
   - Alarm summary (count of alarms in each state)
   - Infrastructure status
   - Recent metrics (CPU, Memory)

2. **Infrastructure Health Section** - Detailed metrics including:
   - CPU and Memory utilization
   - ALB 5xx error count
   - Service and cluster information

3. **Auto-refresh** - Dashboard data refreshes automatically when viewing

## Notification Channels

### Email Notifications

Email notifications are sent via Amazon SNS when alarms trigger.

**Setup:**
```bash
# Deploy with email notification
npx cdk deploy Afu9AlarmsStack -c afu9-alarm-email=ops@example.com
```

After deployment, check your email and confirm the SNS subscription.

### Webhook Notifications (Slack, Teams, etc.)

Webhook notifications are sent via a Lambda function that forwards CloudWatch alarms to your webhook URL.

**Slack Setup:**

1. Create a Slack Incoming Webhook:
   - Go to https://api.slack.com/messaging/webhooks
   - Create a new webhook for your channel
   - Copy the webhook URL

2. Deploy with webhook notification:
```bash
npx cdk deploy Afu9AlarmsStack \
  -c afu9-webhook-url=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Microsoft Teams Setup:**

1. Create a Teams Incoming Webhook:
   - In Teams, go to your channel → Connectors → Incoming Webhook
   - Copy the webhook URL

2. Deploy with webhook notification:
```bash
npx cdk deploy Afu9AlarmsStack \
  -c afu9-webhook-url=https://outlook.office.com/webhook/YOUR_WEBHOOK_URL
```

**Custom Webhook:**

The webhook function sends a Slack-compatible JSON payload:

```json
{
  "text": "🔴 CloudWatch Alarm: afu9-ecs-high-cpu",
  "attachments": [
    {
      "color": "#ff0000",
      "fields": [
        {
          "title": "Alarm Name",
          "value": "afu9-ecs-high-cpu",
          "short": true
        },
        {
          "title": "State",
          "value": "ALARM",
          "short": true
        },
        {
          "title": "Reason",
          "value": "Threshold Crossed: 1 datapoint [85.0] was greater than the threshold (80.0)",
          "short": false
        },
        {
          "title": "Time",
          "value": "2024-12-12T18:45:00.000Z",
          "short": false
        }
      ],
      "footer": "AFU-9 CloudWatch Alarms",
      "ts": 1702409100
    }
  ]
}
```

### Combining Notifications

You can enable both email and webhook notifications:

```bash
npx cdk deploy Afu9AlarmsStack \
  -c afu9-alarm-email=ops@example.com \
  -c afu9-webhook-url=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## Monitoring Best Practices

### 1. Regular Review

- Review alarms weekly to ensure thresholds are appropriate
- Check for false positives and adjust thresholds
- Monitor alarm history in CloudWatch console

### 2. Response Procedures

When an alarm triggers:

1. **Check Dashboard** - Open Control Center dashboard to see health status
2. **Review Observability Page** - Check `/observability` for detailed alarm info and logs
3. **Investigate Metrics** - Use AWS CloudWatch console for detailed metric analysis
4. **Check Logs** - Review CloudWatch Logs for errors or warnings
5. **Take Action** - Scale resources, restart services, or fix issues as needed

### 3. Alarm Tuning

Adjust alarm thresholds based on your workload:

```typescript
// Example: Customize CPU threshold
const ecsHighCpuAlarm = new cloudwatch.Alarm(this, 'EcsHighCpuAlarm', {
  // ... other config
  threshold: 90, // Increase from 80% to 90%
});
```

### 4. Integration with Incident Management

For production environments, consider integrating with:

- **PagerDuty** - Use SNS to PagerDuty integration
- **OpsGenie** - Use SNS to OpsGenie integration
- **Custom Systems** - Use the webhook Lambda function as a template

## API Endpoints

The Control Center provides REST APIs for querying alarm and health status:

### Get Alarm Status

```bash
GET /api/observability/alarms
```

Response:
```json
{
  "status": "success",
  "data": {
    "alarms": [...],
    "summary": {
      "total": 8,
      "ok": 7,
      "alarm": 1,
      "insufficientData": 0
    }
  },
  "timestamp": "2024-12-12T18:45:00.000Z"
}
```

### Get Infrastructure Health

```bash
GET /api/infrastructure/health
```

Response:
```json
{
  "status": "ok",
  "cluster": "afu9-cluster",
  "service": "afu9-control-center",
  "metrics": {
    "cpu": {
      "datapoints": [...]
    },
    "memory": {
      "datapoints": [...]
    },
    "alb5xx": {
      "datapoints": [...]
    }
  },
  "timestamp": "2024-12-12T18:45:00.000Z"
}
```

## Troubleshooting

### Alarm Not Triggering

1. Check alarm configuration in CloudWatch console
2. Verify metrics are being published (check CloudWatch Metrics)
3. Review alarm evaluation periods and thresholds
4. Check alarm state history in CloudWatch

### No Notifications Received

**Email:**
- Verify SNS subscription is confirmed
- Check spam folder
- Verify email address in stack parameters

**Webhook:**
- Check Lambda function logs: `/aws/lambda/afu9-alarm-webhook`
- Verify webhook URL is correct
- Test webhook URL with curl
- Check Lambda permissions and errors

### Dashboard Shows "Unknown" Health

1. Check that observability MCP server is running
2. Verify AWS credentials and permissions
3. Check CloudWatch API permissions for ECS task role
4. Review browser console for API errors

## Cost Optimization

- CloudWatch alarms: ~$0.10 per alarm per month
- SNS notifications: First 1,000 notifications free, then $0.50 per 1 million
- Lambda invocations: First 1 million free, minimal cost after
- CloudWatch Logs: Stored for 7 days, minimal cost

Total estimated cost for v0.2: **< $5/month** for typical usage.

## Security Considerations

1. **Webhook URLs**: Store sensitive webhook URLs in AWS Secrets Manager instead of context
2. **SNS Topic**: Topic is not encrypted by default; enable encryption for sensitive data
3. **Lambda Permissions**: Function has minimal permissions (only invoked by SNS)
4. **API Access**: Control Center APIs require authentication in production

## Further Reading

- [AWS CloudWatch Alarms Documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [SNS Subscriptions](https://docs.aws.amazon.com/sns/latest/dg/sns-subscription-filter-policies.html)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)
- [Teams Incoming Webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook)
