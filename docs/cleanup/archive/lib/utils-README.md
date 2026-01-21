# AFU-9 Utility Libraries

This directory contains reusable utility modules for the AFU-9 system.

## Secrets Management (`secrets.ts`)

The secrets module provides a centralized, secure way to load secrets from AWS Secrets Manager with intelligent fallback to environment variables for local development.

### Features

- **Automatic Environment Detection**: Automatically uses AWS Secrets Manager in production (Lambda/ECS) and environment variables in development
- **Caching**: In-memory caching with TTL to reduce AWS API calls
- **Type Safety**: Fully typed interfaces for all secret types
- **Fallback Strategy**: Gracefully falls back to environment variables when AWS is not available
- **Multiple Providers**: Support for GitHub, multiple LLM providers (OpenAI, Anthropic, DeepSeek), and database credentials

### Quick Start

```typescript
import { getGithubSecrets, getLlmSecrets, getDatabaseSecrets } from './lib/utils/secrets';

// Load GitHub credentials
const githubSecrets = await getGithubSecrets();
console.log(`Using GitHub token for ${githubSecrets.owner}/${githubSecrets.repo}`);

// Load LLM API keys
const llmSecrets = await getLlmSecrets();
if (llmSecrets.openai_api_key) {
  console.log('OpenAI configured');
}
if (llmSecrets.anthropic_api_key) {
  console.log('Anthropic configured');
}

// Load database credentials
const dbSecrets = await getDatabaseSecrets();
const connectionString = `postgresql://${dbSecrets.username}:${dbSecrets.password}@${dbSecrets.host}:${dbSecrets.port}/${dbSecrets.database}`;
```

### Usage in Lambda Functions

```typescript
import { getGithubSecrets } from '../../lib/utils/secrets';

export const handler = async (event: any) => {
  // Load secrets from AWS Secrets Manager
  const { token, owner, repo } = await getGithubSecrets();
  
  // Use the secrets
  const octokit = new Octokit({ auth: token });
  
  // Your logic here...
};
```

### Usage in ECS Tasks

Secrets are automatically injected as environment variables by the ECS task definition. The secret helper will automatically detect the AWS environment and load from Secrets Manager.

```typescript
import { getLlmSecrets } from './lib/utils/secrets';

async function main() {
  // In ECS, this loads from AWS Secrets Manager
  const llmSecrets = await getLlmSecrets();
  
  // Use the API key
  const client = new OpenAI({
    apiKey: llmSecrets.openai_api_key,
  });
}
```

### Local Development

For local development, create a `.env` file with your credentials:

```bash
# GitHub
GITHUB_TOKEN=ghp_your_token
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo

# LLM
OPENAI_API_KEY=sk-your-key
ANTHROPIC_API_KEY=sk-ant-your-key
DEEPSEEK_API_KEY=sk-your-key

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=afu9_admin
DATABASE_PASSWORD=dev_password
```

The secret helper automatically falls back to these environment variables when AWS Secrets Manager is not available.

### Advanced Options

```typescript
// Custom cache TTL (in milliseconds)
const secrets = await getGithubSecrets({ cacheTtlMs: 60000 }); // 1 minute cache

// Disable caching
const secrets = await getGithubSecrets({ cacheTtlMs: 0 });

// Disable environment variable fallback (production only)
const secrets = await getGithubSecrets({ useEnvFallback: false });

// Custom AWS region
const secrets = await getGithubSecrets({ awsRegion: 'us-east-1' });

// Custom database secret (for multi-database scenarios)
const dbSecrets = await getDatabaseSecrets('afu9/database-replica');
```

### Validating Secrets

```typescript
import { getGithubSecrets, validateSecretFields } from './lib/utils/secrets';

const secrets = await getGithubSecrets();

// Validate required fields
validateSecretFields(secrets, ['token', 'owner', 'repo'], 'afu9/github');
// Throws error if any required field is missing
```

### Cache Management

```typescript
import { clearSecretCache } from './lib/utils/secrets';

