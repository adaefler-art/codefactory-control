# ECS Secret Injection Failures — Diagnostic Runbook

**ID:** I-05-02-RUNBOOK-SECRETS  
**Purpose:** Diagnose and fix ECS secret injection failures (missing keys, incorrect mapping)  
**Time to Resolution:** < 5 minutes

---

## Overview

This runbook addresses **ECS Secret Injection Failures** — when ECS tasks fail to start because AWS Secrets Manager secrets are missing, have incorrect structure, or fail to be injected into containers.

### When to Use This Runbook

- ✅ ECS tasks fail with `ResourceInitializationError: unable to pull secrets`
- ✅ Container logs show missing environment variables from secrets
- ✅ Secret exists but tasks still fail to start
- ✅ Wrong secret keys mapped to environment variables
- ✅ IAM permission issues accessing secrets

### Quick Start: Is This a Secret Injection Issue?

**Step 1: Check stopped task reason**
```bash
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage

TASK_ARN=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region eu-central-1 \
  --query 'taskArns[0]' \
  --output text)

aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region eu-central-1 \
  --query 'tasks[0].stoppedReason' \
  --output text
```

**If output contains:**
- `ResourceInitializationError: unable to pull secrets` → ✅ **This runbook applies**
- `unable to retrieve secret from asm` → ✅ **This runbook applies**
- `ResourceNotFoundException` → ✅ **Secret missing - this runbook applies**
- `AccessDeniedException` → ✅ **IAM issue - this runbook applies**
- Something else → ❌ Use [ECS Circuit Breaker Diagnosis](./ecs-circuit-breaker-diagnosis.md)

---

## Quick Reference: Common Scenarios

