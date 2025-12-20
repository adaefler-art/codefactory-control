# AFU-9 AWS Deployment Runbook

**Version:** v0.2.5  
**Last Updated:** 2025-12-12  
**Status:** Source of Truth for AFU-9 Staging Deployments

## Overview

This runbook provides step-by-step instructions for deploying AFU-9 Control Center to AWS staging environment. It ensures reproducible, deterministic deployments with proper secret management and validation.

## Pre-flight Before Any `cdk deploy`

1. Run `cdk diff` for the target stack.
2. Scan the diff for **Replacement** or **Deletion/Destruction** entries.
3. If critical resources are affected (DB, ALB, ECS service, secrets, DNS), pause and request a manual review before proceeding.

## Prerequisites

### Required Tools
- **AWS CLI v2**: `aws --version` → 2.x
- **AWS CDK**: `npm install -g aws-cdk` → 2.162.1+
- **Node.js**: 20.x or later
- **Docker**: For building container images (optional, can use GitHub Actions)
- **Git**: For repository access

### AWS Credentials
```bash
# Verify AWS credentials are configured
aws sts get-caller-identity

# Expected output should show:
# - Account ID
# - ARN with appropriate permissions
```

Required AWS permissions:
- CloudFormation: Create/Update/Delete stacks
- EC2: VPC, Security Groups, ALB
- ECS: Clusters, Services, Task Definitions
- RDS: Database instances
- ECR: Push/Pull images
- Secrets Manager: Create/Update secrets
- IAM: Create roles and policies
- Route53: (Optional) For custom domains
- ACM: (Optional) For HTTPS certificates

### GitHub Access
- Personal Access Token with `repo` and `workflow` permissions
- Store securely for later secret configuration

## Diff Gate: Pre-Deployment Validation

**⚠️ MANDATORY:** Before every deployment, run the CDK Diff Gate to validate infrastructure changes.

The Diff Gate analyzes CDK diff output to identify potentially dangerous changes that could cause:
- Service downtime (ECS Service replacement)
- DNS resolution failures (Route53 changes)
- HTTPS outages (ACM Certificate changes)
- Network connectivity issues (Security Group deletions)

### Running the Diff Gate

```bash
# Validate before deploying any stack
npm run validate:diff -- <StackName>

# Examples:
npm run validate:diff -- Afu9NetworkStack
npm run validate:diff -- Afu9EcsStack
npm run validate:diff -- Afu9DatabaseStack
```

### Diff Gate Results

**✓ PASS (Exit 0):** Diff contains only safe changes
- Proceed with deployment
- Example: ECS Task Definition image update, new resources

**⚠️ PASS with Warnings (Exit 0):** Diff contains changes requiring review
- Review warnings carefully
- Proceed with caution
- Example: Security Group rule modifications, IAM changes

**✗ BLOCKED (Exit 1):** Diff contains blocking changes
- **DO NOT DEPLOY** without manual review and approval
- Document justification
- Get team approval
- Example: ECS Service replacement, DNS deletions, ACM Certificate changes

### Blocking Changes

The following changes **PREVENT** deployment:

1. **ECS Service Replacement** - Causes downtime
2. **DNS Record Deletion/Replacement** - Breaks service availability
3. **ACM Certificate Deletion/Replacement** - Breaks HTTPS
4. **Security Group Deletion** - Breaks connectivity
5. **RDS Instance Replacement** - Requires migration
6. **Load Balancer Replacement** - Changes DNS endpoint

### Override Process (Emergency Only)

If blocking changes are **intentional and approved**:

```bash
# 1. Document justification in PR/issue
# 2. Get team approval
# 3. Deploy with gate skip (NOT recommended)
SKIP_DIFF_GATE=true npm run validate:diff -- <StackName>
```

**📖 For complete diff-gate rules and examples, see [DIFF_GATE_RULES.md](./DIFF_GATE_RULES.md)**

## Architecture Overview

```
┌─────────────┐
│   Internet  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│  Application Load Balancer (ALB)   │
│  - Port 80 (HTTP)                   │
│  - Health Check: /api/health        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  ECS Fargate Service                │
│  ┌─────────────────────────────┐   │
│  │  Task (1 vCPU, 2GB RAM)     │   │
│  │  - control-center:3000      │   │
│  │  - mcp-github:3001          │   │
│  │  - mcp-deploy:3002          │   │
│  │  - mcp-observability:3003   │   │
│  └─────────────────────────────┘   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  RDS PostgreSQL 15                  │
│  - Private subnet                   │
│  - Encrypted at rest                │
└─────────────────────────────────────┘
```

