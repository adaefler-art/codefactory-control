# AFU-9 ECS Configuration Reference

This document describes all configuration options for deploying AFU-9 ECS infrastructure.

## Overview

AFU-9 ECS deployment supports deterministic configuration through CDK context variables and stack props. All configuration options are validated at synth time to fail fast with clear error messages.

## Configuration Methods

Configuration can be provided through:

1. **CDK Context** (via `-c` flag or `cdk.context.json`)
2. **Stack Props** (programmatically in `bin/codefactory-control.ts`)
3. **Environment Variables** (at runtime in containers)

---

## CDK Context Variables

### Core Settings

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `afu9-enable-https` | boolean | `true` | Enable HTTPS and DNS stack deployment |
| `afu9-enable-database` | boolean | `true` | Enable database integration (secrets, IAM grants, env vars) |
| `afu9-multi-env` | boolean | `false` | Enable multi-environment deployment (stage + prod) |
| `environment` | string | `'stage'` | Environment name: `stage`, `prod`, or `legacy` |

### DNS Configuration (when `afu9-enable-https=true`)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `domainName` | string | *(required)* | Fully qualified domain name (e.g., `afu-9.com`) |
| `afu9-hosted-zone-id` | string | *(optional)* | Existing Route53 hosted zone ID |
| `afu9-hosted-zone-name` | string | *(optional)* | Existing hosted zone name (required if ID provided) |

### Database Configuration (when `afu9-enable-database=true`)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `dbSecretArn` | string | *(auto from stack)* | ARN of database connection secret |
| `multiAz` | boolean | `false` (stage), `true` (prod) | Enable Multi-AZ database deployment |

### Monitoring Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `afu9-alarm-email` | string | *(optional)* | Email address for CloudWatch alarm notifications |
| `afu9-webhook-url` | string | *(optional)* | Webhook URL for alarm notifications |

### GitHub Actions Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `github-org` | string | `'adaefler-art'` | GitHub organization name |
| `github-repo` | string | `'codefactory-control'` | GitHub repository name |

---

## Stack Props (Afu9EcsStack)

### Required Props

| Prop | Type | Description |
|------|------|-------------|
| `vpc` | `ec2.Vpc` | VPC to deploy ECS tasks in |
| `ecsSecurityGroup` | `ec2.SecurityGroup` | Security group for ECS tasks |
| `targetGroup` | `elbv2.ApplicationTargetGroup` | Target group to attach ECS service to |

### Optional Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `enableDatabase` | boolean | `true` | Enable database integration |
| `dbSecretArn` | string | *(required if enableDatabase=true)* | ARN of database connection secret |
| `imageTag` | string | `'staging-latest'` | Docker image tag for deployment |
| `environment` | string | `'stage'` | Environment name: `stage`, `prod`, or `legacy` |
| `desiredCount` | number | `1` (stage), `2` (prod) | Desired number of ECS tasks |
| `cpu` | number | `1024` | CPU units (1024 = 1 vCPU) |
| `memoryLimitMiB` | number | `2048` | Memory in MiB |

---

## Configuration Validation

### Synth-Time Validation

The stack performs validation during `cdk synth` to catch configuration errors early:

```typescript
// Example validation in Afu9EcsStack constructor
if (enableDatabase && !dbSecretArn && !dbSecretName) {
  throw new Error(
    'enableDatabase is true but neither dbSecretArn nor dbSecretName is provided. ' +
    'Set -c dbSecretArn=... or -c dbSecretName=afu9/database/master (default) or ' +
    'disable database with -c afu9-enable-database=false'
  );
}
```

### Runtime Validation

The application validates environment variables at startup (see `/api/ready` endpoint).

---

## Deployment Modes

### Mode 1: Full Stack (Default)

Deploy all components with database enabled:

```bash
npx cdk deploy Afu9NetworkStack Afu9DatabaseStack Afu9EcsStack
```

**Configuration:**
```json
{
  "afu9-enable-https": true,
  "afu9-enable-database": true
}
```

### Mode 2: ECS Without Database

Deploy ECS without database (for testing or independent services):

```bash
npx cdk deploy Afu9NetworkStack Afu9EcsStack \
  -c afu9-enable-database=false
```

**Configuration:**
```json
{
  "afu9-enable-https": false,
  "afu9-enable-database": false
}
```

**Result:**
- No database secrets in task definition
- No IAM grants for database access
- `DATABASE_ENABLED=false` env var in container
- `/api/ready` returns `database: {status: "not_configured"}`

### Mode 3: Multi-Environment (Stage + Prod)

Deploy separate ECS services for stage and prod:

```bash
npx cdk deploy Afu9EcsStageStack Afu9EcsProdStack Afu9RoutingStack \
  -c afu9-multi-env=true
```