// Clear all cached secrets
clearSecretCache();

// Useful for testing or forcing a refresh
```

### Environment Detection

```typescript
import { isAwsEnvironment, getSecretStrategy } from './lib/utils/secrets';

// Check if running in AWS (Lambda or ECS)
if (isAwsEnvironment()) {
  console.log('Running in AWS environment');
}

// Get current secret loading strategy
const strategy = getSecretStrategy(); // 'aws' or 'env'
```

## API Reference

### Secret Interfaces

#### `GithubSecrets`
```typescript
interface GithubSecrets {
  token: string;      // GitHub Personal Access Token or App token
  owner: string;      // Repository owner (organization or user)
  repo: string;       // Repository name
}
```

#### `LlmSecrets`
```typescript
interface LlmSecrets {
  openai_api_key?: string;      // OpenAI API key (optional)
  anthropic_api_key?: string;   // Anthropic API key (optional)
  deepseek_api_key?: string;    // DeepSeek API key (optional)
}
```

#### `DatabaseSecrets`
```typescript
interface DatabaseSecrets {
  host: string;         // Database host
  port: string;         // Database port
  database: string;     // Database name
  username: string;     // Database username
  password: string;     // Database password
}
```

### Functions

#### `getGithubSecrets(options?: SecretLoadOptions): Promise<GithubSecrets>`
Load GitHub credentials from `afu9/github` secret.

#### `getLlmSecrets(options?: SecretLoadOptions): Promise<LlmSecrets>`
Load LLM API keys from `afu9/llm` secret.

#### `getDatabaseSecrets(secretName?: string, options?: SecretLoadOptions): Promise<DatabaseSecrets>`
Load database credentials from `afu9/database` secret (or custom secret name).

#### `loadSecret<T>(secretName: string, options?: SecretLoadOptions): Promise<T>`
Generic function to load any secret from AWS Secrets Manager.

#### `validateSecretFields<T>(secret: T, requiredFields: (keyof T)[], secretName: string): void`
Validate that required fields are present in a secret. Throws error if any field is missing.

#### `clearSecretCache(): void`
Clear all cached secrets from memory.

#### `isAwsEnvironment(): boolean`
Check if running in AWS environment (Lambda or ECS).

#### `getSecretStrategy(): 'aws' | 'env'`
Get current secret loading strategy based on environment.

## Security Best Practices

1. **Never commit secrets**: Always use `.env` files (gitignored) for local development
2. **Use AWS Secrets Manager in production**: Never use environment variables in ECS/Lambda for sensitive data
3. **Rotate secrets regularly**: Change API keys and tokens periodically
4. **Use least privilege IAM**: Grant only necessary Secrets Manager permissions
5. **Enable audit logging**: Use CloudTrail to monitor secret access
6. **Validate secrets**: Always validate required fields after loading

## Troubleshooting

### "Secret not found" Error

**Problem**: `Failed to load secret afu9/github: ResourceNotFoundException`

**Solution**: 
1. Verify the secret exists in AWS Secrets Manager
2. Check you're in the correct AWS region
3. Ensure the IAM role has `secretsmanager:GetSecretValue` permission

### "Permission Denied" Error

**Problem**: `AccessDeniedException: User is not authorized to perform: secretsmanager:GetSecretValue`

**Solution**:
1. Verify the IAM role attached to your Lambda/ECS task
2. Check the IAM policy includes Secrets Manager permissions
3. Verify the resource ARN matches your secret

### Environment Variables Not Working

**Problem**: Secrets not loading in local development

**Solution**:
1. Verify `.env` file exists and has correct values
2. Ensure environment variables are loaded (e.g., using `dotenv`)
3. Check variable names match exactly (case-sensitive)

## See Also

- [SECURITY.md](../../SECURITY.md) - Complete security documentation
- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [ECS Secrets Management](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
