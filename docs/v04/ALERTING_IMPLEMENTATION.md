# AFU-9 Alerting System Implementation Summary

## Overview

This implementation adds a comprehensive alerting and monitoring system for AFU-9, addressing issue #XX with CloudWatch alarms, health status UI indicators, and notification channels.

## What Was Implemented

### 1. Enhanced Dashboard Health Indicator

**Location**: `control-center/app/dashboard/page.tsx`

**Features**:
- **Prominent Health Status Card** with Red/Yellow/Green indicators
- **Overall Health Status** determined by:
  - 🟢 **Healthy (Green)**: All alarms OK, infrastructure operational
  - 🟡 **Warning (Yellow)**: Infrastructure degraded or insufficient alarm data
  - 🔴 **Critical (Red)**: One or more alarms in ALARM state
  - ⚪ **Unknown (Gray)**: Unable to determine status

**Visual Components**:
- Large circular status indicator with icon (✓, ⚠, ✕, ?)
- Status summary grid showing:
  - CloudWatch Alarms count (ALARM, OK, No Data)
  - Infrastructure status
  - Recent metrics (CPU, Memory)
- Link to detailed observability page

**Implementation Details**:
```typescript
// New interfaces
interface AlarmSummary {
  total: number;
  ok: number;
  alarm: number;
  insufficientData: number;
}

interface AlarmStatus {
  status: string;
  data?: { summary: AlarmSummary };
}

type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

// Health status determination logic
const getOverallHealthStatus = (): HealthStatus => {
  // Critical if any alarms are in ALARM state
  if (alarmStatus.data?.summary.alarm > 0) return 'critical';
  
  // Warning if infrastructure unavailable or insufficient data
  if (infrastructureHealth.status === 'unavailable') return 'warning';
  if (alarmStatus.data?.summary.insufficientData > 0) return 'warning';
  
  // Healthy if all alarms OK
  if (alarmStatus.status === 'success' && infrastructureHealth.status === 'ok') {
    return 'healthy';
  }
  
  return 'unknown';
};
```

### 2. Webhook Notification Support

**Location**: `lib/afu9-alarms-stack.ts`

**Features**:
- **Lambda Function** for forwarding SNS notifications to webhooks
- **Slack-compatible payload format** (also works with Teams, Discord, custom webhooks)
- **Color-coded messages**: Red for ALARM, Green for OK, Gray for INSUFFICIENT_DATA
- **Automatic retry** via SNS built-in retry mechanism

**New Stack Props**:
```typescript
export interface Afu9AlarmsStackProps extends cdk.StackProps {
  // ... existing props ...
  
  /**
   * Webhook URL for alarm notifications (e.g., Slack webhook)
   * Optional - if not provided, no webhook notifications will be configured
   */
  webhookUrl?: string;
}
```

**Lambda Function Details**:
- **Runtime**: Node.js 20.x
- **Memory**: 256 MB
- **Timeout**: 10 seconds
- **Logging**: CloudWatch Logs (`/aws/lambda/afu9-alarm-webhook`)
- **Permissions**: Invoked by SNS only

**Webhook Payload Format** (Slack-compatible):
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
          "value": "Threshold Crossed: 1 datapoint [85.0] was greater than threshold (80.0)",
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

### 3. CDK Stack Updates

**Location**: `bin/codefactory-control.ts`

**Changes**:
- Added `webhookUrl` context parameter support
- Updated stack description to mention webhook notifications

**Deployment Commands**:
```bash
# With email only
npx cdk deploy Afu9AlarmsStack -c afu9-alarm-email=ops@example.com

# With webhook only (Slack)
npx cdk deploy Afu9AlarmsStack \
  -c afu9-webhook-url=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# With both email and webhook
npx cdk deploy Afu9AlarmsStack \
  -c afu9-alarm-email=ops@example.com \
  -c afu9-webhook-url=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 4. Comprehensive Documentation

**Location**: `docs/ALERTING.md`

**Contents**:
- Overview of alerting system
- Complete alarm list with thresholds
- Health status dashboard documentation
- Notification channel setup guides (Email, Slack, Teams, Custom)
- Monitoring best practices
- Response procedures
- Troubleshooting guide
- API endpoints documentation
- Cost estimation
- Security considerations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CloudWatch Alarms                         │
│  (ECS, RDS, ALB metrics monitored continuously)             │
└──────────────────────┬──────────────────────────────────────┘
                       │ Alarm triggers
                       ↓
              ┌────────────────┐
              │   SNS Topic    │
              │  afu9-alarms   │
              └────┬──────┬────┘
                   │      │
        ┏━━━━━━━━━━┛      └━━━━━━━━━━┓
        ↓                             ↓
┌───────────────┐            ┌────────────────┐
│ Email         │            │ Lambda         │
│ Subscription  │            │ Webhook        │
│               │            │ Function       │
└───────────────┘            └────────┬───────┘
                                      │
                                      ↓
                             ┌─────────────────┐
                             │ Webhook URL     │
                             │ (Slack/Teams)   │
                             └─────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Control Center Dashboard                  │
│                                                              │
│  ┌──────────────────────────────────────────────────┐      │
│  │         System Health Status Card                 │      │
│  │                                                    │      │
│  │   [🟢]  Healthy                                   │      │
│  │                                                    │      │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐        │      │
│  │   │ Alarms   │ │ Infra    │ │ Metrics  │        │      │
│  │   │ 0 ALARM  │ │ OK       │ │ CPU: 45% │        │      │
│  │   │ 8 OK     │ │          │ │ Mem: 62% │        │      │
│  │   └──────────┘ └──────────┘ └──────────┘        │      │
│  └──────────────────────────────────────────────────┘      │
│                                                              │
│  Fetches data every page load from:                         │
│  - /api/observability/alarms                                │
│  - /api/infrastructure/health                               │
└─────────────────────────────────────────────────────────────┘
```

