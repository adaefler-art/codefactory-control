# AFU-9 ECS Deployment Diagnostics Runbook

**Goal:** Diagnose any ECS deployment failure within **5 minutes** to root cause.

This runbook provides step-by-step commands to diagnose ECS deployment failures for the AFU-9 Control Center. Each failure scenario includes copy-paste commands and a decision tree to determine the next steps.

## Quick Reference

```bash
# Set your environment
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage  # or afu9-control-center-prod
```

## Diagnostic Flow

```
ECS Deploy Failed
    ↓
1. Check Service Events (recent errors)
    ↓
2. Check Task State (stopped tasks + exit codes)
    ↓
3. Check Container Logs (CloudWatch)
    ↓
4. Check Target Group Health (ALB health checks)
    ↓
5. Check Secrets & IAM (access denied errors)
```

---

## 1. Check Service Events

Service events show the most recent deployment activity and errors from ECS.

### Command

```bash
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[:10]' \
  --output table
```

### What to Look For

| Event Message | Root Cause | Next Step |
|--------------|------------|-----------|
| `(service ...) has reached a steady state` | Deployment succeeded | No action needed |
| `(service ...) failed circuit breaker` | Health checks failed | Go to Step 2 & 3 |
| `(service ...) was unable to place a task` | Resource constraints or subnet issues | Check VPC/subnets |
| `(service ...) failed to launch a task with (error ECS...)` | Task definition or IAM issue | Go to Step 5 |

### Example: Circuit Breaker Triggered

```
service afu9-control-center-stage (instance i-abc123) failed circuit breaker: 
tasks failed to start due to repeated health check failures
```

**Action:** Tasks are starting but failing health checks. Proceed to Step 2 and Step 3.

---

## 2. Check Stopped Tasks

Stopped tasks reveal why containers exited (exit codes, reasons).

### Command: List Recent Stopped Tasks

```bash
# List stopped tasks in the last hour
aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --query 'taskArns[:5]' \
  --output text
```

### Command: Describe Stopped Task Details

```bash
# Get task ARN from above, then describe it
TASK_ARN="<paste-task-arn-here>"

aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION} \
  --query 'tasks[0].{stoppedReason:stoppedReason,containers:containers[*].{name:name,exitCode:exitCode,reason:reason}}' \
  --output json
```

### What to Look For

| Exit Code | Reason | Root Cause | Next Step |
|-----------|--------|------------|-----------|
| `0` | Container exited normally | Possible crash/restart loop | Check logs (Step 3) |
| `1` | Generic error | Application error | Check logs (Step 3) |
| `137` | `SIGKILL` (OOM) | Out of memory | Increase task memory |
| `139` | `SIGSEGV` | Segmentation fault | Check logs, possible app bug |
| `null` | `Task failed ELB health checks` | Health endpoint not responding | Check logs (Step 3) |
| `null` | `CannotPullContainerError` | ECR image missing or auth failed | Check ECR repos & IAM |
| `null` | `ResourceInitializationError` | Secrets or IAM issue | Go to Step 5 |

### Example: Health Check Failure

```json
{
  "stoppedReason": "Task failed ELB health checks in (target-group arn:...)",
  "containers": [
    {
      "name": "control-center",
      "exitCode": null,
      "reason": "Stopped by ECS due to failed health checks"
    }
  ]
}
```

**Action:** Container didn't crash but failed health checks. Check logs in Step 3.

---

## 3. Check Container Logs

CloudWatch Logs contain the actual application output.

### Command: Tail Control Center Logs

```bash
# Live tail (last 100 lines, then follow)
aws logs tail /ecs/afu9/control-center \
  --follow \
  --region ${AWS_REGION}
```

### Command: Tail Logs for a Specific Time Range

```bash
# Get logs from the last 30 minutes
aws logs tail /ecs/afu9/control-center \
  --since 30m \
  --region ${AWS_REGION}
```

### Command: Search Logs for Errors

```bash
# Search for "error", "exception", "fail" in the last hour
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "?error ?exception ?fail" \
  --region ${AWS_REGION} \
  --query 'events[*].message' \
  --output text
```

### What to Look For

