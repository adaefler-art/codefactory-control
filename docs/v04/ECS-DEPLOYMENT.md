# AFU-9 ECS Deployment Guide

This guide covers deploying AFU-9 Control Center and MCP servers to AWS ECS Fargate.

> **📖 For Staging Deployments:**  
> See the **[AWS Deployment Runbook](./AWS_DEPLOY_RUNBOOK.md)** for the complete, step-by-step staging deployment process with troubleshooting and maintenance procedures.

## Overview

The AFU-9 v0.2 deployment consists of:

- **ECR Repositories**: 4 container image repositories
- **ECS Cluster**: Fargate cluster with Container Insights
- **ECS Service**: Single service running 4 containers in one task
- **ALB**: Application Load Balancer for HTTP/HTTPS traffic
- **Route53 & ACM**: Custom domain with TLS certificate (optional)
- **RDS**: PostgreSQL 15 database
- **Secrets Manager**: Secure credential storage
- **CloudWatch**: Centralized logging and monitoring

**📚 Additional Resources:**
- [AWS Deployment Runbook](./AWS_DEPLOY_RUNBOOK.md) - Complete staging deployment guide (Source of Truth)
- [HTTPS & DNS Setup Guide](./HTTPS-DNS-SETUP.md) - Configure custom domain and HTTPS
- [URL Mappings](./URL-MAPPINGS.md) - Complete URL reference for all endpoints

## Architecture

```
Internet → ALB (port 80/443) → ECS Service → RDS Postgres
                                    ↓
                        ┌───────────┴───────────┐
                        │   ECS Task (1 vCPU, 2GB RAM)   │
                        ├───────────────────────┤
                        │  control-center:3000  │
                        │  mcp-github:3001      │
                        │  mcp-deploy:3002      │
                        │  mcp-observability:3003│
                        └───────────────────────┘
```

All containers run in the same task and communicate via localhost. The Control Center is exposed through the ALB on port 3000.

## Prerequisites

1. **AWS CLI** configured with appropriate credentials
2. **AWS CDK** installed globally: `npm install -g aws-cdk`
3. **Docker** for building container images
4. **Node.js 20+** for building the project
5. **GitHub token** with repo and workflow permissions

## Deployment Steps

### 1. Bootstrap AWS CDK (First Time Only)

```bash
cd /path/to/codefactory-control
npx cdk bootstrap aws://ACCOUNT-ID/eu-central-1
```

Replace `ACCOUNT-ID` with your AWS account ID.

### 2. (Optional) Deploy DNS and Certificate Infrastructure

**For production deployments with HTTPS**, deploy the DNS stack first:

```bash
npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com
```

This creates:
- Route53 hosted zone (or uses existing)
- ACM certificate with DNS validation
- Certificate ARN for HTTPS configuration

After deployment, configure name servers at your domain registrar (see output).

**For detailed HTTPS/DNS setup instructions, see [HTTPS-DNS-SETUP.md](./HTTPS-DNS-SETUP.md).**

**For development without HTTPS**, skip this step and proceed to network deployment.

### 3. Deploy Network Infrastructure

Deploy the VPC, subnets, security groups, and ALB:

```bash
# Staging: Deploy without HTTPS (uses cdk.context.json)
npx cdk deploy Afu9NetworkStack \
  --context environment=staging \
  --context afu9-enable-https=false

# Production: Deploy with HTTPS (after DNS stack)
npx cdk deploy Afu9NetworkStack \
  --context environment=production

# Or without context (defaults to HTTPS enabled)
npx cdk deploy Afu9NetworkStack
```

**Staging vs Production Configuration:**

The `cdk.context.json` file defines environment-specific settings:
- **Staging**: HTTPS disabled, single-AZ, cost-optimized
- **Production**: HTTPS enabled, multi-AZ, high availability

To use staging configuration:
```bash
npx cdk deploy <stack-name> --context environment=staging
```

This creates:
- VPC with 2 AZs (10.0.0.0/16)
- Public subnets for ALB
- Private subnets for ECS and RDS
- Security groups with least privilege
- Application Load Balancer
- HTTPS listener (if DNS stack deployed) with HTTP to HTTPS redirect
- Route53 A record pointing to ALB (if DNS stack deployed)

**Outputs to note:**
- `Afu9LoadBalancerDNS` - ALB DNS name for accessing the Control Center
- `HttpsEnabled` - Whether HTTPS is configured

### 4. Deploy Database

Deploy the RDS PostgreSQL database:

```bash
npx cdk deploy Afu9DatabaseStack
```

This creates:
- RDS PostgreSQL 15.5 instance (db.t4g.micro)
- Database credentials in Secrets Manager
- Automated backups with 7-day retention
- Encryption at rest

