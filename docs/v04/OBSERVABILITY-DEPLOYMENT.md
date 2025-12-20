# AFU-9 Observability Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying and configuring the observability infrastructure for AFU-9 v0.2.

## Prerequisites

- AWS account with appropriate permissions
- AWS CLI configured with credentials
- CDK bootstrapped in target region
- AFU-9 infrastructure deployed (Network, Database, ECS stacks)

## Deployment Steps

### 1. Deploy CloudWatch Alarms Stack

The `Afu9AlarmsStack` creates comprehensive monitoring for your infrastructure.

**Basic deployment (no email notifications)**:
```bash
npx cdk deploy Afu9AlarmsStack
```

**With email notifications**:
```bash
npx cdk deploy Afu9AlarmsStack -c afu9-alarm-email=ops@yourdomain.com
```

**Expected Output**:
```
✅  Afu9AlarmsStack

Outputs:
Afu9AlarmsStack.AlarmTopicArn = arn:aws:sns:eu-central-1:123456789:afu9-alarms
Afu9AlarmsStack.AlarmTopicName = afu9-alarms

Stack ARN:
arn:aws:cloudformation:eu-central-1:123456789:stack/Afu9AlarmsStack/...
```

**Confirm SNS Subscription** (if email provided):
1. Check your email for "AWS Notification - Subscription Confirmation"
2. Click the confirmation link
3. Verify subscription in AWS Console: SNS → Topics → afu9-alarms → Subscriptions

### 2. Verify Alarm Configuration

Check that all alarms are created:

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix afu9 \
  --query 'MetricAlarms[*].[AlarmName,StateValue,MetricName]' \
  --output table
```

**Expected Alarms**:
- `afu9-ecs-high-cpu`
- `afu9-ecs-high-memory`
- `afu9-ecs-no-running-tasks`
- `afu9-rds-high-cpu`
- `afu9-rds-low-storage`
- `afu9-rds-high-connections`
- `afu9-alb-high-5xx-rate`
- `afu9-alb-unhealthy-targets`
- `afu9-alb-high-response-time`

### 3. Configure Secrets (Required)

Update the placeholder secrets created during ECS stack deployment:

**GitHub Credentials**:
```bash
aws secretsmanager update-secret \
  --secret-id afu9-github \
  --secret-string '{
    "token": "ghp_YOUR_GITHUB_TOKEN",
    "owner": "your-github-org",
    "repo": "your-repository"
  }' \
  --region eu-central-1
```

**Generate GitHub Token**:
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Select scopes:
   - `repo` - Full control of private repositories
   - `workflow` - Update GitHub Action workflows
   - `write:org` - Read and write org data (if needed)
4. Generate token and copy immediately (it won't be shown again)

**LLM API Keys**:
```bash
aws secretsmanager update-secret \
  --secret-id afu9-llm \
  --secret-string '{
    "openai_api_key": "sk-YOUR_OPENAI_KEY",
    "anthropic_api_key": "sk-ant-api03-YOUR_ANTHROPIC_KEY"
  }' \
  --region eu-central-1
```

**Verify Secrets**:
```bash
# List secrets
aws secretsmanager list-secrets \
  --query 'SecretList[?starts_with(Name, `afu9/`)].Name' \
  --output table

# Verify secret structure (without showing values)
aws secretsmanager describe-secret --secret-id afu9-github
```

### 4. Restart ECS Service

After updating secrets, restart the ECS service to pick up new values:

```bash
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --force-new-deployment \
  --region eu-central-1
```

Wait for deployment to complete:
```bash
aws ecs wait services-stable \
  --cluster afu9-cluster \
  --services afu9-control-center \
  --region eu-central-1
```

### 5. Verify Observability Endpoints

Test that the observability API endpoints are working:

**Health Check**:
```bash
curl https://afu9.yourdomain.com/api/health
```

**Alarms API** (requires authentication if configured):
```bash
curl https://afu9.yourdomain.com/api/observability/alarms
```

**Logs API**:
```bash
curl https://afu9.yourdomain.com/api/observability/logs
```

**Infrastructure Health**:
```bash
curl https://afu9.yourdomain.com/api/infrastructure/health
```

### 6. Access Observability Dashboard

Navigate to the Control Center observability page:

```
https://afu9.yourdomain.com/observability
```

**Expected Features**:
- ✅ Alarm summary cards (Total, OK, In Alarm, Insufficient Data)
- ✅ Infrastructure health (CPU, Memory utilization)
- ✅ CloudWatch alarms list with status
- ✅ Recent error logs viewer
- ✅ Auto-refresh every 30 seconds

### 7. Test Alarm Notifications

**Trigger Test Alarm** (ECS High CPU):

Option 1 - Using AWS CLI:
```bash
aws cloudwatch set-alarm-state \
  --alarm-name afu9-ecs-high-cpu \
  --state-value ALARM \
  --state-reason "Testing alarm notification" \
  --region eu-central-1
```

Option 2 - Generate actual high CPU:
```bash
# SSH into ECS task (requires ECS Exec enabled)
aws ecs execute-command \
  --cluster afu9-cluster \
  --task <task-id> \
  --container control-center \
  --interactive \
  --command "/bin/sh"

