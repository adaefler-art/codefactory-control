# AFU-9 Observability Runbook

## Overview

This runbook provides operational procedures for monitoring, troubleshooting, and responding to incidents in AFU-9 v0.2.

## Table of Contents

- [Quick Start](#quick-start)
- [Monitoring Dashboard](#monitoring-dashboard)
- [CloudWatch Alarms](#cloudwatch-alarms)
- [Common Scenarios](#common-scenarios)
- [Troubleshooting Guide](#troubleshooting-guide)
- [Alert Response Procedures](#alert-response-procedures)
- [Log Analysis](#log-analysis)

## Quick Start

### Access Points

- **Control Center UI**: `https://afu9.yourdomain.com/observability`
- **AWS CloudWatch Console**: `https://console.aws.amazon.com/cloudwatch`
- **ECS Console**: `https://console.aws.amazon.com/ecs`

### Key Metrics to Monitor

1. **ECS Service Health**
   - CPU Utilization: Should be < 80%
   - Memory Utilization: Should be < 80%
   - Running Task Count: Should be ≥ 1

2. **Database Health**
   - CPU Utilization: Should be < 80%
   - Free Storage Space: Should be > 2 GB
   - Database Connections: Should be < 80

3. **Application Load Balancer**
   - 5xx Error Rate: Should be < 1%
   - Healthy Target Count: Should be ≥ 1
   - Response Time: Should be < 5 seconds

## Monitoring Dashboard

### Control Center Observability Page

Navigate to `/observability` in the Control Center to view:

1. **Alarm Summary Cards**
   - Total alarms
   - Alarms in OK state
   - Alarms in ALARM state
   - Alarms with insufficient data

2. **Infrastructure Health**
   - Current CPU and Memory utilization
   - Service cluster and name
   - Latest metric values

3. **CloudWatch Alarms Panel**
   - Real-time alarm status
   - Alarm descriptions and thresholds
   - State reasons for triggered alarms

4. **Recent Error Logs Panel**
   - Last 1-24 hours of error logs
   - Filterable by log group (Control Center, MCP servers)
   - Real-time log streaming

### CloudWatch Dashboard

Create a custom dashboard in AWS CloudWatch:

```bash
# Create dashboard via AWS CLI
aws cloudwatch put-dashboard \
  --dashboard-name afu9-overview \
  --dashboard-body file://dashboard-config.json
```

**dashboard-config.json**:
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ECS", "CPUUtilization", { "stat": "Average" } ],
          [ ".", "MemoryUtilization", { "stat": "Average" } ]
        ],
        "period": 300,
        "stat": "Average",
        "region": "eu-central-1",
        "title": "ECS Service Metrics"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/RDS", "CPUUtilization", { "stat": "Average" } ],
          [ ".", "DatabaseConnections", { "stat": "Average" } ]
        ],
        "period": 300,
        "stat": "Average",
        "region": "eu-central-1",
        "title": "RDS Metrics"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          [ "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", { "stat": "Sum" } ],
          [ ".", "TargetResponseTime", { "stat": "Average" } ]
        ],
        "period": 300,
        "stat": "Average",
        "region": "eu-central-1",
        "title": "ALB Metrics"
      }
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/ecs/afu9/control-center' | fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20",
        "region": "eu-central-1",
        "title": "Recent Errors"
      }
    }
  ]
}
```

## CloudWatch Alarms

### Alarm States

- **OK**: Metric is within threshold
- **ALARM**: Metric has breached threshold
- **INSUFFICIENT_DATA**: Not enough data to evaluate

### Configured Alarms

#### ECS Service Alarms

1. **afu9-ecs-high-cpu**
   - **Threshold**: CPU > 80% for 5 minutes
   - **Severity**: P2 (High)
   - **Action**: Check for runaway processes, consider scaling

2. **afu9-ecs-high-memory**
   - **Threshold**: Memory > 80% for 5 minutes
   - **Severity**: P2 (High)
   - **Action**: Check for memory leaks, consider scaling

3. **afu9-ecs-no-running-tasks**
   - **Threshold**: Running tasks < 1 for 2 minutes
   - **Severity**: P1 (Critical)
   - **Action**: Service is down, immediate investigation required

#### RDS Alarms

4. **afu9-rds-high-cpu**
   - **Threshold**: CPU > 80% for 10 minutes
   - **Severity**: P2 (High)
   - **Action**: Check for slow queries, consider optimization

5. **afu9-rds-low-storage**
   - **Threshold**: Free storage < 2 GB
   - **Severity**: P2 (High)
   - **Action**: Increase storage or clean up old data

6. **afu9-rds-high-connections**
   - **Threshold**: Connections > 80
   - **Severity**: P2 (High)
   - **Action**: Check for connection leaks, increase connection pool

#### ALB Alarms

7. **afu9-alb-high-5xx-rate**
   - **Threshold**: 5xx errors > 10 in 5 minutes
   - **Severity**: P2 (High)
   - **Action**: Check application logs for errors

8. **afu9-alb-unhealthy-targets**
   - **Threshold**: Unhealthy targets ≥ 1
   - **Severity**: P1 (Critical)
   - **Action**: Check health check endpoint, container logs

9. **afu9-alb-high-response-time**
   - **Threshold**: Response time > 5 seconds for 10 minutes
   - **Severity**: P3 (Medium)
   - **Action**: Check for performance bottlenecks

## Common Scenarios

### Scenario 1: High CPU Utilization

**Symptoms**:
- `afu9-ecs-high-cpu` alarm triggered
- Slow response times
- Increased latency

**Investigation**:
```bash
# Check ECS service metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=afu9-control-center Name=ClusterName,Value=afu9-cluster \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average Maximum

