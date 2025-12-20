# AFU-9 v0.2 Deployment Guide

> **⚠️ DEPRECATION NOTICE:**  
> This document is **legacy documentation**. For the current, canonical deployment guide, see:  
> **[DEPLOYMENT_CONSOLIDATED.md](DEPLOYMENT_CONSOLIDATED.md)**

This guide covers deploying AFU-9 Control Center on AWS ECS Fargate with multi-environment support.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Multi-Environment Setup](#multi-environment-setup)
4. [Stage Environment Deployment](#stage-environment-deployment)
5. [Production Environment Deployment](#production-environment-deployment)
6. [DNS Configuration](#dns-configuration)
7. [Environment Variables](#environment-variables)
8. [Rollback Procedures](#rollback-procedures)
9. [Troubleshooting](#troubleshooting)

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Node.js 20+ and npm
- Docker installed
- GitHub account and Personal Access Token
- Domain name configured in Route53 (e.g., afu-9.com)

## Architecture Overview

AFU-9 v0.2 supports two deployment modes:

### Single Environment (Legacy)
- **ECS Fargate**: 4 containers in a single task (Control Center + 3 MCP servers)
- **RDS Postgres**: Shared database
- **ALB**: Single target group
- **DNS**: Single domain (e.g., afu-9.com)

### Multi-Environment (FEAT-011)
- **Stage Environment**: 
  - Domain: stage.afu-9.com
  - ECS Service: afu9-control-center-stage (1 task)
  - Auto-deploys on main branch push
  - Lower resource allocation
- **Production Environment**:
  - Domain: prod.afu-9.com
  - ECS Service: afu9-control-center-prod (2+ tasks)
  - Manual deployment only
  - Production resource allocation
- **Landing Page**: afu-9.com → redirects to prod.afu-9.com
- **Shared Resources**: ALB, VPC, RDS, ECR repositories

**Architecture Diagram:**
```
Internet
    ↓
Route53 DNS
    ├─ stage.afu-9.com → ALB
    ├─ prod.afu-9.com → ALB
    └─ afu-9.com → ALB (redirects to prod)
    ↓
ALB (HTTPS:443) [Shared, ACM Certificate]
    ├─ Host: stage.afu-9.com → Stage Target Group → ECS Stage Service
    ├─ Host: prod.afu-9.com → Prod Target Group → ECS Prod Service
    └─ Host: afu-9.com → Redirect to prod.afu-9.com
    ↓
ECS Cluster (Shared)
    ├─ afu9-control-center-stage (1 task)
    └─ afu9-control-center-prod (2+ tasks)
    ↓
RDS Postgres (Shared)
```

## Step 1: Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure

# Verify access
aws sts get-caller-identity
```

## Multi-Environment Setup

### Enabling Multi-Environment Mode

To deploy stage and production environments separately with domain-based routing:

```bash
# Set context flag for multi-environment mode
export AFU9_MULTI_ENV=true

# Deploy infrastructure with multi-env enabled
npx cdk deploy --all \
  -c afu9-multi-env=true \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-https=true
```

### Infrastructure Deployment Order

1. **DNS Stack** (creates Route53 hosted zone and wildcard certificate)
2. **Network Stack** (creates VPC, ALB, security groups)
3. **Database Stack** (creates shared RDS instance)
4. **ECS Stage Stack** (creates stage ECS service and target group)
5. **ECS Prod Stack** (creates prod ECS service and target group)
6. **Routing Stack** (configures ALB listener rules and DNS records)
7. **Alarms Stacks** (creates CloudWatch alarms for each environment)

### Required CDK Context Variables

- `afu9-multi-env`: Set to `true` to enable multi-environment deployment
- `afu9-domain`: Base domain name (e.g., `afu-9.com`)
- `afu9-enable-https`: Set to `true` to enable HTTPS (default: true)
- `github-org`: GitHub organization (default: `adaefler-art`)
- `github-repo`: GitHub repository (default: `codefactory-control`)

## Step 1: Configure AWS Credentials (Legacy Section - Merged Above)



## Step 2: Set Environment Variables

Create a `.env` file (don't commit!):

```bash
# AWS Configuration
AWS_ACCOUNT_ID=123456789012
AWS_REGION=eu-central-1

# GitHub Credentials
GITHUB_TOKEN=ghp_your_token_here
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo

# LLM API Keys
OPENAI_API_KEY=sk-your-key-here

# Database (will be auto-generated if using Secrets Manager)
# DB_PASSWORD=random-secure-password
```

## Stage Environment Deployment

### Automatic Deployment via GitHub Actions

Stage environment automatically deploys when code is pushed to the `main` branch.

**Workflow File:** `.github/workflows/deploy-stage.yml`

**Trigger:** Push to `main` branch with changes in:
- `control-center/**`
- `mcp-servers/**`
- `.github/workflows/deploy-stage.yml`

**Process:**
1. Builds Docker images with `stage-{sha}` and `stage-latest` tags
2. Pushes images to ECR
3. Updates ECS service `afu9-control-center-stage`
4. Waits for service to stabilize
5. Generates deployment summary

**Monitoring Deployment:**
```bash
# Watch GitHub Actions workflow
# Go to: https://github.com/{org}/{repo}/actions

# Or watch ECS service directly
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-stage \
  --region eu-central-1 \
  --query 'services[0].deployments'
```

**Accessing Stage:**
- URL: https://stage.afu-9.com
- Logs: `/ecs/afu9/control-center-stage`

### Manual Stage Deployment

To manually trigger a stage deployment:

```bash
# Build and push stage images
./scripts/deploy-stage.sh

# Or manually with Docker
cd control-center
docker build -t ${ACCOUNT_ID}.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-latest .
docker push ${ACCOUNT_ID}.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-latest

# Force ECS service update
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center-stage \
  --force-new-deployment \
  --region eu-central-1
```

## Production Environment Deployment

### Manual Deployment via GitHub Actions

Production deploys **ONLY** via manual workflow dispatch for safety.

**Workflow File:** `.github/workflows/deploy-prod.yml`

**Trigger:** Manual only (`workflow_dispatch`)

**Steps to Deploy:**

1. **Navigate to GitHub Actions:**
   ```
   https://github.com/{org}/{repo}/actions/workflows/deploy-prod.yml
   ```

2. **Click "Run workflow"**

3. **Enter Confirmation:**
   - Type `deploy` in the confirmation field
   - Select the branch (usually `main`)

4. **Click "Run workflow"**

5. **Monitor Progress:**
   - Watch the workflow execution
   - Review deployment summary after completion

**Process:**
1. Validates deployment confirmation
2. Builds Docker images with `prod-{sha}` and `prod-latest` tags
3. Pushes images to ECR
4. Updates ECS service `afu9-control-center-prod`
5. Waits for service to stabilize (all 2+ tasks healthy)
6. Generates deployment summary

**Accessing Production:**
- URL: https://prod.afu-9.com
- Landing page: https://afu-9.com (redirects to prod)
- Logs: `/ecs/afu9/control-center-prod`

### Production Deployment Checklist

Before deploying to production:

- [ ] Verify stage deployment is stable and tested
- [ ] Review all changes in the deployment
- [ ] Ensure database migrations are applied (Deploy ECS workflow now runs [scripts/db-migrate.sh](scripts/db-migrate.sh) via Secrets Manager; set DB secret name via repo/organization vars `PROD_DB_SECRET_NAME`, `STAGE_DB_SECRET_NAME`, or `DB_SECRET_NAME`)
- [ ] Check current production health metrics
- [ ] Notify team of upcoming deployment
- [ ] Have rollback plan ready
- [ ] Monitor during deployment

### Production Deployment Verification

After deployment:

```bash
# Check service health
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-prod \
  --region eu-central-1

# Check all tasks are running
aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-control-center-prod \
  --desired-status RUNNING \
  --region eu-central-1

# Test the endpoint
curl https://prod.afu-9.com/api/health

# Check CloudWatch logs
aws logs tail /ecs/afu9/control-center-prod --follow
```

## DNS Configuration

### Route53 Setup

The multi-environment deployment creates three DNS records:

1. **stage.afu-9.com** → ALB (Stage target group)
2. **prod.afu-9.com** → ALB (Prod target group)
3. **afu-9.com** → ALB (Redirects to prod)

All records are A records using Route53 alias to the ALB.

### Certificate Configuration

The ACM certificate is created with:
- Primary domain: `afu-9.com`
- Subject Alternative Name: `*.afu-9.com` (wildcard for all subdomains)

This single certificate covers all three domains:
- `afu-9.com`
- `stage.afu-9.com`
- `prod.afu-9.com`

### Verifying DNS

```bash
# Check DNS resolution
dig stage.afu-9.com
dig prod.afu-9.com
dig afu-9.com

# Test HTTPS certificate
curl -v https://stage.afu-9.com
curl -v https://prod.afu-9.com
curl -v https://afu-9.com
```

## Environment Variables

### Environment-Specific Variables

Each environment has these variables set:

**Stage:**
```bash
NODE_ENV=production
ENVIRONMENT=stage
PORT=3000
```

**Production:**
```bash
NODE_ENV=production
ENVIRONMENT=prod
PORT=3000
```

### Shared Variables

These are shared across environments (from Secrets Manager):
- Database credentials (same RDS instance)
- GitHub token
- LLM API keys

### Setting Custom Environment Variables

To add environment-specific configuration:

1. Update the ECS task definition in `lib/afu9-ecs-stack.ts`
2. Add new environment variables in the container definition
3. Deploy infrastructure update:
   ```bash
   npx cdk deploy Afu9EcsStageStack
   npx cdk deploy Afu9EcsProdStack
   ```

## Rollback Procedures

### Quick Rollback (Stage)

```bash
# List recent task definitions
aws ecs list-task-definitions \
  --family-prefix afu9-control-center-stage \
  --sort DESC \
  --max-items 5

# Rollback to previous revision
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center-stage \
  --task-definition afu9-control-center-stage:PREVIOUS_REVISION \
  --region eu-central-1

# Wait for rollback to complete
aws ecs wait services-stable \
  --cluster afu9-cluster \
  --services afu9-control-center-stage
```

### Quick Rollback (Production)

```bash
# List recent task definitions
aws ecs list-task-definitions \
  --family-prefix afu9-control-center-prod \
  --sort DESC \
  --max-items 5

# Rollback to previous revision
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center-prod \
  --task-definition afu9-control-center-prod:PREVIOUS_REVISION \
  --region eu-central-1

# Wait for rollback to complete
aws ecs wait services-stable \
  --cluster afu9-cluster \
  --services afu9-control-center-prod
```

### Rollback to Specific Image Tag

```bash
# Find the SHA tag you want to rollback to
aws ecr list-images \
  --repository-name afu9/control-center \
  --filter tagStatus=TAGGED \
  --query 'imageIds[?starts_with(imageTag, `prod-`)].imageTag' \
  --output table

# Update task definition with specific image tags
# This requires creating a new task definition with the old image tags
# See docs/ROLLBACK.md for detailed procedures
```

### Rollback Verification

After rollback:
```bash
# Verify service is stable
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-{stage|prod} \
  --region eu-central-1

# Test endpoint
curl https://{stage|prod}.afu-9.com/api/health

# Check logs for errors
aws logs tail /ecs/afu9/control-center-{stage|prod} --follow
```

For detailed rollback procedures, see **[ROLLBACK.md](ROLLBACK.md)**.

## Troubleshooting

### Stage Deployment Failures

**Problem:** GitHub Actions workflow fails to deploy stage

**Solutions:**
1. Check AWS credentials are configured correctly
2. Verify IAM role has necessary permissions
3. Check ECR repositories exist
4. Review CloudWatch logs for container errors

```bash
# Check workflow logs in GitHub Actions UI

# Verify ECS service events
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-stage \
  --query 'services[0].events[0:10]'
```

### Production Deployment Hangs

**Problem:** Production deployment stuck in progress

**Solutions:**
1. Check ECS service events for errors
2. Verify health checks are passing
3. Check security group allows ALB → ECS traffic
4. Review task definition for errors

```bash
# Check deployment status
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-prod \
  --query 'services[0].deployments'

# Check task health
aws ecs describe-tasks \
  --cluster afu9-cluster \
  --tasks $(aws ecs list-tasks \
    --cluster afu9-cluster \
    --service-name afu9-control-center-prod \
    --query 'taskArns[0]' \
    --output text)
```

### DNS Not Resolving

**Problem:** Domains not resolving or showing certificate errors

**Solutions:**
1. Verify Route53 records exist
2. Check ACM certificate is validated
3. Wait for DNS propagation (up to 48 hours)
4. Verify nameservers are configured correctly

```bash
# Check Route53 records
aws route53 list-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID

# Check certificate status
aws acm describe-certificate \
  --certificate-arn YOUR_CERT_ARN

# Test DNS resolution
nslookup stage.afu-9.com
nslookup prod.afu-9.com
```

### Environment Variables Not Available

**Problem:** Application can't access environment-specific variables

**Solutions:**
1. Verify task definition has correct environment variables
2. Check Secrets Manager has required secrets
3. Verify IAM task execution role has permission to read secrets

```bash
# Check task definition environment variables
aws ecs describe-task-definition \
  --task-definition afu9-control-center-{stage|prod} \
  --query 'taskDefinition.containerDefinitions[0].environment'

# List secrets
aws secretsmanager list-secrets \
  --query 'SecretList[?starts_with(Name, `afu9/`)].Name'
```

### Old Legacy Deployment Guide Sections Continue Below...

## Step 3: Create AWS Secrets

Store sensitive data in AWS Secrets Manager:

```bash
# GitHub credentials
aws secretsmanager create-secret \
  --name afu9-github \
  --description "AFU-9 GitHub credentials" \
  --secret-string "{\"token\":\"$GITHUB_TOKEN\"}" \
  --region $AWS_REGION

# LLM API keys
aws secretsmanager create-secret \
  --name afu9-llm \
  --description "AFU-9 LLM API keys" \
  --secret-string "{\"openai_api_key\":\"$OPENAI_API_KEY\"}" \
  --region $AWS_REGION

# Database credentials (auto-generated during CDK deployment)
# Or create manually:
aws secretsmanager create-secret \
  --name afu9-database \
  --description "AFU-9 RDS Postgres credentials" \
  --secret-string "{\"username\":\"afu9_admin\",\"password\":\"$(openssl rand -base64 32)\"}" \
  --region $AWS_REGION
```

## Step 4: Build CDK Infrastructure

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Synthesize CloudFormation template
npm run synth

# Review the generated template
cat cdk.out/Afu9InfrastructureStack.template.json
```

## Step 5: Deploy Infrastructure

Deploy the infrastructure in stages to handle dependencies:

### 5.1: Bootstrap CDK (First Time Only)

```bash
# Bootstrap CDK
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION
```

### 5.2: Deploy Network Stack

```bash
# Deploy VPC, subnets, security groups, and ALB
npx cdk deploy Afu9NetworkStack

# Note the outputs:
# - VpcId: vpc-xxxxx
# - LoadBalancerDNS: xxx.eu-central-1.elb.amazonaws.com
# - DbSecurityGroupId: sg-xxxxx
```

### 5.3: Deploy Database Stack

```bash
# Deploy RDS Postgres instance
npx cdk deploy Afu9DatabaseStack

# This will:
# - Create RDS Postgres 15.5 instance (db.t4g.micro)
# - Generate secure credentials in Secrets Manager
# - Configure automated backups (7 days)
# - Enable encryption at rest
# - Deploy in private subnets with ECS-only access

# Note the outputs:
# - DbEndpoint: afu9-postgres.xxxxx.eu-central-1.rds.amazonaws.com
# - DbPort: 5432
# - DbName: afu9
# - DbSecretArn: arn:aws:secretsmanager:eu-central-1:xxx:secret:afu9-database-xxx
```

**Note**: RDS deployment takes approximately 10-15 minutes.

## Step 6: Initialize Database

After the database is deployed, run migrations to create the schema:

### 6.1: Using the Migration Script (Recommended)

The migration script automatically retrieves credentials from Secrets Manager and runs migrations:

```bash
# Ensure you have psql installed
# macOS: brew install postgresql
# Ubuntu: sudo apt-get install postgresql-client

# Run all migrations
./scripts/deploy-migrations.sh

# Or run a specific migration
./scripts/deploy-migrations.sh 001_initial_schema.sql
```

The script will:
1. Retrieve credentials from AWS Secrets Manager
2. Test database connectivity
3. Run migrations in order
4. Show table statistics

### 6.2: Manual Migration (Alternative)

If you prefer to run migrations manually:

```bash
# Get database credentials from Secrets Manager
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --query SecretString \
  --output text \
  --region $AWS_REGION)

DB_HOST=$(echo $DB_SECRET | jq -r '.host')
DB_PORT=$(echo $DB_SECRET | jq -r '.port')
DB_USER=$(echo $DB_SECRET | jq -r '.username')
DB_PASSWORD=$(echo $DB_SECRET | jq -r '.password')
DB_NAME=$(echo $DB_SECRET | jq -r '.database')

# Export environment variables
export PGHOST=$DB_HOST
export PGPORT=$DB_PORT
export PGUSER=$DB_USER
export PGPASSWORD=$DB_PASSWORD
export PGDATABASE=$DB_NAME
export PGSSLMODE=require

# Run migration (requires network access to RDS)
psql -f database/migrations/001_initial_schema.sql
```

### 6.3: Setting Up Network Access for Migrations

Since the database is in a private subnet, you need network access. Choose one option:

**Option A: AWS Systems Manager Session Manager (Recommended)**

```bash
# Launch a bastion EC2 instance (if not exists)
# See docs/DATABASE-LOCAL-DEVELOPMENT.md for detailed instructions

# Start port forwarding session
aws ssm start-session \
  --target <instance-id> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters host="$DB_HOST",portNumber="5432",localPortNumber="5432"

# Then run migrations using localhost
./scripts/deploy-migrations.sh
```

**Option B: Temporary Security Group Rule (Development Only)**

⚠️ **Warning**: Only for development. Avoid in production.

```bash
# Get your public IP
MY_IP=$(curl -s https://checkip.amazonaws.com)

# Get security group ID
SG_ID=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query "Stacks[0].Outputs[?OutputKey=='DbSecurityGroupId'].OutputValue" \
  --output text)

# Add temporary ingress rule
aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region $AWS_REGION

# Run migrations
./scripts/deploy-migrations.sh

# IMPORTANT: Remove the rule after migrations
aws ec2 revoke-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr $MY_IP/32 \
  --region $AWS_REGION
```

**Option C: From EC2 Instance in Same VPC**

If you have an EC2 instance in the same VPC:

```bash
# SSH to the instance
ssh ec2-user@<instance-ip>

# Install PostgreSQL client
sudo yum install postgresql15

# Clone the repository
git clone https://github.com/adaefler-art/codefactory-control.git
cd codefactory-control

# Run migrations
./scripts/deploy-migrations.sh
```

### 6.4: Verify Database Setup

```bash
# Connect to database
export PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --query SecretString \
  --output text \
  --region $AWS_REGION | jq -r '.password')

DB_HOST=$(aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --query SecretString \
  --output text \
  --region $AWS_REGION | jq -r '.host')

# List tables
psql -h $DB_HOST -U afu9_admin -d afu9 -c "\dt"

# Expected output:
#              List of relations
#  Schema |         Name         | Type  |   Owner    
# --------+----------------------+-------+------------
#  public | agent_runs           | table | afu9_admin
#  public | mcp_servers          | table | afu9_admin
#  public | mcp_tool_calls       | table | afu9_admin
#  public | repositories         | table | afu9_admin
#  public | workflow_executions  | table | afu9_admin
#  public | workflow_steps       | table | afu9_admin
#  public | workflows            | table | afu9_admin
```

## Step 7: Build and Push Docker Images

### Image Tagging Strategy

AFU-9 uses a deterministic versioning strategy with immutable image tags:

**Tag Types:**
- **Primary (Immutable)**: Git commit SHA (7 chars, e.g., `a1b2c3d`) - used for production
- **Secondary (Immutable)**: Timestamp (e.g., `20251212-143000`) - audit trail
- **Convenience (Mutable)**: `staging-latest` - for development/staging only

**Best Practices:**
- Production deployments MUST use SHA tags
- Never use `latest` tag for production
- GitHub Actions automatically creates SHA-tagged images
- For rollback procedures, see [ROLLBACK.md](ROLLBACK.md)

### Build Control Center

```bash
cd control-center

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Get current git SHA
GIT_SHA=$(git rev-parse --short=7 HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Build image
docker build -t afu9/control-center:$GIT_SHA .

# Tag for ECR with multiple tags
docker tag afu9/control-center:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:$GIT_SHA

docker tag afu9/control-center:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:$TIMESTAMP

docker tag afu9/control-center:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:staging-latest

# Push all tags to ECR
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:$GIT_SHA
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:$TIMESTAMP
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:staging-latest

echo "Images pushed with SHA: $GIT_SHA"

cd ..
```

### Build MCP Servers

```bash
cd mcp-servers

# Get versioning info
GIT_SHA=$(git rev-parse --short=7 HEAD)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Build and push GitHub server
docker build -t afu9/mcp-github:$GIT_SHA -f github/Dockerfile .
docker tag afu9/mcp-github:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:$GIT_SHA
docker tag afu9/mcp-github:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:$TIMESTAMP
docker tag afu9/mcp-github:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:staging-latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:$GIT_SHA
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:$TIMESTAMP
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:staging-latest

# Build and push Deploy server
docker build -t afu9/mcp-deploy:$GIT_SHA -f deploy/Dockerfile .
docker tag afu9/mcp-deploy:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:$GIT_SHA
docker tag afu9/mcp-deploy:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:$TIMESTAMP
docker tag afu9/mcp-deploy:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:staging-latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:$GIT_SHA
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:$TIMESTAMP
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:staging-latest

# Build and push Observability server
docker build -t afu9/mcp-observability:$GIT_SHA -f observability/Dockerfile .
docker tag afu9/mcp-observability:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:$GIT_SHA
docker tag afu9/mcp-observability:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:$TIMESTAMP
docker tag afu9/mcp-observability:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:staging-latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:$GIT_SHA
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:$TIMESTAMP
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:staging-latest

echo "All MCP servers pushed with SHA: $GIT_SHA"

cd ..
```

## Step 8: Update ECS Service

After pushing images, ECS will automatically pull and deploy:

```bash
# Force new deployment
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --force-new-deployment \
  --region $AWS_REGION

# Watch deployment progress
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center \
  --region $AWS_REGION \
  --query 'services[0].deployments'
```

## Step 9: Verify Deployment

### Check ECS Service

```bash
# Get service status
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center \
  --region $AWS_REGION

# Check running tasks
aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-control-center \
  --region $AWS_REGION
```

### Check Health

Get the ALB DNS name and test:

```bash
# Get ALB DNS
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names afu9-load-balancer \
  --query 'LoadBalancers[0].DNSName' \
  --output text \
  --region $AWS_REGION)

# Test health endpoint
curl http://$ALB_DNS/api/health

# Expected response:
# {"status":"ok","service":"afu9-control-center","version":"0.2.0","timestamp":"..."}
```

### Check Logs

```bash
# Control Center logs
aws logs tail /ecs/afu9/control-center --follow --region $AWS_REGION

# MCP Server logs
aws logs tail /ecs/afu9/mcp-github --follow --region $AWS_REGION
aws logs tail /ecs/afu9/mcp-deploy --follow --region $AWS_REGION
aws logs tail /ecs/afu9/mcp-observability --follow --region $AWS_REGION
```

## Step 10: Configure HTTPS (Optional but Recommended)

### Request ACM Certificate

```bash
# Request certificate for your domain
aws acm request-certificate \
  --domain-name afu9.yourdomain.com \
  --validation-method DNS \
  --region $AWS_REGION

# Follow DNS validation instructions in AWS Console
```

### Update ALB Listener

Once certificate is validated:

```bash
# Get certificate ARN
CERT_ARN=$(aws acm list-certificates \
  --query 'CertificateSummaryList[?DomainName==`afu9.yourdomain.com`].CertificateArn' \
  --output text \
  --region $AWS_REGION)

# Add HTTPS listener to ALB
aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn=$CERT_ARN \
  --default-actions Type=forward,TargetGroupArn=$TARGET_GROUP_ARN \
  --region $AWS_REGION
```

### Update DNS

```bash
# Create Route53 A record (alias to ALB)
aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "CREATE",
      "ResourceRecordSet": {
        "Name": "afu9.yourdomain.com",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "'$ALB_HOSTED_ZONE_ID'",
          "DNSName": "'$ALB_DNS'",
          "EvaluateTargetHealth": false
        }
      }
    }]
  }'
```

## Continuous Deployment with GitHub Actions

Create `.github/workflows/deploy-afu9.yml`:

```yaml
name: Deploy AFU-9

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-region: eu-central-1
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Control Center
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          cd control-center
          SHORT_SHA=$(echo $IMAGE_TAG | cut -c1-7)
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          
          docker build -t $ECR_REGISTRY/afu9/control-center:$SHORT_SHA .
          docker push $ECR_REGISTRY/afu9/control-center:$SHORT_SHA
          docker tag $ECR_REGISTRY/afu9/control-center:$SHORT_SHA \
            $ECR_REGISTRY/afu9/control-center:$TIMESTAMP
          docker push $ECR_REGISTRY/afu9/control-center:$TIMESTAMP
          docker tag $ECR_REGISTRY/afu9/control-center:$SHORT_SHA \
            $ECR_REGISTRY/afu9/control-center:staging-latest
          docker push $ECR_REGISTRY/afu9/control-center:staging-latest

      - name: Build and push MCP servers
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          cd mcp-servers
          SHORT_SHA=$(echo $IMAGE_TAG | cut -c1-7)
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          
          # GitHub server
          docker build -t $ECR_REGISTRY/afu9/mcp-github:$SHORT_SHA -f github/Dockerfile .
          docker push $ECR_REGISTRY/afu9/mcp-github:$SHORT_SHA
          docker tag $ECR_REGISTRY/afu9/mcp-github:$SHORT_SHA $ECR_REGISTRY/afu9/mcp-github:$TIMESTAMP
          docker push $ECR_REGISTRY/afu9/mcp-github:$TIMESTAMP
          docker tag $ECR_REGISTRY/afu9/mcp-github:$SHORT_SHA $ECR_REGISTRY/afu9/mcp-github:staging-latest
          docker push $ECR_REGISTRY/afu9/mcp-github:staging-latest
          
          # Deploy server
          docker build -t $ECR_REGISTRY/afu9/mcp-deploy:$SHORT_SHA -f deploy/Dockerfile .
          docker push $ECR_REGISTRY/afu9/mcp-deploy:$SHORT_SHA
          docker tag $ECR_REGISTRY/afu9/mcp-deploy:$SHORT_SHA $ECR_REGISTRY/afu9/mcp-deploy:$TIMESTAMP
          docker push $ECR_REGISTRY/afu9/mcp-deploy:$TIMESTAMP
          docker tag $ECR_REGISTRY/afu9/mcp-deploy:$SHORT_SHA $ECR_REGISTRY/afu9/mcp-deploy:staging-latest
          docker push $ECR_REGISTRY/afu9/mcp-deploy:staging-latest
          
          # Observability server
          docker build -t $ECR_REGISTRY/afu9/mcp-observability:$SHORT_SHA -f observability/Dockerfile .
          docker push $ECR_REGISTRY/afu9/mcp-observability:$SHORT_SHA
          docker tag $ECR_REGISTRY/afu9/mcp-observability:$SHORT_SHA $ECR_REGISTRY/afu9/mcp-observability:$TIMESTAMP
          docker push $ECR_REGISTRY/afu9/mcp-observability:$TIMESTAMP
          docker tag $ECR_REGISTRY/afu9/mcp-observability:$SHORT_SHA $ECR_REGISTRY/afu9/mcp-observability:staging-latest
          docker push $ECR_REGISTRY/afu9/mcp-observability:staging-latest

      - name: Deploy to ECS
        run: |
          SHORT_SHA=$(echo ${{ github.sha }} | cut -c1-7)
          
          # Update service with new task definition using SHA tags
          # See .github/workflows/deploy-ecs.yml for complete deployment logic
          aws ecs update-service \
            --cluster afu9-cluster \
            --service afu9-control-center \
            --force-new-deployment \
            --region eu-central-1
```

## Rollback Procedures

For detailed rollback instructions, see **[ROLLBACK.md](ROLLBACK.md)**.

### Quick Rollback Summary

If a deployment fails or causes issues, you can quickly rollback to a previous stable version:

```bash
# List recent task definition revisions
aws ecs list-task-definitions \
  --family-prefix afu9-control-center \
  --sort DESC \
  --max-items 5 \
  --region eu-central-1

# Rollback to a specific revision (e.g., revision 41)
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --task-definition afu9-control-center:41 \
  --region eu-central-1

# Wait for service to stabilize
aws ecs wait services-stable \
  --cluster afu9-cluster \
  --services afu9-control-center \
  --region eu-central-1
```

**Key Points:**
- Each deployment creates a new task definition revision
- Revisions are immutable and contain specific image SHA tags
- Rollback typically completes in 2-3 minutes
- Always verify health after rollback

See [ROLLBACK.md](ROLLBACK.md) for:
- Step-by-step rollback procedures
- Common rollback scenarios
- Verification checklists
- Emergency rollback commands

## Troubleshooting

### Tasks won't start

**Symptoms**: ECS tasks immediately fail or won't start

**Solutions**:
- Check CloudWatch logs for error messages
- Verify IAM roles have necessary permissions
- Ensure secrets exist in Secrets Manager
- Check security group rules allow outbound traffic
- Verify ECR images were pushed successfully

### Database connection fails

**Symptoms**: Control Center can't connect to RDS

**Solutions**:
- Verify security group allows traffic from ECS to RDS on port 5432
- Check database credentials in Secrets Manager
- Ensure RDS instance is running
- Verify database name is correct (`afu9`)

### ALB health checks fail

**Symptoms**: ALB shows no healthy targets

**Solutions**:
- Verify `/api/health` endpoint returns 200 OK
- Check container logs for startup errors
- Ensure Control Center listens on port 3000
- Verify security group allows ALB -> ECS on port 3000

### MCP servers not responding

**Symptoms**: Control Center can't reach MCP servers

**Solutions**:
- Check MCP server logs in CloudWatch
- Verify all 4 containers are running in the task
- Test MCP endpoints: `curl http://localhost:3001/health` (from Control Center container)
- Verify environment variables are set correctly

## Monitoring

### CloudWatch Dashboards

Create a dashboard to monitor:
- ECS service health (running tasks, CPU, memory)
- ALB metrics (request count, latency, 5xx errors)
- RDS metrics (CPU, connections, storage)
- Custom application metrics

### Alarms

Set up CloudWatch alarms for:
- ALB 5xx errors > 5%
- ECS CPU utilization > 80%
- ECS memory utilization > 80%
- RDS CPU > 80%
- No healthy ALB targets

### Log Aggregation

All logs are in CloudWatch Logs:
- `/ecs/afu9/control-center`
- `/ecs/afu9/mcp-github`
- `/ecs/afu9/mcp-deploy`
- `/ecs/afu9/mcp-observability`

Use CloudWatch Insights for querying:

```sql
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 100
```

## Scaling

### Horizontal Scaling

Increase task count:

```bash
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --desired-count 2 \
  --region $AWS_REGION
```

### Auto Scaling

Enable auto scaling based on CPU:

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/afu9-cluster/afu9-control-center \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 1 \
  --max-capacity 5

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --policy-name afu9-cpu-scaling \
  --service-namespace ecs \
  --resource-id service/afu9-cluster/afu9-control-center \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 60
  }'
```

## Backup and Recovery

### Database Backups

RDS automated backups are enabled (7-day retention). To create manual snapshot:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier afu9-db \
  --db-snapshot-identifier afu9-db-snapshot-$(date +%Y%m%d-%H%M%S) \
  --region $AWS_REGION
```

### Restore from Snapshot

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier afu9-db-restored \
  --db-snapshot-identifier afu9-db-snapshot-20251211-150000 \
  --region $AWS_REGION
```

## Cost Optimization

1. **Use Fargate Spot** for non-production (70% cost savings)
2. **Right-size tasks**: Monitor CPU/memory and adjust
3. **Use RDS Reserved Instances** for production
4. **Enable ALB access logs** only when debugging
5. **Set CloudWatch log retention** to 7 days (or as needed)
6. **Delete old ECR images**: Keep only last 10 versions

## Security Checklist

- [ ] All secrets in AWS Secrets Manager
- [ ] IAM roles follow least privilege
- [ ] RDS in private subnets only
- [ ] Security groups restrict traffic
- [ ] Enable encryption at rest (RDS, ECS)
- [ ] Enable encryption in transit (HTTPS)
- [ ] Regular security updates (rebuild images monthly)
- [ ] Enable AWS CloudTrail for audit logging
- [ ] Enable VPC Flow Logs
- [ ] Regular backup testing

## Cleanup

To tear down the infrastructure:

```bash
# Delete ECS service
aws ecs delete-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --force \
  --region $AWS_REGION

# Destroy CDK stack
npx cdk destroy Afu9InfrastructureStack

# Delete secrets (if no longer needed)
aws secretsmanager delete-secret \
  --secret-id afu9-github \
  --force-delete-without-recovery \
  --region $AWS_REGION
```

## Support

For issues:
1. Check CloudWatch logs
2. Review this deployment guide
3. See architecture docs in `docs/architecture/`
4. Check GitHub issues
5. Contact the AFU-9 team
