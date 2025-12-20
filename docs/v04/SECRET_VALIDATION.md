# Secret Key Validation Guardrail

**Issue ID:** I-01-02-SECRET-PREFLIGHT (previously I-ECS-DB-02)  
**Status:** ✅ Implemented

## Overview

This guardrail ensures that all required secret keys exist in AWS Secrets Manager before deployment. It prevents runtime failures due to missing or misconfigured secrets by **failing the build/synth process** when secrets are invalid.

## Problem Statement

Without validation, deployments could fail at runtime when:
- A secret exists but is missing required keys (e.g., `password`, `username`)
- A secret has keys with wrong names (e.g., `dbname` vs `database`)
- A secret is not yet created in Secrets Manager

These failures only occur when ECS tasks start, causing deployment rollbacks and wasted time.

## Solution

A **preflight check** that blocks CDK synth/build/deploy:

1. **Build Validation**: `npm run build` validates secrets before TypeScript compilation
2. **Synth Validation**: `npm run synth` validates secrets before CDK synthesis
3. **Deploy Validation**: `npm run deploy` validates secrets before deployment
4. **CI Integration**: Automatic validation in CI pipelines (already integrated)

## Architecture

### Secret Requirements

The system tracks three types of secrets:

#### 1. Database Secret (`afu9-database`)
**Required Keys:**
- `host` - Database endpoint address
- `port` - Database port number
- `database` - Database name
- `username` - Database username
- `password` - Database password

**Note:** The key is `database`, not `dbname`. This is the application connection secret created by `Afu9DatabaseStack`, which differs from RDS-generated secrets.

#### 2. GitHub Secret (`afu9-github`)
**Required Keys:**
- `token` - GitHub personal access token or app token
- `owner` - GitHub repository owner (organization or user)
- `repo` - GitHub repository name

#### 3. LLM Secret (`afu9-llm`)
**Optional Keys (at least one recommended):**
- `openai_api_key` - OpenAI API key
- `anthropic_api_key` - Anthropic (Claude) API key
- `deepseek_api_key` - DeepSeek API key

## Usage

### 1. Build with Secret Validation (Recommended)

The `npm run build` command now includes automatic secret validation:

```bash
npm run build
```

This will:
1. Validate all secrets in AWS Secrets Manager
2. If validation fails, build stops with clear error messages
3. If validation passes, TypeScript compilation proceeds

**For local development without AWS:**
```bash
SKIP_SECRET_VALIDATION=true npm run build
```

### 2. CDK Synth with Secret Validation (Automatic)

The `npm run synth` command now validates secrets **before** synthesis:

```bash
# Synth all stacks with validation
npm run synth

# Synth specific stack with validation
npm run synth -- Afu9EcsStack

# Synth without validation (not recommended)
npm run synth:no-validation
# OR
SKIP_SECRET_VALIDATION=true npm run synth
```

**Validation behavior:**
- ✅ Validates all secrets before running CDK synth
- ❌ **Fails fast** if any secret is missing or has missing keys
- 📋 Shows clear error messages with secret name and missing keys
- 🔧 Provides instructions on how to fix the issues

### 3. Deploy with Secret Validation (Automatic)

The `npm run deploy` command validates secrets before deployment:

```bash
npm run deploy
```

This ensures secrets are valid before any AWS resources are modified.

### 4. Standalone Validation Script

Run validation without building or deploying:

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

### 5. CI/CD Integration