# Check running tasks
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center

# Check container logs for CPU-intensive operations
aws logs tail /ecs/afu9/control-center --follow
```

**Resolution**:
1. Scale up ECS service if consistently high
2. Optimize code if specific operations are CPU-intensive
3. Consider upgrading task CPU allocation

### Scenario 2: Service Unavailable

**Symptoms**:
- `afu9-ecs-no-running-tasks` alarm triggered
- `afu9-alb-unhealthy-targets` alarm triggered
- 503 Service Unavailable errors

**Investigation**:
```bash
# Check service status
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center

# Check task status
aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-control-center

# Check stopped tasks (failures)
aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-control-center \
  --desired-status STOPPED

# Get stopped task details
aws ecs describe-tasks \
  --cluster afu9-cluster \
  --tasks <task-id>

# Check logs for startup errors
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern 'ERROR'
```

**Resolution**:
1. Check container health check endpoint: `curl http://localhost:3000/api/health`
2. Verify environment variables and secrets are configured correctly
3. Check for database connectivity issues
4. Force new deployment if issues persist:
   ```bash
   aws ecs update-service \
     --cluster afu9-cluster \
     --service afu9-control-center \
     --force-new-deployment
   ```

### Scenario 3: Database Connection Errors

**Symptoms**:
- Application logs show "connection refused" or "timeout" errors
- `afu9-rds-high-connections` alarm may be triggered
- Workflow executions fail

**Investigation**:
```bash
# Check RDS instance status
aws rds describe-db-instances \
  --db-instance-identifier afu9-db

# Check database connections
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name DatabaseConnections \
  --dimensions Name=DBInstanceIdentifier,Value=afu9-db \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average Maximum

# Check security group rules
aws ec2 describe-security-groups \
  --filters Name=tag:Name,Values=afu9-rds-sg
```

**Resolution**:
1. Verify RDS instance is running
2. Check security group allows traffic from ECS security group on port 5432
3. Check connection pool settings in application
4. Verify database credentials in Secrets Manager
5. Check for connection leaks in application code

### Scenario 4: MCP Server Unavailable

**Symptoms**:
- "MCP server may be unreachable" errors in UI
- Workflow steps timeout or fail
- MCP tool calls fail

