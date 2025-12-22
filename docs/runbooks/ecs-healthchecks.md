# AFU-9 ECS healthchecks runbook

## Incident (Historical - Resolved)
- ECS circuit breaker triggered by misconfigured health checks.
- Tasks marked UNHEALTHY despite application being ready.

## Symptoms (Historical)
- ECS events: `Service ... (port 3000) is unhealthy in target-group ...` followed by circuit breaker rollback.
- Task status: desired=1 → running=1 → UNHEALTHY, then service scaled to 0.
- Application logs showed readiness success before task termination.

## Root Cause (Historical)
- ALB health check pointed to `/api/ready` which performs deep dependency checks
- `/api/ready` returned 503 during startup when database/MCP not yet available
- ECS Circuit Breaker interpreted 503 as failure → rollback

## Fix (Current State - As of PR #228)
✅ **ALB Target Group health check uses `/api/health`**
- Path: `/api/health` (liveness probe, no dependencies)
- Always returns 200 when Node.js process is running
- No false negatives during startup

✅ **Container health checks use `/api/health`**
- Control Center container: HTTP probe on the task ENI IPv4 (prefers `10.*`) at `http://<task-ip>:3000/api/health`
  - In this Fargate setup, the Next.js server is reachable on the task IP (e.g. `10.x.x.x`) but can refuse `127.0.0.1`.
- MCP containers: HTTP probe on `http://127.0.0.1:300X/health`
- startPeriod: 120s to allow for cold start

✅ **`/api/ready` remains available for optional readiness checks**
- Not used by ALB or ECS health checks
- Can return 503 if dependencies unavailable
- Use for manual verification or future K8s readiness probes

## Verification (Current)
```bash
# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:REGION:ACCOUNT:targetgroup/afu9-tg/ID

# Expected: State = "healthy" for all targets

# Check ECS service health
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center

# Expected: runningCount = desiredCount, no UNHEALTHY events

# Manual health endpoint check
curl https://afu-9.com/api/health | jq .
# Expected: {"status":"ok","service":"afu9-control-center",...}

# Optional readiness check (may return 503 during startup)
curl https://afu-9.com/api/ready | jq .
```

## Optional Follow-up
- Monitor CloudWatch metrics for health check success rate
- Set up alarms for sustained health check failures
- Review health check intervals if deployment times change