## Deployment Flow

### Phase 1: Bootstrap (One-Time Setup)

Bootstrap CDK in your AWS account (required only once per account/region):

```bash
cd /path/to/codefactory-control

# Bootstrap CDK with your account and region
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=eu-central-1

npx cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION}
```

**Expected Output:**
```
✅  Environment aws://123456789012/eu-central-1 bootstrapped.
```

**Verification:**
```bash
aws cloudformation describe-stacks --stack-name CDKToolkit
```

### Phase 2: Infrastructure Deployment

Deploy infrastructure stacks in the correct order. The stacks have dependencies that must be respected.

#### 2.1: Network Stack (VPC, ALB, Security Groups)

```bash
# STEP 1: Validate diff before deployment
npm run validate:diff -- Afu9NetworkStack -c afu9-enable-https=false -c environment=staging

# STEP 2: If validation passes, deploy
# Staging: Deploy without HTTPS
npx cdk deploy Afu9NetworkStack \
  --context afu9-enable-https=false \
  --context environment=staging \
  --require-approval never

# Save the ALB DNS name from outputs
export ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

echo "ALB DNS: $ALB_DNS"
```

**Expected Outputs:**
- `VpcId`: vpc-xxxxx
- `LoadBalancerDNS`: afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com
- `AlbSecurityGroupId`: sg-xxxxx
- `EcsSecurityGroupId`: sg-xxxxx
- `DbSecurityGroupId`: sg-xxxxx

**Duration:** ~3-5 minutes

**Verification:**
```bash
# Check VPC exists
aws ec2 describe-vpcs --vpc-ids $(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
  --output text)

# Check ALB is provisioning
aws elbv2 describe-load-balancers --query 'LoadBalancers[?contains(LoadBalancerName, `afu9`)]'
```

#### 2.2: Database Stack (RDS PostgreSQL)

```bash
# STEP 1: Validate diff before deployment
npm run validate:diff -- Afu9DatabaseStack -c environment=staging -c multiAz=false

# STEP 2: If validation passes, deploy
npx cdk deploy Afu9DatabaseStack \
  --context environment=staging \
  --context multiAz=false \
  --require-approval never

# Save database endpoint
export DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name Afu9DatabaseStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DbEndpoint`].OutputValue' \
  --output text)

echo "Database Endpoint: $DB_ENDPOINT"
```

**Expected Outputs:**
- `DbInstanceId`: afu9-postgres
- `DbEndpoint`: afu9-postgres.xxxxx.eu-central-1.rds.amazonaws.com
- `DbPort`: 5432
- `DbName`: afu9
- `DbSecretArn`: arn:aws:secretsmanager:...:secret:afu9-database-xxxxx

**Duration:** ~5-8 minutes

**Verification:**
```bash
# Check RDS instance status
aws rds describe-db-instances --db-instance-identifier afu9-postgres \
  --query 'DBInstances[0].DBInstanceStatus'

# Expected: "available"
```

#### 2.3: ECS Stack (Fargate, ECR, Task Definition)

```bash
# STEP 1: Validate diff before deployment
npm run validate:diff -- Afu9EcsStack -c environment=staging -c imageTag=staging-latest

# STEP 2: If validation passes, deploy
npx cdk deploy Afu9EcsStack \
  --context environment=staging \
  --context imageTag=staging-latest \
  --require-approval never

# Save ECR repository URIs
export ECR_CONTROL=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ControlCenterRepoUri`].OutputValue' \
  --output text)

export ECR_MCP_GITHUB=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`McpGithubRepoUri`].OutputValue' \
  --output text)

export ECR_MCP_DEPLOY=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`McpDeployRepoUri`].OutputValue' \
  --output text)

export ECR_MCP_OBS=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`McpObservabilityRepoUri`].OutputValue' \
  --output text)

echo "ECR Repositories:"
echo "  Control Center: $ECR_CONTROL"
echo "  MCP GitHub: $ECR_MCP_GITHUB"
echo "  MCP Deploy: $ECR_MCP_DEPLOY"
echo "  MCP Observability: $ECR_MCP_OBS"
```

