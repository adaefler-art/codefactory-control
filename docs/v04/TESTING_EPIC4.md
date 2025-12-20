# Epic-4 Testing Guide: Smoke Tests & DB Toggle Hardening

This document provides comprehensive testing instructions for Epic-4, focusing on smoke tests, ECS debugging, and database configuration validation.

## Overview

Epic-4 introduces:
- **Smoke test harness** for health/readiness validation with DB toggle assertions
- **ECS debug harness** for diagnosing deployment issues
- **Database toggle hardening** to ensure enableDatabase flag works correctly
- **Test matrix** for validating both DB on/off configurations

## Quick Start

### Prerequisites

```bash
# Required tools
- PowerShell 7+ (pwsh)
- AWS CLI v2
- curl or Invoke-RestMethod
- jq (for bash scripts, optional)

# AWS Authentication (for ECS debugging)
aws sso login --profile <your-profile>
# OR
export AWS_PROFILE=<your-profile>
```

### Run Smoke Tests

```powershell
# Local development (auto-detect DB config)
npm run smoke:epic4

# Staging with DB disabled
npm run smoke:epic4 -- -BaseUrl https://stage.afu-9.com -ExpectDatabaseEnabled false

# Production with DB enabled
npm run smoke:epic4 -- -BaseUrl https://prod.afu-9.com -ExpectDatabaseEnabled true
```

### Run ECS Debugging

```powershell
# Debug staging service
npm run ecs:debug -- -Service afu9-service-stage

# Debug production service with AWS profile
npm run ecs:debug -- -Service afu9-service-prod -Profile codefactory

# Extended logs (100 lines per container)
npm run ecs:debug -- -Service afu9-service-stage -LogLines 100
```

## Test Matrix

### Database Toggle Testing

| Test Case | enableDatabase | Expected Behavior | Validation Method |
|-----------|----------------|-------------------|-------------------|
| **DB-OFF-1** | `false` | No DB secret ARN injected | Check task definition |
| **DB-OFF-2** | `false` | No IAM SecretsManager permissions | Check task role policy |
| **DB-OFF-3** | `false` | `/ready` returns `database:not_configured` | Smoke test assertion |
| **DB-OFF-4** | `false` | No DATABASE_* env vars in container | Container inspection |
| **DB-ON-1** | `true` (no dbSecretArn) | CDK synth fails with validation error | `cdk synth` |
| **DB-ON-2** | `true` (with dbSecretArn) | DB secret ARN injected | Check task definition |
| **DB-ON-3** | `true` (with dbSecretArn) | IAM grants SecretsManager read | Check task role policy |
| **DB-ON-4** | `true` (with dbSecretArn) | `/ready` returns `database:ok` or `database:connection_configured` | Smoke test assertion |

### Deployment Scenarios

#### Scenario 1: Deploy with Database Disabled (Recommended First)

```bash
# Step 1: Deploy with database disabled
cdk deploy Afu9NetworkStack Afu9EcsStageStack -c afu9-enable-database=false

# Step 2: Verify deployment
npm run ecs:debug -- -Service afu9-service-stage

# Step 3: Run smoke tests
npm run smoke:epic4 -- -BaseUrl http://<alb-dns> -ExpectDatabaseEnabled false

# Expected Results:
# ✅ Control Center health: ok
# ✅ Control Center ready: database:not_configured
# ✅ No DB secrets in task definition
# ✅ No SecretsManager permissions in task role
```

#### Scenario 2: Enable Database (After Scenario 1)

```bash
# Step 1: Deploy database stack (if not already deployed)
cdk deploy Afu9DatabaseStack

# Step 2: Get database secret ARN
aws secretsmanager describe-secret --secret-id afu9/database/master --query 'ARN' --output text

# Step 3: Deploy ECS with database enabled
cdk deploy Afu9EcsStageStack \
  -c afu9-enable-database=true \
  -c dbSecretArn=<secret-arn-from-step-2>

# Step 4: Verify deployment
npm run ecs:debug -- -Service afu9-service-stage

# Step 5: Run smoke tests
npm run smoke:epic4 -- -BaseUrl http://<alb-dns> -ExpectDatabaseEnabled true

# Expected Results:
# ✅ Control Center health: ok
# ✅ Control Center ready: database:ok
# ✅ DB secret ARN in task definition
# ✅ SecretsManager read permissions in task role
```