**Configuration:**
```json
{
  "afu9-multi-env": true,
  "afu9-enable-https": true,
  "afu9-enable-database": true
}
```

**Result:**
- Two ECS services: `afu9-control-center-stage`, `afu9-control-center-prod`
- Two IAM roles: `afu9-ecs-task-role-stage`, `afu9-ecs-task-role-prod`
- Host-based routing: `stage.afu-9.com` → stage, `afu-9.com` → prod

---

## Environment Variables (Runtime)

These environment variables are injected into containers at runtime:

### Application Environment Variables

| Variable | Value | Source | Description |
|----------|-------|--------|-------------|
| `NODE_ENV` | `production` | Task Definition | Node.js environment |
| `PORT` | `3000` | Task Definition | HTTP server port |
| `ENVIRONMENT` | `stage` \| `prod` | Task Definition | Deployment environment |
| `DATABASE_ENABLED` | `true` \| `false` | Task Definition | Whether database is configured |
| `MCP_GITHUB_ENDPOINT` | `http://localhost:3001` | Task Definition | MCP GitHub server URL |
| `MCP_DEPLOY_ENDPOINT` | `http://localhost:3002` | Task Definition | MCP Deploy server URL |
| `MCP_OBSERVABILITY_ENDPOINT` | `http://localhost:3003` | Task Definition | MCP Observability server URL |

### Secrets (from AWS Secrets Manager)

When `enableDatabase=true`:

| Variable | Secret Name | Key | Description |
|----------|-------------|-----|-------------|
| `DATABASE_HOST` | `afu9/database` | `host` | RDS endpoint address |
| `DATABASE_PORT` | `afu9/database` | `port` | Database port (5432) |
| `DATABASE_NAME` | `afu9/database` | `database` | Database name (`afu9`) |
| `DATABASE_USER` | `afu9/database` | `username` | Database username |
| `DATABASE_PASSWORD` | `afu9/database` | `password` | Database password |

Always injected:

| Variable | Secret Name | Key | Description |
|----------|-------------|-----|-------------|
| `GITHUB_TOKEN` | `afu9/github` | `token` | GitHub personal access token |
| `GITHUB_OWNER` | `afu9/github` | `owner` | GitHub organization |
| `GITHUB_REPO` | `afu9/github` | `repo` | GitHub repository name |
| `OPENAI_API_KEY` | `afu9/llm` | `openai_api_key` | OpenAI API key |
| `ANTHROPIC_API_KEY` | `afu9/llm` | `anthropic_api_key` | Anthropic API key |
| `DEEPSEEK_API_KEY` | `afu9/llm` | `deepseek_api_key` | DeepSeek API key |

---

## Secret Structure

### Secret: `afu9/github`

```json
{
  "token": "ghp_xxxxxxxxxxxxxxxxxxxxx",
  "owner": "adaefler-art",
  "repo": "codefactory-control"
}
```

**Required Keys:** `token`, `owner`, `repo`

### Secret: `afu9/llm`

```json
{
  "openai_api_key": "sk-xxxxxxxxxxxxxxxxxxxxx",
  "anthropic_api_key": "sk-ant-xxxxxxxxxxxxxxxxxxxxx",
  "deepseek_api_key": "sk-xxxxxxxxxxxxxxxxxxxxx"
}
```

**Required Keys:** `openai_api_key`, `anthropic_api_key`, `deepseek_api_key`

### Secret: `afu9/database` (when `enableDatabase=true`)

```json
{
  "host": "afu9-postgres.xxxxx.eu-central-1.rds.amazonaws.com",
  "port": "5432",
  "database": "afu9",
  "username": "afu9_admin",
  "password": "xxxxxxxxxxxxxxxxxx"
}
```

**Required Keys:** `host`, `port`, `database`, `username`, `password`

**Validation:** Use the diagnostic script to verify all keys are present:

```bash
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query 'SecretString' \
  --output text | jq 'has("host", "port", "database", "username", "password")'
```

Expected output: `true`

---

## Resource Naming (Deterministic)

All resources have fixed names to prevent CDK drift and replacements:

| Resource Type | Name Pattern | Example |
|--------------|-------------|---------|
| ECS Cluster | `afu9-cluster` | `afu9-cluster` |
| ECS Service | `afu9-control-center-{env}` | `afu9-control-center-stage` |
| Task Family | `afu9-control-center` | `afu9-control-center` |
| Task Execution Role | `afu9-ecs-task-execution-role-{env}` | `afu9-ecs-task-execution-role-stage` |
| Task Role | `afu9-ecs-task-role-{env}` | `afu9-ecs-task-role-stage` |
| Log Group | `/ecs/afu9/{container}` | `/ecs/afu9/control-center` |
| Target Group | `afu9-tg-{env}` | `afu9-tg-stage` |
| ALB | `afu9-alb` | `afu9-alb` |
| RDS Instance | `afu9-postgres` | `afu9-postgres` |
| ECR Repository | `afu9/{component}` | `afu9/control-center` |