**Expected Outputs:**
- `ClusterName`: afu9-cluster
- `ServiceName`: afu9-service
- `ControlCenterRepoUri`: xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center
- `McpGithubRepoUri`: xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/mcp-github
- `McpDeployRepoUri`: xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/mcp-deploy
- `McpObservabilityRepoUri`: xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/mcp-observability

**Duration:** ~2-3 minutes

**Note:** The ECS service will not start successfully until:
1. Secrets are properly configured (Phase 3)
2. Docker images are pushed to ECR (Phase 4)

#### 2.4: Alarms Stack (CloudWatch Monitoring)

```bash
npx cdk deploy Afu9AlarmsStack \
  --context environment=staging \
  --context afu9-alarm-email=ops@example.com \
  --require-approval never
```

**Optional:** Add webhook for Slack/Teams notifications:
```bash
npx cdk deploy Afu9AlarmsStack \
  --context environment=staging \
  --context afu9-alarm-email=ops@example.com \
  --context afu9-webhook-url=https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  --require-approval never
```

**Duration:** ~2-3 minutes

#### 2.5: IAM Stack (GitHub Actions Deployment Role)

```bash
npx cdk deploy Afu9IamStack \
  --context environment=staging \
  --context github-org=adaefler-art \
  --context github-repo=codefactory-control \
  --require-approval never
```

**Expected Outputs:**
- `GitHubActionsRoleArn`: arn:aws:iam::xxxxx:role/afu9-github-actions-deploy-role

**Duration:** ~1-2 minutes

### Phase 3: Secret Configuration

Configure secrets in AWS Secrets Manager. The ECS stack creates placeholder secrets that must be updated.

#### 3.1: Update GitHub Secret

```bash
# Update with your GitHub credentials
aws secretsmanager update-secret \
  --secret-id afu9-github \
  --secret-string '{
    "token": "ghp_your_github_personal_access_token",
    "owner": "adaefler-art",
    "repo": "codefactory-control"
  }'
```

**Verification:**
```bash
aws secretsmanager get-secret-value --secret-id afu9-github \
  --query SecretString --output text | jq .
```

#### 3.2: Update LLM API Keys Secret

```bash
# Update with your LLM API keys
aws secretsmanager update-secret \
  --secret-id afu9-llm \
  --secret-string '{
    "openai_api_key": "sk-your-openai-key",
    "anthropic_api_key": "sk-ant-your-anthropic-key",
    "deepseek_api_key": "sk-your-deepseek-key"
  }'
```

**Note:** You can provide only the LLM providers you plan to use. Missing keys will result in those providers being unavailable but won't break the application.

**Verification:**
```bash
aws secretsmanager get-secret-value --secret-id afu9-llm \
  --query SecretString --output text | jq 'keys'
# Expected: ["openai_api_key", "anthropic_api_key", "deepseek_api_key"]
```

#### 3.3: Verify Database Secret (Auto-Created)

The database secret is automatically created during database stack deployment:

```bash
aws secretsmanager get-secret-value --secret-id afu9-database \
  --query SecretString --output text | jq .
```

**Expected fields:**
- `host`: Database endpoint
- `port`: 5432
- `database`: afu9
- `username`: afu9_admin
- `password`: (auto-generated)

### Phase 4: Container Image Build & Push

Build and push Docker images to ECR. You can do this manually or via GitHub Actions.

#### Option A: Manual Build (Local)

```bash
# Login to ECR
aws ecr get-login-password --region eu-central-1 | \
  docker login --username AWS --password-stdin \
  ${AWS_ACCOUNT_ID}.dkr.ecr.eu-central-1.amazonaws.com

# Build and push Control Center
cd control-center
docker build -t ${ECR_CONTROL}:staging-latest .
docker push ${ECR_CONTROL}:staging-latest

# Build and push MCP GitHub Server
cd ../mcp-servers/github
docker build -t ${ECR_MCP_GITHUB}:staging-latest .
docker push ${ECR_MCP_GITHUB}:staging-latest

# Build and push MCP Deploy Server
cd ../deploy
docker build -t ${ECR_MCP_DEPLOY}:staging-latest .
docker push ${ECR_MCP_DEPLOY}:staging-latest

# Build and push MCP Observability Server
cd ../observability
docker build -t ${ECR_MCP_OBS}:staging-latest .
docker push ${ECR_MCP_OBS}:staging-latest
```

