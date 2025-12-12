# AFU-9 ECS Rollback Procedures

This document provides step-by-step instructions for rolling back AFU-9 deployments to a previous stable state.

## Overview

AFU-9 uses a deterministic versioning strategy with immutable image tags:
- **Primary tag**: Git commit SHA (7 characters, e.g., `a1b2c3d`)
- **Secondary tag**: Timestamp (e.g., `20251212-143000`)
- **Convenience tag**: `staging-latest` (mutable, for development)

Each deployment creates a new **ECS Task Definition revision** that references specific image SHA tags. This ensures deployments are reproducible and rollbacks are deterministic.

## Quick Rollback (< 5 minutes)

### Prerequisites
- AWS CLI configured with appropriate credentials
- Access to ECS cluster: `afu9-cluster`
- Access to service: `afu9-control-center`

### Step 1: Identify Current State

```bash
# Set variables
export AWS_REGION=eu-central-1
export ECS_CLUSTER=afu9-cluster
export ECS_SERVICE=afu9-control-center

# Get current service information
aws ecs describe-services \
  --cluster $ECS_CLUSTER \
  --services $ECS_SERVICE \
  --region $AWS_REGION \
  --query 'services[0].{TaskDefinition:taskDefinition,RunningCount:runningCount,DesiredCount:desiredCount}' \
  --output table
```

**Expected Output:**
```
------------------------------------------------------
|               DescribeServices                     |
+----------------+------------+---------------------+
| DesiredCount   | RunningCount | TaskDefinition    |
+----------------+------------+---------------------+
| 1              | 1          | arn:aws:ecs:...:42 |
+----------------+------------+---------------------+
```

Note the current **Task Definition revision** (e.g., `:42`).

### Step 2: List Previous Task Definition Revisions

```bash
# List recent task definition revisions
aws ecs list-task-definitions \
  --family-prefix afu9-control-center \
  --sort DESC \
  --max-items 10 \
  --region $AWS_REGION \
  --query 'taskDefinitionArns[]' \
  --output table
```

**Expected Output:**
```
----------------------------------------------------------------------
|                        ListTaskDefinitions                         |
+--------------------------------------------------------------------+
|  arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:42  |
|  arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:41  |
|  arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:40  |
|  arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:39  |
+--------------------------------------------------------------------+
```

### Step 3: Inspect Previous Task Definition

Choose the revision you want to rollback to (e.g., `:41`) and inspect its images:

```bash
# Inspect specific revision
export ROLLBACK_REVISION=41

aws ecs describe-task-definition \
  --task-definition afu9-control-center:$ROLLBACK_REVISION \
  --region $AWS_REGION \
  --query 'taskDefinition.{Revision:revision,RegisteredAt:registeredAt,Containers:containerDefinitions[*].{Name:name,Image:image}}' \
  --output json
```

**Expected Output:**
```json
{
  "Revision": 41,
  "RegisteredAt": "2025-12-11T14:30:00.000Z",
  "Containers": [
    {
      "Name": "control-center",
      "Image": "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:a1b2c3d"
    },
    {
      "Name": "mcp-github",
      "Image": "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/mcp-github:a1b2c3d"
    },
    {
      "Name": "mcp-deploy",
      "Image": "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/mcp-deploy:a1b2c3d"
    },
    {
      "Name": "mcp-observability",
      "Image": "123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/mcp-observability:a1b2c3d"
    }
  ]
}
```

Verify that:
- All four containers are present
- Image SHA tags match the known stable deployment
- Registration date corresponds to the expected deployment time

### Step 4: Execute Rollback

```bash
# Update service to use previous task definition
aws ecs update-service \
  --cluster $ECS_CLUSTER \
  --service $ECS_SERVICE \
  --task-definition afu9-control-center:$ROLLBACK_REVISION \
  --region $AWS_REGION
```

