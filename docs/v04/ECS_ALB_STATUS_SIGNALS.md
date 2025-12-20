# ECS + ALB Status Signals — Decision Criteria

**Issue ID:** I-04-02-STATUS-SIGNALS  
**Epic:** EPIC-04-OBSERVABILITY  
**Status:** ✅ DOCUMENTED  
**Date:** 2025-12-20

## Executive Summary

This document defines the canonical **Go/No-Go decision criteria** for AFU-9 deployments based on **ECS Events**, **ALB Target Health**, and **Health Probes**. These status signals provide the foundation for automated and manual deployment decisions.

## Purpose

**Why These Signals Matter:**
- **ECS Events** reveal deployment and service-level failures (Circuit Breaker, task placement, resource issues)
- **ALB Target Health** shows whether tasks are reachable and passing health checks
- **Health Probes** validate application-level liveness and readiness

**Use Cases:**
- ✅ Post-deployment verification (automated CI/CD gates)
- ✅ Manual deployment validation (operator decision support)
- ✅ Troubleshooting deployment failures
- ✅ Production readiness assessment
- ✅ Rollback decisions

## Status Signal Categories

### 1. ECS Service Events

**Purpose:** Detect deployment failures, Circuit Breaker activations, and service-level issues.

#### Go Criteria (✅ PASS)

| Signal | Criterion | Meaning |
|--------|-----------|---------|
| Service Events | No Circuit Breaker keywords in last 10 events | Deployment successful, no health check failures |
| Service Events | `"has reached a steady state"` | Service stabilized at desired task count |
| Service Events | No `"failed to launch"` or `"unable to place"` | No resource or placement constraints |

#### No-Go Criteria (❌ FAIL)

| Signal | Criterion | Meaning | Action Required |
|--------|-----------|---------|-----------------|
| Service Events | `"failed circuit breaker"` | Health checks failed repeatedly | Check logs, health endpoints |
| Service Events | `"unable to place a task"` | Insufficient resources or subnet issues | Check ECS capacity, VPC configuration |
| Service Events | `"failed to launch a task"` | Task definition or IAM issue | Check task definition, IAM roles |
| Service Events | `"ResourceInitializationError"` | Secret or IAM access issue | Check Secrets Manager, IAM permissions |

#### Copy-Paste Commands

```bash
# Set your environment
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage  # or afu9-control-center-prod

# Check last 10 service events
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[:10]' \
  --output table

# Check for Circuit Breaker issues (MUST return no results for GO)
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[?contains(message, `circuit breaker`) || contains(message, `failed to launch`) || contains(message, `unable to place`)]' \
  --output table

# Check service status (MUST be ACTIVE for GO)
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table
```

---

### 2. ALB Target Health

**Purpose:** Validate that tasks are registered with the load balancer and passing health checks.

#### Go Criteria (✅ PASS)

| Signal | Criterion | Meaning |
|--------|-----------|---------|
| Target Health | All targets state = `healthy` | All tasks passing ALB health checks |
| Target Health | Target count ≥ 1 | At least one healthy target available |
| Target Health | No `unhealthy` or `draining` targets | No failing or terminating tasks |

#### No-Go Criteria (❌ FAIL)

| Signal | Criterion | Meaning | Action Required |
|--------|-----------|---------|-----------------|
| Target Health | Any target state = `unhealthy` | Health check failing | Check logs, `/api/health` endpoint |
| Target Health | Reason = `Target.FailedHealthChecks` | `/api/health` not returning 200 | Check application logs, health endpoint |
| Target Health | Reason = `Target.Timeout` | Health endpoint timeout | Check response time, increase timeout |
| Target Health | Reason = `Target.ResponseCodeMismatch` | Health endpoint returning non-200 | Check application errors |
| Target Health | No targets registered | Tasks not registering with ALB | Check ECS service configuration |

#### Copy-Paste Commands