#### Option B: GitHub Actions (Recommended)

Set up GitHub Actions secrets in your repository:
- `AWS_ACCOUNT_ID`: Your AWS account ID
- `AWS_REGION`: eu-central-1

Then trigger the build workflow or push to the appropriate branch.

**Verification:**
```bash
# Check images exist in ECR
aws ecr list-images --repository-name afu9/control-center
aws ecr list-images --repository-name afu9/mcp-github
aws ecr list-images --repository-name afu9/mcp-deploy
aws ecr list-images --repository-name afu9/mcp-observability
```

### Phase 5: ECS Service Start

After images are pushed and secrets are configured, start/update the ECS service:

```bash
# Force new deployment to pull latest images
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-service \
  --force-new-deployment

# Monitor deployment
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-service \
  --query 'services[0].{desired:desiredCount,running:runningCount,status:status}'
```

**Expected Output:**
```json
{
  "desired": 1,
  "running": 1,
  "status": "ACTIVE"
}
```

**Wait for service to stabilize** (~3-5 minutes):
```bash
aws ecs wait services-stable \
  --cluster afu9-cluster \
  --services afu9-service
```

### Phase 6: Smoke Tests

Run automated smoke tests to verify the deployment:

```bash
./scripts/smoke-test-staging.sh $ALB_DNS
```

**Expected Output:**
```
Testing AFU-9 Staging Environment
Base URL: http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com

=== Smoke Tests ===

Testing Health endpoint... PASSED
Testing Readiness endpoint... PASSED
Testing Root page... PASSED
Verifying service identity... PASSED
Verifying version info... PASSED

=== Test Summary ===
Passed: 5
Failed: 0
Total:  5

✓ All smoke tests passed!
✓ Staging environment is operational
```

### Phase 7: Manual Verification

Perform manual checks to ensure everything is working:

#### 7.1: Access Control Center

```bash
echo "Access AFU-9 Control Center at: http://$ALB_DNS"
```

Open in browser and verify:
- [ ] Page loads successfully
- [ ] Dashboard is visible
- [ ] No JavaScript errors in console

#### 7.2: Check Health Endpoints

```bash
# Health endpoint
curl http://$ALB_DNS/api/health | jq .

# Expected:
# {
#   "status": "ok",
#   "service": "afu9-control-center",
#   "version": "0.2.5",
#   "timestamp": "..."
# }

# Readiness endpoint
curl http://$ALB_DNS/api/ready | jq .

# Expected:
# {
#   "ready": true,
#   "service": "afu9-control-center",
#   "version": "0.2.5",
#   "checks": {...}
# }
```

#### 7.3: Check ECS Task Logs

```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-service \
  --query 'taskArns[0]' \
  --output text)

# View logs
aws logs tail /ecs/afu9/control-center --follow

# Check for errors
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --filter-pattern "ERROR" \
  --max-items 10
```

#### 7.4: Verify ALB Target Health

```bash
# Get target group ARN
TG_ARN=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`TargetGroupArn`].OutputValue' \
  --output text)

# Check target health
aws elbv2 describe-target-health --target-group-arn $TG_ARN
```

**Expected:** All targets should be in `healthy` state.

#### 7.5: Database Connectivity

```bash
# Connect to database (requires psql and network access)
# Note: RDS is in private subnet, so you may need a bastion host

# Get database credentials
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9-database \
  --query SecretString \
  --output text)

DB_HOST=$(echo $DB_SECRET | jq -r .host)
DB_USER=$(echo $DB_SECRET | jq -r .username)
DB_PASS=$(echo $DB_SECRET | jq -r .password)

# Test connection (if you have network access)
# PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d afu9 -c "SELECT version();"
```

## Stack Dependencies

Understanding the dependency graph is crucial for troubleshooting:

```
Afu9DnsStack (optional)
    ↓
Afu9NetworkStack
    ↓
    ├─→ Afu9DatabaseStack
    │       ↓
    └─→ Afu9EcsStack
            ↓
        Afu9AlarmsStack

Afu9IamStack (independent)
```

