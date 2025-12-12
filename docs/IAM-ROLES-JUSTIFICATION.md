# AFU-9 IAM Roles & Policies - Detailed Justification

This document provides a comprehensive explanation of all IAM roles and policies defined for AFU-9, with detailed justifications following the principle of least privilege.

## Overview

AFU-9 uses three distinct IAM roles, each with minimal permissions scoped to specific resources:

1. **ECS Task Execution Role** (`afu9-ecs-task-execution-role`) - Infrastructure operations
2. **ECS Task Role** (`afu9-ecs-task-role`) - Application operations  
3. **GitHub Actions Deploy Role** (`afu9-github-actions-deploy-role`) - CI/CD operations

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         AWS Account                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                    ECS Fargate Task                     │    │
│  │                                                         │    │
│  │  ┌──────────────────────────────────────────────────┐  │    │
│  │  │            Task Execution Role                    │  │    │
│  │  │  • Pull ECR images                               │  │    │
│  │  │  • Write CloudWatch Logs                         │  │    │
│  │  │  • Read Secrets Manager                          │  │    │
│  │  └──────────────────────────────────────────────────┘  │    │
│  │                                                         │    │
│  │  ┌──────────────────────────────────────────────────┐  │    │
│  │  │              Task Role                            │  │    │
│  │  │  • Application AWS API calls                     │  │    │
│  │  │  • Query CloudWatch Logs/Metrics                 │  │    │
│  │  │  • Manage ECS services                           │  │    │
│  │  │  • Read Secrets Manager                          │  │    │
│  │  └──────────────────────────────────────────────────┘  │    │
│  │                                                         │    │
│  │  ┌────────────┐  ┌──────────┐  ┌────────────────┐     │    │
│  │  │ Control    │  │   MCP    │  │  MCP Deploy    │     │    │
│  │  │ Center     │  │Observ.   │  │  Server        │     │    │
│  │  │ Container  │  │Container │  │  Container     │     │    │
│  │  └────────────┘  └──────────┘  └────────────────┘     │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │         GitHub Actions Deploy Role                      │    │
│  │  • Push to ECR                                         │    │
│  │  • Trigger ECS deployments                             │    │
│  │  • Pass roles to ECS                                   │    │
│  └────────────────────────────────────────────────────────┘    │
│                  ▲                                              │
│                  │ OIDC (no long-term credentials)              │
└──────────────────┼──────────────────────────────────────────────┘
                   │
            ┌──────┴──────┐
            │   GitHub    │
            │   Actions   │
            └─────────────┘