**Outputs to note:**
- `Afu9DbSecretArn` - ARN of the database connection secret
- `Afu9DbEndpoint` - Database endpoint address

### 5. Deploy ECS Infrastructure

Deploy the ECS cluster, task definition, and service:

```bash
npx cdk deploy Afu9EcsStack
```

This creates:
- 4 ECR repositories (control-center, mcp-github, mcp-deploy, mcp-observability)
- ECS Fargate cluster
- ECS task definition with 4 containers
- ECS service attached to ALB
- IAM roles for task execution and application runtime
- CloudWatch log groups

**Outputs to note:**
- `EcrControlCenterRepo` - URI for Control Center repository
- `EcrMcpGithubRepo` - URI for MCP GitHub repository
- `EcrMcpDeployRepo` - URI for MCP Deploy repository
- `EcrMcpObservabilityRepo` - URI for MCP Observability repository
- `ServiceName` - ECS service name
- `TaskRoleArn` - IAM role used by application containers
- `TaskExecutionRoleArn` - IAM role used by ECS infrastructure

### 5a. (Optional) Deploy IAM Stack for GitHub Actions

If you want to use GitHub Actions for automated deployments, deploy the IAM stack:

```bash
npx cdk deploy Afu9IamStack \
  -c github-org=your-github-org \
  -c github-repo=your-repo-name
```

This creates:
- GitHub OIDC provider for credential-less authentication
- IAM role for GitHub Actions with permissions to:
  - Push Docker images to ECR
  - Trigger ECS service deployments
  - Pass IAM roles to ECS

**Outputs to note:**
- `DeployRoleArn` - ARN to configure in GitHub Secrets as `AWS_DEPLOY_ROLE_ARN`
- `DeployRoleName` - Name of the deployment role

**Configure GitHub Repository:**

After deployment, add the role ARN to your GitHub repository secrets:

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `AWS_DEPLOY_ROLE_ARN`
5. Value: (paste the `DeployRoleArn` from stack outputs)
6. Click "Add secret"

**📚 For detailed IAM role documentation, see:**
- [SECURITY-IAM.md](./SECURITY-IAM.md) - IAM roles overview
- [IAM-ROLES-JUSTIFICATION.md](./IAM-ROLES-JUSTIFICATION.md) - Detailed permissions and justifications

### 6. Configure Secrets

**IMPORTANT:** The ECS stack creates placeholder secrets that must be updated before the service can start successfully.

After deployment, update the placeholder secrets in AWS Secrets Manager:

#### GitHub Credentials

```bash
aws secretsmanager update-secret \
  --secret-id afu9/github \
  --secret-string '{
    "token": "ghp_your_github_token_here",
    "owner": "your-github-org",
    "repo": "your-repo-name"
  }' \
  --region eu-central-1
```

**Note:** The GitHub token needs the following scopes:
- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows

#### LLM API Keys

```bash
aws secretsmanager update-secret \
  --secret-id afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-your-openai-key-here"
  }' \
  --region eu-central-1
```

**Note:** You can verify secrets are configured correctly with:

```bash
# Check GitHub secret
aws secretsmanager get-secret-value \
  --secret-id afu9/github \
  --query SecretString \
  --output text \
  --region eu-central-1

# Check LLM secret
aws secretsmanager get-secret-value \
  --secret-id afu9/llm \
  --query SecretString \
  --output text \
  --region eu-central-1
```

### 7. Build and Push Docker Images

#### Option A: Manual Build and Push

Get ECR login credentials:

```bash
aws ecr get-login-password --region eu-central-1 | \
  docker login --username AWS --password-stdin ACCOUNT-ID.dkr.ecr.eu-central-1.amazonaws.com
```

Build and push each image:

```bash
# Get repository URIs from CDK outputs
CONTROL_CENTER_REPO=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`EcrControlCenterRepo`].OutputValue' \
  --output text --region eu-central-1)

MCP_GITHUB_REPO=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`EcrMcpGithubRepo`].OutputValue' \
  --output text --region eu-central-1)

MCP_DEPLOY_REPO=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`EcrMcpDeployRepo`].OutputValue' \
  --output text --region eu-central-1)

MCP_OBSERVABILITY_REPO=$(aws cloudformation describe-stacks \
  --stack-name Afu9EcsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`EcrMcpObservabilityRepo`].OutputValue' \
  --output text --region eu-central-1)

# Build and push Control Center
cd control-center
docker build -t $CONTROL_CENTER_REPO:latest .
docker push $CONTROL_CENTER_REPO:latest
cd ..

# Build and push MCP GitHub
cd mcp-servers
docker build -f github/Dockerfile -t $MCP_GITHUB_REPO:latest .
docker push $MCP_GITHUB_REPO:latest

# Build and push MCP Deploy
docker build -f deploy/Dockerfile -t $MCP_DEPLOY_REPO:latest .
docker push $MCP_DEPLOY_REPO:latest

# Build and push MCP Observability
docker build -f observability/Dockerfile -t $MCP_OBSERVABILITY_REPO:latest .
docker push $MCP_OBSERVABILITY_REPO:latest
cd ..
```