#### Scenario 3: Multi-Environment Deployment

```bash
# Deploy stage (DB disabled for testing)
cdk deploy Afu9EcsStageStack -c afu9-multi-env=true -c afu9-enable-database=false

# Deploy prod (DB enabled)
cdk deploy Afu9EcsProdStack -c afu9-multi-env=true -c afu9-enable-database=true

# Test both environments
npm run smoke:epic4 -- -BaseUrl https://stage.afu-9.com -ExpectDatabaseEnabled false
npm run smoke:epic4 -- -BaseUrl https://prod.afu-9.com -ExpectDatabaseEnabled true
```

## Script Reference

### smoke_epic4.ps1

**Purpose**: Validate health/ready endpoints with database toggle assertions

**Parameters**:
- `-BaseUrl`: Target deployment URL (default: `http://localhost`)
- `-ExpectDatabaseEnabled`: Expected DB state: `'true'`, `'false'`, or `'auto'` (default: `'auto'`)
- `-Profile`: Optional AWS profile name

**Output**:
- Tests all 4 services (Control Center + 3 MCP servers)
- Validates `/health` and `/ready` endpoint responses
- Asserts database configuration matches expected state
- Returns exit code 0 on success, 1 on failure

**Examples**:

```powershell
# Auto-detect mode (no assertions)
.\scripts\smoke_epic4.ps1 -BaseUrl http://localhost

# Assert DB disabled
.\scripts\smoke_epic4.ps1 -BaseUrl https://stage.afu-9.com -ExpectDatabaseEnabled false

# Assert DB enabled
.\scripts\smoke_epic4.ps1 -BaseUrl https://prod.afu-9.com -ExpectDatabaseEnabled true
```

### ecs_debug.ps1

**Purpose**: Diagnose ECS deployment issues with comprehensive debugging

**Parameters**:
- `-Service`: ECS service name (required, e.g., `afu9-service-stage`)
- `-Cluster`: ECS cluster name (default: `afu9-cluster`)
- `-Region`: AWS region (default: `eu-central-1`)
- `-Profile`: Optional AWS profile name
- `-LogLines`: Number of log lines per container (default: 50)

**Output**:
- Service information (status, task counts, deployments)
- Recent service events (last 20)
- Stopped tasks with exit codes and failure reasons
- Target health from ALB
- Log group listings
- Recent logs from each container
- Diagnostic summary with recommendations

**Examples**:

```powershell
# Basic debug
.\scripts\ecs_debug.ps1 -Service afu9-service-stage

# With AWS profile
.\scripts\ecs_debug.ps1 -Service afu9-service-prod -Profile codefactory

# Extended logs
.\scripts\ecs_debug.ps1 -Service afu9-service-stage -LogLines 200

# Custom cluster
.\scripts\ecs_debug.ps1 -Service my-service -Cluster my-cluster
```

## Validation Checklist

### Pre-Deployment Validation

- [ ] CDK context configured correctly
- [ ] AWS credentials valid
- [ ] ECR repositories exist with images
- [ ] Secrets in SecretsManager (github, llm, optionally database)

### Post-Deployment Validation (DB Disabled)

- [ ] Service reaches ACTIVE state
- [ ] All tasks running (runningCount == desiredCount)
- [ ] Targets healthy in ALB target group
- [ ] `/health` returns 200 with valid JSON
- [ ] `/ready` returns database:not_configured
- [ ] Task definition has NO database secrets
- [ ] Task role has NO SecretsManager database permissions
- [ ] `smoke_epic4.ps1 -ExpectDatabaseEnabled false` passes

### Post-Deployment Validation (DB Enabled)

- [ ] Service reaches ACTIVE state
- [ ] All tasks running (runningCount == desiredCount)
- [ ] Targets healthy in ALB target group
- [ ] `/health` returns 200 with valid JSON
- [ ] `/ready` returns database:ok or connection_configured
- [ ] Task definition includes database secret ARN
- [ ] Task execution role can read database secret
- [ ] Task role has NO direct database access (only via env vars)
- [ ] `smoke_epic4.ps1 -ExpectDatabaseEnabled true` passes

## Common Issues & Solutions

### Issue: Smoke test fails with "database:error"