```

## 1. ECS Task Execution Role

### Purpose

The Task Execution Role is used by the **ECS service infrastructure** (not by application code) to:
- Pull Docker images from Amazon ECR
- Send container logs to CloudWatch Logs
- Inject secrets from AWS Secrets Manager as environment variables

### Separation of Concerns

This role is separate from the Task Role to enforce the **separation of infrastructure concerns** from application concerns. ECS infrastructure needs different permissions than the application code.

### Permissions Breakdown

#### AWS Managed Policy: `AmazonECSTaskExecutionRolePolicy`

**Actions Granted**:
```
ecr:GetAuthorizationToken
ecr:BatchCheckLayerAvailability
ecr:GetDownloadUrlForLayer
ecr:BatchGetImage
logs:CreateLogStream
logs:PutLogEvents
```

**Justification**: This AWS-managed policy provides the minimum permissions needed for ECS to:
- Authenticate with ECR
- Pull container image layers
- Create and write to CloudWatch log streams

**Risk Assessment**: Low risk - these permissions are scoped to the ECS service and cannot be abused by application code.

#### Custom Policy: Secrets Manager Access

```json
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
```

**Justification**: 
- ECS needs to read secrets to inject them as environment variables at container startup
- Scoped to only secrets with the `afu9/*` prefix
- Cannot access secrets from other applications or services

**Why Not Use Application Role**: ECS infrastructure needs access to secrets before the application starts, so the task execution role must have this permission.

**Alternative Considered**: Using AWS Systems Manager Parameter Store - rejected because Secrets Manager provides better rotation support and encryption options.

---

## 2. ECS Task Role

### Purpose

The Task Role is used by **application code running inside containers** to make AWS API calls. Different MCP servers within AFU-9 use these permissions:

- **MCP Observability Server**: Queries CloudWatch Logs and Metrics
- **MCP Deploy Server**: Manages ECS services and deployments
- **Control Center**: Accesses secrets at runtime (if needed)

### Permissions Breakdown

#### CloudWatch Logs Access

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

**Used By**: MCP Observability Server

**Justification**: 
- Observability server needs to query logs for monitoring and debugging
- `FilterLogEvents` allows searching logs by pattern
- `DescribeLogStreams` enables listing available log streams

**Resource Scoping**: Limited to `/ecs/afu9/*` log groups only. Cannot access logs from:
- Other applications
- AWS service logs (e.g., VPC Flow Logs, CloudTrail)
- Other ECS services

**Why Not More Restrictive**: CloudWatch Logs permissions don't support fine-grained resource-level control for `FilterLogEvents` at the log-stream level, only at log-group level.

**Risk Assessment**: Medium-low risk - can read application logs but cannot modify them or access other applications' logs.

#### CloudWatch Metrics Access

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

**Used By**: MCP Observability Server, Control Center

**Justification**:
- `GetMetricStatistics` / `GetMetricData`: Query metrics for monitoring dashboards
- `ListMetrics`: Discover available metrics
- `DescribeAlarms`: Check alarm status for alerting
- `PutMetricData`: Publish custom application metrics

**Why Resource = "*"**: CloudWatch Metrics is a global service that doesn't support resource-level permissions. This is an AWS limitation.

**Mitigation**: 
- Metrics are namespaced by application (e.g., `AFU9/Application`)
- Application code only publishes to its own namespace
- Read operations have no destructive impact

**Alternative Considered**: Removing `PutMetricData` - rejected because custom metrics are valuable for application monitoring.

**Risk Assessment**: Low risk - read-only operations plus publishing custom metrics (which is safe).

#### ECS Service Management (Read)

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

**Used By**: MCP Deploy Server, MCP Observability Server

**Justification**:
- Deploy server needs to check deployment status
- Observability server monitors task health
- All actions are **read-only**

**Resource Scoping**: Limited to:
- `afu9-cluster` only
- Tasks and services within that cluster
- Task definitions starting with `afu9-*`

Cannot access:
- Other ECS clusters
- Services from other applications
- Task definitions from other teams

**Risk Assessment**: Very low risk - read-only operations with tight resource scoping.

#### ECS Service Updates (Write)

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

**Used By**: MCP Deploy Server

**Justification**: Deploy server needs to trigger ECS service updates (e.g., force new deployment, change desired count).

**Why Separate Statement**: `UpdateService` is the only write operation and is separated for clarity and future refinement.

**Resource Scoping**: 
- Limited to services in `afu9-cluster` only
- Cannot update services in other clusters
- Cannot modify task definitions (read-only access)

**Alternative Considered**: Using GitHub Actions exclusively for deployments - rejected because MCP Deploy Server provides deployment capabilities for automated workflows.

**Risk Assessment**: Medium risk - can trigger deployments but cannot:
- Modify IAM roles
- Change security groups
- Modify task definitions
- Access other clusters

**Mitigation**: 
- Deployments use existing task definitions
- Circuit breaker automatically rolls back failed deployments
- CloudWatch alarms alert on deployment issues

#### Secrets Manager Access (Runtime)

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

**Used By**: All containers (if secrets need refreshing at runtime)

**Justification**: 
- Secrets are primarily injected at startup via Task Execution Role
- This permission allows refreshing secrets at runtime (e.g., after rotation)
- Required for long-running processes that need to handle secret rotation

**Resource Scoping**: Limited to secrets with `afu9/*` prefix.

**Why Duplicate Permission**: Task Execution Role reads secrets once at startup; Task Role can refresh them during runtime.

**Alternative Considered**: Remove this permission and require restarts for secret rotation - rejected because it reduces availability during rotations.

**Risk Assessment**: Low risk - read-only access to application secrets only.

---

## 3. GitHub Actions Deploy Role

### Purpose

This role allows GitHub Actions workflows to deploy AFU-9 services without long-term AWS credentials. It uses **OpenID Connect (OIDC)** for secure, temporary credential exchange.

### Trust Policy (Assume Role)

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

**Justification**:
- **No Long-Term Credentials**: Uses OIDC tokens from GitHub, eliminating need for AWS access keys
- **Repository-Scoped**: Only workflows from specified GitHub org/repo can assume this role
- **Audience Check**: Validates the token is intended for AWS STS
- **Short-Lived Sessions**: Maximum 1-hour session duration

**Security Benefits**:
- No secret rotation needed
- No risk of leaked credentials in GitHub Secrets
- Automatic expiration of credentials
- Auditable via CloudTrail

**Alternative Considered**: Using IAM User with access keys - rejected due to:
- Need for secret rotation
- Risk of credential leakage
- Lack of automatic expiration

### Permissions Breakdown

#### ECR Authentication

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

**Justification**: Required to authenticate with ECR before pushing images.

**Why Resource = "*"**: `GetAuthorizationToken` doesn't support resource-level permissions (AWS limitation).

**Risk Assessment**: Very low risk - only allows authentication, not actual image operations.

#### ECR Repository Access

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

**Justification**:
- Read operations: Check existing images, verify layers
- Write operations: Push new Docker images

**Resource Scoping**: Limited to repositories under `afu9/*` prefix. Cannot:
- Push to other application repositories
- Modify ECR lifecycle policies
- Delete images (no `DeleteImage` permission)

**Risk Assessment**: Medium-low risk - can push images but:
- Limited to AFU-9 repositories
- Images are scanned on push
- Cannot delete existing images
- Lifecycle policies automatically clean up old images

#### ECS Service Updates

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

**Justification**: After pushing images, GitHub Actions triggers ECS service update to deploy new version.

**Resource Scoping**: 
- Limited to `afu9-cluster` only
- Cannot modify other clusters or applications

**Why UpdateService Needed**: Forces ECS to pull new images with `:latest` tag.

**Risk Assessment**: Medium risk - can trigger deployments but:
- Circuit breaker prevents broken deployments
- CloudWatch alarms detect failures
- Cannot modify task definitions
- Cannot change IAM roles or security groups

#### IAM Pass Role

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

**Justification**: Required for ECS to use IAM roles when running tasks.

**Resource Scoping**:
- Limited to exactly two roles: task role and task execution role
- Cannot pass arbitrary IAM roles

**Condition Key**: Can only pass roles to `ecs-tasks.amazonaws.com`, not to:
- Lambda functions
- EC2 instances  
- Other services

**Why Needed**: Without PassRole, ECS cannot assume the roles needed to run tasks.

**Risk Assessment**: Low risk - highly constrained permission:
- Only two specific roles
- Only to ECS tasks
- Roles themselves are least-privilege

**Alternative Considered**: Remove this permission - rejected because it breaks deployments.

---

## Security Best Practices Implemented

### 1. Principle of Least Privilege

✅ **Each role has only the minimum permissions needed**
- Task Execution Role: Infrastructure operations only
- Task Role: Application operations only, scoped by MCP server needs
- Deploy Role: CI/CD operations only

✅ **Resource-level scoping wherever possible**
- Secrets: `afu9/*` prefix
- ECR: `afu9/*` repositories
- ECS: `afu9-cluster` and its resources
- CloudWatch Logs: `/ecs/afu9/*` log groups

✅ **No wildcard actions**
- All actions explicitly listed
- No `*` in Action field

### 2. Separation of Concerns

✅ **Infrastructure vs Application**
- Task Execution Role separate from Task Role
- Clear separation of when each role is used

✅ **Runtime vs Deployment**
- Task Role for runtime operations
- Deploy Role for CI/CD operations

### 3. Defense in Depth

✅ **Multiple layers of security**
- IAM roles (authorization)
- Security groups (network layer)
- Secrets Manager (credential management)
- VPC private subnets (network isolation)

### 4. No Long-Term Credentials

✅ **OIDC for GitHub Actions**
- No AWS access keys stored in GitHub
- Automatic credential expiration
- Repository-scoped access

✅ **IAM roles for ECS**
- No credentials in container images
- Temporary credentials from instance metadata

### 5. Audit and Monitoring

✅ **CloudTrail logging**
- All IAM role assumptions logged
- All API calls logged with role identity

✅ **CloudWatch alarms**
- Monitor unauthorized API calls
- Detect deployment failures

### 6. Conditions and Constraints

✅ **IAM PassRole condition**
- Can only pass roles to ECS tasks

✅ **OIDC conditions**
- GitHub repository validation
- Audience validation

✅ **Session duration limits**
- Deploy role: 1 hour maximum

---

## Comparison with Alternative Approaches

### Alternative 1: Single IAM Role for Everything

**Rejected Reason**: Violates separation of concerns
- Blurs line between infrastructure and application permissions
- Makes it harder to audit which component is making which API call
- Increases blast radius if role is compromised

### Alternative 2: More Granular Roles per Container

**Rejected Reason**: Adds complexity without significant security benefit
- ECS tasks share the same task role across containers
- Would require separate task definitions for each container
- Network communication between containers would need IAM authentication

### Alternative 3: Using IAM Users Instead of Roles

**Rejected Reason**: Requires long-term credentials
- Need to rotate access keys regularly
- Risk of credential leakage
- Harder to audit (users can be shared, roles show which service assumed them)

### Alternative 4: Removing Deploy Role, Using AWS Console for Deployments

**Rejected Reason**: Not scalable or automatable
- Manual deployments are error-prone
- Cannot implement CI/CD
- Doesn't support automated rollback

---

## Compliance and Standards

### AWS Well-Architected Framework

✅ **Security Pillar**
- Identity and Access Management: Least privilege IAM policies
- Detective Controls: CloudTrail and CloudWatch monitoring
- Data Protection: Secrets Manager for sensitive data

✅ **Reliability Pillar**
- Change Management: Automated deployments with circuit breaker
- Failure Management: CloudWatch alarms and automatic rollback

### CIS AWS Foundations Benchmark

✅ **1.12**: Ensure credentials unused for 90 days are disabled
- Using IAM roles (no long-term credentials)

✅ **1.16**: Ensure IAM policies are attached only to groups or roles
- All policies attached to roles, not users

✅ **1.20**: Ensure a support role has been created
- Separate roles for different purposes

---

## Deployment Instructions

### 1. Deploy the IAM Stack

```bash
# Deploy IAM stack with your GitHub repository details
npx cdk deploy Afu9IamStack \
  -c github-org=adaefler-art \
  -c github-repo=codefactory-control
```

### 2. Configure GitHub Repository

Add the deploy role ARN to your GitHub repository secrets:

1. Go to repository Settings → Secrets and variables → Actions
2. Add new repository secret:
   - Name: `AWS_DEPLOY_ROLE_ARN`
   - Value: (from stack output `DeployRoleArn`)

### 3. Verify Permissions

Test the deployment:

```bash
# Manually trigger the deploy-ecs workflow
gh workflow run deploy-ecs.yml
```

---

## Troubleshooting

### Permission Denied Errors

If you see `AccessDenied` errors:

1. **Check CloudTrail** for the exact API call that failed
2. **Verify resource ARN** matches the policy resource pattern
3. **Check conditions** (e.g., PassRole condition on correct service)

### OIDC Authentication Failures

If GitHub Actions cannot assume the role:

1. **Verify OIDC provider** is configured correctly
2. **Check repository name** in trust policy
3. **Ensure workflow has** `id-token: write` permission

### ECS Deployment Failures

If deployments fail:

1. **Check IAM PassRole** permission is present
2. **Verify task and execution role ARNs** in PassRole policy
3. **Review ECS service events** for detailed error messages

---

## Future Enhancements

### Potential Improvements

1. **S3 Bucket for Artifacts** (Optional)
   - Add S3 read/write permissions if artifact storage needed
   - Scope to specific `afu9-artifacts-*` bucket

2. **RDS Data API** (Optional)
   - Enable RDS Data API for enhanced security
   - Add `rds-data:ExecuteStatement` permission
   - Remove need for database credentials in application

3. **Service Control Policies** (Organization-Level)
   - Add SCPs to prevent privilege escalation
   - Restrict role modification by deployment role

4. **Session Tags** (Enhanced Auditing)
   - Add session tags to track deployment source
   - Use tags in CloudWatch Logs Insights queries

---

## References

- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [ECS Task IAM Roles](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS Well-Architected Framework - Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [Principle of Least Privilege](https://csrc.nist.gov/glossary/term/least_privilege)

---

## Document Metadata

- **Author**: AFU-9 Security Team
- **Last Updated**: 2024-12-12
- **Version**: 1.0
- **Review Schedule**: Quarterly
- **Next Review**: 2025-03-12