**Investigation**:
```bash
# Check if MCP server containers are running
aws ecs describe-tasks \
  --cluster afu9-cluster \
  --tasks $(aws ecs list-tasks --cluster afu9-cluster --service-name afu9-control-center --query 'taskArns[0]' --output text)

# Check MCP server logs
aws logs tail /ecs/afu9/mcp-github --follow
aws logs tail /ecs/afu9/mcp-deploy --follow
aws logs tail /ecs/afu9/mcp-observability --follow

# Test MCP server health endpoint (from within task)
aws ecs execute-command \
  --cluster afu9-cluster \
  --task <task-id> \
  --container control-center \
  --interactive \
  --command "curl http://localhost:3001/health"
```

**Resolution**:
1. Verify MCP server containers started successfully
2. Check MCP server logs for errors
3. Verify network connectivity within ECS task (localhost)
4. Check MCP server environment variables
5. Restart task if needed

## Troubleshooting Guide

### Log Analysis Commands

**Search for errors in last hour**:
```bash
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern 'ERROR'
```

**Search by execution ID**:
```bash
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --filter-pattern '"executionId":"<execution-id>"'
```

**Get logs from specific time range**:
```bash
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --start-time $(date -u -d '2 hours ago' +%s)000 \
  --end-time $(date -u -d '1 hour ago' +%s)000
```

**Tail logs in real-time**:
```bash
aws logs tail /ecs/afu9/control-center --follow
```

### CloudWatch Insights Queries

**Error rate over time**:
```
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() by bin(5m)
```

**Slow requests (> 5 seconds)**:
```
fields @timestamp, durationMs, message
| filter durationMs > 5000
| sort durationMs desc
```

**Most common errors**:
```
fields @timestamp, error.message
| filter level = "error"
| stats count() by error.message
| sort count desc
```

**Workflow execution failures**:
```
fields @timestamp, workflowId, executionId, error
| filter status = "failed"
| sort @timestamp desc
```

### Database Diagnostics

**Connect to database** (from bastion or ECS Exec):
```bash
psql -h afu9-db.xxxx.eu-central-1.rds.amazonaws.com -U afu9_admin -d afu9
```

**Check active connections**:
```sql
SELECT count(*) FROM pg_stat_activity;
```

**Check long-running queries**:
```sql
SELECT pid, now() - query_start AS duration, query 
FROM pg_stat_activity 
WHERE state = 'active' 
ORDER BY duration DESC;
```

**Check table sizes**:
```sql
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Alert Response Procedures

### P1 (Critical) Alerts

**Response Time**: Immediate (< 5 minutes)

**Procedure**:
1. Acknowledge alert
2. Check service status in AWS Console
3. Review recent logs for errors
4. If service is down, force new deployment
5. Notify team via Slack/PagerDuty
6. Create incident ticket
7. Continue investigation until resolved

### P2 (High) Alerts

**Response Time**: < 30 minutes

**Procedure**:
1. Acknowledge alert
2. Review metrics and logs
3. If resources are constrained, scale up
4. If issue persists > 1 hour, escalate to P1
5. Create ticket for follow-up investigation

### P3 (Medium) Alerts

**Response Time**: < 4 hours

**Procedure**:
1. Acknowledge alert
2. Create ticket for investigation
3. Review during next business day
4. Implement fix in next deployment

## Escalation

### Escalation Path

1. **L1**: On-call engineer
2. **L2**: Platform team lead
3. **L3**: CTO / Architecture team

### When to Escalate

- P1 alert not resolved within 30 minutes
- Data loss or corruption suspected
- Security incident suspected
- Multiple systems affected
- Root cause unclear

## Regular Maintenance

### Daily Checks

- [ ] Review alarm status on Observability page
- [ ] Check for any ALARM states
- [ ] Review error logs from last 24 hours
- [ ] Verify backup completion

### Weekly Checks

- [ ] Review CloudWatch metrics trends
- [ ] Check disk space trends
- [ ] Review slow query logs
- [ ] Test disaster recovery procedures

### Monthly Checks

- [ ] Review and rotate secrets if needed
- [ ] Update dependencies for security patches
- [ ] Review and optimize database indexes
- [ ] Review CloudWatch Logs retention and costs
- [ ] Test full system restore from backup

## References

- [CloudWatch Logs Insights Query Syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [ECS Troubleshooting Guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/troubleshooting.html)
- [RDS Performance Insights](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html)

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-12 | Initial runbook creation | AFU-9 Team |