CI workflows already include validation (no changes needed):

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
lib/utils/secret-validator.ts       # Core validation logic
scripts/validate-secrets.ts          # Standalone CLI script
scripts/synth-with-validation.ts     # CDK synth wrapper with validation
lib/afu9-database-stack.ts           # Database stack with validation
lib/afu9-ecs-stack.ts                # ECS stack with validation
package.json                         # Updated build/synth/deploy scripts
```

### Preflight Check Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Developer runs: npm run build / npm run synth              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Validate Secrets                                   │
│  - Connect to AWS Secrets Manager                           │
│  - Check afu9-database (required: host, port, database,     │
│    username, password)                                      │
│  - Check afu9-github (required: token, owner, repo)         │
│  - Check afu9-llm (optional keys)                           │
└────────────────────────────┬────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
     ┌──────────────────┐    ┌──────────────────┐
     │ All Valid ✓      │    │ Missing Keys ✗   │
     └────────┬─────────┘    └────────┬─────────┘
              │                       │
              ▼                       ▼
┌─────────────────────────┐ ┌──────────────────────┐
│ Step 2: Proceed with    │ │ Step 2: FAIL BUILD   │
│ TypeScript build / CDK  │ │ - Show clear error   │
│ synth                   │ │ - List missing keys  │
└─────────────────────────┘ │ - Exit code 1        │
                            └──────────────────────┘
```

### NPM Scripts

| Script | Validation | Description |
|--------|------------|-------------|
| `npm run build` | ✅ Automatic | Validates secrets, then runs TypeScript compilation |
| `npm run synth` | ✅ Automatic | Validates secrets, then runs CDK synth |
| `npm run synth:no-validation` | ❌ Skipped | Direct CDK synth without validation |
| `npm run deploy` | ✅ Automatic | Validates secrets, then deploys |
| `npm run validate-secrets` | ✅ Only | Standalone validation (no build/synth) |
| `SKIP_SECRET_VALIDATION=true npm run synth` | ❌ Skipped | For local dev without AWS |

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

### Success Case (Build/Synth)

When running `npm run build` or `npm run synth`:

```
=====================================
AFU-9 Preflight Secret Validation
=====================================

Region: eu-central-1

Validating secrets before CDK synth...

Validating database secret (afu9-database)...
✓ database secret validation passed
Validating github secret (afu9-github)...
✓ github secret validation passed
Validating llm secret (afu9-llm)...
✓ llm secret validation passed

=====================================
Validation Summary
=====================================

✓ Passed: 3
✗ Failed: 0
Total: 3

✓ All secrets validated successfully!

Proceeding with CDK synth...

=====================================
Running CDK Synth
=====================================

Command: npx cdk synth

[CDK synth output follows...]
```

### Failure Case (Build/Synth Blocked)

When running `npm run build` or `npm run synth` with missing keys:

```
=====================================
AFU-9 Preflight Secret Validation
=====================================

Region: eu-central-1

Validating secrets before CDK synth...

Validating database secret (afu9-database)...
✗ database secret validation failed: Secret afu9-database is missing required keys: password
Validating github secret (afu9-github)...
✓ github secret validation passed
Validating llm secret (afu9-llm)...
✓ llm secret validation passed

=====================================
Validation Summary
=====================================

✓ Passed: 2
✗ Failed: 1
Total: 3

✗ Secret validation FAILED!

Cannot proceed with CDK synth due to missing or invalid secrets:

  ❌ Secret: afu9-database
     Error: Secret afu9-database is missing required keys: password
     Missing keys: password

How to fix:
  1. Go to AWS Secrets Manager console
  2. Create or update the secret with missing keys
  3. Ensure all required keys exist with valid values
  4. Run this command again

For local development, you can skip validation with:
  SKIP_SECRET_VALIDATION=true npm run synth

Process exited with code 1
```

**Note:** The build/synth process **stops** and does **not** proceed to CDK synthesis.

### Standalone Validation Success

When running `npm run validate-secrets` directly:

```
=====================================
AFU-9 Preflight Secret Validation
=====================================

Region: eu-central-1

Validating secrets...

Validating database secret (afu9-database)...
✗ database secret validation failed: Secret afu9-database is missing required keys: password
Validating github secret (afu9-github)...
✓ github secret validation passed
Validating llm secret (afu9-llm)...
✓ llm secret validation passed

=====================================
Validation Summary
=====================================

✓ Passed: 2
✗ Failed: 1
Total: 3

✗ Secret validation failed!

The following secrets have issues:

  ❌ afu9-database
     Error: Secret afu9-database is missing required keys: password
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
**Error:** `Failed to validate secret afu9-database: The security token included in the request is invalid`

**Solution:** 
- Ensure AWS credentials are configured: `aws configure`
- Or set environment variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- Check that you're using the correct AWS profile: `export AWS_PROFILE=your-profile`

#### 2. Missing Keys
**Error:** `Secret afu9-database is missing required keys: password`

**Solution:**
1. Go to AWS Secrets Manager console
2. Find the secret `afu9-database`
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

#### 1. Test Build Preflight Check (Missing Secret)
```bash
# Remove a required key from a secret in AWS Secrets Manager first
npm run build
```

Expected: 
- Exit code 1
- Clear error message showing secret name and missing key
- Build does NOT proceed to TypeScript compilation

#### 2. Test Synth Preflight Check (Valid Secrets)
```bash
export AWS_PROFILE=your-profile
npm run synth
```

Expected:
- Exit code 0
- Validation passes
- CDK synth proceeds
- CloudFormation outputs include validation metadata

#### 3. Test Synth Preflight Check (Invalid Secret)
```bash
# After removing a required key
npm run synth -- Afu9EcsStack
```

Expected:
- Exit code 1
- Error message: "Secret afu9-database is missing required keys: password"
- CDK synth does NOT run

#### 4. Test Local Development Override
```bash
# Skip validation for local development
SKIP_SECRET_VALIDATION=true npm run synth
```

Expected:
- Validation skipped with warning message
- CDK synth proceeds regardless of secret state

#### 5. Test without AWS credentials
```bash
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_PROFILE
npm run synth
```

Expected: 
- Exit code 2
- Helpful error message about AWS credentials
- Suggestion to use SKIP_SECRET_VALIDATION=true for local dev

### CI Testing

CI workflows already include validation (see `.github/workflows/deploy-ecs.yml`):

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

1. **Fail-Fast at Build Time**: Synth/build fails immediately if secrets are invalid
2. **Prevents Wasted Deployments**: Catch issues before AWS resources are touched
3. **Clear Error Messages**: Exact secret name + missing keys listed explicitly
4. **Blocks Bad Deployments**: Cannot accidentally deploy with misconfigured secrets
5. **Reproducible**: Works identically locally and in CI
6. **Zero Runtime Overhead**: Validation at build time, not runtime
7. **Local Development Friendly**: Can skip validation with environment variable
8. **CI-Ready**: Already integrated in all deployment workflows

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

### 2025-12-19 - Issue I-01-02-SECRET-PREFLIGHT Implementation
- **Breaking Change**: `npm run build` and `npm run synth` now validate secrets automatically
- Added `scripts/synth-with-validation.ts` - CDK synth wrapper with preflight check
- Updated `package.json` scripts:
  - `build`: Now runs secret validation before TypeScript compilation
  - `synth`: Now validates secrets before CDK synth (uses wrapper script)
  - `synth:no-validation`: Added for direct CDK synth without validation
  - `deploy`: Now validates secrets before deployment
- **Build/Synth Failure**: Process exits with code 1 if secrets are invalid
- **Error Messages**: Explicitly names secret and lists all missing keys
- **Local Dev Support**: Added `SKIP_SECRET_VALIDATION=true` override
- Updated documentation with preflight check flow diagram
- Added comprehensive testing instructions

### 2025-12-17 - Initial Implementation
- Created `lib/utils/secret-validator.ts` with validation logic
- Created `scripts/validate-secrets.ts` standalone script
- Integrated validation into `Afu9DatabaseStack` and `Afu9EcsStack`
- Fixed key mismatch: `dbname` → `database`
- Added npm script `validate-secrets`
- Added CloudFormation outputs for validation requirements