**Expected Output:**
```json
{
  "service": {
    "serviceName": "afu9-control-center",
    "taskDefinition": "arn:aws:ecs:eu-central-1:123456789:task-definition/afu9-control-center:41",
    "desiredCount": 1,
    "runningCount": 1,
    "pendingCount": 0,
    "deployments": [
      {
        "status": "PRIMARY",
        "taskDefinition": "arn:aws:ecs:...:41",
        "desiredCount": 1
      }
    ]
  }
}
```

### Step 5: Monitor Rollback Progress

```bash
# Wait for service to reach stable state (typically 2-3 minutes)
echo "Waiting for service to stabilize..."
aws ecs wait services-stable \
  --cluster $ECS_CLUSTER \
  --services $ECS_SERVICE \
  --region $AWS_REGION

echo "Service is now stable!"
```

### Step 6: Verify Steady State

```bash
# Check service status
aws ecs describe-services \
  --cluster $ECS_CLUSTER \
  --services $ECS_SERVICE \
  --region $AWS_REGION \
  --query 'services[0].{Status:status,RunningCount:runningCount,DesiredCount:desiredCount,TaskDefinition:taskDefinition,Deployments:deployments[*].{Status:status,RolloutState:rolloutState,TaskDefinition:taskDefinition}}' \
  --output json
```

**Verify:**
- `status`: `ACTIVE`
- `runningCount` equals `desiredCount`
- `deployments[0].rolloutState`: `COMPLETED`
- `taskDefinition` matches the rollback revision

### Step 7: Check Application Health

```bash
# Get ALB DNS name
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names afu9-load-balancer \
  --query 'LoadBalancers[0].DNSName' \
  --output text \
  --region $AWS_REGION)

# Test health endpoint
curl -s http://$ALB_DNS/api/health | jq

# Expected response:
# {
#   "status": "ok",
#   "service": "afu9-control-center",
#   "version": "0.2.5"
# }
```

### Step 8: Check CloudWatch Logs

```bash
# Tail recent logs to ensure no errors
aws logs tail /ecs/afu9/control-center \
  --since 5m \
  --follow \
  --region $AWS_REGION
```

Look for:
- ✅ Successful startup messages
- ✅ Database connections established
- ✅ MCP servers responding
- ❌ No error or exception logs

## Rollback by Image SHA Tag (Alternative Method)

If you know the specific Git SHA of the stable version:

### Step 1: Identify Target SHA

From GitHub deployment history or GitHub Actions summary:
```bash
# Example: Rolling back to commit abc1234
export TARGET_SHA=abc1234
```

### Step 2: Find ECR Images

```bash
# Verify images exist in ECR
aws ecr describe-images \
  --repository-name afu9/control-center \
  --image-ids imageTag=$TARGET_SHA \
  --region $AWS_REGION \
  --query 'imageDetails[0].{ImageTags:imageTags,PushedAt:imagePushedAt}' \
  --output table
```

Repeat for all four repositories:
- `afu9/control-center`
- `afu9/mcp-github`
- `afu9/mcp-deploy`
- `afu9/mcp-observability`

### Step 3: Create New Task Definition

Create a new task definition file with specific SHA tags:

```bash
# Get current task definition as template
aws ecs describe-task-definition \
  --task-definition afu9-control-center \
  --region $AWS_REGION \
  --query 'taskDefinition' > task-def-rollback.json

# Update images with target SHA (using jq)
export ECR_REGISTRY=123456789.dkr.ecr.eu-central-1.amazonaws.com

jq --arg sha "$TARGET_SHA" \
   --arg registry "$ECR_REGISTRY" \
   '.containerDefinitions |= map(
     if .name == "control-center" then .image = "\($registry)/afu9/control-center:\($sha)"
     elif .name == "mcp-github" then .image = "\($registry)/afu9/mcp-github:\($sha)"
     elif .name == "mcp-deploy" then .image = "\($registry)/afu9/mcp-deploy:\($sha)"
     elif .name == "mcp-observability" then .image = "\($registry)/afu9/mcp-observability:\($sha)"
     else . end
   ) | 
   del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)' \
   task-def-rollback.json > task-def-rollback-updated.json

# Register new task definition
NEW_TASK_DEF=$(aws ecs register-task-definition \
  --cli-input-json file://task-def-rollback-updated.json \
  --region $AWS_REGION \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

echo "Created new task definition: $NEW_TASK_DEF"
```

