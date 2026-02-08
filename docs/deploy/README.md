# AFU-9 Deployment Guide

**Purpose:** AWS deployment procedures for AFU-9 Control Platform

**Audience:** DevOps engineers, platform operators

---

## Quick Reference

- **[Deploy Checklist](AFU9_DEPLOY_CHECKLIST.md)** - Pre-deployment verification checklist
- **[Deploy Intent](AFU9_DEPLOY_INTENT.md)** - Deployment goals and constraints
- **[Deploy System Prompt](AFU9_DEPLOY_SYSTEM_PROMPT.md)** - Automated deployment configuration

---

## Prerequisites

### AWS Account Setup

1. **AWS Account** with admin access
2. **AWS CLI** configured with credentials
   ```bash
   aws configure
   # AWS Access Key ID: [your-key]
   # AWS Secret Access Key: [your-secret]
   # Default region: eu-central-1
   ```

3. **CDK Bootstrap** (one-time setup)
   ```bash
   npx cdk bootstrap aws://ACCOUNT-ID/eu-central-1
   ```

### Local Environment

- **Node.js**: 20.x or higher
- **npm**: 10.x or higher
- **AWS CDK**: 2.162.1 or higher
- **Docker**: For building container images

---

## Deployment Steps

### 1. Configure Secrets

Store secrets in AWS Secrets Manager before deployment:

```bash
# GitHub Personal Access Token
aws secretsmanager create-secret \
  --name /afu9/github/token \
   --secret-string '{"token":"<YOUR_GITHUB_TOKEN>"}' \
  --region eu-central-1

# OpenAI API Key
aws secretsmanager create-secret \
  --name /afu9/openai/api-key \
   --secret-string '{"apiKey":"<YOUR_OPENAI_API_KEY>"}' \
  --region eu-central-1

# Database Credentials
aws secretsmanager create-secret \
  --name /afu9/database/credentials \
  --secret-string '{"username":"afu9_admin","password":"your_secure_password"}' \
  --region eu-central-1
```

### 2. Synthesize CloudFormation Template

```bash
npm run synth
# Output: cdk.out/AFU9ControlStack.template.json
```

**Review the synthesized template:**
- VPC configuration
- ECS task definitions
- RDS database setup
- Security groups
- IAM roles and policies

### 3. Deploy Infrastructure

```bash
npm run deploy
# Deploys: VPC, ECS Cluster, RDS, ALB, Secrets Manager references
```

**Expected duration:** 15-20 minutes

**Resources created:**
- VPC with public/private subnets (multi-AZ)
- Application Load Balancer (HTTPS)
- ECS Fargate cluster
- RDS PostgreSQL 15 (multi-AZ)
- CloudWatch log groups
- IAM roles and security groups

### 4. Verify Deployment

```bash
# Run determinism check
npm run determinism:check

# Check ECS service status
aws ecs describe-services \
  --cluster afu9-control-cluster \
  --services afu9-control-service \
  --region eu-central-1

# Check RDS status
aws rds describe-db-instances \
  --db-instance-identifier afu9-control-db \
  --region eu-central-1
```

### 5. Initialize Database

```bash
# Connect to RDS instance
psql -h <rds-endpoint> -U afu9_admin -d afu9_control

# Run migrations
\i database/migrations/001_initial_schema.sql
\i database/migrations/002_runs_ledger.sql
\i database/migrations/003_issue_events.sql
```

### 6. Configure DNS (Optional)

```bash
# Get ALB DNS name
aws elbv2 describe-load-balancers \
  --region eu-central-1 \
  --query "LoadBalancers[?LoadBalancerName=='afu9-control-alb'].DNSName" \
  --output text

# Create Route 53 CNAME record pointing to ALB DNS name
# Example: afu9.yourdomain.com → afu9-control-alb-123456789.eu-central-1.elb.amazonaws.com
```

### 7. Access Application

```bash
# Via ALB DNS
https://<alb-dns-name>

# Via custom domain (if configured)
https://afu9.yourdomain.com
```

---

## Post-Deployment Verification

### Health Checks

```bash
# Control Center health endpoint
curl https://<alb-dns-name>/api/health

# Expected response:
# {"status":"ok","version":"0.6.5"}
```

### Execution Capability Matrix (S3 Implement)

Policy:
- Preview: enabled (when required env vars are present)
- Prod: enabled

Required env vars for S3 execution:
- AFU9_STAGE
- AFU9_GITHUB_EVENTS_QUEUE_URL
- MCP_RUNNER_URL (or MCP_RUNNER_ENDPOINT)
- GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PEM (or GITHUB_APP_SECRET_ID)

If any required config is missing, POST /api/control/afu9/s1s3/issues/:id/implement returns
503 DISPATCH_DISABLED with a requiredConfig list.

### S3 Implement Smoke Test

Logged-in user:

```bash
curl -X POST https://<alb-dns-name>/api/control/afu9/s1s3/issues/<issue-id>/implement \
   -H "Content-Type: application/json" \
   -H "x-request-id: smoke-s3-001" \
   -d '{"baseBranch":"main"}'
```

Expected:
- HTTP 202
- JSON contains {"runId": "...", "mutationId": "..."}
- UI RunsHistoryPanel shows the new run
- requestId propagation intact in headers (x-afu9-request-id or x-request-id)

### Deploy Status Monitor

```bash
# Check deploy status
curl https://<alb-dns-name>/api/deploy/status

# Expected: GREEN (all checks pass)
```

### Run Post-Deploy Verification Playbook

```bash
# Trigger verification workflow
npm run deploy:verify

# Or via API
curl -X POST https://<alb-dns-name>/api/deploy/verify \
  -H "Content-Type: application/json" \
  -d '{"environment":"production"}'
```