#### Option B: GitHub Actions (Automated CI/CD)

The repository includes a GitHub Actions workflow (`.github/workflows/deploy-ecs.yml`) for automated deployment.

**Setup:**

1. Configure AWS credentials for GitHub Actions:
   - Create an IAM role with OIDC provider for GitHub Actions
   - Add role ARN to GitHub secrets as `AWS_DEPLOY_ROLE_ARN`

2. Trigger deployment:
   - Automatically on push to `main` branch
   - Manually via workflow dispatch in GitHub UI

The workflow will:
- Build all 4 Docker images
- Push images to ECR with multiple tags (latest, commit SHA, timestamp)
- Force new deployment of ECS service
- Wait for service to stabilize

### 8. Run Database Migrations

SSH into a running ECS task or run migrations locally:

```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks \
  --cluster afu9-cluster \
  --service-name afu9-control-center \
  --query 'taskArns[0]' \
  --output text --region eu-central-1)

# Execute command in task
aws ecs execute-command \
  --cluster afu9-cluster \
  --task $TASK_ARN \
  --container control-center \
  --command "/bin/sh" \
  --interactive \
  --region eu-central-1
```

Or run migrations from local machine with database endpoint:

```bash
# Get database credentials from Secrets Manager
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --query SecretString --output text --region eu-central-1)

# Extract values and run migrations
# (Add your migration tool command here)
```

### 9. Verify Deployment

#### Automated Smoke Tests

Run the automated smoke test script to verify all components:

```bash
# Get ALB DNS name
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name Afu9NetworkStack \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text --region eu-central-1)

# Run smoke tests
./scripts/smoke-test-staging.sh $ALB_DNS
```

**Expected output:**
```
Testing AFU-9 Staging Environment
=== Smoke Tests ===
Testing Health endpoint... PASSED
Testing Readiness endpoint... PASSED
Testing Root page... PASSED
Verifying service identity... PASSED
Verifying version info... PASSED

✓ All smoke tests passed!
✓ Staging environment is operational
```

#### Manual Verification

Check service status:

```bash
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center \
  --region eu-central-1 \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}'
```

Access the Control Center:

```bash
# If using HTTPS with custom domain
DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name Afu9DnsStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DomainName`].OutputValue' \
  --output text --region eu-central-1 2>/dev/null)

if [ -n "$DOMAIN" ]; then
  echo "Control Center: https://$DOMAIN"
else
  # Get ALB DNS name for HTTP access
  ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name Afu9NetworkStack \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
    --output text --region eu-central-1)
  echo "Control Center: http://$ALB_DNS"
fi
```

Open the URL in your browser. You should see the AFU-9 Control Center UI.

**URL Mappings:**
- **HTTPS with custom domain**: `https://afu9.yourdomain.com`
- **HTTP with ALB DNS**: `http://afu9-alb-xxxxx.eu-central-1.elb.amazonaws.com`
- **Health Check**: `/api/health` - Basic liveness check (used by ALB)
- **Readiness Check**: `/api/ready` - Comprehensive readiness check (manual/optional)
- **API Endpoints**: `/api/*`
- **GitHub Webhooks**: `/api/webhooks/github`

## Monitoring and Logs

### CloudWatch Logs

View logs for each container:

```bash
# Control Center logs
aws logs tail /ecs/afu9/control-center --follow --region eu-central-1

# MCP GitHub logs
aws logs tail /ecs/afu9/mcp-github --follow --region eu-central-1

# MCP Deploy logs
aws logs tail /ecs/afu9/mcp-deploy --follow --region eu-central-1

# MCP Observability logs
aws logs tail /ecs/afu9/mcp-observability --follow --region eu-central-1
```

### ECS Service Metrics

View service metrics in CloudWatch:
- CPU utilization
- Memory utilization
- Task count
- ALB target health

## Troubleshooting

### ECS Circuit Breaker Triggered

When the ECS Circuit Breaker triggers and prevents deployment, use the **standardized diagnostic runbook** for rapid root cause identification:

**📖 [ECS Circuit Breaker Diagnosis Runbook](./runbooks/ecs-circuit-breaker-diagnosis.md)**

This runbook provides:
- ✅ 5-step diagnostic flow with copy-paste commands
- ✅ Root cause identification in < 10 minutes
- ✅ Common scenarios with immediate fixes
- ✅ No trial-and-error required

