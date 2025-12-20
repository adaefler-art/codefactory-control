# AFU-9 IAM Quick Reference

Quick reference guide for AFU-9 IAM roles and their permissions.

## Role Summary

| Role Name | Used By | Purpose | Resource Scoping |
|-----------|---------|---------|------------------|
| `afu9-ecs-task-execution-role` | ECS Infrastructure | Pull images, write logs, inject secrets | `afu9/*` secrets |
| `afu9-ecs-task-role` | Application Containers | AWS API calls (CloudWatch, ECS, Secrets) | `afu9-cluster`, `/ecs/afu9/*` |
| `afu9-github-actions-deploy-role` | GitHub Actions | Push images, trigger deployments | `afu9/*` repos, `afu9-cluster` |

## Permission Matrix

### Task Execution Role

| Service | Actions | Resources | Justification |
|---------|---------|-----------|---------------|
| ECR | Get images | All ECR | Pull container images |
| CloudWatch Logs | Write logs | All log groups | Container logging |
| Secrets Manager | Read secrets | `afu9/*` | Inject environment variables |

### Task Role

| Service | Actions | Resources | Justification |
|---------|---------|-----------|---------------|
| CloudWatch Logs | Read/Write logs | `/ecs/afu9/*` | MCP Observability monitoring |
| CloudWatch Metrics | Read/Write metrics | All (no resource-level) | Application monitoring |
| ECS | Describe/Update services | `afu9-cluster` | MCP Deploy operations |
| Secrets Manager | Read secrets | `afu9/*` | Runtime secret refresh |

### GitHub Actions Deploy Role

| Service | Actions | Resources | Justification |
|---------|---------|-----------|---------------|
| ECR | Push images | `afu9/*` repos | Build and push containers |
| ECS | Update service | `afu9-cluster` | Trigger deployments |
| IAM | PassRole | Task + Execution roles | ECS role assumption |

## Common Operations

### Check Which Role a Container is Using

```bash
# SSH into ECS task (requires ECS Exec enabled)
aws ecs execute-command \
  --cluster afu9-cluster \
  --task <task-id> \
  --container control-center \
  --interactive \
  --command "/bin/sh"

# Inside container, check current role
curl http://169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
```

### View IAM Role Policies

```bash
# Task Role
aws iam get-role --role-name afu9-ecs-task-role
aws iam list-role-policies --role-name afu9-ecs-task-role
aws iam list-attached-role-policies --role-name afu9-ecs-task-role

# Task Execution Role
aws iam get-role --role-name afu9-ecs-task-execution-role
aws iam list-attached-role-policies --role-name afu9-ecs-task-execution-role

# Deploy Role
aws iam get-role --role-name afu9-github-actions-deploy-role
aws iam list-role-policies --role-name afu9-github-actions-deploy-role
```

### Test Role Permissions

```bash
# Test Task Role permissions from inside container
aws sts get-caller-identity
aws logs describe-log-groups --log-group-name-prefix /ecs/afu9
aws ecs describe-services --cluster afu9-cluster --services afu9-control-center

# Test Deploy Role from GitHub Actions (in workflow)
- name: Test IAM permissions
  run: |
    aws sts get-caller-identity
    aws ecr describe-repositories --repository-names afu9/control-center
    aws ecs describe-services --cluster afu9-cluster --services afu9-control-center
```

### CloudTrail: Find IAM Activity

```bash
# Find all API calls made by Task Role in last hour
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=afu9-ecs-task-role \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --max-results 50

# Find all deployments by GitHub Actions
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=afu9-github-actions-deploy-role \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --max-results 50
```

## Troubleshooting

### "Access Denied" Errors

1. **Identify the failing action**
   ```bash
   # Check CloudTrail for the exact denied API call
   aws cloudtrail lookup-events \
     --lookup-attributes AttributeKey=EventName,AttributeValue=AccessDenied \
     --max-results 10
   ```

2. **Check the role ARN**
   ```bash
   # Verify which role is being used
   aws sts get-caller-identity
   ```

3. **Verify resource ARN matches policy**
   - Check that resource follows naming conventions (`afu9/*`, `afu9-cluster`, etc.)
   - Confirm region and account match

### ECS Tasks Can't Start

**Symptom**: Tasks fail with "Cannot pull container image" or "Cannot retrieve secrets"

**Solution**: Task Execution Role needs permissions
```bash
# Check Task Execution Role has ECR and Secrets Manager access
aws iam list-attached-role-policies --role-name afu9-ecs-task-execution-role
aws iam get-policy-version \
  --policy-arn $(aws iam list-role-policies --role-name afu9-ecs-task-execution-role --query 'PolicyNames[0]' --output text) \
  --version-id v1
```

### GitHub Actions Can't Deploy

**Symptom**: Workflow fails with "AssumeRoleWithWebIdentity" error

**Solution**: Check OIDC trust policy
```bash
# View trust policy
aws iam get-role --role-name afu9-github-actions-deploy-role \
  --query 'Role.AssumeRolePolicyDocument'

# Verify repository name in condition matches your repo
# Should see: "token.actions.githubusercontent.com:sub": "repo:org/repo:*"
```

### Permission Changes Not Taking Effect

**Symptom**: Updated IAM policy but changes not reflected

**Solution**: 
1. IAM changes can take up to 5 minutes to propagate
2. If using ECS tasks, restart them:
   ```bash
   aws ecs update-service \
     --cluster afu9-cluster \
     --service afu9-control-center \
     --force-new-deployment
   ```
3. If using GitHub Actions, re-run the workflow

## Security Checklist

- [ ] All roles follow least privilege (only necessary permissions)
- [ ] Resources scoped to `afu9/*` or `afu9-cluster` where possible
- [ ] No long-term AWS credentials stored in GitHub or containers
- [ ] GitHub OIDC provider configured correctly
- [ ] CloudTrail logging enabled for audit
- [ ] Regular review of IAM role usage via CloudTrail

## Useful AWS Console Links

Generate these by replacing `REGION` and `ACCOUNT_ID`:

- **Task Role**: `https://console.aws.amazon.com/iam/home?region=REGION#/roles/afu9-ecs-task-role`
- **Task Execution Role**: `https://console.aws.amazon.com/iam/home?region=REGION#/roles/afu9-ecs-task-execution-role`
- **Deploy Role**: `https://console.aws.amazon.com/iam/home?region=REGION#/roles/afu9-github-actions-deploy-role`
- **CloudTrail Events**: `https://console.aws.amazon.com/cloudtrail/home?region=REGION#/events`

## Related Documentation

- [SECURITY-IAM.md](./SECURITY-IAM.md) - Complete IAM roles overview
- [IAM-ROLES-JUSTIFICATION.md](./IAM-ROLES-JUSTIFICATION.md) - Detailed permission justifications
- [ECS-DEPLOYMENT.md](./ECS-DEPLOYMENT.md) - Deployment guide including IAM stack

## Need Help?

1. Check CloudTrail for exact error details
2. Review IAM policy simulator: `https://policysim.aws.amazon.com/`
3. Consult [AWS IAM Troubleshooting Guide](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html)
