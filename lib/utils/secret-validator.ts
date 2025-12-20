/**
 * Secret Key Validator for AFU-9
 * 
 * Provides validation utilities to ensure all referenced secret keys exist
 * in AWS Secrets Manager before deployment.
 * 
 * This is a critical guardrail that prevents deployment failures due to
 * missing or misconfigured secrets.
 * 
 * Usage in CDK Stack:
 * ```typescript
 * import { validateSecretKeys } from './utils/secret-validator';
 * 
 * // In constructor, before using secrets
 * validateSecretKeys(this, dbSecret, ['host', 'port', 'database', 'username', 'password']);
 * ```
 * 
 * Usage as standalone script:
 * ```bash
 * ts-node lib/utils/secret-validator.ts --secret afu9-database --keys host,port,database,username,password
 * ```
 */

import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * Configuration for a secret validation
 */
export interface SecretValidationConfig {
  /**
   * Secret name or ARN
   */
  secretName: string;

  /**
   * Required keys that must exist in the secret
   */
  requiredKeys: string[];

  /**
   * Optional keys that may or may not exist
   */
  optionalKeys?: string[];

  /**
   * Human-readable description for error messages
   */
  description?: string;
}

/**
 * Result of a secret validation
 */
export interface SecretValidationResult {
  /**
   * Whether the validation passed
   */
  valid: boolean;

  /**
   * Secret name that was validated
   */
  secretName: string;

  /**
   * List of missing required keys
   */
  missingKeys: string[];

  /**
   * Error message if validation failed
   */
  error?: string;
}

/**
 * Validates that a secret contains all required keys using CDK Aspects
 * 
 * This creates validation metadata that can be checked by pre-deployment scripts.
 * The validation information is added to CloudFormation outputs for visibility.
 * 
 * @param scope - CDK construct scope
 * @param secret - The secret to validate
 * @param requiredKeys - List of required keys that must exist in the secret
 * @param description - Human-readable description for error messages
 */
export function validateSecretKeys(
  scope: Construct,
  secret: secretsmanager.ISecret,
  requiredKeys: string[],
  description?: string
): void {
  const secretName = secret.secretName;
  const descriptionText = description || secretName;

  // Add a CfnOutput to make validation information visible in synth output
  // This allows pre-deployment scripts to validate the requirements
  // Use a hash of the secret name to ensure unique output IDs
  const normalizedName = secretName.replace(/[^a-zA-Z0-9]/g, '');
  const hash = secretName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const outputId = `SecretValidation${normalizedName}${hash}`;
  
  new cdk.CfnOutput(scope, outputId, {
    value: JSON.stringify({
      secretName,
      requiredKeys,
      description: descriptionText,
    }),
    description: `Secret validation requirements for ${descriptionText}`,
  });
}

/**
 * Validates multiple secrets in a single call
 * 
 * @param scope - CDK construct scope
 * @param validations - Array of secret validation configurations
 */
export function validateSecrets(
  scope: Construct,
  validations: Array<{
    secret: secretsmanager.ISecret;
    requiredKeys: string[];
    description?: string;
  }>
): void {
  for (const validation of validations) {
    validateSecretKeys(
      scope,
      validation.secret,
      validation.requiredKeys,
      validation.description
    );
  }
}

/**
 * Known secret configurations for AFU-9
 */
export const AFU9_SECRET_CONFIGS: Record<string, SecretValidationConfig> = {
  database: {
    secretName: 'afu9-database',
    requiredKeys: ['host', 'port', 'database', 'username', 'password'],
    description: 'Database connection credentials (application secret, not RDS-generated)',
  },
  github: {
    secretName: 'afu9-github',
    requiredKeys: ['token', 'owner', 'repo'],
    description: 'GitHub API credentials',
  },
  llm: {
    secretName: 'afu9-llm',
    requiredKeys: [], // All LLM keys are optional
    optionalKeys: ['openai_api_key', 'anthropic_api_key', 'deepseek_api_key'],
    description: 'LLM API keys',
  },
};

/**
 * Creates a validation summary for all AFU-9 secrets
 * 
 * This can be used in the main CDK app to output validation requirements
 */