```bash
# Get ALB ARN (adjust filter as needed)
export ALB_ARN=$(aws elbv2 describe-load-balancers \
  --region ${AWS_REGION} \
  --query 'LoadBalancers[?contains(LoadBalancerName, `afu9`)].LoadBalancerArn' \
  --output text | head -1)

# Get all target groups for the ALB
export TG_ARNS=$(aws elbv2 describe-target-groups \
  --load-balancer-arn ${ALB_ARN} \
  --region ${AWS_REGION} \
  --query 'TargetGroups[*].TargetGroupArn' \
  --output text)

# Check target health for all target groups (MUST show all healthy for GO)
for TG_ARN in ${TG_ARNS}; do
  echo "Checking Target Group: ${TG_ARN}"
  aws elbv2 describe-target-health \
    --target-group-arn ${TG_ARN} \
    --region ${AWS_REGION} \
    --query 'TargetHealthDescriptions[*].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}' \
    --output table
  echo ""
done

# Quick health check (exit code 0 if all healthy, 1 if any unhealthy)
for TG_ARN in ${TG_ARNS}; do
  UNHEALTHY_COUNT=$(aws elbv2 describe-target-health \
    --target-group-arn ${TG_ARN} \
    --region ${AWS_REGION} \
    --query 'length(TargetHealthDescriptions[?TargetHealth.State!=`healthy`])' \
    --output text)
  if [ "${UNHEALTHY_COUNT}" != "0" ]; then
    echo "❌ FAIL: Found ${UNHEALTHY_COUNT} unhealthy target(s)"
    exit 1
  fi
done
echo "✅ PASS: All targets healthy"
```

---

### 3. Health Probes

**Purpose:** Validate application-level liveness and readiness.

#### 3.1 Liveness Probe (`/api/health`)

**Contract:** MUST always return 200 OK when process is running (no dependency checks).

##### Go Criteria (✅ PASS)

| Signal | Criterion | Meaning |
|--------|-----------|---------|
| HTTP Response | Status code = `200` | Application process is alive |
| Response Body | Contains `"status": "ok"` | Response format is correct |
| Response Time | < 5 seconds | Application is responsive |

##### No-Go Criteria (❌ FAIL)

| Signal | Criterion | Meaning | Action Required |
|--------|-----------|---------|-----------------|
| HTTP Response | Status code ≠ `200` | Application process failed | Check container logs, restart task |
| HTTP Response | No response / timeout | Application not running | Check ECS task state, container logs |
| Response Body | Invalid JSON or missing fields | Application error | Check application logs |

#### 3.2 Readiness Probe (`/api/ready`)

**Contract:** Returns 200 OK when ready, 503 when dependencies unavailable.

##### Go Criteria (✅ PASS)

| Signal | Criterion | Meaning |
|--------|-----------|---------|
| HTTP Response | Status code = `200` | All required dependencies available |
| Response Body | `"ready": true` | Service is ready to accept traffic |
| Response Body | All required checks = `"ok"` | Database, environment, etc. healthy |

##### Warning (⚠️ WARN — Acceptable During Startup)

| Signal | Criterion | Meaning | Action |
|--------|-----------|---------|--------|
| HTTP Response | Status code = `503` | Dependencies initializing | Wait up to 120 seconds during startup |
| Response Body | `"ready": false` | Service not yet ready | Check individual dependency statuses |

##### No-Go Criteria (❌ FAIL — After Startup Period)

| Signal | Criterion | Meaning | Action Required |
|--------|-----------|---------|-----------------|
| HTTP Response | Status code = `503` (after 120s) | Persistent dependency failure | Check dependency health (DB, MCP servers) |
| Response Body | Required dependency check failed | Critical dependency unavailable | Resolve dependency issue |

#### Copy-Paste Commands

```bash
# Get ALB DNS name
export ALB_DNS=$(aws elbv2 describe-load-balancers \
  --region ${AWS_REGION} \
  --query 'LoadBalancers[?contains(LoadBalancerName, `afu9`)].DNSName' \
  --output text | head -1)

# Test liveness probe (MUST return 200 for GO)
echo "Testing /api/health..."
HTTP_CODE=$(curl -s -o /tmp/health.json -w "%{http_code}" http://${ALB_DNS}/api/health)
if [ "${HTTP_CODE}" = "200" ]; then
  echo "✅ PASS: Health endpoint returned ${HTTP_CODE}"
  cat /tmp/health.json | jq .
else
  echo "❌ FAIL: Health endpoint returned ${HTTP_CODE} (expected 200)"
  cat /tmp/health.json
  exit 1
fi

# Test readiness probe (200 = ready, 503 = not ready but acceptable during startup)
echo "Testing /api/ready..."
HTTP_CODE=$(curl -s -o /tmp/ready.json -w "%{http_code}" http://${ALB_DNS}/api/ready)
if [ "${HTTP_CODE}" = "200" ]; then
  echo "✅ PASS: Readiness endpoint returned ${HTTP_CODE} - service is ready"
  cat /tmp/ready.json | jq .
elif [ "${HTTP_CODE}" = "503" ]; then
  echo "⚠️  WARN: Readiness endpoint returned ${HTTP_CODE} - service not ready (check dependencies)"
  cat /tmp/ready.json | jq .
else
  echo "❌ FAIL: Readiness endpoint returned ${HTTP_CODE} (expected 200 or 503)"
  cat /tmp/ready.json
  exit 1
fi

# Detailed readiness check with dependency breakdown
curl -s http://${ALB_DNS}/api/ready | jq '{ready: .ready, checks: .checks}'
```

