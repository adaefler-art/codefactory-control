/**
 * Configuration Management
 * Handles environment variables and AWS Secrets Manager integration
 * NO SECRETS HARDCODED
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export interface CodeFactoryConfig {
  github: {
    appId: string;
    webhookSecret: string;
    privateKeySecretArn: string;
  };
  aws: {
    region: string;
    stepFunctionArn: string;
  };
}

export class ConfigManager {
  private secretsClient: SecretsManagerClient;
  private cachedSecrets: Map<string, string> = new Map();

  constructor(region: string = process.env.AWS_REGION || 'us-east-1') {
    this.secretsClient = new SecretsManagerClient({ region });
  }

  /**
   * Get configuration from environment variables
   */
  getConfig(): CodeFactoryConfig {
    return {
      github: {
        appId: this.getEnvVar('GITHUB_APP_ID'),
        webhookSecret: this.getEnvVar('GITHUB_WEBHOOK_SECRET'),
        privateKeySecretArn: this.getEnvVar('GITHUB_PRIVATE_KEY_SECRET_ARN'),
      },
      aws: {
        region: this.getEnvVar('AWS_REGION', 'us-east-1'),
        stepFunctionArn: this.getEnvVar('STEP_FUNCTION_ARN'),
      },
    };
  }

  /**
   * Retrieve secret from AWS Secrets Manager
   */
  async getSecret(secretArn: string): Promise<string> {
    if (this.cachedSecrets.has(secretArn)) {
      return this.cachedSecrets.get(secretArn)!;
    }

    try {
      const command = new GetSecretValueCommand({ SecretId: secretArn });
      const response = await this.secretsClient.send(command);
      
      const secret = response.SecretString || '';
      this.cachedSecrets.set(secretArn, secret);
      return secret;
    } catch (error) {
      throw new Error(`Failed to retrieve secret ${secretArn}: ${error}`);
    }
  }

  private getEnvVar(key: string, defaultValue?: string): string {
    const value = process.env[key] || defaultValue;
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }
}

export const configManager = new ConfigManager();