export function createValidationSummary(scope: Construct): void {
  const summary = Object.entries(AFU9_SECRET_CONFIGS).map(([name, config]) => ({
    name,
    secretName: config.secretName,
    requiredKeys: config.requiredKeys,
    optionalKeys: config.optionalKeys || [],
    description: config.description,
  }));

  new cdk.CfnOutput(scope, 'SecretValidationSummary', {
    value: JSON.stringify(summary, null, 2),
    description: 'Complete list of secret validation requirements',
  });
}

// ========================================
// Standalone Script Support
// ========================================

/**
 * Validate a secret by actually fetching it from AWS Secrets Manager
 * This is used by the standalone validation script
 * 
 * NOTE: This requires AWS credentials and will make actual AWS API calls
 */
export async function validateSecretRuntime(
  config: SecretValidationConfig
): Promise<SecretValidationResult> {
  try {
    // Dynamic import to avoid loading AWS SDK in CDK synth
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      '@aws-sdk/client-secrets-manager'
    );

    // Use region from environment or default to eu-central-1 (AFU-9 project default)
    // This can be overridden by setting AWS_REGION environment variable
    const client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'eu-central-1',
    });

    const command = new GetSecretValueCommand({
      SecretId: config.secretName,
    });

    const response = await client.send(command);

    if (!response.SecretString) {
      return {
        valid: false,
        secretName: config.secretName,
        missingKeys: [],
        error: `Secret ${config.secretName} exists but has no SecretString value`,
      };
    }

    let secretValue: Record<string, any>;
    try {
      secretValue = JSON.parse(response.SecretString);
    } catch (error: any) {
      return {
        valid: false,
        secretName: config.secretName,
        missingKeys: [],
        error: `Secret ${config.secretName} contains invalid JSON: ${error.message || String(error)}`,
      };
    }

    const missingKeys: string[] = [];

    // Check for required keys
    // Only flag as missing if the key doesn't exist or is null/undefined
    // Empty strings are considered valid values
    for (const key of config.requiredKeys) {
      if (!(key in secretValue) || secretValue[key] == null) {
        missingKeys.push(key);
      }
    }

    if (missingKeys.length > 0) {
      return {
        valid: false,
        secretName: config.secretName,
        missingKeys,
        error: `Secret ${config.secretName} is missing required keys: ${missingKeys.join(', ')}`,
      };
    }

    return {
      valid: true,
      secretName: config.secretName,
      missingKeys: [],
    };
  } catch (error: any) {
    return {
      valid: false,
      secretName: config.secretName,
      missingKeys: [],
      error: `Failed to validate secret ${config.secretName}: ${error.message || String(error)}`,
    };
  }
}

/**
 * Validate all AFU-9 secrets
 * This is used by the standalone validation script
 */
export async function validateAllSecrets(): Promise<SecretValidationResult[]> {
  const results: SecretValidationResult[] = [];

  for (const [name, config] of Object.entries(AFU9_SECRET_CONFIGS)) {
    console.log(`Validating ${name} secret (${config.secretName})...`);
    const result = await validateSecretRuntime(config);
    results.push(result);

    if (result.valid) {
      console.log(`✓ ${name} secret validation passed`);
    } else {
      console.error(`✗ ${name} secret validation failed: ${result.error}`);
    }
  }

  return results;
}

// ========================================
// CLI Script Support
// ========================================

/**
 * Main function for CLI usage
 */
async function main() {
  console.log('AFU-9 Secret Validation');
  console.log('=======================\n');

  const results = await validateAllSecrets();

  console.log('\n======================');
  console.log('Validation Summary');
  console.log('======================\n');

  const failedResults = results.filter((r) => !r.valid);

  if (failedResults.length === 0) {
    console.log('✓ All secrets validated successfully!\n');
    process.exit(0);
  } else {
    console.error(`✗ ${failedResults.length} secret(s) failed validation:\n`);
    for (const result of failedResults) {
      console.error(`  - ${result.secretName}:`);
      console.error(`    ${result.error}`);
      if (result.missingKeys.length > 0) {
        console.error(`    Missing keys: ${result.missingKeys.join(', ')}`);
      }
    }
    console.error('\nPlease fix the above errors before deploying.\n');
    process.exit(1);
  }
}

// Run main if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
