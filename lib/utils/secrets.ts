/**
 * Secret Management Helper for AFU-9
 * 
 * This module provides a centralized, secure way to load secrets from AWS Secrets Manager
 * with caching and fallback strategies for different execution environments.
 * 
 * Features:
 * - Automatic loading from AWS Secrets Manager in production
 * - Fallback to environment variables for local development
 * - In-memory caching to reduce API calls
 * - TTL-based cache expiration for security
 * - Type-safe secret interfaces
 * - Comprehensive error handling
 * 
 * Usage:
 * ```typescript
 * import { getGithubSecrets, getLlmSecrets, getDatabaseSecrets } from './lib/utils/secrets';
 * 
 * // In Lambda or ECS task
 * const githubSecrets = await getGithubSecrets();
 * console.log(githubSecrets.token);
 * 
 * // With custom cache TTL
 * const llmSecrets = await getLlmSecrets({ cacheTtlMs: 60000 });
 * ```
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// ========================================
// Configuration
// ========================================

/**
 * Default cache TTL in milliseconds (5 minutes)
 * Secrets are cached to reduce AWS API calls and improve performance
 */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * AWS Region for Secrets Manager
 * Falls back to environment variable or default region
 */
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1';

// ========================================
// Type Definitions
// ========================================

/**
 * GitHub secrets structure
 */
export interface GithubSecrets {
  token: string;
  owner: string;
  repo: string;
}

/**
 * LLM API keys structure
 * Supports multiple LLM providers
 */
export interface LlmSecrets {
  openai_api_key?: string;
  anthropic_api_key?: string;
  deepseek_api_key?: string;
}

/**
 * Database connection secrets
 */
export interface DatabaseSecrets {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

/**
 * Options for secret loading
 */
export interface SecretLoadOptions {
  /**
   * Cache TTL in milliseconds
   * Set to 0 to disable caching
   */
  cacheTtlMs?: number;

  /**
   * Whether to use environment variables as fallback
   * Default: true
   */
  useEnvFallback?: boolean;