| Log Message Pattern | Root Cause | Next Step |
|-------------------|------------|-----------|
| `Error: connect ECONNREFUSED` | Database/service unreachable | Check network/secrets |
| `Error: getaddrinfo ENOTFOUND` | DNS resolution failed | Check VPC DNS settings |
| `Access denied` or `UnauthorizedOperation` | IAM permissions missing | Go to Step 5 |
| `FATAL: password authentication failed` | Wrong DB credentials | Go to Step 5 |
| `Error: Cannot find module` | Missing dependency/build issue | Check Docker image |
| `listen EADDRINUSE` | Port conflict (rare in ECS) | Check task definition |
| `Healthcheck failed` | App not responding on health endpoint | Check app logic |

### Example: Database Connection Error

```
Error: connect ECONNREFUSED 10.0.11.123:5432
  at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1141:16)
```

**Action:** Database is unreachable. Verify security group rules allow ECS → RDS (port 5432).

---

## 4. Check Target Group Health

ALB target groups track health check status for each task.

### Command: Get Target Health

```bash
# Get target group ARN from ECS service or Network stack outputs
TARGET_GROUP_ARN="arn:aws:elasticloadbalancing:eu-central-1:ACCOUNT:targetgroup/afu9-tg-stage/abc123"

aws elbv2 describe-target-health \
  --target-group-arn ${TARGET_GROUP_ARN} \
  --region ${AWS_REGION} \
  --output table
```

### What to Look For

| Target State | Reason | Root Cause | Next Step |
|-------------|--------|------------|-----------|
| `healthy` | n/a | Target is healthy | No action needed |
| `unhealthy` | `Target.FailedHealthChecks` | `/api/health` not returning 200 | Check logs (Step 3) |
| `unhealthy` | `Target.Timeout` | App not responding in time | Increase health check timeout |
| `draining` | n/a | Target is being deregistered | Wait for new tasks |
| `unavailable` | `Target.NotRegistered` | No tasks running | Check ECS service events |

### Example: Failed Health Checks

```
Target              Health  State     Reason
--------------------------------------------------
10.0.11.45:3000     unhealthy  Target.FailedHealthChecks
```

**Action:** Container is running but `/api/health` is not returning 200. This indicates the Node.js process may have crashed or is unresponsive. Check logs for app errors.

---

## 5. Check Secrets & IAM Permissions

Secrets and IAM issues prevent tasks from starting or accessing resources.

### Command: Verify Secrets Exist

```bash
# Check GitHub secret
aws secretsmanager describe-secret \
  --secret-id afu9-github \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
  --output table

# Check LLM secret
aws secretsmanager describe-secret \
  --secret-id afu9-llm \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
  --output table

# Check Database secret (if enableDatabase=true)
aws secretsmanager describe-secret \
  --secret-id afu9-database \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
  --output table
```

### Command: Validate Secret JSON Structure

```bash
# Verify GitHub secret has required keys
aws secretsmanager get-secret-value \
  --secret-id afu9-github \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("token", "owner", "repo")'

# Verify LLM secret has required keys
aws secretsmanager get-secret-value \
  --secret-id afu9-llm \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("openai_api_key", "anthropic_api_key", "deepseek_api_key")'

# Verify Database secret has required keys (if enableDatabase=true)
aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("host", "port", "database", "username", "password")'
```

**Expected:** All commands return `true`. If `false`, update the secret with missing keys.

### Command: Check IAM Role Permissions

```bash
# Get task execution role ARN
TASK_EXEC_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`].OutputValue' \
  --output text)

# List attached policies
aws iam list-attached-role-policies \
  --role-name afu9-ecs-task-execution-role-stage \
  --region ${AWS_REGION} \
  --output table
```

### What to Look For

| Error Message | Root Cause | Next Step |
|--------------|------------|-----------|
| `AccessDeniedException` when reading secrets | IAM role lacks `secretsmanager:GetSecretValue` | Add IAM policy |
| `User: arn:aws:sts::... is not authorized` | IAM role not trusted by ECS | Fix trust policy |
| `ResourceInitializationError: unable to pull secrets` | Secret ARN incorrect or IAM issue | Verify ARN & IAM |
| Secret key missing (e.g., `port` not found in secret) | Secret JSON structure incorrect | Update secret with required keys |

### Example: Missing Secret Key

```
Error: Unable to extract secret value for DATABASE_PORT from secret arn:aws:secretsmanager:...
Reason: Key 'port' not found in secret JSON
```

**Action:** Update the secret to include the missing key:

```bash
aws secretsmanager update-secret \
  --secret-id afu9-database \
  --secret-string '{"host":"...","port":"5432","database":"afu9","username":"...","password":"..."}' \
  --region ${AWS_REGION}