| Symptom | Root Cause | Fix | Time |
|---------|-----------|-----|------|
| `ResourceInitializationError: unable to pull secrets` | Secret doesn't exist | [Create secret](#fix-1-create-missing-secret) | 2 min |
| `Secret ... can't find the specified secret` | Secret name mismatch | [Verify secret names](#fix-2-verify-secret-names) | 1 min |
| `Container exited with Environment variable ... not set` | Missing key in secret | [Add missing keys](#fix-3-add-missing-secret-keys) | 2 min |
| `AccessDeniedException` | Task execution role missing permissions | [Fix IAM permissions](#fix-4-iam-permissions) | 3 min |
| Secret exists but wrong structure | Keys don't match expected names | [Validate secret structure](#fix-5-validate-secret-structure) | 2 min |

---

## Prevention: Preflight Checks

**⚠️ Prevent these issues before deployment with preflight validation:**

AFU-9 includes **automatic secret validation** that catches these issues at build time:

```bash
# Validate secrets before deployment
npm run validate-secrets

# Or use automatic validation during build/synth
npm run build    # Validates secrets before TypeScript compilation
npm run synth    # Validates secrets before CDK synthesis
```

**See also:**
- [Secret Preflight Verification](../v04/SECRET_PREFLIGHT_VERIFICATION.md) - Comprehensive preflight check documentation
- [Secret Validation](../v04/SECRET_VALIDATION.md) - Secret structure requirements and validation

**Key benefits of preflight checks:**
- ✅ Catches missing secrets before deployment
- ✅ Validates all required keys exist
- ✅ Prevents deployment with invalid secrets
- ✅ Clear error messages with exact secret name and missing keys

---

## Diagnostic Flow

```
ECS Task Failed to Start
    ↓
Check Stopped Task Reason
    ↓
┌─────────────────────────────────────┐
│ ResourceInitializationError?        │
│ "unable to pull secrets"            │
└────────────┬────────────────────────┘
             │
             ▼
    Step 1: Verify Secret Exists
             │
             ├─ Missing → Create Secret
             ├─ Exists → Step 2
             │
             ▼
    Step 2: Validate Secret Structure
             │
             ├─ Missing Keys → Add Keys
             ├─ Valid → Step 3
             │
             ▼
    Step 3: Check IAM Permissions
             │
             ├─ Missing Perms → Fix IAM
             ├─ Valid → Step 4
             │
             ▼
    Step 4: Verify Secret Mapping
             │
             └─ Fix Mapping → Force Redeploy
```

---

## Step-by-Step Diagnostics

### Environment Setup

```bash
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage  # or afu9-control-center-prod
export ECS_STACK_NAME=Afu9EcsStack
```

---

### Step 1: Verify Secrets Exist

**Check if all required secrets exist:**

```bash
# Check GitHub secret
aws secretsmanager describe-secret \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessed:LastAccessedDate}' \
  --output table 2>&1 || echo "❌ afu9/github NOT FOUND"

# Check LLM secret
aws secretsmanager describe-secret \
  --secret-id afu9/llm \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessed:LastAccessedDate}' \
  --output table 2>&1 || echo "❌ afu9/llm NOT FOUND"

# Check Database secret (only if database enabled)
aws secretsmanager describe-secret \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessed:LastAccessedDate}' \
  --output table 2>&1 || echo "❌ afu9/database NOT FOUND"
```

**Expected:** All secrets should return table output with Name, ARN, and LastAccessed date.

**If any secret is missing:**
- → Go to [Fix 1: Create Missing Secret](#fix-1-create-missing-secret)

---

### Step 2: Validate Secret Structure

**Use the built-in preflight validation:**

```bash
npm run validate-secrets
```

This automatically validates:
- **afu9/github**: Requires `token`, `owner`, `repo`
- **afu9/database**: Requires `host`, `port`, `database`, `username`, `password`
- **afu9/llm**: Optional keys (no required keys)

**Example output when valid:**
```
✓ database secret validation passed
✓ github secret validation passed
✓ llm secret validation passed

✓ All secrets validated successfully!
```

**Example output when invalid:**
```
✗ database secret validation failed: Secret afu9/database is missing required keys: password

Missing keys: password
```

**Manual validation (alternative):**

```bash
# Validate GitHub secret structure
aws secretsmanager get-secret-value \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("token", "owner", "repo")'

# Expected: true

# Validate Database secret structure
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("host", "port", "database", "username", "password")'

# Expected: true
```

**If validation fails:**
- → Go to [Fix 3: Add Missing Secret Keys](#fix-3-add-missing-secret-keys)

---

### Step 3: Check IAM Permissions

**Verify Task Execution Role has secret access:**

```bash
# Get Task Execution Role ARN
TASK_EXEC_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${ECS_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`].OutputValue' \
  --output text)

TASK_EXEC_ROLE_NAME=$(echo ${TASK_EXEC_ROLE_ARN} | awk -F'/' '{print $NF}')

echo "Task Execution Role: ${TASK_EXEC_ROLE_NAME}"

# List attached policies
aws iam list-attached-role-policies \
  --role-name ${TASK_EXEC_ROLE_NAME} \
  --region ${AWS_REGION} \
  --output table

# List inline policies
aws iam list-role-policies \
  --role-name ${TASK_EXEC_ROLE_NAME} \
  --region ${AWS_REGION} \
  --output table
```

**Expected policies:**
- `AmazonECSTaskExecutionRolePolicy` (AWS managed)
- Or a custom policy with `secretsmanager:GetSecretValue` on `afu9/*` secrets

**If IAM permissions are missing:**
- → Go to [Fix 4: IAM Permissions](#fix-4-iam-permissions)

---

### Step 4: Verify Secret-to-Environment Mapping

**Check how secrets are mapped in Task Definition:**

```bash
# Get current task definition
SERVICE_TASK_DEF=$(aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].taskDefinition' \
  --output text)

# View secrets configuration
aws ecs describe-task-definition \
  --task-definition ${SERVICE_TASK_DEF} \
  --region ${AWS_REGION} \
  --query 'taskDefinition.containerDefinitions[0].secrets' \
  --output json | jq .
```

**Expected output:**
```json
[
  {
    "name": "GITHUB_TOKEN",
    "valueFrom": "arn:aws:secretsmanager:eu-central-1:...:secret:afu9/github:token::"
  },
  {
    "name": "DATABASE_HOST",
    "valueFrom": "arn:aws:secretsmanager:eu-central-1:...:secret:afu9/database:host::"
  },
  ...
]
```

**Check for common issues:**
- ❌ Wrong secret ARN
- ❌ Wrong key name (e.g., `:dbname::` instead of `:database::`)
- ❌ Missing required secret mapping

**If mapping is incorrect:**
- → Update CDK code and redeploy
- → Or use [Fix 5: Validate Secret Structure](#fix-5-validate-secret-structure)

---

## Fixes

### Fix 1: Create Missing Secret

#### For afu9/github

```bash
aws secretsmanager create-secret \
  --name afu9/github \
  --secret-string '{
    "token": "<YOUR_GITHUB_TOKEN>",
    "owner": "adaefler-art",
    "repo": "codefactory-control"
  }' \
  --region ${AWS_REGION}

# Force new ECS deployment to pick up the secret
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

#### For afu9/llm

```bash
aws secretsmanager create-secret \
  --name afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-YOUR_OPENAI_KEY",
    "anthropic_api_key": "sk-ant-YOUR_ANTHROPIC_KEY",
    "deepseek_api_key": "YOUR_DEEPSEEK_KEY"
  }' \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

#### For afu9/database

**⚠️ Only create if database is enabled (`enableDatabase=true`)**

```bash
# Get RDS endpoint from Database Stack
export DATABASE_STACK_NAME=Afu9DatabaseStack

RDS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${DATABASE_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbEndpoint`].OutputValue' \
  --output text)

# Get credentials from RDS master secret
RDS_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${DATABASE_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbSecretArn`].OutputValue' \
  --output text)

RDS_CREDENTIALS=$(aws secretsmanager get-secret-value \
  --secret-id ${RDS_SECRET_ARN} \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text)

DB_USERNAME=$(echo $RDS_CREDENTIALS | jq -r '.username')
DB_PASSWORD=$(echo $RDS_CREDENTIALS | jq -r '.password')

# Create application database secret
aws secretsmanager create-secret \
  --name afu9/database \
  --secret-string "{
    \"host\": \"${RDS_ENDPOINT}\",
    \"port\": \"5432\",
    \"database\": \"afu9\",
    \"username\": \"${DB_USERNAME}\",
    \"password\": \"${DB_PASSWORD}\"
  }" \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

---

### Fix 2: Verify Secret Names

**Check that secret names match exactly:**

Required secret names:
- `afu9/github` (NOT `afu9-github` or `github`)
- `afu9/llm` (NOT `afu9-llm` or `llm`)
- `afu9/database` (NOT `afu9-database` or `database`)

**List all secrets with prefix:**
```bash
aws secretsmanager list-secrets \
  --region ${AWS_REGION} \
  --query 'SecretList[?starts_with(Name, `afu9`)].Name' \
  --output table
```

**If names don't match, rename or create new secrets with correct names.**

---

### Fix 3: Add Missing Secret Keys

**For afu9/github:**

Required keys: `token`, `owner`, `repo`

```bash
# Update secret with all required keys
aws secretsmanager update-secret \
  --secret-id afu9/github \
  --secret-string '{
    "token": "<YOUR_GITHUB_TOKEN>",
    "owner": "adaefler-art",
    "repo": "codefactory-control"
  }' \
  --region ${AWS_REGION}
```

**For afu9/database:**

Required keys: `host`, `port`, `database`, `username`, `password`

**⚠️ Important:** The key is `database`, NOT `dbname`

```bash
# Get current secret value
CURRENT_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text)

echo "Current secret:"
echo $CURRENT_SECRET | jq .

# Update with missing keys (example: adding 'password')
aws secretsmanager update-secret \
  --secret-id afu9/database \
  --secret-string '{
    "host": "your-rds-endpoint.eu-central-1.rds.amazonaws.com",
    "port": "5432",
    "database": "afu9",
    "username": "afu9_admin",
    "password": "YOUR_SECURE_PASSWORD"
  }' \
  --region ${AWS_REGION}
```

**After updating secrets, force new deployment:**

```bash
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}

# Wait for service to stabilize
aws ecs wait services-stable \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION}
```

---

### Fix 4: IAM Permissions

**If Task Execution Role is missing secret access:**

**Option A: Redeploy ECS Stack (Recommended)**

The ECS stack should automatically create the correct IAM policies.

```bash
npx cdk deploy Afu9EcsStack --region ${AWS_REGION}
```

**Option B: Manually Add IAM Policy**

```bash
# Create policy document
cat > /tmp/secrets-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:eu-central-1:*:secret:afu9/*"
      ]
    }
  ]
}
EOF

# Attach inline policy to Task Execution Role
TASK_EXEC_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${ECS_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`].OutputValue' \
  --output text)

TASK_EXEC_ROLE_NAME=$(echo ${TASK_EXEC_ROLE_ARN} | awk -F'/' '{print $NF}')

aws iam put-role-policy \
  --role-name ${TASK_EXEC_ROLE_NAME} \
  --policy-name Afu9SecretsAccess \
  --policy-document file:///tmp/secrets-policy.json \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

---

### Fix 5: Validate Secret Structure

**Common key name mistakes:**

| Wrong Key | Correct Key | Secret |
|-----------|-------------|--------|
| `dbname` | `database` | afu9/database |
| `github_token` | `token` | afu9/github |
| `repository` | `repo` | afu9/github |
| `org` | `owner` | afu9/github |

**Validate and fix:**

```bash
# Show current keys
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'keys'

# Expected for afu9/database:
# ["database", "host", "password", "port", "username"]

# If keys are wrong, update the secret with correct structure
# (See Fix 3 for update commands)
```

---

## Verification

After applying fixes, verify the deployment:

```bash
# 1. Check service status
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{runningCount:runningCount,desiredCount:desiredCount,status:status}'

# Expected: runningCount == desiredCount

# 2. Check latest events
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[:5]' \
  --output table

# Expected: "has reached a steady state"

# 3. Verify no stopped tasks with secret errors
TASK_ARN=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --query 'taskArns[0]' \
  --output text)

if [ "${TASK_ARN}" != "None" ]; then
  aws ecs describe-tasks \
    --cluster ${CLUSTER_NAME} \
    --tasks ${TASK_ARN} \
    --region ${AWS_REGION} \
    --query 'tasks[0].stoppedReason' \
    --output text
fi

# Expected: Should NOT contain "ResourceInitializationError"
```

---

## Prevention: Best Practices

### 1. Always Use Preflight Checks

**Before every deployment:**

```bash
npm run validate-secrets
```

This catches:
- Missing secrets
- Missing keys
- Invalid secret structure

### 2. Use CDK Context for Database Toggle

**If database is not needed:**

```bash
npx cdk deploy Afu9EcsStack \
  -c afu9-enable-database=false \
  --region ${AWS_REGION}
```

This prevents database secret errors when database is not configured.

### 3. Document Secret Requirements

Keep secret requirements in sync:
- [Secret Validation Documentation](../v04/SECRET_VALIDATION.md)
- [Secret Preflight Verification](../v04/SECRET_PREFLIGHT_VERIFICATION.md)

### 4. Use Secret Rotation Safely

When rotating secrets:
1. Validate new secret structure matches old structure
2. Use `npm run validate-secrets` before applying rotation
3. Test in staging before production

### 5. Monitor Secret Access

Check `LastAccessedDate` in Secrets Manager to verify secrets are being used:

```bash
aws secretsmanager describe-secret \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query 'LastAccessedDate' \
  --output text
```

---

## Troubleshooting Matrix

| Error Message | Cause | Fix | Prevention |
|--------------|-------|-----|------------|
| `ResourceInitializationError: unable to pull secrets` | Secret doesn't exist or wrong name | [Fix 1](#fix-1-create-missing-secret) | Preflight check |
| `ResourceNotFoundException: Secrets Manager can't find` | Secret name mismatch | [Fix 2](#fix-2-verify-secret-names) | Preflight check |
| `Environment variable DATABASE_HOST is not set` | Missing key in secret | [Fix 3](#fix-3-add-missing-secret-keys) | Preflight check |
| `AccessDeniedException` | IAM role missing permissions | [Fix 4](#fix-4-iam-permissions) | CDK deployment |
| `password authentication failed` | Wrong password in secret | Update password in secret | Manual verification |
| `getaddrinfo ENOTFOUND null` | Key exists but value is null | Update secret with valid value | Preflight check |

---

## Related Documentation

### Core Documentation
- **[Secret Preflight Verification](../v04/SECRET_PREFLIGHT_VERIFICATION.md)** - Automatic validation before deployment
- **[Secret Validation](../v04/SECRET_VALIDATION.md)** - Secret structure requirements and validation tools
- **[ECS Circuit Breaker Diagnosis](./ecs-circuit-breaker-diagnosis.md)** - General ECS troubleshooting
- **[ECS Circuit Breaker: Secrets](../v04/RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md)** - Detailed secret-specific diagnostics

### Deployment Guides
- **[AWS Deployment Runbook](../v04/AWS_DEPLOY_RUNBOOK.md)** - Complete deployment guide
- **[ECS Deployment](../v04/ECS-DEPLOYMENT.md)** - ECS-specific deployment steps
- **[CloudFormation UPDATE_ROLLBACK_COMPLETE](./cloudformation-update-rollback-complete.md)** - Recovery from failed deployments

---

## Quick Commands Cheat Sheet

```bash
# Validate all secrets
npm run validate-secrets

# List all afu9 secrets
aws secretsmanager list-secrets \
  --query 'SecretList[?starts_with(Name, `afu9`)].Name' \
  --output table

# Check stopped task reason
TASK_ARN=$(aws ecs list-tasks --cluster afu9-cluster \
  --service-name afu9-control-center-stage --desired-status STOPPED \
  --query 'taskArns[0]' --output text) && \
aws ecs describe-tasks --cluster afu9-cluster --tasks ${TASK_ARN} \
  --query 'tasks[0].stoppedReason' --output text

# Force new deployment
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center-stage \
  --force-new-deployment

# Watch service stabilization
aws ecs wait services-stable \
  --cluster afu9-cluster \
  --services afu9-control-center-stage
```

---

**Version:** 1.0  
**Last Updated:** 2025-12-20  
**Maintainer:** AFU-9 Team  
**Issue ID:** I-05-02-RUNBOOK-SECRETS