## Existing Infrastructure (Leveraged)

### CloudWatch Alarms (Already Implemented)

The `Afu9AlarmsStack` was already comprehensive with 8 alarms:

1. **afu9-ecs-high-cpu**: ECS CPU > 80%
2. **afu9-ecs-high-memory**: ECS Memory > 80%
3. **afu9-ecs-no-running-tasks**: Running tasks < 1
4. **afu9-rds-high-cpu**: RDS CPU > 80%
5. **afu9-rds-low-storage**: RDS storage < 2GB
6. **afu9-rds-high-connections**: DB connections > 80
7. **afu9-alb-high-5xx-rate**: 5xx errors > 10
8. **afu9-alb-unhealthy-targets**: Unhealthy targets >= 1

### API Routes (Already Implemented)

- **GET /api/observability/alarms**: Returns alarm status via MCP Observability Server
- **GET /api/infrastructure/health**: Returns ECS metrics and health

### UI Pages (Already Implemented)

- **Dashboard** (`/dashboard`): Overview with stats
- **Observability** (`/observability`): Detailed alarms and logs view

## What Changed

### Before This Implementation

1. ✅ Alarms existed but only email notifications
2. ✅ Dashboard showed infrastructure metrics but no clear health indicator
3. ✅ Observability page existed but required manual navigation
4. ❌ No webhook/Slack notifications
5. ❌ No prominent Red/Yellow/Green health status
6. ❌ No comprehensive alerting documentation

### After This Implementation

1. ✅ Alarms with email AND webhook notifications
2. ✅ Dashboard shows prominent Red/Yellow/Green health status card
3. ✅ Observability page accessible via link from health card
4. ✅ Webhook/Slack notifications via Lambda function
5. ✅ Clear visual health status (🟢🟡🔴⚪)
6. ✅ Comprehensive alerting documentation (ALERTING.md)

## Testing Checklist

### Manual Testing (Requires Deployment)

- [ ] Deploy updated Afu9AlarmsStack with webhook URL
- [ ] Verify Lambda function is created and has correct permissions
- [ ] Manually trigger a test alarm (e.g., set CPU threshold to 1%)
- [ ] Verify email notification received (if configured)
- [ ] Verify webhook notification received in Slack/Teams (if configured)
- [ ] Check Lambda function logs for successful webhook delivery
- [ ] Open Control Center dashboard
- [ ] Verify System Health Status card displays correctly
- [ ] Verify health indicator shows correct state based on alarms
- [ ] Trigger an alarm and verify dashboard updates to "Critical" (Red)
- [ ] Resolve alarm and verify dashboard updates to "Healthy" (Green)
- [ ] Test with infrastructure unavailable (stop MCP server)
- [ ] Verify dashboard shows "Warning" (Yellow) or "Unknown" state

### Automated Testing (Future)

- Integration tests for webhook Lambda function
- UI tests for dashboard health indicator
- Mock alarm status API responses
- Test health status determination logic

## Security Considerations

1. **Webhook URL Security**:
   - Currently passed via CDK context (visible in CloudFormation)
   - **Recommendation**: Store in AWS Secrets Manager for production
   - Lambda function logs don't expose webhook URL

2. **Lambda Permissions**:
   - Function can only be invoked by SNS topic
   - No outbound permissions beyond HTTPS to webhook URL
   - Follows principle of least privilege

3. **Dashboard API**:
   - Currently unauthenticated (local dev)
   - **Recommendation**: Add authentication for production deployment

## Cost Impact

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| CloudWatch Alarms (8) | ~$0.80 |
| SNS Notifications | ~$0.01 (first 1,000 free) |
| Lambda Invocations | ~$0.00 (first 1M free) |
| Lambda Execution Time | ~$0.00 (minimal) |
| CloudWatch Logs (Lambda) | ~$0.10 |
| **Total** | **< $1.00/month** |

## Future Enhancements

1. **Enhanced Webhook Support**:
   - Support for PagerDuty
   - Support for OpsGenie
   - Custom webhook templates

2. **Dashboard Improvements**:
   - Historical health status graph
   - Alarm trends over time
   - Notification history

3. **Advanced Alerting**:
   - Composite alarms (logical combinations)
   - Anomaly detection alarms
   - Custom metrics and alarms

4. **Mobile Support**:
   - Push notifications via mobile app
   - SMS notifications via SNS

## References

- Issue: #XX - Basis-Alerting für AFU-9 (CloudWatch Alarme + UI-Hinweise) aufsetzen
- Parent Epic: adaefler-art/codefactory-control#38
- Documentation: `docs/ALERTING.md`
- Related Docs: `docs/OBSERVABILITY.md`, `docs/ECS-DEPLOYMENT.md`