**Deployment Order:**
1. Afu9DnsStack (optional, for HTTPS)
2. Afu9NetworkStack (requires DNS if HTTPS enabled)
3. Afu9DatabaseStack (requires Network)
4. Afu9EcsStack (requires Network and Database)
5. Afu9AlarmsStack (requires ECS and Database)
6. Afu9IamStack (independent, can be deployed anytime)

**Destruction Order** (reverse):
1. Afu9AlarmsStack
2. Afu9EcsStack
3. Afu9DatabaseStack
4. Afu9NetworkStack
5. Afu9DnsStack (if deployed)
6. Afu9IamStack (independent)

## Troubleshooting

### ECS Circuit Breaker Triggered

**⚡ Use the Standardized Diagnostic Runbook:**

When deployments fail due to Circuit Breaker triggers, follow the standardized diagnostic process:

**📖 [ECS Circuit Breaker Diagnosis Runbook](./runbooks/ecs-circuit-breaker-diagnosis.md)**

**Features:**
- ✅ Root cause identification in < 10 minutes
- ✅ Copy-paste ready commands
- ✅ Step-by-step diagnostic flow
- ✅ Common scenarios with immediate fixes

**Quick Start:**
```bash
# Set environment
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage

# Run automated diagnostics
pwsh scripts/ecs_debug.ps1 -Service ${SERVICE_NAME}

# Or follow manual steps in the runbook
```

**Common scenarios covered:**
1. Secret missing or misconfigured (Database, GitHub, LLM)
2. Health check failures
3. Container image issues
4. IAM permission problems
5. Network/Security group issues

---

### Issue: CDK Synth Fails

**Symptoms:**
```
Error: Cannot find module 'aws-cdk-lib'
```

**Solution:**
```bash
npm install
npm run build
```

### Issue: ECS Tasks Not Starting

**Possible Causes:**
1. **No Docker images in ECR**
   ```bash
   aws ecr list-images --repository-name afu9/control-center
   ```
   Solution: Build and push images (Phase 4)

2. **Secrets not configured**
   ```bash
   aws secretsmanager get-secret-value --secret-id afu9-github
   ```
   Solution: Update secrets (Phase 3)

3. **Insufficient task memory/CPU**
   Check CloudWatch logs:
   ```bash
   aws logs tail /ecs/afu9/control-center --follow
   ```

### Issue: ALB Health Checks Failing

**Symptoms:**
```
Target health: unhealthy
Reason: Health checks failed
```

**Debug Steps:**
```bash
# 1. Check target group health
TG_ARN=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`TargetGroupArn`].OutputValue' \
  --output text)

aws elbv2 describe-target-health --target-group-arn $TG_ARN

# 2. Check ECS task is running
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-service

# 3. Check security groups allow ALB → ECS traffic on port 3000

# 4. Test health endpoint directly from ECS task
# (requires exec access or log inspection)
```

### Issue: Database Connection Errors

**Symptoms:**
```
Error: Connection refused to database
```

**Debug Steps:**
```bash
# 1. Verify database is running
aws rds describe-db-instances \
  --db-instance-identifier afu9-postgres \
  --query 'DBInstances[0].DBInstanceStatus'

# 2. Check security group allows ECS → RDS on port 5432
aws ec2 describe-security-groups \
  --group-ids $(aws cloudformation describe-stacks \
    --stack-name Afu9NetworkStack \
    --query 'Stacks[0].Outputs[?OutputKey==`DbSecurityGroupId`].OutputValue' \
    --output text)

# 3. Verify database secret is correct
aws secretsmanager get-secret-value --secret-id afu9-database
```

### Issue: Stack Update Fails

**Symptoms:**
```
UPDATE_ROLLBACK_COMPLETE
```

**Debug Steps:**
```bash
# Check stack events
aws cloudformation describe-stack-events \
  --stack-name Afu9EcsStack \
  --max-items 20 \
  --query 'StackEvents[?ResourceStatus==`UPDATE_FAILED`]'

# Common solutions:
# - Delete failed stack and redeploy
# - Check IAM permissions
# - Verify resource limits (e.g., VPC limit, EIP limit)
```

## Rollback Procedures

### Rollback ECS Service to Previous Task Definition

```bash
# List task definitions
aws ecs list-task-definitions --family-prefix afu9

# Update service to previous version
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-service \
  --task-definition afu9-task-definition:PREVIOUS_REVISION
```

