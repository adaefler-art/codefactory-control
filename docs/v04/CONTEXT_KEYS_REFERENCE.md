# AFU-9 Context Keys Reference

This document lists all canonical context keys for AFU-9 infrastructure deployment.

## Overview

Context keys are used to configure CDK stacks during deployment. Only the canonical keys listed in this document should be used. Using deprecated or incorrect keys will result in warnings or errors.

## How to Use Context Keys

Context keys can be provided in three ways:

1. **Command line**: `npx cdk deploy -c afu9-enable-database=false`
2. **cdk.context.json**: Add keys to the context object
3. **Environment-specific**: Add keys under `staging` or `production` in cdk.context.json

## Canonical Context Keys

### Feature Toggles

#### `afu9-enable-database`
- **Type**: boolean
- **Default**: `true`
- **Description**: Enable database integration (RDS, secrets, IAM grants)
- **Example**: `npx cdk deploy -c afu9-enable-database=false`
- **Deprecated aliases**: `enableDatabase` ❌

#### `afu9-enable-https`
- **Type**: boolean
- **Default**: `true`
- **Description**: Enable HTTPS and DNS stack deployment
- **Example**: `npx cdk deploy -c afu9-enable-https=false`
- **Deprecated aliases**: `enableHttps` ❌

#### `afu9-multi-env`
- **Type**: boolean
- **Default**: `false`
- **Description**: Enable multi-environment deployment (stage + prod)
- **Example**: `npx cdk deploy -c afu9-multi-env=true`
- **Deprecated aliases**: `multiEnv` ❌

### DNS and Domain Configuration

#### `afu9-domain`
- **Type**: string
- **Default**: none
- **Description**: Base domain name (e.g., afu-9.com)
- **Example**: `npx cdk deploy -c afu9-domain=afu-9.com`
- **Deprecated aliases**: `domainName` ❌

#### `afu9-hosted-zone-id`
- **Type**: string
- **Default**: none
- **Description**: Existing Route53 hosted zone ID
- **Example**: `npx cdk deploy -c afu9-hosted-zone-id=Z1234567890ABC`
- **Required with**: `afu9-hosted-zone-name`

#### `afu9-hosted-zone-name`
- **Type**: string
- **Default**: none
- **Description**: Existing hosted zone name (required if ID provided)
- **Example**: `npx cdk deploy -c afu9-hosted-zone-name=afu-9.com`
- **Required with**: `afu9-hosted-zone-id`

### Monitoring and Alerts

#### `afu9-alarm-email`
- **Type**: string
- **Default**: none
- **Description**: Email address for CloudWatch alarm notifications
- **Example**: `npx cdk deploy -c afu9-alarm-email=ops@example.com`

#### `afu9-webhook-url`
- **Type**: string
- **Default**: none
- **Description**: Webhook URL for alarm notifications
- **Example**: `npx cdk deploy -c afu9-webhook-url=https://hooks.slack.com/...`

### Authentication

#### `afu9-cognito-domain-prefix`
- **Type**: string
- **Default**: none
- **Description**: Cognito user pool domain prefix
- **Example**: `npx cdk deploy -c afu9-cognito-domain-prefix=afu9-auth`

### GitHub Integration

#### `github-org`
- **Type**: string
- **Default**: `adaefler-art`
- **Description**: GitHub organization name
- **Example**: `npx cdk deploy -c github-org=my-org`

#### `github-repo`
- **Type**: string
- **Default**: `codefactory-control`
- **Description**: GitHub repository name
- **Example**: `npx cdk deploy -c github-repo=my-repo`

### Database Configuration

These keys are only relevant when `afu9-enable-database=true`.

#### `dbSecretArn`
- **Type**: string
- **Default**: none
- **Description**: ARN of database connection secret
- **Example**: `npx cdk deploy -c dbSecretArn=arn:aws:secretsmanager:...`
- **Mutually exclusive with**: `dbSecretName`

#### `dbSecretName`
- **Type**: string
- **Default**: `afu9/database/master`
- **Description**: Name of database connection secret
- **Example**: `npx cdk deploy -c dbSecretName=afu9-database`
- **Mutually exclusive with**: `dbSecretArn`

### Environment Configuration

