# Secret Key Validation Guardrail

**Issue ID:** I-ECS-DB-02  
**Status:** ✅ Implemented

## Overview

This guardrail ensures that all required secret keys exist in AWS Secrets Manager before deployment. It prevents runtime failures due to missing or misconfigured secrets by validating secrets during the CDK synth/build phase and optionally before deployment.

## Problem Statement

Without validation, deployments could fail at runtime when:
- A secret exists but is missing required keys (e.g., `password`, `username`)
- A secret has keys with wrong names (e.g., `dbname` vs `database`)
- A secret is not yet created in Secrets Manager

These failures only occur when ECS tasks start, causing deployment rollbacks and wasted time.

## Solution

A multi-layered validation approach:

1. **CDK Synth-time Validation**: Outputs validation requirements to CloudFormation
2. **Pre-deployment Script**: Validates actual secrets in AWS Secrets Manager
3. **CI Integration**: Automatic validation in CI pipelines

## Architecture

### Secret Requirements

The system tracks three types of secrets:

#### 1. Database Secret (`afu9/database`)
**Required Keys:**
- `host` - Database endpoint address
- `port` - Database port number
- `database` - Database name
- `username` - Database username
- `password` - Database password

**Note:** The key is `database`, not `dbname`. This is the application connection secret created by `Afu9DatabaseStack`, which differs from RDS-generated secrets.

#### 2. GitHub Secret (`afu9/github`)
**Required Keys:**
- `token` - GitHub personal access token or app token
- `owner` - GitHub repository owner (organization or user)
- `repo` - GitHub repository name

#### 3. LLM Secret (`afu9/llm`)
**Optional Keys (at least one recommended):**
- `openai_api_key` - OpenAI API key
- `anthropic_api_key` - Anthropic (Claude) API key
- `deepseek_api_key` - DeepSeek API key

## Usage

### 1. CDK Synth Validation

The validation is automatically integrated into CDK stacks. When you run `cdk synth`, validation metadata is included in the CloudFormation outputs:

```bash
npx cdk synth Afu9EcsStack
```

Look for outputs like:
```yaml
Outputs:
  SecretValidationafu9github:
    Description: Secret validation requirements for GitHub API credentials
    Value: '{"secretName":"afu9/github","requiredKeys":["token","owner","repo"],"description":"GitHub API credentials"}'
```

### 2. Pre-deployment Validation Script

Run the standalone validation script to check actual secrets in AWS:

```bash
# Using npm script (recommended)
npm run validate-secrets

# Or directly with ts-node
ts-node scripts/validate-secrets.ts
```

**Environment Variables:**
- `AWS_REGION` - AWS region (default: `eu-central-1`)
- `AWS_PROFILE` - AWS profile to use (optional)

**Exit Codes:**
- `0` - All secrets validated successfully
- `1` - One or more secrets failed validation
- `2` - Script error (e.g., AWS credentials not configured)

### 3. CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Validate Secrets
  run: npm run validate-secrets
  env:
    AWS_REGION: eu-central-1
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Or in your deployment script:

```bash
#!/bin/bash
set -e

echo "Validating secrets..."
npm run validate-secrets

echo "Deploying..."
npm run deploy
```

## Implementation Details

### Code Structure

```
lib/utils/secret-validator.ts    # Core validation logic
scripts/validate-secrets.ts       # Standalone CLI script
lib/afu9-database-stack.ts        # Database stack with validation
lib/afu9-ecs-stack.ts             # ECS stack with validation
```

### Integration Points

#### Database Stack
```typescript
import { validateSecretKeys } from './utils/secret-validator';

// After creating appConnectionSecret
validateSecretKeys(
  this,
  appConnectionSecret,
  ['host', 'port', 'database', 'username', 'password'],
  'Database application connection secret'
);
```

#### ECS Stack
```typescript
// Validate database secret (when enabled)
if (dbSecret) {
  validateSecretKeys(
    this,
    dbSecret,
    ['host', 'port', 'database', 'username', 'password'],
    'Database connection credentials'
  );
}

// Validate GitHub secret
validateSecretKeys(
  this,
  githubSecret,
  ['token', 'owner', 'repo'],
  'GitHub API credentials'
);

// Validate LLM secret (no required keys)
validateSecretKeys(
  this,
  llmSecret,
  [],
  'LLM API keys (all optional)'
);
```

## Validation Output Examples

### Success Case

```
=====================================
AFU-9 Preflight Secret Validation
=====================================

Region: eu-central-1

Validating secrets...

Validating database secret (afu9/database)...
✓ database secret validation passed
Validating github secret (afu9/github)...
✓ github secret validation passed
Validating llm secret (afu9/llm)...
✓ llm secret validation passed

=====================================
Validation Summary
=====================================

✓ Passed: 3
✗ Failed: 0
Total: 3

✓ All secrets validated successfully!
You can proceed with deployment.
```