```

---

## 6. Advanced Diagnostics

### Check VPC and Network Configuration

```bash
# Verify ECS security group allows ALB → ECS traffic
aws ec2 describe-security-groups \
  --group-ids sg-xxxxxxxxx \
  --region ${AWS_REGION} \
  --query 'SecurityGroups[0].IpPermissions' \
  --output table

# Verify RDS security group allows ECS → RDS traffic (if enableDatabase=true)
aws ec2 describe-security-groups \
  --group-ids sg-yyyyyyyyy \
  --region ${AWS_REGION} \
  --query 'SecurityGroups[0].IpPermissions' \
  --output table
```

### Check ECR Repository Access

```bash
# Verify image exists
aws ecr describe-images \
  --repository-name afu9/control-center \
  --image-ids imageTag=staging-latest \
  --region ${AWS_REGION} \
  --query 'imageDetails[0].{digest:imageDigest,pushedAt:imagePushedAt,tags:imageTags}' \
  --output table
```

### Force New Deployment

If you've fixed an issue externally (e.g., updated a secret), force ECS to redeploy:

```bash
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

### Get Service Details for Complete Picture

```bash
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0]' \
  --output json > service-details.json
```

---

## Decision Tree Summary

```
┌─────────────────────────────────┐
│  ECS Deployment Failed          │
└────────────┬────────────────────┘
             │
             ├─ Check Service Events (Step 1)
             │    │
             │    ├─ "circuit breaker" → Go to Step 2 & 3
             │    ├─ "unable to place task" → Check VPC/subnets
             │    └─ "failed to launch" → Go to Step 5
             │
             ├─ Check Stopped Tasks (Step 2)
             │    │
             │    ├─ Exit code 137 → Increase memory
             │    ├─ Exit code 1 → Check logs (Step 3)
             │    ├─ "CannotPullContainerError" → Check ECR
             │    └─ "ResourceInitializationError" → Go to Step 5
             │
             ├─ Check Container Logs (Step 3)
             │    │
             │    ├─ "ECONNREFUSED" → Check network/secrets
             │    ├─ "Access denied" → Go to Step 5
             │    ├─ "password authentication failed" → Go to Step 5
             │    └─ App errors → Fix app code
             │
             ├─ Check Target Group Health (Step 4)
             │    │
             │    ├─ "FailedHealthChecks" → Check logs (Step 3)
             │    └─ "Timeout" → Increase timeout or fix app
             │
             └─ Check Secrets & IAM (Step 5)
                  │
                  ├─ Secret missing → Create secret
                  ├─ Secret key missing → Update secret
                  └─ IAM permission denied → Add IAM policy
```

---

## Common Failure Scenarios

### Scenario 1: Database Connection Failed (enableDatabase=true)

**Symptoms:**
- Service events: "circuit breaker"
- Stopped tasks: "Task failed ELB health checks"
- Logs: `Error: connect ECONNREFUSED 10.0.x.x:5432`

**Root Cause:** ECS security group doesn't allow traffic to RDS, or RDS security group doesn't allow traffic from ECS.

**Fix:**
```bash
# Add inbound rule to RDS security group allowing port 5432 from ECS security group
aws ec2 authorize-security-group-ingress \
  --group-id <RDS_SECURITY_GROUP_ID> \
  --protocol tcp \
  --port 5432 \
  --source-group <ECS_SECURITY_GROUP_ID> \
  --region ${AWS_REGION}
```

### Scenario 2: Secret Key Missing

**Symptoms:**
- Service events: "circuit breaker"
- Stopped tasks: "ResourceInitializationError"
- Logs: `unable to extract secret value for DATABASE_PORT`

**Root Cause:** Secret JSON is missing a required key (e.g., `port`, `username`).

**Fix:**
```bash
# Update secret with all required keys
aws secretsmanager update-secret \
  --secret-id afu9-database \
  --secret-string '{"host":"afu9-postgres.xxx.eu-central-1.rds.amazonaws.com","port":"5432","database":"afu9","username":"afu9_admin","password":"..."}' \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

### Scenario 3: Image Not Found

**Symptoms:**
- Service events: "circuit breaker"
- Stopped tasks: "CannotPullContainerError: image not found"
- Logs: (no logs, container never started)

**Root Cause:** ECR image with the specified tag doesn't exist, or IAM role lacks ECR permissions.

**Fix:**
```bash
# Verify image exists
aws ecr describe-images \
  --repository-name afu9/control-center \
  --image-ids imageTag=staging-latest \
  --region ${AWS_REGION}

