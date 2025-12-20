# AFU-9 Operational Runbooks

This directory contains operational runbooks for managing and troubleshooting AFU-9 infrastructure.

## Available Runbooks

### 🔴 Critical Operations

#### [CloudFormation UPDATE_ROLLBACK_COMPLETE](./cloudformation-update-rollback-complete.md)
**ID:** I-05-01-RUNBOOK-ROLLBACK  
**Purpose:** Standardisierter Diagnoseprozess für UPDATE_ROLLBACK_COMPLETE  
**Time to Resolution:** < 15 minutes

**Use when:**
- CloudFormation stack is in UPDATE_ROLLBACK_COMPLETE state
- Stack update fails and cannot be updated
- Need to recover from failed CloudFormation deployment
- CDK deployment fails and rolls back

**Key Features:**
- 4-step diagnostic flow: CFN → ECS → Logs → Fix
- Common failure scenarios with immediate solutions
- Copy-paste ready commands
- Covers 6 most common scenarios (Secrets, IAM, Circuit Breaker, Limits, Dependencies, Parameters)

---

#### [ECS Circuit Breaker Diagnosis](./ecs-circuit-breaker-diagnosis.md)
**ID:** I-01-03-ECS-CIRCUIT-DIAG  
**Purpose:** Standardized diagnostic process for ECS Circuit Breaker events  
**Time to Root Cause:** < 10 minutes

**Use when:**
- ECS deployment fails with circuit breaker trigger
- Tasks fail to start or are repeatedly stopped
- ALB health checks continuously fail
- Need rapid root cause identification

**Key Features:**
- 5-step diagnostic flow with copy-paste commands
- Common failure scenarios with immediate fixes
- Decision trees for troubleshooting
- No trial-and-error required

**Quick Reference:** [Quick Reference Card](./ecs-circuit-breaker-quick-reference.md) - Print-friendly 1-page cheatsheet

---

### 🟡 Specific Issues

#### [ECS Secret Injection Failures](./ecs-secret-injection.md)
**ID:** I-05-02-RUNBOOK-SECRETS  
**Purpose:** Diagnose and fix ECS secret injection failures  
**Time to Resolution:** < 5 minutes

**Use when:**
- ECS tasks fail with `ResourceInitializationError: unable to pull secrets`
- Container logs show missing environment variables from secrets
- Wrong secret keys mapped to environment variables
- IAM permission issues accessing secrets

**Key Features:**
- References preflight checks to avoid repetition errors
- Copy-paste ready commands for quick diagnosis
- Decision trees for common secret injection scenarios
- Validates secret structure and IAM permissions
- Prevents secret-related deployment failures

---

#### [ECS Health Checks](./ecs-healthchecks.md)
**Purpose:** Troubleshooting ECS/ALB health check issues  
**Scope:** Container-level and target group health checks

**Use when:**
- Tasks marked UNHEALTHY despite app running correctly
- ALB target group shows persistent health check failures
- Circuit breaker triggered by false-negative health checks

---

#### [Deploy Stacks](./deploy_stacks.md)
**Purpose:** Quick reference for deploying CDK stacks  
**Scope:** CloudFormation stack deployment commands

**Use when:**
- Need quick deploy commands for specific stacks
- Reference for stack deployment order

---

## Quick Start: Troubleshooting Workflow

### 1. CloudFormation Stack in UPDATE_ROLLBACK_COMPLETE?

Start with: **[CloudFormation UPDATE_ROLLBACK_COMPLETE](./cloudformation-update-rollback-complete.md)**

```bash
# Check stack status
export STACK_NAME=Afu9EcsStack
aws cloudformation describe-stacks --stack-name ${STACK_NAME} \
  --query 'Stacks[0].StackStatus'

# Quick fix: Delete and redeploy
aws cloudformation delete-stack --stack-name ${STACK_NAME}
aws cloudformation wait stack-delete-complete --stack-name ${STACK_NAME}
npx cdk deploy ${STACK_NAME} -c domainName=afu-9.com
```

### 2. ECS Deployment Failure?

Start with: **[ECS Circuit Breaker Diagnosis](./ecs-circuit-breaker-diagnosis.md)**

```bash
# Quick automated diagnostics
export SERVICE_NAME=afu9-control-center-stage
pwsh scripts/ecs_debug.ps1 -Service ${SERVICE_NAME}
```

### 3. Health Check Issues?

See: **[ECS Health Checks](./ecs-healthchecks.md)**

```bash
# Check ALB target health
aws elbv2 describe-target-health --target-group-arn <TG_ARN>
```

### 4. Need Full Deployment Guide?

See: **[AWS Deployment Runbook](../v04/AWS_DEPLOY_RUNBOOK.md)** (Source of Truth)

---

## Related Documentation

### Core Documentation
- **[AWS Deployment Runbook](../AWS_DEPLOY_RUNBOOK.md)** - Complete staging deployment guide
- **[ECS Deployment Guide](../ECS-DEPLOYMENT.md)** - Detailed ECS deployment instructions
- **[ECS Config Reference](../ECS_CONFIG_REFERENCE.md)** - Configuration options

### Specialized Runbooks
- **[ECS Secret Injection Failures](./ecs-secret-injection.md)** - Quick diagnosis and fix for secret injection issues
- **[RUNBOOK_ECS_DEPLOY.md](../v04/RUNBOOK_ECS_DEPLOY.md)** - General ECS deployment diagnostics
- **[RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md](../v04/RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md)** - Secret-specific circuit breaker issues

### Other Operational Docs
- **[Secret Validation](../SECRET_VALIDATION.md)** - Secret structure and validation
- **[Post Deploy Verification](../POST_DEPLOY_VERIFICATION.md)** - Deployment verification steps
- **[Rollback Guide](../ROLLBACK.md)** - How to rollback failed deployments

---

## Diagnostic Scripts

### PowerShell Scripts

Located in `/scripts/`:

- **`ecs_debug.ps1`** - Comprehensive ECS diagnostics
  ```bash
  pwsh scripts/ecs_debug.ps1 -Service afu9-control-center-stage
  ```

- **`ecs_diagnose.ps1`** - Quick ECS diagnostics
  ```bash
  pwsh scripts/ecs_diagnose.ps1 -Cluster afu9-cluster -Service afu9-control-center-stage
  ```

- **`aws-auth-doctor.ps1`** - AWS authentication diagnostics
  ```bash
  pwsh scripts/aws-auth-doctor.ps1
  ```

---

## Contributing

When adding new runbooks:

1. **Follow the template:**
   - Clear objective and scope
   - Time estimates for each step
   - Copy-paste ready commands
   - Decision trees for common scenarios

2. **Include in this README:**
   - Add entry in appropriate section
   - Link to related documentation

3. **Cross-reference:**
   - Update related docs to reference new runbook
   - Add to main documentation index

---

## Support

For issues not covered in runbooks:

1. Run comprehensive diagnostics:
   ```bash
   pwsh scripts/ecs_debug.ps1 -Service <service-name> -LogLines 200
   ```

2. Export logs:
   ```bash
   aws logs tail /ecs/afu9/control-center --since 1h --region eu-central-1 > logs.txt
   ```

3. Create GitHub issue with:
   - Diagnostic output
   - Log exports
   - Steps already attempted

---

**Last Updated:** 2025-12-19  
**Maintainer:** AFU-9 Team