**Note:** The `-{env}` suffix is only added in multi-environment mode or when deploying non-legacy environments.

---

## Health Check Configuration

### Container Health Check (Docker)

```typescript
healthCheck: {
  command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1'],
  interval: cdk.Duration.seconds(30),
  timeout: cdk.Duration.seconds(5),
  retries: 3,
  startPeriod: cdk.Duration.seconds(60),
}
```

**Endpoint:** `/api/health`  
**Purpose:** Liveness probe (basic process check)  
**Expected Response:** `200 OK` with `{status: "ok"}`

### ALB Health Check (Target Group)

```typescript
healthCheck: {
  path: '/api/ready',
  interval: cdk.Duration.seconds(30),
  timeout: cdk.Duration.seconds(5),
  healthyThresholdCount: 2,
  unhealthyThresholdCount: 3,
  protocol: elbv2.Protocol.HTTP,
}
```

**Endpoint:** `/api/ready`  
**Purpose:** Readiness probe (comprehensive check including DB)  
**Expected Response:**
- `200 OK` if ready
- `503 Service Unavailable` if not ready

### Health Check Grace Period

```typescript
healthCheckGracePeriod: cdk.Duration.seconds(240)
```

**Duration:** 240 seconds (4 minutes)  
**Purpose:** Allow time for database connection pooling and MCP server startup

---

## Deployment Safety Settings

### Circuit Breaker

```typescript
deploymentCircuitBreaker: {
  enable: true,
  rollback: true,
}
```

**Behavior:** Automatically rolls back deployment if health checks fail repeatedly.

### Deployment Configuration

```typescript
minHealthyPercent: 50
maxHealthyPercent: 200
```

**Behavior:**
- During rolling update, keep at least 50% of tasks healthy
- Allow up to 200% capacity during deployment (for faster rollouts)

### Deregistration Delay

```typescript
deregistrationDelay: cdk.Duration.seconds(30)
```

**Behavior:** Wait 30 seconds before deregistering task from target group (graceful shutdown).

---

## Example: Deploy ECS Without Database

```bash
# 1. Deploy network stack
npx cdk deploy Afu9NetworkStack \
  -c afu9-enable-https=false

# 2. Deploy ECS stack without database
npx cdk deploy Afu9EcsStack \
  -c afu9-enable-database=false

# 3. Verify deployment
curl http://<ALB_DNS>/api/ready
```

**Expected `/api/ready` response:**

```json
{
  "ready": true,
  "service": "afu9-control-center",
  "version": "0.2.5",
  "timestamp": "2025-12-16T22:00:00.000Z",
  "checks": {
    "service": { "status": "ok" },
    "database": { "status": "not_configured", "message": "Database disabled in configuration" },
    "environment": { "status": "ok" }
  },
  "dependencies": {
    "required": ["database", "environment"],
    "optional": []
  }
}
```

---

## Troubleshooting

### Configuration Error: Missing `dbSecretArn`

**Error:**
```
Error: enableDatabase is true but neither dbSecretArn nor dbSecretName is provided. 
Set -c dbSecretArn=... or -c dbSecretName=afu9/database/master (default) or disable database with -c afu9-enable-database=false
```

**Fix:** Either provide `dbSecretArn` or disable the database:

```bash
npx cdk deploy Afu9EcsStack -c afu9-enable-database=false
```

### Configuration Warning: Conflicting Settings

**Warning:**
```
⚠️  DEPRECATION WARNING: Context key "enableDatabase" is deprecated. 
Please use "afu9-enable-database" instead. 
Example: cdk deploy -c afu9-enable-database=false
```

**Fix:** Use the correct context key `afu9-enable-database` instead of `enableDatabase`.

### Secret Validation Failed

**Error:**
```
ResourceInitializationError: unable to extract secret value for DATABASE_PORT
```

**Root Cause:** Secret JSON is missing the `port` key.

**Fix:** Update the secret with all required keys (see Secret Structure above).

---

## References

- [ECS Deployment Guide](./ECS-DEPLOYMENT.md)
- [ECS Diagnostics Runbook](./RUNBOOK_ECS_DEPLOY.md)
- [Health/Readiness Verification](../HEALTH_READINESS_VERIFICATION.md)
- [IAM Roles Justification](./IAM-ROLES-JUSTIFICATION.md)