**Quick diagnostic script:**
```bash
pwsh scripts/ecs_debug.ps1 -Service afu9-control-center-stage
```

### Task Fails to Start

1. Check CloudWatch logs for errors
2. Verify ECR images exist with `latest` tag
3. Check IAM role permissions
4. Verify Secrets Manager secrets are configured

**Detailed steps:** See [ECS Circuit Breaker Diagnosis Runbook](./runbooks/ecs-circuit-breaker-diagnosis.md) Section 2

### Cannot Connect to Database

1. Verify database security group allows connections from ECS security group
2. Check database endpoint and port in connection string
3. Verify RDS instance is running
4. Check Secrets Manager for correct credentials

**Detailed steps:** See [ECS Circuit Breaker Diagnosis Runbook](./runbooks/ecs-circuit-breaker-diagnosis.md) Section 5.3

### Service Unhealthy

1. Check ALB target group health checks
2. Verify Control Center container is listening on port 3000
3. Check `/api/health` endpoint responds with 200 OK
4. Review CloudWatch logs for application errors

**Detailed steps:** See [ECS Circuit Breaker Diagnosis Runbook](./runbooks/ecs-circuit-breaker-diagnosis.md) Section 4

## Scaling

### Increase Task Count

Update the service desired count:

```bash
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --desired-count 2 \
  --region eu-central-1
```

### Update Task Resources

Modify the task definition in `lib/afu9-ecs-stack.ts`:

```typescript
const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
  family: 'afu9-control-center',
  cpu: 2048, // 2 vCPU
  memoryLimitMiB: 4096, // 4 GB
  // ...
});
```

Then redeploy:

```bash
npx cdk deploy Afu9EcsStack
```

## Updating the Application

### Using GitHub Actions

Push changes to the `main` branch, and the GitHub Actions workflow will automatically:
1. Build new Docker images
2. Push to ECR
3. Force new deployment

### Manual Update

Build and push new images, then force new deployment:

```bash
aws ecs update-service \
  --cluster afu9-cluster \
  --service afu9-control-center \
  --force-new-deployment \
  --region eu-central-1
```

## Cleanup

To remove all resources:

```bash
# Delete ECS stack
npx cdk destroy Afu9EcsStack

# Delete database stack
npx cdk destroy Afu9DatabaseStack

# Delete network stack
npx cdk destroy Afu9NetworkStack
```

**Note:** ECR repositories are retained by default. To delete them:

```bash
aws ecr delete-repository --repository-name afu9/control-center --force --region eu-central-1
aws ecr delete-repository --repository-name afu9/mcp-github --force --region eu-central-1
aws ecr delete-repository --repository-name afu9/mcp-deploy --force --region eu-central-1
aws ecr delete-repository --repository-name afu9/mcp-observability --force --region eu-central-1
```

## Cost Estimation

Approximate monthly costs for the default configuration:

- **ECS Fargate**: ~$30-40 (1 task, 1 vCPU, 2GB RAM)
- **ALB**: ~$20-25
- **RDS db.t4g.micro**: ~$15-20
- **NAT Gateway**: ~$30-35
- **Data Transfer**: Variable
- **CloudWatch Logs**: ~$5-10

**Total estimated cost**: ~$100-130/month

To reduce costs:
- Use RDS reserved instances
- Reduce NAT Gateway count (single NAT for development)
- Adjust CloudWatch log retention periods

## Security Best Practices

1. **Enable HTTPS**: Always use HTTPS in production. See [HTTPS-DNS-SETUP.md](./HTTPS-DNS-SETUP.md) for setup instructions
2. **Configure Custom Domain**: Use a custom domain with ACM certificate instead of ALB DNS
3. **HTTP to HTTPS Redirect**: Ensure HTTP traffic is redirected to HTTPS (automatic when using DNS stack)
4. **Rotate Secrets**: Regularly rotate GitHub tokens and API keys in Secrets Manager
5. **Enable MFA**: Require MFA for AWS console and CLI access
6. **Limit IAM Permissions**: Follow principle of least privilege for all IAM roles
7. **Enable CloudTrail**: Audit all AWS API calls
8. **Regular Updates**: Keep container images and dependencies up to date
9. **Network Isolation**: Keep RDS and ECS in private subnets (already configured)
10. **Enable VPC Flow Logs**: Monitor network traffic for security analysis
11. **Webhook Security**: Use webhook secrets for GitHub webhook validation
12. **TLS Policy**: Use modern TLS policies (TLS 1.2+ minimum)

## Support

For issues or questions:
- Check CloudWatch logs for errors
- Review [Architecture Documentation](./architecture/README.md)
- Open an issue in the GitHub repository