---

## Rollback Procedures

### Full Rollback

```bash
# Destroy entire stack (CAUTION!)
npm run destroy

# Confirm destruction
# This will delete: VPC, ECS, RDS, ALB, etc.
```

### Partial Rollback (ECS Service Only)

```bash
# Update ECS service to previous task definition
aws ecs update-service \
  --cluster afu9-control-cluster \
  --service afu9-control-service \
  --task-definition afu9-control-task:PREVIOUS_REVISION \
  --region eu-central-1
```

### Database Rollback

```bash
# Restore from automated snapshot
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier afu9-control-db-restored \
  --db-snapshot-identifier <snapshot-id> \
  --region eu-central-1
```

---

## Monitoring & Logs

### CloudWatch Logs

```bash
# View Control Center logs
aws logs tail /ecs/afu9-control-center --follow --region eu-central-1

# View MCP server logs
aws logs tail /ecs/afu9-mcp-github --follow --region eu-central-1
```

### Deploy Status Dashboard

Access: `https://<your-domain>/deploy/status`

- **GREEN:** All systems operational
- **YELLOW:** Degraded performance
- **RED:** Critical failures

### Alerts

Configure SNS topic for alerts:

```bash
aws sns create-topic --name afu9-alerts --region eu-central-1

aws sns subscribe \
  --topic-arn arn:aws:sns:eu-central-1:ACCOUNT-ID:afu9-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com
```

---

## Cost Optimization

### Estimated Monthly Costs (eu-central-1)

| Service | Configuration | Estimated Cost |
|---------|--------------|----------------|
| ECS Fargate | 2 tasks × 1280 CPU, 2560 MB | ~$60/month |
| RDS PostgreSQL | db.t3.small, multi-AZ | ~$50/month |
| ALB | 1 load balancer | ~$20/month |
| NAT Gateway | 2 NAT gateways (multi-AZ) | ~$70/month |
| Data Transfer | Moderate traffic | ~$10/month |
| **Total** | | **~$210/month** |

### Cost Reduction Options

1. **Single-AZ Deployment** (non-production)
   - Remove multi-AZ for RDS: -$25/month
   - Single NAT gateway: -$35/month

2. **Smaller RDS Instance**
   - Use db.t3.micro: -$30/month
   - WARNING: May impact performance

3. **Fargate Spot** (non-production)
   - Use Fargate Spot capacity: -$20/month
   - WARNING: Task interruptions possible

---

## Troubleshooting

### ECS Task Fails to Start

**Symptom:** Tasks enter STOPPED state immediately

**Common Causes:**
1. Secrets not accessible
   ```bash
   # Check IAM role permissions
   aws iam get-role-policy --role-name afu9-ecs-task-role --policy-name SecretsAccess
   ```

2. Image pull failure
   ```bash
   # Check ECR repository
   aws ecr describe-repositories --region eu-central-1
   ```

3. Health check failure
   ```bash
   # Check CloudWatch logs
   aws logs tail /ecs/afu9-control-center --since 10m
   ```

### Database Connection Failures

**Symptom:** Control Center cannot connect to RDS

**Solutions:**
1. Check security group rules
   ```bash
   # Verify ECS security group can access RDS on port 5432
   aws ec2 describe-security-groups --group-ids <rds-sg-id>
   ```

2. Verify connection string
   ```bash
   # Check environment variable
   aws ecs describe-task-definition --task-definition afu9-control-task | \
     grep -A 5 DATABASE_URL
   ```

### ALB Health Check Failures

**Symptom:** ALB marks targets as unhealthy

**Solutions:**
1. Verify health check endpoint
   ```bash
   curl http://<task-private-ip>:3000/api/health
   ```

2. Check CloudWatch logs for errors
   ```bash
   aws logs tail /ecs/afu9-control-center --filter-pattern "ERROR"
   ```

---

## Security Considerations

### Network Security

- **Private Subnets:** ECS tasks and RDS in private subnets (no direct internet access)
- **NAT Gateway:** Outbound internet access for GitHub API calls
- **Security Groups:** Least privilege (ALB → ECS on 3000, ECS → RDS on 5432)

### IAM Security

- **Task Role:** Minimal permissions (Secrets Manager read, CloudWatch logs write)
- **Execution Role:** ECR image pull, CloudWatch logs
- **Validation:** Run `npm run validate-iam` before deployment

### Secrets Security

- **AWS Secrets Manager:** All secrets stored securely
- **No hardcoded credentials:** Validated via `npm run validate-secrets`
- **Rotation:** Rotate secrets every 90 days (recommended)

---

## Maintenance

### Regular Tasks

**Weekly:**
- Review CloudWatch logs for errors
- Check deploy status monitor (should be GREEN)
- Verify disk space on RDS

**Monthly:**
- Review AWS costs
- Update dependencies (npm packages)
- Rotate secrets (if required)

**Quarterly:**
- Update CDK version
- Review and update IAM policies
- Performance tuning (if needed)

### Updates & Patches

```bash
# Update application code
git pull origin main
npm run build
npm run deploy

# Update CDK infrastructure
npm install aws-cdk-lib@latest
npm run synth
npm run deploy
```

---

## Related Documentation

- **[Architecture Overview](../architecture/README.md)** - System architecture
- **[v0.6 Docs](../v06/README.md)** - Feature documentation
- **[v0.6.5 Docs](../v065/README.md)** - Security hardening
- **[Root README](../../README.md)** - Quick start guide

---

**Maintained by:** AFU-9 DevOps Team  
**Last Updated:** 2025-12-30  
**Version:** v0.6.5