**Symptoms**:
- `/ready` returns `database:error` with message about missing env vars
- enableDatabase=true but database credentials not injected

**Solution**:
```bash
# 1. Check task definition for secret references
aws ecs describe-task-definition --task-definition <task-def-arn> \
  --query 'taskDefinition.containerDefinitions[0].secrets'

# 2. Verify secret exists and is readable
aws secretsmanager get-secret-value --secret-id afu9/database/master

# 3. Check task execution role permissions
aws iam get-role-policy --role-name afu9-ecs-task-execution-role-stage \
  --policy-name <inline-policy-name>

# 4. Redeploy with correct dbSecretArn
cdk deploy Afu9EcsStageStack -c afu9-enable-database=true -c dbSecretArn=<correct-arn>
```

### Issue: Smoke test fails with "not_configured" but DB enabled

**Symptoms**:
- Deployed with enableDatabase=true
- `/ready` returns `database:not_configured`
- Expected `database:ok`

**Root Cause**: DATABASE_ENABLED env var not set to 'true' in container

**Solution**:
```bash
# 1. Check container environment variables
aws ecs describe-task-definition --task-definition <task-def-arn> \
  --query 'taskDefinition.containerDefinitions[0].environment'

# 2. Verify DATABASE_ENABLED=true is present
# If missing, this is a CDK stack bug

# 3. Check actual running container
aws ecs execute-command --cluster afu9-cluster --task <task-id> \
  --container control-center --interactive --command "env | grep DATABASE"
```

### Issue: ECS tasks stuck in PENDING

**Symptoms**:
- Service shows pendingCount > 0
- No tasks reaching RUNNING state
- Service events show "unable to pull image" or "resource unavailable"

**Solution**:
```powershell
# Run debug harness to diagnose
.\scripts\ecs_debug.ps1 -Service afu9-service-stage

# Common fixes:
# 1. ECR authentication issue
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.eu-central-1.amazonaws.com

# 2. Image doesn't exist
aws ecr describe-images --repository-name afu9/control-center --image-ids imageTag=stage-latest

# 3. Insufficient resources
# Check if desiredCount exceeds Fargate capacity limits
```

### Issue: Tasks starting but immediately stopping

**Symptoms**:
- runningCount stays at 0
- Stopped tasks with non-zero exit codes
- Service events show "Essential container exited"

**Solution**:
```powershell
# Check stopped task exit codes
.\scripts\ecs_debug.ps1 -Service afu9-service-stage

# Look for:
# - Exit code 1: Application error (check logs)
# - Exit code 137: OOM killed (increase memoryLimitMiB)
# - Exit code 139: Segmentation fault (application bug)

# Check container logs for errors
# Look in "RECENT LOGS" section of debug output
```

### Issue: Targets unhealthy in ALB

**Symptoms**:
- Tasks running but targets showing unhealthy
- ALB not routing traffic to service
- Service events show "target failing health checks"

**Solution**:
```powershell
# Check target health
.\scripts\ecs_debug.ps1 -Service afu9-service-stage

# Common causes:
# 1. App not responding on port 3000
# 2. Health check path incorrect (should be /api/ready)
# 3. App startup too slow (adjust healthCheckGracePeriod)

# Verify health endpoint manually
curl http://<task-ip>:3000/api/ready

# Check security group allows ALB -> ECS on port 3000
```

## Automation & CI/CD

### GitHub Actions Integration

```yaml
# .github/workflows/smoke-test.yml
name: Smoke Tests

on:
  deployment_status:
    types: [success]

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install PowerShell
        uses: microsoft/setup-powershell@v1
      
      - name: Run Smoke Tests
        shell: pwsh
        run: |
          ./scripts/smoke_epic4.ps1 `
            -BaseUrl ${{ secrets.DEPLOYMENT_URL }} `
            -ExpectDatabaseEnabled ${{ secrets.DB_ENABLED }}
      
      - name: Debug on Failure
        if: failure()
        shell: pwsh
        env:
          AWS_REGION: eu-central-1
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          ./scripts/ecs_debug.ps1 `
            -Service ${{ secrets.ECS_SERVICE_NAME }} `
            -Cluster afu9-cluster
```

### Pre-Deployment Validation