### Failure Case

```
=====================================
AFU-9 Preflight Secret Validation
=====================================

Region: eu-central-1

Validating secrets...

Validating database secret (afu9/database)...
✗ database secret validation failed: Secret afu9/database is missing required keys: password
Validating github secret (afu9/github)...
✓ github secret validation passed
Validating llm secret (afu9/llm)...
✓ llm secret validation passed

=====================================
Validation Summary
=====================================

✓ Passed: 2
✗ Failed: 1
Total: 3

✗ Secret validation failed!

The following secrets have issues:

  ❌ afu9/database
     Error: Secret afu9/database is missing required keys: password
     Missing keys: password

Please fix the above errors before deploying.

To fix missing keys:
  1. Go to AWS Secrets Manager console
  2. Find the secret by name
  3. Add the missing keys to the secret value (JSON format)
  4. Run this script again to verify
```

## Troubleshooting

### Common Issues

#### 1. Secret Not Found
**Error:** `Failed to validate secret afu9/database: The security token included in the request is invalid`

**Solution:** 
- Ensure AWS credentials are configured: `aws configure`
- Or set environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Check that you're using the correct AWS profile: `export AWS_PROFILE=your-profile`

#### 2. Missing Keys
**Error:** `Secret afu9/database is missing required keys: password`

**Solution:**
1. Go to AWS Secrets Manager console
2. Find the secret `afu9/database`
3. Click "Retrieve secret value"
4. Click "Edit"
5. Add the missing key in JSON format:
   ```json
   {
     "host": "...",
     "port": "5432",
     "database": "afu9",
     "username": "...",
     "password": "your-password-here"
   }
   ```
6. Save and run validation again

#### 3. Wrong Key Name
**Error:** ECS tasks fail with `ResourceInitializationError`

**Cause:** The secret has `dbname` instead of `database` key.

**Solution:**
- The application connection secret uses `database` as the key name
- Update the secret to use `database` instead of `dbname`
- This differs from RDS-generated secrets which use `dbname`

#### 4. Insufficient Permissions
**Error:** `AccessDeniedException: User is not authorized to perform: secretsmanager:GetSecretValue`

**Solution:**
Add the required IAM permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:eu-central-1:*:secret:afu9/*"
      ]
    }
  ]
}
```

## Testing

### Local Testing

1. **Test without AWS credentials** (should fail gracefully):
```bash
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
npm run validate-secrets
```

Expected: Exit code 2 with helpful error message

2. **Test with valid secrets** (requires AWS credentials):
```bash
export AWS_PROFILE=your-profile
npm run validate-secrets
```

Expected: Exit code 0 with success message

3. **Test CDK synth integration**:
```bash
# Without database
npx cdk synth Afu9EcsStack -c afu9-enable-https=false -c afu9-enable-database=false

# With database
npx cdk synth Afu9EcsStack -c afu9-enable-https=false -c afu9-enable-database=true
```

Expected: Successful synth with validation outputs in CloudFormation

### CI Testing

Add to `.github/workflows/deploy.yml`:

```yaml
jobs:
  validate-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-central-1
          
      - name: Validate secrets
        run: npm run validate-secrets
        
      - name: Deploy
        run: npm run deploy
```

## Benefits

1. **Early Detection**: Catch configuration issues before deployment
2. **Clear Error Messages**: Know exactly which keys are missing
3. **Reproducible**: Works the same locally and in CI
4. **Zero Runtime Overhead**: Validation happens before deployment
5. **Documentation**: Validation requirements are self-documenting in CloudFormation outputs

## Future Enhancements

Potential improvements (not currently implemented):

1. **Lambda Custom Resource**: Validate secrets at deployment time in CloudFormation
2. **Automated Fixes**: Suggest or apply fixes for common issues
3. **Secret Rotation Support**: Validate that rotated secrets maintain required keys
4. **Regional Support**: Validate secrets across multiple regions
5. **Secret Templates**: Generate secret templates with required keys

## Related Documentation

- [ECS Configuration Reference](./ECS_CONFIG_REFERENCE.md)
- [Security & IAM](./SECURITY-IAM.md)
- [Database Setup](./DATABASE-LOCAL-DEVELOPMENT.md)
- [AWS Deployment Runbook](./AWS_DEPLOY_RUNBOOK.md)

## Changelog

### 2025-12-17 - Initial Implementation
- Created `lib/utils/secret-validator.ts` with validation logic
- Created `scripts/validate-secrets.ts` standalone script
- Integrated validation into `Afu9DatabaseStack` and `Afu9EcsStack`
- Fixed key mismatch: `dbname` → `database`
- Added npm script `validate-secrets`
- Added CloudFormation outputs for validation requirements
