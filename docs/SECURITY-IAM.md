# AFU-9 Security & IAM Guide

## Overview

This document describes the security architecture, IAM roles, secrets management, and best practices for AFU-9 v0.2.

## Table of Contents

- [IAM Roles & Policies](#iam-roles--policies)
- [Secrets Management](#secrets-management)
- [Network Security](#network-security)
- [Container Security](#container-security)
- [Security Best Practices](#security-best-practices)
- [Audit & Compliance](#audit--compliance)

## IAM Roles & Policies

AFU-9 follows the principle of **least privilege** with separate IAM roles for different purposes:

1. **Task Execution Role** - Used by ECS infrastructure
2. **Task Role** - Used by application containers
3. **GitHub Actions Deploy Role** - Used by CI/CD pipelines

### 1. Task Execution Role

**Role Name**: `afu9-ecs-task-execution-role`

**Purpose**: Used by the ECS service infrastructure to pull container images from ECR, write logs to CloudWatch, and inject secrets as environment variables.

**AWS Managed Policies**:
- `AmazonECSTaskExecutionRolePolicy` - Standard ECS task execution permissions

**Custom Permissions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SecretsManagerAccess",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:afu9/*"
      ]
    }
  ]
}
```

**Justification**:
- **ECR Access**: Required to pull Docker images at task startup
- **CloudWatch Logs**: Required to create log streams and send container logs
- **Secrets Manager**: Required to inject database credentials, GitHub tokens, and API keys as environment variables

**Created in**: `lib/afu9-ecs-stack.ts`

**Resource Scoping**: Secrets are scoped to `afu9/*` prefix only

---

### 2. Task Role

**Role Name**: `afu9-ecs-task-role`

**Purpose**: Used by application code running inside containers to access AWS services (RDS, CloudWatch, ECS).

**Permissions by Service**:

#### CloudWatch Logs
```json
{
  "Sid": "CloudWatchLogsAccess",
  "Effect": "Allow",
  "Action": [
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "logs:FilterLogEvents",
    "logs:DescribeLogStreams",
    "logs:DescribeLogGroups"
  ],
  "Resource": [
    "arn:aws:logs:region:account:log-group:/ecs/afu9/*",
    "arn:aws:logs:region:account:log-group:/ecs/afu9/*:log-stream:*"
  ]
}
```

**Justification**: MCP Observability server queries logs for monitoring and debugging. Scoped to AFU-9 log groups only.

#### CloudWatch Metrics
```json
{
  "Sid": "CloudWatchMetricsAccess",
  "Effect": "Allow",
  "Action": [
    "cloudwatch:GetMetricStatistics",
    "cloudwatch:GetMetricData",
    "cloudwatch:ListMetrics",
    "cloudwatch:DescribeAlarms",
    "cloudwatch:PutMetricData"
  ],
  "Resource": "*"
}
```

**Justification**: MCP Observability server reads metrics and alarms. CloudWatch Metrics doesn't support resource-level permissions.

#### ECS Service Management
```json
{
  "Sid": "ECSServiceManagement",
  "Effect": "Allow",
  "Action": [
    "ecs:DescribeServices",
    "ecs:DescribeTasks",
    "ecs:ListTasks",
    "ecs:DescribeTaskDefinition",
    "ecs:ListTaskDefinitions"
  ],
  "Resource": [
    "arn:aws:ecs:region:account:cluster/afu9-cluster",
    "arn:aws:ecs:region:account:service/afu9-cluster/*",
    "arn:aws:ecs:region:account:task/afu9-cluster/*",
    "arn:aws:ecs:region:account:task-definition/afu9-*:*"
  ]
}
```

**Justification**: MCP Deploy server needs to query ECS services and tasks. Scoped to AFU-9 cluster and resources only.

#### ECS Service Updates
```json
{
  "Sid": "ECSServiceUpdate",
  "Effect": "Allow",
  "Action": [
    "ecs:UpdateService"
  ],
  "Resource": [
    "arn:aws:ecs:region:account:service/afu9-cluster/*"
  ]
}
```

**Justification**: MCP Deploy server triggers deployments. Scoped to AFU-9 services only.

#### Secrets Manager (Application Access)
```json
{
  "Sid": "SecretsManagerRead",
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue"
  ],
  "Resource": [
    "arn:aws:secretsmanager:*:*:secret:afu9/*"
  ]
}
```

**Justification**: Application code may need to refresh secrets at runtime. Scoped to AFU-9 secrets only.

**Created in**: `lib/afu9-ecs-stack.ts`

---

### 3. GitHub Actions Deploy Role

**Role Name**: `afu9-github-actions-deploy-role`

**Purpose**: Used by GitHub Actions workflows to deploy container images and trigger ECS deployments.

**Authentication**: Uses OpenID Connect (OIDC) for secure, credential-less authentication from GitHub Actions.

**Trust Policy**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::account:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:org/repo:*"
        }
      }
    }
  ]
}
```

**Permissions by Service**:

#### ECR (Container Registry)
```json
{
  "Sid": "ECRAuthenticationAndImagePush",
  "Effect": "Allow",
  "Action": [
    "ecr:GetAuthorizationToken"
  ],
  "Resource": "*"
}
```

```json
{
  "Sid": "ECRRepositoryAccess",
  "Effect": "Allow",
  "Action": [
    "ecr:DescribeRepositories",
    "ecr:ListImages",
    "ecr:DescribeImages",
    "ecr:BatchCheckLayerAvailability",
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
    "ecr:InitiateLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload",
    "ecr:PutImage"
  ],
  "Resource": [
    "arn:aws:ecr:region:account:repository/afu9/*"
  ]
}
```

**Justification**: GitHub Actions builds and pushes Docker images. Scoped to AFU-9 repositories only.

#### ECS (Deployment Trigger)
```json
{
  "Sid": "ECSServiceUpdate",
  "Effect": "Allow",
  "Action": [
    "ecs:DescribeServices",
    "ecs:DescribeTasks",
    "ecs:DescribeTaskDefinition",
    "ecs:ListTasks",
    "ecs:UpdateService"
  ],
  "Resource": [
    "arn:aws:ecs:region:account:cluster/afu9-cluster",
    "arn:aws:ecs:region:account:service/afu9-cluster/*",
    "arn:aws:ecs:region:account:task/afu9-cluster/*",
    "arn:aws:ecs:region:account:task-definition/afu9-*:*"
  ]
}
```

**Justification**: GitHub Actions triggers ECS service updates after pushing images. Scoped to AFU-9 cluster only.

#### IAM (Pass Role)
```json
{
  "Sid": "IAMPassRole",
  "Effect": "Allow",
  "Action": [
    "iam:PassRole"
  ],
  "Resource": [
    "arn:aws:iam::account:role/afu9-ecs-task-role",
    "arn:aws:iam::account:role/afu9-ecs-task-execution-role"
  ],
  "Condition": {
    "StringEquals": {
      "iam:PassedToService": "ecs-tasks.amazonaws.com"
    }
  }
}
```

**Justification**: ECS needs permission to assume task roles. Scoped to AFU-9 roles and ECS service only.

**Created in**: `lib/afu9-iam-stack.ts`

**Deployment**:
```bash
# Deploy the IAM stack
npx cdk deploy Afu9IamStack \
  -c github-org=your-org \
  -c github-repo=your-repo

# Add the role ARN to GitHub Secrets as AWS_DEPLOY_ROLE_ARN
# Get the ARN from stack outputs
```

---

### Least Privilege Principles

AFU-9 IAM implementation follows these security best practices:

#### 1. Separation of Concerns
- **Task Execution Role**: Only ECS infrastructure operations (pull images, write logs)
- **Task Role**: Only application operations (query AWS services)
- **Deploy Role**: Only CI/CD operations (push images, trigger deployments)

#### 2. Resource-Level Scoping
- Secrets: Scoped to `afu9/*` prefix
- ECR: Scoped to `afu9/*` repositories
- ECS: Scoped to `afu9-cluster` and its resources
- CloudWatch Logs: Scoped to `/ecs/afu9/*` log groups

#### 3. Action Minimization
- Read-only permissions by default
- Write permissions only where necessary (e.g., `ecs:UpdateService`)
- No `*` actions or wildcard permissions

#### 4. Condition Keys
- IAM PassRole: Conditioned on `iam:PassedToService` = `ecs-tasks.amazonaws.com`
- GitHub OIDC: Conditioned on specific repository

#### 5. Time-Based Restrictions
- Deploy role: 1-hour maximum session duration
- Prevents long-lived credential exposure

#### 6. No Long-Term Credentials
- GitHub Actions uses OIDC (no access keys)
- Application uses IAM roles (no credentials in code)
- Secrets in AWS Secrets Manager (encrypted at rest)

## Secrets Management

### Overview

All sensitive credentials are stored in AWS Secrets Manager with encryption at rest using AWS KMS.

### Secrets Structure

#### 1. Database Secret (`afu9/database`)

Created automatically by `Afu9DatabaseStack` when RDS instance is created.

```json
{
  "host": "afu9-db.xxxx.eu-central-1.rds.amazonaws.com",
  "port": "5432",
  "database": "afu9",
  "username": "afu9_admin",
  "password": "auto-generated-password"
}
```

**Rotation**: Automatic every 90 days

#### 2. GitHub Secret (`afu9/github`)

Created by `Afu9EcsStack` with placeholder values.

```json
{
  "token": "ghp_...",
  "owner": "your-github-org",
  "repo": "your-repo"
}
```

**Update after deployment**:
```bash
aws secretsmanager update-secret \
  --secret-id afu9/github \
  --secret-string '{
    "token": "ghp_your_real_token",
    "owner": "your-org",
    "repo": "your-repo"
  }'
```

**Required Scopes**:
- `repo` - Full control of private repositories
- `workflow` - Update GitHub Action workflows
- `write:org` - Read and write org data (if org-level operations needed)

**Rotation**: Manual, when token expires or is compromised

#### 3. LLM API Keys Secret (`afu9/llm`)

Created by `Afu9EcsStack` with placeholder values.

```json
{
  "openai_api_key": "sk-...",
  "anthropic_api_key": "sk-ant-api03-..."
}
```

**Update after deployment**:
```bash
aws secretsmanager update-secret \
  --secret-id afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-your-openai-key",
    "anthropic_api_key": "sk-ant-api03-your-anthropic-key"
  }'
```

**Rotation**: Manual, recommended quarterly or when compromised

### Secret Access Pattern

Secrets are injected as environment variables in ECS task definitions:

```typescript
secrets: {
  DATABASE_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
  DATABASE_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
  DATABASE_NAME: ecs.Secret.fromSecretsManager(dbSecret, 'database'),
  DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
  DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
  GITHUB_TOKEN: ecs.Secret.fromSecretsManager(githubSecret, 'token'),
  OPENAI_API_KEY: ecs.Secret.fromSecretsManager(llmSecret, 'openai_api_key'),
}
```

### Best Practices

1. **Never commit secrets to code**: Use environment variables and Secrets Manager
2. **Rotate regularly**: Database passwords every 90 days, API keys quarterly
3. **Use least privilege**: Only grant access to secrets that are needed
4. **Audit access**: Monitor CloudTrail for secret access patterns
5. **Encrypt at rest**: All secrets encrypted with KMS (automatic)
6. **Encrypt in transit**: TLS for all API calls to Secrets Manager

## Network Security

### VPC Architecture

- **Private Subnets**: ECS tasks and RDS run in private subnets with no direct internet access
- **NAT Gateway**: Outbound internet access for private subnets (GitHub API, LLM APIs)
- **Security Groups**: Fine-grained access control between components

### Security Groups

#### ALB Security Group
```
Inbound:
  - Port 443 (HTTPS) from 0.0.0.0/0
  - Port 80 (HTTP) from 0.0.0.0/0
Outbound:
  - Port 3000 (HTTP) to ECS Security Group
```

#### ECS Security Group
```
Inbound:
  - Port 3000 from ALB Security Group
Outbound:
  - Port 443 (HTTPS) to 0.0.0.0/0 (for GitHub, LLM APIs)
  - Port 5432 to RDS Security Group
```

#### RDS Security Group
```
Inbound:
  - Port 5432 from ECS Security Group only
Outbound:
  - None
```

### Encryption

- **In Transit**: 
  - ALB uses HTTPS with TLS 1.2+ (via ACM certificate)
  - RDS connections use TLS
  - All AWS API calls use HTTPS

- **At Rest**:
  - RDS: AES-256 encryption enabled
  - Secrets Manager: KMS encryption
  - CloudWatch Logs: Encrypted by default
  - EBS volumes: Encrypted

## Container Security

### Image Security

1. **Base Images**: Use official, minimal images (Alpine, Distroless)
2. **Vulnerability Scanning**: ECR Image Scanning enabled on push
3. **Immutable Tags**: ECR configured with immutable tags
4. **Lifecycle Policies**: Keep only last 10 images

### Runtime Security

1. **Non-root User**: Containers run as non-root user
2. **Read-only Filesystem**: Where possible, mount filesystem as read-only
3. **Resource Limits**: CPU and memory limits set on all containers
4. **Network Isolation**: Containers communicate only via localhost in ECS task
5. **No Privileged Mode**: Containers never run in privileged mode

### Example Dockerfile Security

```dockerfile
FROM node:18-alpine

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy dependencies
COPY --chown=nodejs:nodejs package*.json ./
RUN npm ci --only=production

# Copy application
COPY --chown=nodejs:nodejs . .

# Build application
RUN npm run build

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

## Security Best Practices

### 1. Input Validation

All API routes should validate and sanitize input:

```typescript
import { logger } from '@/lib/logger';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.workflowId || typeof body.workflowId !== 'string') {
      return NextResponse.json(
        { error: 'Invalid workflowId' },
        { status: 400 }
      );
    }
    
    // Sanitize input (example: remove special characters)
    const sanitizedId = body.workflowId.replace(/[^a-zA-Z0-9-_]/g, '');
    
    // Continue with validated input...
  } catch (error) {
    logger.error('Invalid request', error);
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
```

### 2. Error Handling

Never expose sensitive information in error messages:

```typescript
try {
  // Operation
} catch (error) {
  // Log full error for debugging
  logger.error('Database operation failed', error, { userId });
  
  // Return generic error to client
  return NextResponse.json(
    { error: 'Operation failed' },
    { status: 500 }
  );
}
```

### 3. Rate Limiting

Implement rate limiting for API endpoints (consider using middleware):

```typescript
// Example: Simple in-memory rate limiter
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimiter.get(ip);
  
  if (!record || record.resetAt < now) {
    rateLimiter.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (record.count >= limit) {
    return false;
  }
  
  record.count++;
  return true;
}
```

### 4. CORS Configuration

Configure CORS appropriately for your environment:

```typescript
// For production, restrict to specific domains
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://afu9.yourdomain.com']
  : ['http://localhost:3000'];
```

### 5. Secure Headers

Set security headers in Next.js config:

```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};
```

## Audit & Compliance

### CloudTrail Logging

Enable CloudTrail for audit logging of AWS API calls:

```bash
aws cloudtrail create-trail \
  --name afu9-audit-trail \
  --s3-bucket-name afu9-audit-logs \
  --is-multi-region-trail \
  --enable-log-file-validation
```

### Monitoring Secret Access

Monitor Secrets Manager access via CloudWatch Logs:

```bash
# Create metric filter for secret access
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail \
  --filter-name afu9-secret-access \
  --filter-pattern '{ $.eventName = "GetSecretValue" && $.requestParameters.secretId = "afu9/*" }' \
  --metric-transformations \
    metricName=SecretAccess,metricNamespace=AFU9/Security,metricValue=1
```

### Security Checklist

- [ ] All secrets stored in Secrets Manager
- [ ] IAM roles follow least privilege principle
- [ ] Database connections encrypted with TLS
- [ ] HTTPS enabled on ALB with valid certificate
- [ ] CloudTrail enabled for audit logging
- [ ] CloudWatch alarms configured for security events
- [ ] ECR image scanning enabled
- [ ] ECS tasks run in private subnets
- [ ] Security groups restrict access appropriately
- [ ] Regular security updates for dependencies
- [ ] Secrets rotation policies in place
- [ ] Input validation on all API endpoints
- [ ] Rate limiting implemented
- [ ] Error messages don't expose sensitive data
- [ ] Security headers configured

### Incident Response

1. **Detection**: CloudWatch alarms notify of suspicious activity
2. **Investigation**: Check CloudTrail and application logs
3. **Containment**: Rotate compromised secrets immediately
4. **Remediation**: Update IAM policies, security groups as needed
5. **Recovery**: Verify system integrity, restore from backups if needed
6. **Post-Mortem**: Document incident and update security procedures

### Secrets Rotation Procedure

**Database Password**:
```bash
# Automated rotation via Secrets Manager
aws secretsmanager rotate-secret \
  --secret-id afu9/database \
  --rotation-lambda-arn arn:aws:lambda:region:account:function:afu9-rotate-db-password
```

**GitHub Token**:
1. Create new token in GitHub with same scopes
2. Update secret in Secrets Manager
3. Verify applications can connect
4. Revoke old token in GitHub

**LLM API Keys**:
1. Generate new API key from provider
2. Update secret in Secrets Manager
3. Verify applications can connect
4. Revoke old API key

## References

- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [ECS Security Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/security.html)
- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [VPC Security](https://docs.aws.amazon.com/vpc/latest/userguide/security.html)
- [OWASP Security Cheat Sheet](https://cheatsheetseries.owasp.org/)

## Contact

For security concerns or to report vulnerabilities, contact the security team at security@yourdomain.com.
