# GitHub Actions Workflows

This directory contains GitHub Actions workflows for AFU-9 automation.

## Workflows

### 1. `deploy-ecs.yml` - ECS Deployment Pipeline

Automated CI/CD pipeline for building and deploying AFU-9 Docker images to AWS ECS.

**Triggers:**
- **Automatic**: Push to `main` branch with changes in:
  - `control-center/**`
  - `mcp-servers/**`
  - `.github/workflows/deploy-ecs.yml`
- **Manual**: Workflow dispatch from GitHub Actions UI

**What it does:**
1. Builds Docker images for all 4 containers
2. Pushes images to ECR with multiple tags:
   - `latest` - Always points to the most recent build
   - `<commit-sha>` - Tagged with the 7-character commit SHA
   - `<timestamp>` - Tagged with build timestamp (YYYYMMDD-HHMMSS)
3. Forces new deployment of ECS service
4. Waits for service to stabilize

**Setup Requirements:**

#### 1. Configure AWS OIDC Provider

Create an IAM OIDC identity provider for GitHub Actions:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

#### 2. Create IAM Role for GitHub Actions

Create a trust policy file `github-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT-ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR-ORG/codefactory-control:*"
        }
      }
    }
  ]
}
```

Replace:
- `ACCOUNT-ID` with your AWS account ID
- `YOUR-ORG` with your GitHub organization name

Create the role:

```bash
aws iam create-role \
  --role-name GitHubActionsDeployRole \
  --assume-role-policy-document file://github-trust-policy.json \
  --description "Role for GitHub Actions to deploy to ECS"
```

#### 3. Attach Required Policies

Create a policy file `deploy-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:DescribeTasks",
        "ecs:ListTasks"
      ],
      "Resource": "*"
    }
  ]
}
```

Create and attach the policy:

```bash
aws iam create-policy \
  --policy-name GitHubActionsECSDeployPolicy \
  --policy-document file://deploy-policy.json

aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::ACCOUNT-ID:policy/GitHubActionsECSDeployPolicy
```

#### 4. Add GitHub Secret

Get the role ARN:

```bash
aws iam get-role \
  --role-name GitHubActionsDeployRole \
  --query 'Role.Arn' \
  --output text
```

Add this ARN to your GitHub repository secrets:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `AWS_DEPLOY_ROLE_ARN`
5. Value: `arn:aws:iam::ACCOUNT-ID:role/GitHubActionsDeployRole`
6. Click **Add secret**

**Manual Trigger:**

To manually trigger a deployment:

1. Go to **Actions** tab in GitHub
2. Select **Deploy AFU-9 to ECS** workflow
3. Click **Run workflow**
4. Select environment (production or staging)
5. Click **Run workflow**

**Monitoring:**

- View workflow runs in the **Actions** tab
- Each step shows detailed logs
- Deployment summary is added to the workflow run summary

### 2. `afu9-bugfix.yml` - Legacy Bugfix Pipeline (v0.1)

Legacy workflow for v0.1 Lambda-based AFU-9 pipeline. This invokes AWS Lambda directly to trigger the bugfix workflow.

**Note:** This workflow is for the v0.1 architecture and will be deprecated in favor of v0.2 ECS-based deployments.

## Troubleshooting

### Authentication Errors

**Issue:** `Error: Could not assume role with OIDC`

**Solution:**
- Verify OIDC provider is correctly configured
- Check trust policy allows your repository
- Ensure role ARN is correct in GitHub secrets

### ECR Push Failures

**Issue:** `denied: User is not authorized to perform ecr:PutImage`

**Solution:**
- Verify IAM role has `ecr:PutImage` permission
- Check ECR repository policy allows the role
- Ensure repository exists (run CDK deploy first)

### ECS Update Failures

**Issue:** `Error updating ECS service`

**Solution:**
- Verify service name and cluster name are correct
- Check IAM role has `ecs:UpdateService` permission
- Ensure task definition exists and is valid
- Review CloudWatch logs for container startup errors

### Service Doesn't Stabilize

**Issue:** Workflow times out waiting for service to stabilize

**Solution:**
- Check ECS service events for deployment failures
- Review CloudWatch logs for application errors
- Verify ALB health check configuration
- Ensure images exist in ECR with `latest` tag

## Best Practices

1. **Tagging Strategy:**
   - Use `latest` for automatic deployments
   - Use commit SHA tags for rollbacks
   - Use timestamp tags for audit trail

2. **Rollback:**
   ```bash
   # List available tags
   aws ecr describe-images \
     --repository-name afu9/control-center \
     --region eu-central-1
   
   # Update task definition to use specific tag
   # Then force new deployment
   ```

3. **Testing:**
   - Test Docker builds locally before pushing
   - Use staging environment for pre-production testing
   - Monitor CloudWatch logs after deployment

4. **Security:**
   - Use OIDC instead of long-lived credentials
   - Limit IAM permissions to minimum required
   - Rotate credentials regularly
   - Enable branch protection rules

## Additional Resources

- [AWS OIDC Guide](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [ECS Deployment Guide](../../docs/ECS-DEPLOYMENT.md)
- [Architecture Documentation](../../docs/architecture/README.md)
