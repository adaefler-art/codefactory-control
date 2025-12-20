# OIDC Setup Verification Checklist

This checklist helps verify that GitHub Actions OIDC authentication to AWS is configured correctly.

## Prerequisites

- AWS CLI configured
- Access to AWS IAM console
- Access to GitHub repository settings

## Verification Steps

### 1. Check GitHub OIDC Provider in AWS

```bash
# List OIDC providers
aws iam list-open-id-connect-providers

# Expected output should include:
# arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
```

**✅ Verify:**
- [ ] OIDC provider exists
- [ ] Provider URL is `token.actions.githubusercontent.com`
- [ ] Audience includes `sts.amazonaws.com`

### 2. Check IAM Role Trust Policy

```bash
# Get the deploy role (replace with your role name)
aws iam get-role --role-name GitHubActionsDeployRole

# Check the AssumeRolePolicyDocument
```

**✅ Verify Trust Policy Contains:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR-ORG/YOUR-REPO:*"
        }
      }
    }
  ]
}
```

**✅ Verify:**
- [ ] `aud` (audience) is set to `sts.amazonaws.com`
- [ ] `sub` (subject) matches repository pattern: `repo:adaefler-art/codefactory-control:*`
- [ ] Federated principal points to correct OIDC provider ARN

### 3. Check IAM Role Permissions

```bash
# List attached policies
aws iam list-attached-role-policies --role-name GitHubActionsDeployRole

# Get inline policies
aws iam list-role-policies --role-name GitHubActionsDeployRole
```

**✅ Verify Role Has Permissions For:**
- [ ] CloudFormation (create/update/delete stacks)
- [ ] ECS (update service, register task definition)
- [ ] ECR (login, push images)
- [ ] Secrets Manager (read secrets for validation)
- [ ] S3 (CDK asset storage)
- [ ] IAM (pass role to ECS tasks)

### 4. Check GitHub Repository Secrets

**Navigate to:** `GitHub Repository → Settings → Secrets and variables → Actions`

**✅ Verify Secret Exists:**
- [ ] `AWS_DEPLOY_ROLE_ARN` secret exists
- [ ] Secret value format: `arn:aws:iam::ACCOUNT_ID:role/ROLE_NAME`
- [ ] Account ID matches your AWS account
- [ ] Role name matches IAM role from step 2

### 5. Check Workflow Permissions

**In workflow files** (`.github/workflows/deploy-*.yml`):

```yaml
permissions:
  id-token: write  # Required for OIDC
  contents: read
```

**✅ Verify:**
- [ ] `id-token: write` permission is set
- [ ] Permissions are at job level or workflow level

### 6. Test OIDC Authentication

**Run the verification in a GitHub Action:**

```yaml
- name: Verify AWS OIDC Authentication
  run: |
    aws sts get-caller-identity
```

**Expected output:**
```json
{
  "UserId": "AROA...:GitHubActions-...",
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/GitHubActionsDeployRole/..."
}
```

**✅ Verify:**
- [ ] Command succeeds (exit code 0)
- [ ] Account ID matches your AWS account
- [ ] ARN shows assumed role (not user)
- [ ] No credential errors

## Common Issues

### Issue: "Could not load credentials from any providers"

**Possible Causes:**
1. OIDC provider not created in AWS
2. Trust policy missing or incorrect
3. Repository secret not set
4. Workflow missing `id-token: write` permission

**Debug Steps:**
```bash
# Check CloudTrail for AssumeRoleWithWebIdentity events
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 10
```

### Issue: "Not authorized to perform sts:AssumeRoleWithWebIdentity"

**Possible Causes:**
1. Trust policy `sub` doesn't match repository
2. Trust policy `aud` is incorrect
3. OIDC provider thumbprint mismatch

**Fix:**
- Update trust policy `sub` to: `repo:YOUR-ORG/YOUR-REPO:*`
- Ensure `aud` is: `sts.amazonaws.com`

### Issue: "Role lacks permissions for deployment"

**Possible Causes:**
1. IAM role missing required permissions
2. Permission boundary restricting access

**Fix:**
- Add missing permissions to role
- Check for permission boundaries: `aws iam get-role --role-name ROLE_NAME`

## Verification Complete

Once all items are checked:
- ✅ OIDC provider exists and is correctly configured
- ✅ IAM role trust policy is correct
- ✅ IAM role has required permissions
- ✅ GitHub secret is set correctly
- ✅ Workflow permissions are correct
- ✅ Test authentication succeeds

**Your OIDC setup is ready for deployments!**

---

## Additional Resources

- [AWS Documentation: Using OIDC with GitHub Actions](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc_verify-thumbprint.html)
- [GitHub Documentation: Configuring OpenID Connect in AWS](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AFU-9 Deployment Guide](DEPLOYMENT_CONSOLIDATED.md)
- [IAM Roles Justification](IAM-ROLES-JUSTIFICATION.md)
