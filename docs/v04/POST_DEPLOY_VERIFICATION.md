# Post-Deployment Verification

## Overview

The post-deployment verification script (`scripts/post-deploy-verification.sh`) provides automated, deterministic checks after ECS deployments to ensure the system is healthy and ready to serve traffic.

**Issue:** I-ECS-DB-05  
**Epic:** E-ECS-DB (Database Integration)

## What It Checks

The verification script performs 5 critical checks:

### 1. ECS Service Events
- **Purpose**: Detect Circuit Breaker issues and deployment errors
- **Check**: Analyzes the last 10 ECS service events for error keywords
- **Error Detection**: 
  - Circuit Breaker activations
  - Failed deployments
  - Unhealthy task stops
- **Error Messages**: 
  - "Circuit Breaker issues detected in service events"
  - "Error keywords found in recent service events"

### 2. ALB Target Health
- **Purpose**: Ensure all targets are healthy and receiving traffic
- **Check**: Queries all target groups associated with the ALB
- **Metrics**:
  - Count of healthy targets
  - Count of unhealthy targets
  - Target state (healthy, unhealthy, draining, etc.)
- **Error Messages**:
  - "Found X unhealthy target(s)"
  - "No targets registered in target group"
  - Detailed unhealthy target information (ID, port, reason, description)

### 3. Service Stability
- **Purpose**: Confirm ECS service reached desired state
- **Check**: Verifies running task count matches desired count
- **Metrics**:
  - Service status (ACTIVE, DRAINING, etc.)
  - Running tasks vs. desired tasks
  - Pending tasks
- **Error Messages**:
  - "Service status is X (expected ACTIVE)"
  - "Running tasks (X) do not match desired count (Y)"
  - "Service has X pending tasks" (warning)

### 4. Health Endpoint (/api/health)
- **Purpose**: Validate service liveness
- **Check**: Tests `/api/health` endpoint per Control Plane Spec v1
- **Expected Response**: 200 OK with JSON containing:
  ```json
  {
    "status": "ok",
    "service": "afu9-control-center",
    "version": "0.2.5",
    "timestamp": "2025-12-17T..."
  }
  ```
- **Error Messages**:
  - "Health endpoint returned HTTP X (expected 200)"
  - "Health endpoint returned 200 but with invalid format"

### 5. Readiness Endpoint (/api/ready)
- **Purpose**: Validate service readiness and dependency health
- **Check**: Tests `/api/ready` endpoint per Control Plane Spec v1
- **Expected Response**: 200 OK with JSON containing:
  ```json
  {
    "ready": true,
    "service": "afu9-control-center",
    "version": "0.2.5",
    "checks": {
      "service": { "status": "ok" },
      "database": { "status": "ok" },
      "mcp-github": { "status": "ok" }
    }
  }
  ```
- **Error Messages**:
  - "Readiness endpoint returned 503 - service not ready"
  - "Readiness endpoint returned HTTP X (expected 200 or 503)"
  - Displays failed dependency checks with detailed error messages

## Usage

### Automated (GitHub Actions)

The verification script is automatically executed after every deployment:

- **Workflow**: `.github/workflows/deploy-ecs.yml`
- **Staging**: After automatic deployment on push to main
- **Production**: After manual workflow_dispatch deployment

The workflow will **fail** if any verification check fails, preventing bad deployments from being marked as successful.

### Manual Execution

```bash
# Basic usage
./scripts/post-deploy-verification.sh <environment> <cluster-name> <service-name> <alb-dns>

# Staging example
./scripts/post-deploy-verification.sh \
  stage \
  afu9-cluster \
  afu9-control-center-stage \
  afu9-alb-1234567890.eu-central-1.elb.amazonaws.com

# Production example
./scripts/post-deploy-verification.sh \
  prod \
  afu9-cluster \
  afu9-control-center-prod \
  afu9-alb-1234567890.eu-central-1.elb.amazonaws.com

# Using environment variables
ENVIRONMENT=stage \
ECS_CLUSTER=afu9-cluster \
ECS_SERVICE=afu9-control-center-stage \
ALB_DNS=afu9-alb-1234567890.eu-central-1.elb.amazonaws.com \
AWS_REGION=eu-central-1 \
./scripts/post-deploy-verification.sh
```

### Prerequisites

- AWS CLI configured with appropriate credentials
- `jq` installed (for JSON parsing)
- `curl` installed (for HTTP requests)
- Permissions to:
  - `ecs:DescribeServices`
  - `elasticloadbalancing:DescribeTargetGroups`
  - `elasticloadbalancing:DescribeTargetHealth`

## Exit Codes

- **0**: All checks passed (may include warnings)
- **1**: One or more checks failed

## Output Format

The script provides color-coded output:

- 🟢 **Green**: Passed checks
- 🟡 **Yellow**: Warnings (non-critical issues)
- 🔴 **Red**: Failed checks (critical issues)

