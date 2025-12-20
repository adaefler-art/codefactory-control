# AFU-9 Deployment Guide (CANONICAL)

> **Source of Truth** for all AFU-9 deployment procedures (Infrastructure & Application)

This document provides the **complete deployment process** for AFU-9, covering both infrastructure (CDK) and application (ECS) deployments.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Decision Logic: When to Use Which Workflow](#decision-logic)
3. [Prerequisites & OIDC Setup](#prerequisites--oidc-setup)
4. [Infrastructure Deployment (CDK)](#infrastructure-deployment-cdk)
5. [Application Deployment (ECS)](#application-deployment-ecs)
6. [Deployment Workflows](#deployment-workflows)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

AFU-9 v0.2 uses a **separation of concerns** between infrastructure and application deployments:

### Infrastructure (CDK)
- **Purpose**: Provision and update AWS resources (VPC, ECS, RDS, ALB, IAM roles, etc.)
- **Tool**: AWS CDK (TypeScript)
- **Workflow**: `deploy-cdk-stack.yml`
- **When**: Infrastructure changes, new stacks, resource configuration updates

### Application (ECS)
- **Purpose**: Build Docker images and update running ECS services
- **Tool**: Docker + AWS ECS
- **Workflow**: `deploy-ecs.yml`
- **When**: Code changes, dependency updates, configuration changes

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Actions                          │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │ deploy-cdk-stack.yml │    │  deploy-ecs.yml          │  │
│  │ (Infrastructure)     │    │  (Application)           │  │
│  └──────────┬───────────┘    └──────────┬───────────────┘  │
│             │                           │                   │
│         AWS CDK                      Docker Build           │
└─────────────┼──────────────────────────┼───────────────────┘
              │                          │
              ▼                          ▼
    ┌─────────────────┐        ┌─────────────────┐
    │  CloudFormation │        │   Amazon ECR    │
    │   (Infrastructure)        │   (Images)      │
    └─────────┬───────┘        └─────────┬───────┘
              │                          │
              ▼                          ▼
    ┌──────────────────────────────────────────┐
    │           AWS Infrastructure              │
    │  VPC │ ALB │ ECS │ RDS │ Secrets │ IAM   │
    └──────────────────────────────────────────┘
```

### Multi-Environment Support

Both staging and production environments share infrastructure but run separate ECS services:

```
Route53 DNS
  ├─ stage.afu-9.com → ALB → ECS Stage Service (afu9-control-center-stage)
  ├─ prod.afu-9.com  → ALB → ECS Prod Service (afu9-control-center-prod)
  └─ afu-9.com       → Redirect to prod

Shared Resources:
  - VPC & Networking (Afu9NetworkStack)
  - RDS Database (Afu9DatabaseStack)
  - ALB & Target Groups (Afu9NetworkStack)
  - ECR Repositories
  - IAM Roles (Afu9IamStack)

Environment-Specific Resources:
  - ECS Services (stage vs prod)
  - Task Definitions (stage-tagged vs prod-tagged images)
  - CloudWatch Alarms (Afu9AlarmsStack)
```

---

## Decision Logic

### When to Use CDK Deployment (`deploy-cdk-stack.yml`)

Use the CDK workflow when you need to:
- ✅ Create new infrastructure stacks
- ✅ Update VPC, subnets, security groups
- ✅ Modify IAM roles or policies
- ✅ Change RDS configuration (instance type, storage)
- ✅ Update ALB settings or target groups
- ✅ Add/remove CloudWatch alarms
- ✅ Change ECS cluster settings (NOT task definitions)

**Examples:**
- Adding a new RDS read replica
- Updating security group rules
- Deploying a new CloudWatch alarm
- Changing ECS task CPU/memory limits

### When to Use ECS Deployment (`deploy-ecs.yml`)

Use the ECS workflow when you need to:
- ✅ Deploy code changes (Control Center or MCP servers)
- ✅ Update Docker images
- ✅ Update environment variables in task definitions
- ✅ Deploy new application versions
- ✅ Roll back to a previous version

**Examples:**
- Fixing a bug in Control Center
- Updating an MCP server
- Adding a new feature to the application
- Rolling back after a failed deployment

### Decision Tree

```
Do you need to change AWS resources (IAM, VPC, RDS, etc.)?
├─ YES → Use deploy-cdk-stack.yml (Infrastructure)
│   └─ Run with diff gate enabled
│      └─ Review changes carefully
│         └─ Deploy with approval
│
└─ NO → Are you deploying code changes?
    ├─ YES → Use deploy-ecs.yml (Application)
    │   ├─ Staging: Auto-deploys on push to main
    │   └─ Production: Manual workflow_dispatch
    │
    └─ NO → No deployment needed
```

---

## Prerequisites & OIDC Setup

### Required Tools

- **AWS CLI** (configured with appropriate credentials)
- **Node.js** 18+ and npm
- **Docker** (for local builds)
- **AWS CDK** (installed via npm)
- **GitHub Account** with repository access

### AWS OIDC Authentication

AFU-9 uses **GitHub OIDC** (OpenID Connect) for secure, credential-less authentication to AWS.

#### How It Works

```
GitHub Action
  └─ Requests OIDC token from GitHub
     └─ AWS validates token
        └─ AssumeRole with Web Identity
           └─ Returns temporary credentials
              └─ Deploy to AWS
```

#### Setup Requirements

1. **GitHub OIDC Provider in AWS** (already configured)
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

2. **IAM Role with Trust Policy** (configured in `AWS_DEPLOY_ROLE_ARN` secret)
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:adaefler-art/codefactory-control:*"
           }
         }
       }
     ]
   }
   ```

3. **GitHub Repository Secret** (already configured)
   - `AWS_DEPLOY_ROLE_ARN`: Full ARN of the IAM role to assume

#### Verification

Both canonical workflows include an OIDC verification step:

```bash
aws sts get-caller-identity
```

This command:
- ✅ Confirms OIDC authentication succeeded
- ✅ Shows the assumed role ARN
- ✅ Displays AWS account ID
- ✅ Provides early failure if credentials are invalid

**Expected Output:**
```json
{
  "UserId": "AROA...:GitHubActions-...",
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/GitHubActionsDeployRole/..."
}
```

---

## Infrastructure Deployment (CDK)

### Available Stacks

| Stack Name | Purpose | Dependencies |
|------------|---------|--------------|
| `Afu9NetworkStack` | VPC, ALB, Target Groups | None |
| `Afu9DatabaseStack` | RDS Postgres | NetworkStack |
| `Afu9IamStack` | IAM roles for ECS tasks | None |
| `Afu9EcsStack` | ECS cluster, services, task definitions | NetworkStack, DatabaseStack, IamStack |
| `Afu9AlarmsStack` | CloudWatch alarms and SNS topics | EcsStack, DatabaseStack |
| `Afu9DeployMemoryStack` | Deploy memory storage | None |

### Deployment Order

```
1. Afu9NetworkStack     (VPC, ALB)
2. Afu9DatabaseStack    (RDS)
3. Afu9IamStack         (IAM roles)
4. Afu9EcsStack         (ECS cluster & services)
5. Afu9AlarmsStack      (Monitoring)
6. Afu9DeployMemoryStack (Optional)
```

### Step-by-Step: Deploy Infrastructure

#### 1. Using GitHub Actions (Recommended)

1. Navigate to **Actions** → **Deploy CDK Stack with Diff Gate**
2. Click **Run workflow**
3. Select parameters:
   - **Stack**: Choose from available stacks
   - **Environment**: `staging` or `production`
   - **Enable HTTPS**: `true` (if DNS is configured)
   - **Skip Diff Gate**: `false` (recommended)
4. Click **Run workflow**
5. Monitor the workflow run
6. Review the diff output
7. Approve if changes are expected

#### 2. Using Local CDK CLI

**Bootstrap (First Time Only):**
```bash
npx cdk bootstrap
```

**Deploy a Specific Stack:**
```bash
# Install dependencies
npm install

# Build CDK project
npm run build

# Validate secrets (required)
npm run validate-secrets

# Review changes with diff
npx cdk diff Afu9NetworkStack \
  --context environment=staging \
  --context afu9-enable-https=false

# Deploy stack
npx cdk deploy Afu9NetworkStack \
  --context environment=staging \
  --context afu9-enable-https=false \
  --require-approval never
```

**Deploy All Stacks:**
```bash
npx cdk deploy --all \
  --context environment=staging \
  --context afu9-enable-https=false
```

### Context Keys Reference

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `environment` | `staging`, `production` | `staging` | Deployment environment |
| `afu9-enable-https` | `true`, `false` | `false` | Enable HTTPS with ACM certificate |
| `afu9-domain` | Domain name | - | Base domain for Route53 |
| `afu9-multi-env` | `true`, `false` | `false` | Enable multi-environment mode |

See [CONTEXT_KEYS_REFERENCE.md](CONTEXT_KEYS_REFERENCE.md) for complete details.

### Diff Gate Validation

The CDK workflow includes a **diff gate** that blocks deployments with unexpected changes:

**Blocking Changes:**
- IAM policy modifications
- Security group rule changes
- Database deletions or replacements
- Load balancer modifications

**Non-Blocking Changes:**
- Task definition updates
- Environment variable changes
- Log configuration updates

**Override (Not Recommended):**
Set `skip_diff_gate: true` only for emergency deployments.

---

## Application Deployment (ECS)

### Deployment Strategy

AFU-9 uses **environment-specific Docker image tags** for isolation:

```
Staging:  stage-{git-sha}, stage-{timestamp}, stage-latest
Production: prod-{git-sha}, prod-{timestamp}, prod-latest
```

**Primary Tag:** `{env}-{git-sha}` (deterministic, reproducible)  
**Supplementary Tag:** `{env}-{timestamp}` (human-readable)  
**Latest Tag:** `{env}-latest` (convenience)

### Step-by-Step: Deploy Application

#### 1. Staging Deployment (Automatic)

Staging deploys **automatically** on push to `main` branch:

```bash
# Make your changes
git add .
git commit -m "Fix: Update Control Center UI"
git push origin main

# GitHub Actions will automatically:
# 1. Build Docker images
# 2. Push to ECR with stage-* tags
# 3. Update ECS service
# 4. Run post-deployment verification
```

#### 2. Production Deployment (Manual)

Production requires **manual approval**:

1. Navigate to **Actions** → **Deploy AFU-9 to ECS**
2. Click **Run workflow**
3. Select:
   - **Environment**: `production`
4. Click **Run workflow**
5. Monitor deployment progress
6. Verify health endpoints after completion

#### 3. Local Build (Testing Only)

```bash
# Build Control Center image
cd control-center
docker build -t afu9-control-center:local .

# Build MCP GitHub Server
cd ../mcp-servers/github
docker build -t afu9-mcp-github:local .

# Test locally with docker-compose
cd ../..
docker-compose up
```

### Deployment Verification

After deployment, the workflow automatically verifies:

✅ **ECS Service Events** (no Circuit Breaker failures)  
✅ **ALB Target Health** (all targets healthy)  
✅ **Service Stability** (desired task count reached)  
✅ **Health Endpoint** (`/api/health` returns 200)  
✅ **Readiness Endpoint** (`/api/ready` returns 200)

### Rollback Procedures

See [ROLLBACK.md](ROLLBACK.md) for detailed rollback instructions.

**Quick Rollback:**
```bash
# Find previous working image tag
aws ecr describe-images \
  --repository-name afu9/control-center \
  --query 'sort_by(imageDetails,& imagePushedAt)[-10:]'

# Update service to previous tag
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center-prod \
  --task-definition <previous-task-def-arn>
```

---

## Deployment Workflows

### Workflow: `deploy-cdk-stack.yml`

**Purpose:** Deploy infrastructure changes via AWS CDK

**Triggers:**
- Manual (`workflow_dispatch`)

**Inputs:**
- `stack_name` (required): CDK stack to deploy
- `environment` (required): `staging` or `production`
- `enable_https` (optional): Enable HTTPS
- `skip_diff_gate` (optional): Skip diff validation

**Workflow Steps:**
1. Checkout code
2. Configure AWS credentials (OIDC)
3. Verify OIDC authentication (`aws sts get-caller-identity`)
4. Setup Node.js
5. Install dependencies
6. Build CDK project
7. Run diff gate validation (unless skipped)
8. Deploy CDK stack
9. Verify deployment (CloudFormation status)
10. Get stack outputs

**When to Use:**
- Deploying new stacks
- Updating infrastructure resources
- Modifying IAM roles or security groups

### Workflow: `deploy-ecs.yml`

**Purpose:** Build and deploy application Docker images to ECS

**Triggers:**
- Manual (`workflow_dispatch`) for production
- Automatic (`push` to `main`) for staging

**Inputs (Manual):**
- `environment` (required): `staging` or `production`

**Workflow Steps:**
1. Checkout code
2. Set deployment variables (environment-specific)
3. Configure AWS credentials (OIDC)
4. Verify OIDC authentication (`aws sts get-caller-identity`)
5. Setup Node.js
6. Install dependencies
7. Validate AWS Secrets Manager secrets
8. Login to Amazon ECR
9. Build and push Docker images (4 images):
   - Control Center
   - MCP GitHub Server
   - MCP Deploy Server
   - MCP Observability Server
10. Create new task definition with environment tags
11. Check deployment verdict gate
12. Update ECS service
13. Wait for service stability
14. Get service status
15. Run post-deployment verification

**When to Use:**
- Deploying code changes
- Updating application versions
- Rolling back to a previous version

---

## Troubleshooting

### Common Issues

#### 1. "Could not load credentials from any providers"

**Symptom:**
```
Error: Could not load credentials from any providers
```

**Causes:**
- OIDC authentication failed
- Invalid `AWS_DEPLOY_ROLE_ARN` secret
- Trust policy misconfiguration

**Solutions:**

1. **Verify OIDC Provider Exists:**
   ```bash
   aws iam list-open-id-connect-providers
   # Should show: arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
   ```

2. **Check Trust Policy:**
   ```bash
   aws iam get-role --role-name GitHubActionsDeployRole
   # Verify "aud": "sts.amazonaws.com"
   # Verify "sub" matches repo pattern
   ```

3. **Verify GitHub Secret:**
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Ensure `AWS_DEPLOY_ROLE_ARN` exists and is correct
   - Format: `arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME`

4. **Check Workflow Permissions:**
   ```yaml
   permissions:
     id-token: write  # Required for OIDC
     contents: read
   ```

#### 2. "Stack is in UPDATE_ROLLBACK_COMPLETE state"

**Symptom:**
```
Stack is in UPDATE_ROLLBACK_COMPLETE state and can not be updated
```

**Causes:**
- Previous CDK deployment failed
- Stack is in a terminal state

**Solutions:**

1. **Delete the failed stack:**
   ```bash
   aws cloudformation delete-stack --stack-name Afu9EcsStack
   ```

2. **Re-deploy the stack:**
   ```bash
   npx cdk deploy Afu9EcsStack --context environment=staging
   ```

#### 3. "Diff gate BLOCKED - Contains blocking changes"

**Symptom:**
```
❌ Diff gate BLOCKED - Contains blocking changes
```

**Causes:**
- CDK changes include IAM, security group, or database modifications
- Unexpected infrastructure changes

**Solutions:**

1. **Review the diff output carefully**
2. **Verify changes are intentional**
3. **Get approval from team lead**
4. **Override only if emergency:**
   - Re-run workflow with `skip_diff_gate: true`

#### 4. "Secret validation failed"

**Symptom:**
```
❌ Secret validation failed: Missing required keys
```

**Causes:**
- Required secrets missing in AWS Secrets Manager
- Secret keys not configured

**Solutions:**

1. **Check which secrets are missing:**
   ```bash
   npm run validate-secrets
   ```

2. **Add missing secrets:**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id afu9/github \
     --secret-string '{"GITHUB_TOKEN":"ghp_..."}'
   ```

3. **See [SECRET_VALIDATION.md](SECRET_VALIDATION.md) for details**

#### 5. "ECS Circuit Breaker triggered"

**Symptom:**
```
ECS deployment circuit breaker has triggered a rollback
```

**Causes:**
- Container health checks failing
- Application failing to start
- Missing environment variables

**Solutions:**

1. **Check ECS service events:**
   ```bash
   aws ecs describe-services \
     --cluster afu9-cluster \
     --services afu9-control-center-stage \
     --query 'services[0].events[0:10]'
   ```

2. **Check container logs:**
   ```bash
   aws logs tail /ecs/afu9-control-center --follow
   ```

3. **Verify health endpoints:**
   ```bash
   curl http://ALB_DNS/api/health
   curl http://ALB_DNS/api/ready
   ```

4. **See [RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md](RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md)**

#### 6. "Task failed to start"

**Symptom:**
```
Task failed to start: CannotPullContainerError
```

**Causes:**
- ECR image not found
- IAM permissions missing for ECR pull
- Image tag doesn't exist

**Solutions:**

1. **Verify image exists:**
   ```bash
   aws ecr describe-images \
     --repository-name afu9/control-center \
     --image-ids imageTag=stage-latest
   ```

2. **Check ECR permissions:**
   ```bash
   aws ecr get-repository-policy \
     --repository-name afu9/control-center
   ```

3. **Rebuild and push image:**
   - Re-run the `deploy-ecs.yml` workflow

#### 7. "Verdict gate blocked deployment"

**Symptom:**
```
❌ Deployment blocked by verdict gate: Verdict is RED
```

**Causes:**
- `DEPLOYMENT_VERDICT` repository variable is not `GREEN`
- Safety gate preventing deployment

**Solutions:**

1. **Check current verdict:**
   - Go to **Settings** → **Variables** → **Actions**
   - Check `DEPLOYMENT_VERDICT` value

2. **Update verdict (with approval):**
   - Only update after verifying system health
   - Set to `GREEN` to allow deployment

3. **See [VERDICT_TYPES.md](VERDICT_TYPES.md) for details**

### Diagnostic Commands

**Check AWS Authentication:**
```bash
aws sts get-caller-identity
```

**Check CloudFormation Stack Status:**
```bash
aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].StackStatus'
```

**Check ECS Service Status:**
```bash
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-stage \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}'
```

**Check ALB Target Health:**
```bash
aws elbv2 describe-target-health \
  --target-group-arn <target-group-arn>
```

**Check Recent Container Logs:**
```bash
aws logs tail /ecs/afu9-control-center --follow --since 10m
```

### Getting Help

- **Issue Tracking:** GitHub Issues in `adaefler-art/codefactory-control`
- **Documentation:**
  - [AWS_DEPLOY_RUNBOOK.md](AWS_DEPLOY_RUNBOOK.md) - Detailed staging deployment runbook
  - [ECS-DEPLOYMENT.md](ECS-DEPLOYMENT.md) - ECS-specific deployment details
  - [SECURITY-IAM.md](SECURITY-IAM.md) - IAM and security configuration
  - [ROLLBACK.md](ROLLBACK.md) - Rollback procedures
- **Runbooks:**
  - [RUNBOOK_ECS_DEPLOY.md](RUNBOOK_ECS_DEPLOY.md)
  - [RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md](RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md)

---

## Summary

### Key Points

✅ **Two Canonical Workflows:**
- `deploy-cdk-stack.yml` for infrastructure
- `deploy-ecs.yml` for application

✅ **OIDC Authentication:**
- No long-lived credentials
- Secure, auditable access
- Verified with `aws sts get-caller-identity`

✅ **Multi-Environment Support:**
- Staging: Auto-deploy on main
- Production: Manual approval required

✅ **Safety Gates:**
- CDK diff gate for infrastructure changes
- Secret validation before deployment
- Deployment verdict gate
- Post-deployment verification

✅ **Clear Decision Logic:**
- Infrastructure changes → CDK workflow
- Code changes → ECS workflow

### Next Steps

1. **Review Prerequisites** and ensure OIDC is configured
2. **Choose the right workflow** based on your change type
3. **Follow step-by-step instructions** for your deployment
4. **Verify deployment** using health endpoints
5. **Monitor CloudWatch** alarms and logs

---

**Last Updated:** 2025-12-20  
**Version:** 1.0.0  
**Maintainers:** AFU-9 Team
