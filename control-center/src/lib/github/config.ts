/**
 * GitHub App Configuration Schema
 * 
 * Zod validation schemas for GitHub App credentials and configuration.
 * Provides type safety and runtime validation for app configuration.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy
 */

import { z } from 'zod';

// ========================================
// GitHub App Config Schema
// ========================================

/**
 * Schema for GitHub App credentials
 * Validates the structure loaded from AWS Secrets Manager or environment variables
 */
export const GitHubAppCredentialsSchema = z.object({
  appId: z.union([z.string(), z.number()]).transform((val) => String(val)),
  webhookSecret: z.string().optional(),
  privateKeyPem: z.string().min(100), // PEM keys are typically >100 chars
}).strict();

export type GitHubAppCredentials = z.infer<typeof GitHubAppCredentialsSchema>;

/**
 * Alternative field names that might appear in Secrets Manager
 */
export const GitHubAppSecretSchema = z.object({
  appId: z.union([z.string(), z.number()]).optional(),
  app_id: z.union([z.string(), z.number()]).optional(),
  webhookSecret: z.string().optional(),
  webhook_secret: z.string().optional(),
  webhook_secret_token: z.string().optional(),
  privateKeyPem: z.string().optional(),
  private_key_pem: z.string().optional(),
  private_key: z.string().optional(),
  privateKey: z.string().optional(),
}).passthrough(); // Allow additional fields

export type GitHubAppSecret = z.infer<typeof GitHubAppSecretSchema>;

// ========================================
// Environment Variable Schemas
// ========================================

/**
 * Schema for GitHub-related environment variables
 */
export const GitHubEnvConfigSchema = z.object({
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PEM: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_SECRET_ID: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional(),
  GITHUB_REPO_ALLOWLIST: z.string().optional(), // JSON string
  AWS_REGION: z.string().optional(),
}).passthrough(); // Allow other env vars

export type GitHubEnvConfig = z.infer<typeof GitHubEnvConfigSchema>;