---

## Decision Tree: Deployment Go/No-Go

Use this decision tree to determine whether a deployment is healthy and ready for production traffic.

```
┌─────────────────────────────────────────────────────────────┐
│              DEPLOYMENT VERIFICATION DECISION TREE           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │ 1. Check ECS Events   │
                  └───────────────────────┘
                              │
           ┌──────────────────┴──────────────────┐
           │                                      │
    ❌ Circuit Breaker?                    ✅ Steady State?
    ❌ Unable to Place?                          │
    ❌ Failed to Launch?                         ▼
           │                          ┌───────────────────────┐
           │                          │ 2. Check Target Health │
           │                          └───────────────────────┘
           │                                     │
           │              ┌──────────────────────┴──────────────────┐
           │              │                                          │
           │         ❌ Unhealthy?                            ✅ All Healthy?
           │         ❌ No Targets?                                  │
           │              │                                          ▼
           │              │                          ┌────────────────────────┐
           │              │                          │ 3. Check Health Probe  │
           │              │                          │    (/api/health)       │
           │              │                          └────────────────────────┘
           │              │                                     │
           │              │              ┌──────────────────────┴──────────────┐
           │              │              │                                      │
           │              │         ❌ Non-200?                          ✅ Returns 200?
           │              │         ❌ Timeout?                                │
           │              │              │                                      ▼
           │              │              │                      ┌────────────────────────┐
           │              │              │                      │ 4. Check Ready Probe   │
           │              │              │                      │    (/api/ready)        │
           │              │              │                      └────────────────────────┘
           │              │              │                                 │
           │              │              │          ┌──────────────────────┴──────────────┐
           │              │              │          │                                      │
           │              │              │     ⚠️ 503 < 120s?                       ✅ Returns 200?
           │              │              │          │                                      │
           │              │              │          │                                      ▼
           │              │              │          ▼                      ┌──────────────────────┐
           ▼              ▼              ▼          │                      │   ✅ DEPLOYMENT GO    │
    ┌──────────────────────────────────────┐       │                      │                       │
    │      ❌ DEPLOYMENT NO-GO              │◄──────┘                      │ • All checks passed   │
    │                                       │                              │ • Ready for traffic   │
    │ • Investigate failure                │                              │ • Monitor normally    │
    │ • Check logs & diagnostics           │                              └──────────────────────┘
    │ • Fix root cause                     │
    │ • Re-deploy after fix                │
    └──────────────────────────────────────┘
```

### Decision Criteria Summary

| Check | Go Criterion | No-Go Criterion |
|-------|-------------|-----------------|
| **1. ECS Events** | Steady state reached, no Circuit Breaker | Circuit Breaker, placement failures, launch errors |
| **2. Target Health** | All targets healthy, ≥1 target registered | Any unhealthy targets, no targets registered |
| **3. Health Probe** | Returns 200 OK within 5s | Non-200, timeout, no response |
| **4. Ready Probe** | Returns 200 OK with `ready: true` | 503 after 120s, persistent dependency failures |

**Decision Rule:**
- **GO** = All 4 checks pass ✅
- **NO-GO** = Any check fails ❌ (or ⚠️ persists > 120s)

---

## Integration with Observability Decision Tree

This document integrates with the broader observability framework:

### Related Decision Trees

1. **[Health Check Decision Summary](./HEALTH_CHECK_DECISION_SUMMARY.md)**
   - **Focus:** When to use `/api/health` vs `/api/ready`
   - **Integration Point:** Status signals use these endpoints per the decision tree
   - **Reference:** Section 2 (Decision Tree: When to Use Which Endpoint)