### Step 4: Deploy New Task Definition

```bash
# Update service with new task definition
aws ecs update-service \
  --cluster $ECS_CLUSTER \
  --service $ECS_SERVICE \
  --task-definition "$NEW_TASK_DEF" \
  --region $AWS_REGION

# Wait for stability
aws ecs wait services-stable \
  --cluster $ECS_CLUSTER \
  --services $ECS_SERVICE \
  --region $AWS_REGION
```

### Step 5: Verify Rollback

Follow Steps 6-8 from the Quick Rollback procedure above.

## Rollback Validation Checklist

After completing a rollback, verify:

- [ ] Service status is `ACTIVE`
- [ ] Running count equals desired count (typically 1)
- [ ] No pending tasks or failed tasks
- [ ] Task definition matches expected revision or SHA
- [ ] Health endpoint returns `200 OK`
- [ ] CloudWatch logs show successful startup
- [ ] No error spikes in CloudWatch metrics
- [ ] Database connectivity confirmed
- [ ] All four containers are running and healthy

## Common Rollback Scenarios

### Scenario 1: Recent Deployment Fails Health Checks

**Symptoms:**
- Tasks start but immediately fail health checks
- Service repeatedly starts and stops tasks
- CloudWatch shows application errors

**Solution:**
Rollback to previous revision (N-1):
```bash
# If current revision is 42, rollback to 41
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --task-definition afu9-control-center:41 \
  --region eu-central-1
```

### Scenario 2: Performance Degradation After Deployment

**Symptoms:**
- Increased response times
- Higher CPU/memory usage
- Increased error rates

**Solution:**
1. Identify last stable deployment from monitoring dashboards
2. Rollback to that task definition revision
3. Create incident report for investigation

### Scenario 3: Database Migration Incompatibility

**Symptoms:**
- Application errors related to database schema
- Missing columns or tables

**Solution:**
1. Rollback application to last compatible version
2. **Note:** Database rollbacks are handled separately (see migration policy)
3. For this issue, focus on application-level rollback only

### Scenario 4: Accidental Deployment to Production

**Symptoms:**
- Wrong version deployed
- Unintended features activated

**Solution:**
Immediate rollback to last known production revision:
```bash
# List recent revisions with timestamps
aws ecs list-task-definitions \
  --family-prefix afu9-control-center \
  --sort DESC \
  --max-items 5

# Rollback to identified production revision
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --task-definition afu9-control-center:<production-revision> \
  --region eu-central-1
```

## Emergency Rollback (< 60 seconds)

If immediate rollback is critical and you don't have time to identify revisions:

```bash
# Rollback to previous revision (N-1)
CURRENT_REV=$(aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center \
  --region eu-central-1 \
  --query 'services[0].taskDefinition' \
  --output text | grep -oE '[0-9]+$')

PREVIOUS_REV=$((CURRENT_REV - 1))

aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --task-definition afu9-control-center:$PREVIOUS_REV \
  --region eu-central-1
```

**⚠️ Warning:** This assumes the previous revision is stable. Always verify afterwards.

## Rollback Prevention

To minimize the need for rollbacks:

1. **Test deployments in staging first**
   - Use `staging-latest` tag for pre-production testing
   - Verify health checks pass before promoting to production

2. **Enable blue-green deployments**
   - ECS automatically performs rolling updates
   - Old tasks remain running until new tasks are healthy

3. **Set up automated rollback triggers**
   - CloudWatch alarms can trigger automatic rollbacks
   - See `ALERTING.md` for alarm configuration

4. **Implement canary deployments**
   - Deploy to subset of instances first
   - Monitor metrics before full rollout