# Inside container, generate CPU load
yes > /dev/null &
yes > /dev/null &
```

**Verify Notification**:
1. Check email for alarm notification (if SNS email configured)
2. Check CloudWatch Alarms console
3. Check observability page in Control Center

**Reset Test Alarm**:
```bash
aws cloudwatch set-alarm-state \
  --alarm-name afu9-ecs-high-cpu \
  --state-value OK \
  --state-reason "Test complete" \
  --region eu-central-1
```

## Post-Deployment Configuration

### Configure Log Retention

By default, logs are retained for 7 days. Adjust if needed:

```bash
# Update retention for Control Center logs
aws logs put-retention-policy \
  --log-group-name /ecs/afu9/control-center \
  --retention-in-days 14 \
  --region eu-central-1

# Available retention periods: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653
```

### Create CloudWatch Dashboard

Create a custom dashboard for at-a-glance monitoring:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name afu9-overview \
  --dashboard-body file://cloudwatch-dashboard.json \
  --region eu-central-1
```

**cloudwatch-dashboard.json**:
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ECS", "CPUUtilization", { "stat": "Average", "period": 300 } ],
          [ ".", "MemoryUtilization", { "stat": "Average", "period": 300 } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "eu-central-1",
        "title": "ECS Service Utilization",
        "period": 300
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/RDS", "CPUUtilization", { "stat": "Average", "period": 300 } ],
          [ ".", "DatabaseConnections", { "stat": "Average", "period": 300 } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "eu-central-1",
        "title": "RDS Metrics",
        "period": 300
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", { "stat": "Sum", "period": 300 } ],
          [ ".", "TargetResponseTime", { "stat": "Average", "period": 300 } ]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "eu-central-1",
        "title": "ALB Health",
        "period": 300
      }
    }
  ]
}
```

Access dashboard at: CloudWatch Console → Dashboards → afu9-overview

### Set Up Additional SNS Subscribers

Add Slack webhook or other notification channels:

```bash
# Get SNS topic ARN
TOPIC_ARN=$(aws sns list-topics --query "Topics[?contains(TopicArn, 'afu9-alarms')].TopicArn" --output text)

# Add HTTPS endpoint (e.g., Slack webhook)
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol https \
  --notification-endpoint https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### Configure CloudTrail for Audit Logging

Enable CloudTrail to audit AWS API calls:

```bash
# Create S3 bucket for CloudTrail logs
aws s3 mb s3://afu9-audit-logs --region eu-central-1

# Create trail
aws cloudtrail create-trail \
  --name afu9-audit-trail \
  --s3-bucket-name afu9-audit-logs \
  --is-multi-region-trail \
  --enable-log-file-validation

# Start logging
aws cloudtrail start-logging --name afu9-audit-trail
```

## Verification Checklist

- [ ] CloudWatch alarms stack deployed successfully
- [ ] All 9 alarms created and visible in CloudWatch Console
- [ ] SNS topic created and email subscription confirmed
- [ ] GitHub secret updated with valid token
- [ ] LLM secrets updated with API keys
- [ ] ECS service restarted after secret updates
- [ ] Observability page loads successfully
- [ ] Alarms visible in Control Center UI
- [ ] Logs viewer shows recent logs
- [ ] Infrastructure health metrics display correctly
- [ ] Test alarm notification sent and received
- [ ] CloudWatch dashboard created (optional)
- [ ] CloudTrail enabled for audit logging (optional)

## Troubleshooting

### Alarms Show "INSUFFICIENT_DATA"

**Cause**: Metrics haven't been published yet or metric dimensions are incorrect.

**Solution**:
1. Wait 5-10 minutes for initial metrics to be published
2. Verify service is running: `aws ecs describe-services --cluster afu9-cluster --services afu9-control-center`
3. Check metric dimensions match actual resource names

### Observability Page Shows "Unavailable"

**Cause**: MCP observability server can't access CloudWatch.

**Solution**:
1. Check task role has CloudWatch permissions
2. Check container logs: `aws logs tail /ecs/afu9/mcp-observability --follow`
3. Verify containers started successfully: `aws ecs describe-tasks --cluster afu9-cluster --tasks <task-id>`

### No Email Notifications

**Cause**: SNS subscription not confirmed.

**Solution**:
1. Check spam folder for confirmation email
2. List subscriptions: `aws sns list-subscriptions-by-topic --topic-arn <topic-arn>`
3. Re-subscribe if needed: `aws sns subscribe --topic-arn <topic-arn> --protocol email --notification-endpoint ops@yourdomain.com`

### Logs Don't Appear

**Cause**: Application not using structured logger or CloudWatch permissions missing.

**Solution**:
1. Check application logs: `aws logs tail /ecs/afu9/control-center --follow`
2. Verify task role has `logs:PutLogEvents` permission
3. Check log group exists: `aws logs describe-log-groups --log-group-name-prefix /ecs/afu9`

## Maintenance

### Weekly Tasks

- Review alarm status on observability page
- Check for any ALARM states requiring investigation
- Review error logs for patterns
- Verify backup completion

### Monthly Tasks

- Rotate secrets (GitHub token, LLM API keys) if needed
- Review CloudWatch Logs costs and adjust retention
- Update alarm thresholds based on actual usage patterns
- Test disaster recovery procedures

## Support

For issues or questions:
1. Check the [Observability Runbook](OBSERVABILITY-RUNBOOK.md)
2. Review [Security & IAM Guide](SECURITY-IAM.md)
3. Contact platform team at ops@yourdomain.com

## References

- [CloudWatch Alarms User Guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [ECS Task IAM Roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