2. **[Post-Deployment Verification](./POST_DEPLOY_VERIFICATION.md)**
   - **Focus:** Automated verification script
   - **Integration Point:** Implements these status signals as automated checks
   - **Reference:** Checks 1-5 map directly to this document

3. **[ECS Deployment Runbook](./RUNBOOK_ECS_DEPLOY.md)**
   - **Focus:** Manual troubleshooting workflows
   - **Integration Point:** Provides diagnostic commands for failed signals
   - **Reference:** Sections 1-4 (Service Events, Stopped Tasks, Logs, Target Health)

### Cross-Reference Matrix

| Status Signal | Decision Tree | Automation | Troubleshooting |
|--------------|---------------|------------|-----------------|
| ECS Events | Health Check Decision Summary §2 | POST_DEPLOY_VERIFICATION Check 1 | RUNBOOK_ECS_DEPLOY §1 |
| Target Health | Health Check Decision Summary §2 | POST_DEPLOY_VERIFICATION Check 2 | RUNBOOK_ECS_DEPLOY §4 |
| Health Probe | Health Check Decision Summary §2 | POST_DEPLOY_VERIFICATION Check 4 | RUNBOOK_ECS_DEPLOY §3 |
| Ready Probe | Health Check Decision Summary §2 | POST_DEPLOY_VERIFICATION Check 5 | RUNBOOK_ECS_DEPLOY §3 |

---

## Automation Integration

### GitHub Actions Integration

These status signals are automatically checked in CI/CD:

**ECS Deployment Workflow** (`.github/workflows/deploy-ecs.yml`):
```yaml
- name: Post-Deployment Verification
  run: |
    ./scripts/post-deploy-verification.sh \
      ${{ steps.vars.outputs.tag_prefix }} \
      afu9-cluster \
      ${{ steps.vars.outputs.ecs_service }} \
      ${{ steps.alb-dns.outputs.alb_dns }}
```

This workflow handles both staging and production deployments:
- **Staging**: `tag_prefix=stage`, `ecs_service=afu9-control-center-stage`
- **Production**: `tag_prefix=prod`, `ecs_service=afu9-control-center-prod`

The verification script exits with:
- **Exit 0** = All signals pass (GO) ✅
- **Exit 1** = Any signal fails (NO-GO) ❌

### Manual Verification Workflow

For manual deployments, use this sequence:

```bash
# 1. Set environment
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage
export ALB_DNS=$(aws elbv2 describe-load-balancers \
  --region ${AWS_REGION} \
  --query 'LoadBalancers[?contains(LoadBalancerName, `afu9`)].DNSName' \
  --output text | head -1)

# 2. Run automated verification script
./scripts/post-deploy-verification.sh stage ${CLUSTER_NAME} ${SERVICE_NAME} ${ALB_DNS}

# 3. If script fails, manually check each signal
# See commands in sections 1-3 above
```

---

## Troubleshooting Failed Signals

### ECS Events Show Circuit Breaker

**Symptoms:**
- Service events contain "failed circuit breaker"
- Tasks are starting but being terminated

**Diagnosis:**
1. Check recent logs for application errors
2. Test `/api/health` endpoint manually
3. Verify health check configuration in ALB

**Commands:**
```bash
# Check application logs
aws logs tail /ecs/afu9/control-center --follow --filter-pattern ERROR

# Test health endpoint directly on task IP
TASK_IP=$(aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks $(aws ecs list-tasks --cluster ${CLUSTER_NAME} --service-name ${SERVICE_NAME} --query 'taskArns[0]' --output text) \
  --query 'tasks[0].containers[0].networkInterfaces[0].privateIpv4Address' \
  --output text)
curl -v http://${TASK_IP}:3000/api/health
```

**Common Causes:**
- Application startup failures
- Missing environment variables or secrets
- Database connection issues (when DATABASE_ENABLED=true)

**Fix:**
- Review application logs
- Verify secrets in AWS Secrets Manager
- Check database connectivity
- Ensure `/api/health` always returns 200 (no dependency checks)

---

### Target Health Shows Unhealthy

**Symptoms:**
- Target state = `unhealthy`
- Reason = `Target.FailedHealthChecks` or `Target.Timeout`

**Diagnosis:**
1. Verify ALB health check path is `/api/health`
2. Test endpoint response time
3. Check application logs for errors

