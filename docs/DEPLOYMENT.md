# AFU-9 v0.2 Deployment Guide

This guide covers deploying AFU-9 Control Center on AWS ECS Fargate.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Node.js 20+ and npm
- Docker installed
- GitHub account and Personal Access Token

## Architecture Overview

AFU-9 v0.2 deploys as:
- **ECS Fargate**: 4 containers in a single task (Control Center + 3 MCP servers)
- **RDS Postgres**: Database for workflows and state
- **ALB**: Application Load Balancer for HTTPS termination
- **Secrets Manager**: For GitHub tokens, API keys, database credentials
- **CloudWatch**: Logs and metrics
- **ECR**: Container image registry

## Step 1: Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure

# Verify access
aws sts get-caller-identity
```

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

## Step 3: Create AWS Secrets

Store sensitive data in AWS Secrets Manager:

```bash
# GitHub credentials
aws secretsmanager create-secret \
  --name afu9/github \
  --description "AFU-9 GitHub credentials" \
  --secret-string "{\"token\":\"$GITHUB_TOKEN\"}" \
  --region $AWS_REGION

# LLM API keys
aws secretsmanager create-secret \
  --name afu9/llm \
  --description "AFU-9 LLM API keys" \
  --secret-string "{\"openai_api_key\":\"$OPENAI_API_KEY\"}" \
  --region $AWS_REGION

# Database credentials (auto-generated during CDK deployment)
# Or create manually:
aws secretsmanager create-secret \
  --name afu9/database \
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

```bash
# Bootstrap CDK (first time only)
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION

# Deploy the infrastructure stack
npx cdk deploy Afu9InfrastructureStack

# Note the outputs:
# - LoadBalancerDNS: xxx.eu-central-1.elb.amazonaws.com
# - DatabaseEndpoint: afu9-db.xxx.eu-central-1.rds.amazonaws.com
# - EcrControlCenterRepo: 123456789012.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center
```

## Step 6: Initialize Database

Connect to the RDS instance and run migrations:

```bash
# Get database credentials from Secrets Manager
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --query SecretString \
  --output text \
  --region $AWS_REGION)

DB_HOST=$(echo $DB_SECRET | jq -r '.host')
DB_USER=$(echo $DB_SECRET | jq -r '.username')
DB_PASSWORD=$(echo $DB_SECRET | jq -r '.password')

# Connect via bastion or VPN, then run migration
psql -h $DB_HOST -U $DB_USER -d afu9 -f database/migrations/001_initial_schema.sql
```

## Step 7: Build and Push Docker Images

### Build Control Center

```bash
cd control-center

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build image
docker build -t afu9/control-center:latest .

# Tag for ECR
docker tag afu9/control-center:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:latest

# Push to ECR
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/control-center:latest

cd ..
```

### Build MCP Servers

```bash
cd mcp-servers

# Build and push GitHub server
docker build -t afu9/mcp-github:latest -f github/Dockerfile .
docker tag afu9/mcp-github:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-github:latest

# Build and push Deploy server
docker build -t afu9/mcp-deploy:latest -f deploy/Dockerfile .
docker tag afu9/mcp-deploy:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-deploy:latest

# Build and push Observability server
docker build -t afu9/mcp-observability:latest -f observability/Dockerfile .
docker tag afu9/mcp-observability:latest \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/afu9/mcp-observability:latest

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
          docker build -t $ECR_REGISTRY/afu9/control-center:$IMAGE_TAG .
          docker push $ECR_REGISTRY/afu9/control-center:$IMAGE_TAG
          docker tag $ECR_REGISTRY/afu9/control-center:$IMAGE_TAG \
            $ECR_REGISTRY/afu9/control-center:latest
          docker push $ECR_REGISTRY/afu9/control-center:latest

      - name: Build and push MCP servers
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          cd mcp-servers
          
          # GitHub server
          docker build -t $ECR_REGISTRY/afu9/mcp-github:$IMAGE_TAG -f github/Dockerfile .
          docker push $ECR_REGISTRY/afu9/mcp-github:$IMAGE_TAG
          
          # Deploy server
          docker build -t $ECR_REGISTRY/afu9/mcp-deploy:$IMAGE_TAG -f deploy/Dockerfile .
          docker push $ECR_REGISTRY/afu9/mcp-deploy:$IMAGE_TAG
          
          # Observability server
          docker build -t $ECR_REGISTRY/afu9/mcp-observability:$IMAGE_TAG -f observability/Dockerfile .
          docker push $ECR_REGISTRY/afu9/mcp-observability:$IMAGE_TAG

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster afu9-cluster \
            --service afu9-control-center \
            --force-new-deployment \
            --region eu-central-1
```

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
  --secret-id afu9/github \
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
