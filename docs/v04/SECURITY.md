# Security Documentation

This document outlines the security practices and secret management strategy for AFU-9 (codefactory-control).

## Table of Contents

- [Secret Management](#secret-management)
- [AWS Secrets Manager Integration](#aws-secrets-manager-integration)
- [Local Development](#local-development)
- [Production Deployment](#production-deployment)
- [Secret Rotation](#secret-rotation)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Secret Management

AFU-9 uses AWS Secrets Manager for storing and managing all sensitive credentials in production environments. This approach provides:

- **Centralized secret storage**: All secrets in one secure location
- **IAM-based access control**: Fine-grained permissions via IAM roles
- **Automatic encryption**: Secrets encrypted at rest and in transit
- **Audit logging**: CloudTrail logs all secret access
- **Secret rotation support**: Easy rotation without code changes
- **No secrets in code**: Zero secrets checked into version control

### Secret Categories

AFU-9 manages three categories of secrets:

1. **GitHub Credentials** (`afu9/github`):
   - GitHub Personal Access Token or App credentials
   - Repository owner and name
   - Used for: Issue tracking, PR creation, branch management

2. **LLM API Keys** (`afu9/llm`):
   - OpenAI API key (GPT models)
   - Anthropic API key (Claude models)
   - DeepSeek API key (DeepSeek models)
   - Used for: AI-powered code generation and analysis

3. **Database Credentials** (`afu9/database`):
   - RDS PostgreSQL connection details
   - Host, port, database name, username, password
   - Used for: Workflow state persistence

## AWS Secrets Manager Integration

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ AWS Secrets Manager                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  afu9/github          afu9/llm              afu9/database       │
│  ├─ token             ├─ openai_api_key    ├─ host             │
│  ├─ owner             ├─ anthropic_api_key ├─ port             │
│  └─ repo              └─ deepseek_api_key  ├─ database         │
│                                             ├─ username         │
│                                             └─ password         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ IAM Role-based Access
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ ECS Tasks / Lambda Functions                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Execution Role: Reads secrets during container startup         │
│  Task Role: Application access to AWS services                  │
│                                                                  │
│  Secrets automatically injected as environment variables         │
└─────────────────────────────────────────────────────────────────┘
```

### IAM Permissions

**Task Execution Role** (`afu9-ecs-task-execution-role`):
- Reads secrets from Secrets Manager during container startup
- Permissions: `secretsmanager:GetSecretValue` on `afu9/*` secrets

**Task Role** (`afu9-ecs-task-role`):
- Used by application code for AWS API calls
- Permissions: CloudWatch Logs, ECS service queries, limited Secrets Manager access

## Local Development

For local development, secrets can be loaded from environment variables as a fallback:

### Using `.env` file (Recommended)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your credentials:
   ```bash
   # GitHub Configuration
   GITHUB_TOKEN=<YOUR_GITHUB_TOKEN>
   GITHUB_OWNER=your-org
   GITHUB_REPO=your-repo

   # LLM API Keys
   OPENAI_API_KEY=<YOUR_OPENAI_API_KEY>
   ANTHROPIC_API_KEY=<YOUR_ANTHROPIC_API_KEY>
   DEEPSEEK_API_KEY=<YOUR_DEEPSEEK_API_KEY>

   # AWS Configuration
   AWS_REGION=eu-central-1
   ```

3. The `.env` file is gitignored and will never be committed

### Using Secret Helper Library

The `lib/utils/secrets.ts` module provides a unified interface for loading secrets:

```typescript
import { getGithubSecrets, getLlmSecrets, getDatabaseSecrets } from './lib/utils/secrets';

// Automatically loads from AWS Secrets Manager in production
// Falls back to environment variables in development
const githubSecrets = await getGithubSecrets();
const llmSecrets = await getLlmSecrets();
const dbSecrets = await getDatabaseSecrets();

console.log(githubSecrets.token); // <REDACTED_GITHUB_TOKEN>
console.log(llmSecrets.openai_api_key); // <REDACTED_LLM_KEY>
```

**Features:**
- Automatic environment detection (AWS vs local)
- In-memory caching with TTL (5 minutes default)
- Type-safe secret interfaces
- Graceful fallback to environment variables
- Comprehensive error handling

## Production Deployment

### Initial Secret Setup

After deploying the CDK stacks, secrets are created with placeholder values. You must update them manually:

#### 1. GitHub Credentials

```bash
aws secretsmanager update-secret \
  --secret-id afu9/github \
  --secret-string '{
      "token": "<YOUR_GITHUB_TOKEN>",
    "owner": "your-github-org",
    "repo": "your-repo-name"
  }' \
  --region eu-central-1
```

#### 2. LLM API Keys

```bash
aws secretsmanager update-secret \
  --secret-id afu9/llm \
  --secret-string '{
      "openai_api_key": "<YOUR_OPENAI_API_KEY>",
      "anthropic_api_key": "<YOUR_ANTHROPIC_API_KEY>",
      "deepseek_api_key": "<YOUR_DEEPSEEK_API_KEY>"
  }' \
  --region eu-central-1
```

**Note:** You don't need to provide all LLM keys. Include only the providers you use.

#### 3. Database Credentials

Database secrets are automatically created by the `Afu9DatabaseStack` with secure random passwords. You don't need to update them manually unless you want to change credentials.

To view database credentials:
```bash
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region eu-central-1 \
  --query SecretString \
  --output text | jq .
```

### Verifying Secret Access

After updating secrets, verify ECS tasks can access them:

```bash
# Check ECS task logs
aws logs tail /ecs/afu9/control-center --follow

# Look for successful secret loading:
# [Secrets] Loading secret from AWS: afu9/github
# [Secrets] Successfully loaded secret: afu9/github
```

## Secret Rotation

### Manual Rotation

To rotate a secret:

1. Generate new credentials (new API key, token, etc.)
2. Update the secret in AWS Secrets Manager:
   ```bash
   aws secretsmanager update-secret \
     --secret-id afu9/github \
       --secret-string '{"token":"<YOUR_GITHUB_TOKEN>","owner":"org","repo":"repo"}'
   ```
3. Restart ECS tasks to pick up new secrets:
   ```bash
   aws ecs update-service \
     --cluster afu9-cluster \
     --service afu9-control-center \
     --force-new-deployment
   ```

### Automatic Rotation (Future)

AWS Secrets Manager supports automatic rotation via Lambda functions. This can be configured for:
- Database passwords (using RDS integration)
- API keys (with custom rotation Lambda)

**Reference:** [AWS Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)

## Best Practices

### DO ✅

- **Use AWS Secrets Manager in production**: Always use Secrets Manager for deployed environments
- **Use environment variables locally**: Keep local credentials in `.env` files (gitignored)
- **Rotate secrets regularly**: Change API keys and tokens periodically
- **Use least privilege IAM**: Grant only necessary permissions to roles
- **Enable secret audit logging**: Use CloudTrail to monitor secret access
- **Use secret caching**: Leverage the built-in cache to reduce API calls
- **Validate secrets after loading**: Check for required fields before use
- **Use separate secrets per environment**: Dev, staging, and production should have different credentials

### DON'T ❌

- **Never commit secrets to git**: No secrets in code, config files, or documentation
- **Never log secret values**: Log only that a secret was loaded, not its content
- **Never hardcode secrets**: Always load dynamically from Secrets Manager or env vars
- **Never share secrets via email/Slack**: Use secure secret sharing tools
- **Never use the same secrets in multiple environments**: Isolate credentials
- **Never disable encryption**: Always keep secrets encrypted at rest and in transit
- **Never grant broad IAM permissions**: Use resource-specific ARNs where possible

## Troubleshooting

### Secret Not Found

**Error:** `Failed to load secret afu9/github: ResourceNotFoundException`

**Solution:**
1. Verify the secret exists:
   ```bash
   aws secretsmanager describe-secret --secret-id afu9/github
   ```
2. Check the secret name matches exactly
3. Verify you're in the correct AWS region

### Permission Denied

**Error:** `AccessDeniedException: User is not authorized to perform: secretsmanager:GetSecretValue`

**Solution:**
1. Verify the IAM role has `secretsmanager:GetSecretValue` permission
2. Check the resource ARN in the IAM policy matches the secret ARN
3. Verify the trust relationship allows the service (ECS, Lambda) to assume the role

### Invalid Secret Format

**Error:** `Secret afu9/github is missing required fields: token`

**Solution:**
1. Verify the secret contains all required fields
2. Check JSON formatting is valid
3. Update the secret with complete data:
   ```bash
   aws secretsmanager get-secret-value --secret-id afu9/github
   # Fix and update with correct structure
   ```

### Environment Variable Fallback Not Working

**Problem:** Secrets not loading in local development

**Solution:**
1. Check `.env` file exists and has correct values
2. Verify environment variables are loaded (e.g., using `dotenv`)
3. Check variable names match exactly (case-sensitive)
4. Confirm `useEnvFallback: true` option is set (default)

### Cache Issues

**Problem:** Updated secrets not reflecting in application

**Solution:**
1. Secrets are cached for 5 minutes by default
2. Clear cache manually in code:
   ```typescript
   import { clearSecretCache } from './lib/utils/secrets';
   clearSecretCache();
   ```
3. Restart the application/container
4. Use `cacheTtlMs: 0` to disable caching temporarily

## Security Contacts

For security issues or vulnerabilities:
- Open a private security advisory on GitHub
- Contact the repository maintainer directly
- **Do not** open public issues for security vulnerabilities

## Additional Resources

- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [ECS Secrets Management](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [Lambda Environment Variables](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

---

**Last Updated:** December 2024  
**Version:** v0.2 (ECS Architecture)