5. **Maintain rollback runbook**
   - Keep this document updated
   - Practice rollback procedures quarterly

## Monitoring During Rollback

### Key Metrics to Watch

```bash
# CPU utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=afu9-control-center Name=ClusterName,Value=afu9-cluster \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average \
  --region eu-central-1

# Memory utilization
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name MemoryUtilization \
  --dimensions Name=ServiceName,Value=afu9-control-center Name=ClusterName,Value=afu9-cluster \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average \
  --region eu-central-1
```

### CloudWatch Insights Queries

```sql
-- Error rate after rollback
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() as error_count by bin(5m)
| sort @timestamp desc

-- Response time trends
fields @timestamp, @message
| filter @message like /response_time/
| stats avg(response_time) as avg_response_time by bin(1m)
```

## Post-Rollback Actions

After a successful rollback:

1. **Document the incident**
   - What triggered the rollback?
   - Which revision was rolled back to?
   - Timeline of events

2. **Investigate root cause**
   - Review CloudWatch logs for errors
   - Compare configurations between revisions
   - Identify what changed

3. **Update deployment process**
   - Add additional validation steps
   - Improve testing coverage
   - Update deployment checklist

4. **Communicate with stakeholders**
   - Notify team of rollback completion
   - Share incident report
   - Schedule post-mortem if needed

## Support and Escalation

If rollback fails or issues persist:

1. Check CloudWatch logs: `/ecs/afu9/*`
2. Verify ECS cluster capacity
3. Check AWS service health dashboard
4. Escalate to infrastructure team
5. Consider manual intervention (scale to zero, redeploy)

## Related Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md) - Standard deployment procedures
- [ALERTING.md](ALERTING.md) - CloudWatch alarms and monitoring
- [ECS-DEPLOYMENT.md](ECS-DEPLOYMENT.md) - ECS infrastructure details
- [OBSERVABILITY-RUNBOOK.md](OBSERVABILITY-RUNBOOK.md) - Troubleshooting guide

## Rollback Script (Optional)

For automation, save this as `/tmp/rollback-ecs.sh`:

```bash
#!/bin/bash
set -e

# AFU-9 ECS Rollback Script
# Usage: ./rollback-ecs.sh <target-revision>

CLUSTER="afu9-cluster"
SERVICE="afu9-control-center"
REGION="eu-central-1"
TARGET_REVISION=$1

if [ -z "$TARGET_REVISION" ]; then
  echo "Usage: $0 <target-revision>"
  echo "Example: $0 41"
  exit 1
fi

echo "🔄 Starting rollback to revision $TARGET_REVISION..."

# Verify target revision exists
aws ecs describe-task-definition \
  --task-definition "$SERVICE:$TARGET_REVISION" \
  --region $REGION \
  --query 'taskDefinition.revision' \
  --output text > /dev/null

if [ $? -ne 0 ]; then
  echo "❌ Error: Task definition revision $TARGET_REVISION not found"
  exit 1
fi

echo "✅ Target revision verified"

# Update service
echo "⏳ Updating service..."
aws ecs update-service \
  --cluster $CLUSTER \
  --service $SERVICE \
  --task-definition "$SERVICE:$TARGET_REVISION" \
  --region $REGION \
  --query 'service.{TaskDef:taskDefinition,Status:status}' \
  --output table

# Wait for stability
echo "⏳ Waiting for service to stabilize (this may take 2-3 minutes)..."
aws ecs wait services-stable \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region $REGION

echo "✅ Rollback complete!"

# Verify status
echo ""
echo "📊 Final status:"
aws ecs describe-services \
  --cluster $CLUSTER \
  --services $SERVICE \
  --region $REGION \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,TaskDef:taskDefinition}' \
  --output table

echo ""
echo "✅ Rollback to revision $TARGET_REVISION completed successfully"
```

Make it executable:
```bash
chmod +x /tmp/rollback-ecs.sh
```

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-12  
**Maintained By:** AFU-9 Infrastructure Team