Example output:

```
========================================
AFU-9 Post-Deployment Verification
========================================
Environment:   stage
ECS Cluster:   afu9-cluster
ECS Service:   afu9-control-center-stage
ALB DNS:       afu9-alb-123.eu-central-1.elb.amazonaws.com

========================================
Check 1: ECS Service Events
========================================
Fetching ECS service events...
✅ PASS: No Circuit Breaker issues in service events
✅ PASS: No error keywords in recent service events

========================================
Check 2: ALB Target Health
========================================
Fetching target groups for ALB...
Found target groups: arn:aws:...
✅ PASS: All 2 target(s) are healthy

========================================
Check 3: Service Stability
========================================
Service Status: ACTIVE
Running Tasks: 2 / 2 (desired)
✅ PASS: Service is stable with 2/2 tasks running

========================================
Check 4: Health Endpoint (/api/health)
========================================
Testing health endpoint: http://...
✅ PASS: Health endpoint returned 200 OK with valid response

========================================
Check 5: Readiness Endpoint (/api/ready)
========================================
Testing readiness endpoint: http://...
✅ PASS: Readiness endpoint returned 200 OK - service is ready

========================================
Verification Summary
========================================
Passed:   10
Warnings: 0
Failed:   0
Total:    10

✅ POST-DEPLOYMENT VERIFICATION PASSED
```

## Deterministic Behavior

All checks are designed to be deterministic:

1. **No retries**: Each check runs once with clear timeout values
2. **No flakiness**: Checks use stable AWS APIs and HTTP endpoints
3. **Clear thresholds**: Pass/fail criteria are well-defined (e.g., HTTP 200 vs 503)
4. **Explicit error messages**: Every failure includes specific details about what went wrong

## Troubleshooting

If verification fails, follow these steps:

### Circuit Breaker Issues
```bash
# Check recent deployment events
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-stage \
  --query 'services[0].events[0:20]'

# Check task definition health check configuration
aws ecs describe-task-definition \
  --task-definition <task-def-arn> \
  --query 'taskDefinition.containerDefinitions[].healthCheck'
```

### Unhealthy Targets
```bash
# Get detailed target health
aws elbv2 describe-target-health \
  --target-group-arn <tg-arn>

# Check ALB health check configuration
aws elbv2 describe-target-groups \
  --target-group-arns <tg-arn> \
  --query 'TargetGroups[0].HealthCheckPath'
```

### Service Not Stable
```bash
# Check task status
aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-control-center-stage

# Check task logs
aws logs tail /ecs/afu9-control-center --follow
```

### Health/Readiness Failures
```bash
# Test endpoints manually
curl -v http://<alb-dns>/api/health
curl -v http://<alb-dns>/api/ready

# Check task logs for startup errors
aws logs tail /ecs/afu9-control-center --since 10m
```

## Integration with CI/CD

The verification script is integrated into the canonical ECS deployment workflow:

### ECS Deployment Workflow (`deploy-ecs.yml`)
1. Build and push Docker images
2. Update ECS task definition
3. Update ECS service
4. **Wait for service stability** (AWS ECS waiter)
5. **Run post-deployment verification** ← Automatic verification
6. Generate deployment summary

This workflow handles both staging and production deployments with environment-specific configuration.

### Workflow Enhancement

The deployment summary now includes verification status:

```markdown
## Stage Deployment Summary

✅ **Deployment completed successfully**
✅ **Post-deployment verification passed**

### Verification Checks:
- ✅ ECS service events - No Circuit Breaker issues
- ✅ ALB target health - All targets healthy
- ✅ Service stability - Desired task count reached
- ✅ Health endpoint - /api/health returns 200 OK
- ✅ Readiness endpoint - /api/ready returns 200 OK
```

## Related Documentation

- [Control Plane Specification](./CONTROL_PLANE_SPEC.md) - Health/readiness endpoint specs
- [ECS Deployment Guide](./ECS-DEPLOYMENT.md) - ECS deployment procedures
- [AWS Deploy Runbook](./AWS_DEPLOY_RUNBOOK.md) - Complete deployment guide
- [Observability](./OBSERVABILITY.md) - Monitoring and alerting

## Future Enhancements

Potential improvements for future versions:

1. **Detailed metrics collection**: Export verification results as CloudWatch metrics
2. **Slack/Teams notifications**: Send verification results to chat channels
3. **Historical tracking**: Store verification results in DynamoDB for trend analysis
4. **MCP server checks**: Verify individual MCP servers (GitHub, Deploy, Observability)
5. **Database connectivity**: Test actual database queries during verification
6. **Performance benchmarks**: Run basic performance tests (response time, throughput)

## Version History

- **v1.0.0** (2025-12-17): Initial implementation
  - ECS service events check
  - ALB target health check
  - Service stability check
  - Health endpoint check
  - Readiness endpoint check