# If not found, build and push:
# See docs/ECS-DEPLOYMENT.md for build instructions
```

### Scenario 4: Health Check Failing Despite Running Process

**Symptoms:**
- Service events: "circuit breaker"
- Stopped tasks: "Task failed ELB health checks"
- Logs: Application shows "Ready" but ALB health checks fail

**Root Cause (FIXED in this version):** 
- In previous versions: ALB was checking `/api/ready` which returns 503 during startup or when dependencies are initializing
- Current version: ALB checks `/api/health` which returns 200 as soon as Node.js is running

**Verification:**
- Test ALB health endpoint: `curl http://<ALB_DNS>/api/health` should return 200
- Test readiness separately: `curl http://<ALB_DNS>/api/ready` shows detailed dependency status
- When `DATABASE_ENABLED=false`: Both endpoints return 200
- When `DATABASE_ENABLED=true` but secrets missing: `/api/health` returns 200, `/api/ready` returns 503

---

## Configuration Reference

### Required Secrets

| Secret Name | Required Keys | Notes |
|------------|---------------|-------|
| `afu9-github` | `token`, `owner`, `repo` | GitHub API access |
| `afu9-llm` | `openai_api_key`, `anthropic_api_key`, `deepseek_api_key` | LLM API keys |
| `afu9-database` | `host`, `port`, `database`, `username`, `password` | Only if `enableDatabase=true` |

### Required Environment Variables (in Task Definition)

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `3000` | Control Center port |
| `ENVIRONMENT` | `stage` or `prod` | Deployment environment |
| `DATABASE_ENABLED` | `true` or `false` | Whether DB is configured |

### Health Check Endpoints

AFU-9 Control Center provides two health endpoints with distinct purposes:

#### `/api/health` (Liveness Probe)
- **Purpose:** Check if the Node.js process is alive
- **Dependencies:** None (no DB, MCP, or auth)
- **Response:** Always 200 OK once process starts
- **Used by:** ALB TargetGroup health checks, ECS Container HealthCheck
- **Timeout:** Fast response (< 100ms)

#### `/api/ready` (Readiness Probe)
- **Purpose:** Check if service is ready to accept traffic
- **Dependencies:** Database (if enabled), Environment variables
- **Response:** 200 OK if ready, 503 if critical dependencies fail
- **Used by:** Optional manual checks, future K8s deployments, monitoring
- **Timeout:** May take longer due to dependency checks

**Important:** ALB and ECS Container HealthCheck use `/api/health` to avoid false negatives during startup.

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/api/health` | Liveness probe | `200 OK` always (unless process crashed) |
| `/api/ready` | Readiness probe | `200 OK` if ready, `503` if not ready |

**When `DATABASE_ENABLED=false`:**
- `/api/ready` returns `200 OK` with `checks.database = {status: "not_configured"}`

**When `DATABASE_ENABLED=true`:**
- `/api/ready` returns `200 OK` if DB configuration is valid, `503` if credentials are missing or invalid

---

## Tools

### Automated Diagnostic Script

For convenience, use the PowerShell diagnostic script:

```powershell
# Run from repository root
.\scripts\ecs_diagnose.ps1 -ClusterName afu9-cluster -ServiceName afu9-control-center-stage
```

This script automates Steps 1-5 and produces a summary report.

---

## Rollback

If deployment is completely broken and you need to rollback:

```bash
# Get previous task definition
PREV_TASK_DEF=$(aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].deployments[1].taskDefinition' \
  --output text)

# Update service to use previous task definition
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --task-definition ${PREV_TASK_DEF} \
  --region ${AWS_REGION}
```

See [docs/ROLLBACK.md](./ROLLBACK.md) for full rollback procedures.

---

## Support

For additional help:
- Check [ECS-DEPLOYMENT.md](./ECS-DEPLOYMENT.md) for deployment instructions
- Check [AWS_DEPLOY_RUNBOOK.md](./AWS_DEPLOY_RUNBOOK.md) for full deployment procedures
- Review CloudWatch Logs: `/ecs/afu9/*`
- Open an issue in the GitHub repository