  /**
   * AWS region override
   */
  awsRegion?: string;
}

// ========================================
// Cache Management
// ========================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * In-memory cache for secrets
 * Maps secret name to cached value with expiration
 */
const secretCache = new Map<string, CacheEntry<unknown>>();

/**
 * Get a cached secret if it exists and hasn't expired
 */
function getCachedSecret<T>(secretName: string): T | null {
  const entry = secretCache.get(secretName);
  if (!entry) {
    return null;
  }

  // Check if cache entry has expired
  if (Date.now() > entry.expiresAt) {
    secretCache.delete(secretName);
    return null;
  }

  return entry.value as T;
}

/**
 * Store a secret in cache with TTL
 */
function setCachedSecret<T>(secretName: string, value: T, ttlMs: number): void {
  if (ttlMs <= 0) {
    // Caching disabled
    return;
  }

  secretCache.set(secretName, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Clear all cached secrets
 * Useful for testing or force refresh
 */
export function clearSecretCache(): void {
  secretCache.clear();
}

// ========================================
// AWS Secrets Manager Client
// ========================================

let secretsManagerClient: SecretsManagerClient | null = null;

/**
 * Get or create Secrets Manager client
 */
function getSecretsManagerClient(region?: string): SecretsManagerClient {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({
      region: region || AWS_REGION,
    });
  }
  return secretsManagerClient;
}

// ========================================
// Core Secret Loading Functions
// ========================================

/**
 * Load a secret from AWS Secrets Manager with caching
 * 
 * @param secretName - Name or ARN of the secret in AWS Secrets Manager
 * @param options - Loading options (cache TTL, region, etc.)
 * @returns Parsed secret object
 * @throws Error if secret cannot be loaded
 */
export async function loadSecret<T>(
  secretName: string,
  options: SecretLoadOptions = {}
): Promise<T> {
  const {
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    awsRegion,
  } = options;

  // Check cache first
  const cached = getCachedSecret<T>(secretName);
  if (cached) {
    console.log(`[Secrets] Using cached secret: ${secretName}`);
    return cached;
  }

  try {
    console.log(`[Secrets] Loading secret from AWS: ${secretName}`);
    
    const client = getSecretsManagerClient(awsRegion);
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });

    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no SecretString value`);
    }

    const secret = JSON.parse(response.SecretString) as T;

    // Cache the secret
    setCachedSecret(secretName, secret, cacheTtlMs);

    console.log(`[Secrets] Successfully loaded secret: ${secretName}`);
    return secret;

  } catch (error) {
    console.error(`[Secrets] Error loading secret ${secretName}:`, error);
    throw new Error(
      `Failed to load secret ${secretName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load a secret with environment variable fallback
 * 
 * This is useful for local development where AWS Secrets Manager may not be available.
 * In production (ECS/Lambda), secrets should always come from Secrets Manager.
 * 
 * @param secretName - Name of the secret in AWS Secrets Manager
 * @param envMapping - Map of secret keys to environment variable names
 * @param options - Loading options
 * @returns Secret object with values from AWS or environment
 */
async function loadSecretWithEnvFallback<T extends Record<string, any>>(
  secretName: string,
  envMapping: Record<keyof T, string>,
  options: SecretLoadOptions = {}
): Promise<T> {
  const { useEnvFallback = true } = options;

  // Try AWS Secrets Manager first
  try {
    return await loadSecret<T>(secretName, options);
  } catch (error) {
    // If Secrets Manager fails and fallback is enabled, use environment variables
    if (useEnvFallback) {
      console.warn(
        `[Secrets] Failed to load from AWS Secrets Manager, falling back to environment variables: ${secretName}`
      );

      const envSecret = {} as T;
      let hasAnyValue = false;

      for (const [key, envVar] of Object.entries(envMapping)) {
        const value = process.env[envVar];
        if (value) {
          (envSecret as Record<string, string>)[key as string] = value;
          hasAnyValue = true;
        }
      }

      if (!hasAnyValue) {
        throw new Error(
          `Failed to load secret ${secretName} from AWS and no environment variables found`
        );
      }

      console.log(`[Secrets] Using environment variable fallback for: ${secretName}`);
      return envSecret;
    }

    // Re-throw error if fallback is disabled
    throw error;
  }
}

// ========================================
// Domain-Specific Secret Getters
// ========================================

/**
 * Get GitHub secrets (token, owner, repo)
 * 
 * In production: Loads from AWS Secrets Manager (afu9-github)
 * In development: Falls back to GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars
 * 
 * @param options - Loading options
 * @returns GitHub secrets
 */
export async function getGithubSecrets(
  options: SecretLoadOptions = {}
): Promise<GithubSecrets> {
  return loadSecretWithEnvFallback<GithubSecrets>(
    'afu9-github',
    {
      token: 'GITHUB_TOKEN',
      owner: 'GITHUB_OWNER',
      repo: 'GITHUB_REPO',
    },
    options
  );
}

/**
 * Get LLM API keys (OpenAI, Anthropic, DeepSeek, etc.)
 * 
 * In production: Loads from AWS Secrets Manager (afu9-llm)
 * In development: Falls back to OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
 * 
 * @param options - Loading options
 * @returns LLM secrets (may have null values for unconfigured providers)
 */
export async function getLlmSecrets(
  options: SecretLoadOptions = {}
): Promise<LlmSecrets> {
  return loadSecretWithEnvFallback<LlmSecrets>(
    'afu9-llm',
    {
      openai_api_key: 'OPENAI_API_KEY',
      anthropic_api_key: 'ANTHROPIC_API_KEY',
      deepseek_api_key: 'DEEPSEEK_API_KEY',
    },
    options
  );
}

/**
 * Get database connection secrets
 * 
 * In production: Loads from AWS Secrets Manager (afu9-database or custom ARN)
 * In development: Falls back to DATABASE_HOST, DATABASE_PORT, etc.
 * 
 * @param secretName - Custom secret name or ARN (optional, defaults to afu9-database)
 * @param options - Loading options
 * @returns Database secrets
 */
export async function getDatabaseSecrets(
  secretName: string = 'afu9-database',
  options: SecretLoadOptions = {}
): Promise<DatabaseSecrets> {
  return loadSecretWithEnvFallback<DatabaseSecrets>(
    secretName,
    {
      host: 'DATABASE_HOST',
      port: 'DATABASE_PORT',
      database: 'DATABASE_NAME',
      username: 'DATABASE_USER',
      password: 'DATABASE_PASSWORD',
    },
    options
  );
}

// ========================================
// Utility Functions
// ========================================

/**
 * Validate that required secret fields are present
 * 
 * @param secret - Secret object to validate
 * @param requiredFields - List of required field names
 * @param secretName - Name of the secret (for error messages)
 * @throws Error if any required field is missing
 */
export function validateSecretFields<T extends Record<string, any>>(
  secret: T,
  requiredFields: (keyof T)[],
  secretName: string
): void {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!secret[field]) {
      missingFields.push(String(field));
    }
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Secret ${secretName} is missing required fields: ${missingFields.join(', ')}`
    );
  }
}

/**
 * Check if running in AWS environment (Lambda or ECS)
 * 
 * @returns true if in AWS environment, false otherwise
 */
export function isAwsEnvironment(): boolean {
  return !!(
    process.env.AWS_EXECUTION_ENV || // Lambda
    process.env.ECS_CONTAINER_METADATA_URI || // ECS Fargate
    process.env.AWS_LAMBDA_FUNCTION_NAME // Lambda (alternative check)
  );
}

/**
 * Get secret loading strategy based on environment
 * 
 * @returns 'aws' if in AWS environment, 'env' otherwise
 */
export function getSecretStrategy(): 'aws' | 'env' {
  return isAwsEnvironment() ? 'aws' : 'env';
}

// ========================================
// Exports
// ========================================

export default {
  loadSecret,
  getGithubSecrets,
  getLlmSecrets,
  getDatabaseSecrets,
  validateSecretFields,
  clearSecretCache,
  isAwsEnvironment,
  getSecretStrategy,
};