### Rollback Entire Stack

```bash
# CloudFormation will automatically rollback failed updates
# To manually rollback to previous version:
aws cloudformation cancel-update-stack --stack-name Afu9EcsStack

# To completely remove a stack:
npx cdk destroy Afu9EcsStack
```

### Emergency: Stop All Services

```bash
# Scale ECS service to 0
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-service \
  --desired-count 0
```

## Maintenance

### Update Container Images

```bash
# Build new images with new tag
docker build -t ${ECR_CONTROL}:v0.2.6 .
docker push ${ECR_CONTROL}:v0.2.6

# Update task definition to use new tag (via CDK)
npx cdk deploy Afu9EcsStack --context imageTag=v0.2.6

# Or force new deployment with same tag
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-service \
  --force-new-deployment
```

### Database Backups

Backups are automatic (configured in DatabaseStack):
- Retention: 7 days
- Backup window: 02:00-03:00 UTC

**Manual Snapshot:**
```bash
aws rds create-db-snapshot \
  --db-instance-identifier afu9-postgres \
  --db-snapshot-identifier afu9-postgres-manual-$(date +%Y%m%d-%H%M%S)
```

### Scale ECS Service

```bash
# Scale to 2 tasks
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-service \
  --desired-count 2
```

### Rotate Secrets

```bash
# Update GitHub token
aws secretsmanager update-secret \
  --secret-id afu9-github \
  --secret-string '{"token":"new_token","owner":"...","repo":"..."}'

# Force ECS service restart to pick up new secret
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-service \
  --force-new-deployment
```

## Clean Up

To completely remove the staging environment:

```bash
# Delete stacks in reverse dependency order
npx cdk destroy Afu9AlarmsStack --force
npx cdk destroy Afu9EcsStack --force
npx cdk destroy Afu9DatabaseStack --force
npx cdk destroy Afu9NetworkStack --force
npx cdk destroy Afu9DnsStack --force  # if deployed
npx cdk destroy Afu9IamStack --force

# Or destroy all at once (CDK handles dependencies)
npx cdk destroy --all --force
```

**Warning:** This will delete:
- All data in RDS (final snapshot will be created)
- All Docker images in ECR
- All logs in CloudWatch
- All secrets in Secrets Manager (with recovery window)

## Appendix

### A. Quick Reference: All Stack Outputs

```bash
# Get all stack outputs
for stack in Afu9NetworkStack Afu9DatabaseStack Afu9EcsStack Afu9AlarmsStack Afu9IamStack; do
  echo "=== $stack ==="
  aws cloudformation describe-stacks \
    --stack-name $stack \
    --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
    --output table
done
```

### B. Environment Variables Reference

ECS Task environment variables (configured in ECS stack):

- `NODE_ENV`: production/staging
- `DATABASE_URL`: postgresql://...  (from secret)
- `GITHUB_TOKEN`: (from secret)
- `OPENAI_API_KEY`: (from secret, if configured)
- `ANTHROPIC_API_KEY`: (from secret, if configured)
- `DEEPSEEK_API_KEY`: (from secret, if configured)

### C. Cost Estimation (Staging)

Approximate monthly costs for staging environment:

- **ECS Fargate**: ~$30-40/month (1 task, 1 vCPU, 2GB)
- **RDS db.t4g.micro**: ~$15-20/month
- **ALB**: ~$20-25/month
- **NAT Gateway**: ~$35-40/month
- **Data Transfer**: ~$5-10/month
- **CloudWatch Logs**: ~$5/month
- **ECR Storage**: ~$1/month

**Total: ~$110-140/month**

Cost optimization tips:
- Stop ECS service when not in use
- Use Spot instances for non-critical environments
- Reduce log retention period
- Use VPC endpoints instead of NAT Gateway

### D. Contact & Support

For issues with this deployment:
1. Check troubleshooting section above
2. Review CloudFormation events and CloudWatch logs
3. Consult [ECS-DEPLOYMENT.md](./ECS-DEPLOYMENT.md) for additional details
4. Check [GitHub Issues](https://github.com/adaefler-art/codefactory-control/issues)

---

**Document Version:** 1.0  
**Compatible with:** AFU-9 v0.2.5  
**Last Tested:** 2025-12-12