```bash
# Add to deployment pipeline before cdk deploy
npm run smoke:epic4 -- -BaseUrl http://localhost -ExpectDatabaseEnabled false

# Ensures:
# - Local containers are healthy
# - Smoke tests pass before pushing to AWS
# - Database toggle logic works in development
```

## Expected Outputs

### Successful Smoke Test (DB Disabled)

```
========================================
AFU-9 Epic-4 Smoke Test Suite
========================================
Base URL: https://stage.afu-9.com
Expected Database Enabled: false

========================================
Testing Control Center
========================================
ℹ️  URL: https://stage.afu-9.com:3000
ℹ️  Testing Control Center health endpoint: https://stage.afu-9.com:3000/health
✅ Control Center health check passed
   Service: afu9-control-center, Version: 0.2.5
ℹ️  Testing Control Center readiness endpoint: https://stage.afu-9.com:3000/ready
✅ Control Center readiness check: READY
   Service: afu9-control-center, Version: 0.2.5
   Checks:
     ✓ service : ok
     ○ database : not_configured (Database disabled in configuration)
     ✓ environment : ok

========================================
DATABASE CONFIGURATION VALIDATION
========================================
ℹ️  Database check status: not_configured
✅ DATABASE TOGGLE VALIDATION: Database correctly reports 'not_configured' when enableDatabase=false

========================================
TEST SUMMARY
========================================
Passed:  12
Warnings: 0
Failed:  0

✅ ALL SMOKE TESTS PASSED

✨ Epic-4 smoke test suite completed successfully
```

### Successful ECS Debug (Healthy Service)

```
========================================
AFU-9 ECS Debug Harness
========================================
Cluster: afu9-cluster
Service: afu9-service-stage
Region: eu-central-1

========================================
SERVICE INFORMATION
========================================
ℹ️  Service: afu9-service-stage
ℹ️  Status: ACTIVE
ℹ️  Running Tasks: 1
ℹ️  Desired Tasks: 1
ℹ️  Pending Tasks: 0
ℹ️  Task Definition: arn:aws:ecs:eu-central-1:123456789012:task-definition/afu9-task-stage:3

Deployments:
  - Status: PRIMARY, Running: 1, Desired: 1, Pending: 0
    Task Definition: arn:aws:ecs:eu-central-1:123456789012:task-definition/afu9-task-stage:3

========================================
SERVICE EVENTS (Last 20)
========================================
2025-12-17T06:00:00Z - service afu9-service-stage has reached a steady state.
2025-12-17T05:58:30Z - service afu9-service-stage registered 1 targets in target-group afu9-tg-stage
2025-12-17T05:58:00Z - service afu9-service-stage has started 1 tasks: task 123abc

========================================
STOPPED TASKS (Last 10)
========================================
✅ No stopped tasks (this is good!)

========================================
TARGET HEALTH (ALB)
========================================
ℹ️  Target Group: arn:aws:elasticloadbalancing:eu-central-1:123456789012:targetgroup/afu9-tg-stage/abc123
  Target: 10.0.1.123:3000
    State: healthy

========================================
DIAGNOSTIC SUMMARY
========================================
✅ No critical issues detected
ℹ️  Service appears to be healthy

========================================
DEBUG COMPLETE
========================================
✅ ECS debug harness completed successfully
ℹ️  For more details, check CloudWatch Logs console or use AWS CLI directly
```

## Troubleshooting Tips

1. **Always run ecs_debug.ps1 first** when investigating issues
2. **Check stopped tasks** for exit codes and container errors
3. **Review recent logs** for application-level errors
4. **Verify target health** to ensure ALB can reach tasks
5. **Compare working vs broken** deployments using service events
6. **Use -LogLines parameter** to get more context when needed
7. **Save debug output** for sharing with team or support

## Related Documentation

- [ECS Configuration Reference](./ECS_CONFIG_REFERENCE.md)
- [AWS Deploy Runbook](./AWS_DEPLOY_RUNBOOK.md)
- [RDS Quickstart](./RDS-QUICKSTART.md)
- [ECS Deployment Guide](./ECS-DEPLOYMENT.md)
- [Observability Runbook](./OBSERVABILITY-RUNBOOK.md)

## Version History

- **2025-12-17**: Initial Epic-4 testing guide
  - Added smoke_epic4.ps1 script
  - Added ecs_debug.ps1 script
  - Added test matrix for DB toggle validation
  - Added common issues and solutions