#### `environment`
- **Type**: string
- **Default**: `staging`
- **Description**: Environment name (staging, production)
- **Example**: `npx cdk deploy -c environment=production`
- **Deprecated aliases**: `stage` ❌

## Deprecated Keys

The following keys are **deprecated** and should not be used. They will generate warnings and may be removed in future versions.

| Deprecated Key | Canonical Key | Status |
|----------------|---------------|--------|
| `enableDatabase` | `afu9-enable-database` | ⚠️ Warning |
| `enableHttps` | `afu9-enable-https` | ⚠️ Warning |
| `multiEnv` | `afu9-multi-env` | ⚠️ Warning |
| `domainName` | `afu9-domain` | ⚠️ Warning |
| `stage` | `environment` | ⚠️ Warning |

### Migration Guide

If you're using deprecated keys, follow these steps:

1. **Identify deprecated keys in your deployment**:
   ```bash
   npx cdk synth 2>&1 | grep -i deprecation
   ```

2. **Update command-line arguments**:
   ```bash
   # Before
   npx cdk deploy -c enableDatabase=false -c domainName=afu-9.com
   
   # After
   npx cdk deploy -c afu9-enable-database=false -c afu9-domain=afu-9.com
   ```

3. **Update cdk.context.json**:
   ```json
   {
     "staging": {
       "afu9-enable-https": false,
       "afu9-enable-database": true,
       "environment": "staging"
     }
   }
   ```

4. **Verify no warnings**:
   ```bash
   npx cdk synth 2>&1 | grep -i warning
   ```

## Common Deployment Scenarios

### Scenario 1: Deploy ECS without Database (Testing)

```bash
npx cdk deploy Afu9EcsStack \
  -c afu9-enable-database=false \
  -c afu9-enable-https=false
```

### Scenario 2: Deploy Full Stack with HTTPS

```bash
npx cdk deploy --all \
  -c afu9-enable-database=true \
  -c afu9-enable-https=true \
  -c afu9-domain=afu-9.com \
  -c afu9-alarm-email=ops@example.com
```

### Scenario 3: Multi-Environment Deployment

```bash
npx cdk deploy --all \
  -c afu9-multi-env=true \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-https=true \
  -c afu9-enable-database=true
```

## Validation

### Automatic Validation

The CDK app automatically validates context keys during synthesis:

- **Deprecation warnings**: Issued for deprecated keys
- **Error on unknown keys**: (Future enhancement)
- **Required key validation**: Ensures required keys are provided when needed

### Manual Validation

You can validate your context configuration before deployment:

```bash
# Show all warnings and errors
npx cdk synth 2>&1 | grep -E "(warning|error)" | grep -i context

# List all context keys being used
npx cdk context --clear
npx cdk synth > /dev/null 2>&1
npx cdk context
```

## Best Practices

1. **Use canonical keys only**: Always use `afu9-*` prefixed keys for AFU-9 features
2. **Environment-specific configuration**: Use `cdk.context.json` with environment sections
3. **Document custom contexts**: If adding new context keys, update this document
4. **Test before deploying**: Run `npx cdk synth` to catch validation errors early
5. **Avoid hardcoding**: Use context keys instead of hardcoding values in stack code

## Troubleshooting

### Warning: "DEPRECATION: Context key 'enableDatabase' is deprecated"

**Solution**: Replace `enableDatabase` with `afu9-enable-database`

```bash
# Before
npx cdk deploy -c enableDatabase=false

# After
npx cdk deploy -c afu9-enable-database=false
```

### Warning: "Both 'enableDatabase' and 'afu9-enable-database' context keys are provided"

**Solution**: Remove the deprecated key from your configuration

```bash
# Check current context
npx cdk context

# Remove deprecated key
npx cdk context --reset enableDatabase
```

### Error: "Missing required context keys"

**Solution**: Provide all required context keys for your deployment

```bash
# Example for database-enabled deployment
npx cdk deploy -c afu9-enable-database=true -c dbSecretArn=arn:aws:...
```

## Reference

- Implementation: `lib/utils/context-validator.ts`
- Tests: `lib/utils/__tests__/context-validator.test.ts`
- Usage: `bin/codefactory-control.ts`, `lib/afu9-ecs-stack.ts`