**Commands:**
```bash
# Verify ALB health check configuration
aws elbv2 describe-target-groups \
  --target-group-arns ${TG_ARN} \
  --query 'TargetGroups[0].{Path:HealthCheckPath,Interval:HealthCheckIntervalSeconds,Timeout:HealthCheckTimeoutSeconds}' \
  --output table

# Test health endpoint response time
time curl http://${ALB_DNS}/api/health
```

**Common Causes:**
- `/api/health` returning non-200 status code
- Health endpoint timeout (> 5 seconds)
- Security group blocking ALB → ECS traffic
- Application crash during startup

**Fix:**
- Ensure `/api/health` always returns 200
- Optimize health endpoint response time
- Verify security group rules (ALB → ECS port 3000)
- Review startup logs for errors

---

### Health Probe Fails (Non-200)

**Symptoms:**
- `/api/health` returns non-200 status code
- `/api/health` times out or no response

**Diagnosis:**
1. Check container is running
2. Review application logs
3. Verify network connectivity

**Commands:**
```bash
# Check task status
aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks $(aws ecs list-tasks --cluster ${CLUSTER_NAME} --service-name ${SERVICE_NAME} --query 'taskArns[0]' --output text) \
  --query 'tasks[0].{LastStatus:lastStatus,HealthStatus:healthStatus,Containers:containers[*].{Name:name,HealthStatus:healthStatus,ExitCode:exitCode}}' \
  --output json

# Check application startup logs
aws logs tail /ecs/afu9/control-center --since 10m
```

**Common Causes:**
- Application crash or startup failure
- Port binding issues
- Missing dependencies in container image
- Out of memory (OOMKilled)

**Fix:**
- Check container exit code (137 = OOMKilled, increase memory)
- Review application startup logs
- Verify all dependencies are bundled in image
- Ensure health endpoint handler is registered correctly

---

### Ready Probe Persistent 503

**Symptoms:**
- `/api/ready` returns 503 after 120+ seconds
- `ready: false` in response body
- Specific dependency checks failing

**Diagnosis:**
1. Review which dependencies are failing
2. Check dependency-specific logs
3. Verify configuration and secrets

**Commands:**
```bash
# Get detailed readiness status
curl -s http://${ALB_DNS}/api/ready | jq '{ready: .ready, checks: .checks}'

# If database check fails, verify secrets
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --query 'SecretString' \
  --output text | jq .

# If MCP server check fails, check MCP server logs
aws logs tail /ecs/afu9/mcp-github --follow
```

**Common Causes:**
- Database not accessible (security group, secret misconfiguration)
- MCP servers not starting (image issues, memory constraints)
- Missing or invalid environment variables

**Fix:**
- For database: Verify secret keys, check RDS security group
- For MCP servers: Check container logs, verify task definition
- For environment: Ensure required env vars are set in task definition

---

## Best Practices

### 1. Always Check in Order

Follow the decision tree sequence (ECS Events → Target Health → Health → Ready) for fastest root cause identification.

### 2. Automate in CI/CD

Always run post-deployment verification in CI/CD pipelines. Never rely on manual checks alone.

### 3. Set Appropriate Timeouts

- **Health checks:** 5 seconds timeout, 30 seconds interval
- **Readiness grace period:** 120 seconds during startup
- **Circuit Breaker:** 3 consecutive failures before rollback

### 4. Monitor Signal Trends

Track signal success rates over time to identify degradation before failures occur.

### 5. Document Signal Failures

When a signal fails, document the root cause and resolution for future reference.

---

## References

- **[Control Plane Specification](./CONTROL_PLANE_SPEC.md)** - Health/readiness endpoint contracts
- **[Health Check Decision Summary](./HEALTH_CHECK_DECISION_SUMMARY.md)** - Liveness vs readiness decision tree
- **[Post-Deployment Verification](./POST_DEPLOY_VERIFICATION.md)** - Automated verification implementation
- **[ECS Deployment Runbook](./RUNBOOK_ECS_DEPLOY.md)** - Manual troubleshooting procedures
- **[Observability Guide](./OBSERVABILITY.md)** - Comprehensive observability overview
- **[Health vs Ready Separation](./HEALTH_VS_READY_SEPARATION.md)** - Detailed endpoint semantics

---

**Document Owner:** AFU-9 Team  
**Review Cycle:** Quarterly or when deployment logic changes  
**Last Updated:** 2025-12-20  
**Version:** 1.0
