/**
 * Feature Flags & Environment Variables Catalog
 * 
 * Central source of truth for all feature flags and environment variables.
 * Includes defaults, descriptions, risk classifications, and allowed environments.
 * 
 * E7.0.4: Prevents "latent features" (code references flags but stack doesn't set them)
 */

import { z } from 'zod';

/**
 * Risk classification for configuration values
 */
export enum RiskClass {
  /** Low risk - cosmetic/logging changes */
  LOW = 'low',
  /** Medium risk - feature toggles with fallbacks */
  MEDIUM = 'medium',
  /** High risk - critical functionality, security, or data integrity */
  HIGH = 'high',
  /** Critical - deployment/infrastructure changes */
  CRITICAL = 'critical',
}

/**
 * Allowed environments
 */
export enum AllowedEnvironment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  ALL = 'all',
}

/**
 * Configuration value type
 */
export enum ConfigType {
  STRING = 'string',
  BOOLEAN = 'boolean',
  NUMBER = 'number',
  JSON = 'json',
}

/**
 * Zod schema for a single flag/env configuration entry
 */
export const FlagConfigSchema = z.object({
  key: z.string().min(1),
  type: z.nativeEnum(ConfigType),
  description: z.string().min(1),
  riskClass: z.nativeEnum(RiskClass),
  defaultValue: z.union([z.string(), z.boolean(), z.number(), z.null()]).optional(),
  allowedEnvironments: z.array(z.nativeEnum(AllowedEnvironment)),
  required: z.boolean().default(false),
  /** Environments where this flag is required (if required=true and this is set, only enforced in these envs) */
  requiredIn: z.array(z.enum(['development', 'staging', 'production'])).optional(),
  /** Conditional requirement - flag is only required if this condition is met */
  conditionalOn: z.object({
    key: z.string(),
    equals: z.union([z.boolean(), z.string(), z.number()]).optional(),
  }).optional(),
  /** Whether this is build-time or runtime configuration */
  source: z.enum(['build', 'runtime', 'both']).default('runtime'),
  /** Tags for categorization */
  tags: z.array(z.string()).default([]),
});

export type FlagConfig = z.infer<typeof FlagConfigSchema>;

/**
 * Zod schema for the complete catalog
 */
export const FlagsCatalogSchema = z.object({
  version: z.string(),
  lastUpdated: z.string(),
  flags: z.array(FlagConfigSchema),
});

export type FlagsCatalog = z.infer<typeof FlagsCatalogSchema>;

/**
 * Central catalog of all feature flags and environment variables
 */
export const FLAGS_CATALOG: FlagsCatalog = {
  version: '1.0.0',
  lastUpdated: '2026-01-02',
  flags: [
    // === Build-time Configuration ===
    {
      key: 'GIT_SHA',
      type: ConfigType.STRING,
      description: 'Git commit SHA of the deployed build',
      riskClass: RiskClass.LOW,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'build',
      tags: ['build', 'metadata'],
    },
    {
      key: 'BUILD_TIME',
      type: ConfigType.STRING,
      description: 'ISO timestamp when the build was created',
      riskClass: RiskClass.LOW,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'build',
      tags: ['build', 'metadata'],
    },
    
    // === GitHub Configuration ===
    {
      key: 'GITHUB_APP_ID',
      type: ConfigType.STRING,
      description: 'GitHub App ID for server-to-server authentication',
      riskClass: RiskClass.CRITICAL,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: true,
      source: 'runtime',
      tags: ['github', 'auth'],
    },
    {
      key: 'GITHUB_APP_PRIVATE_KEY_PEM',
      type: ConfigType.STRING,
      description: 'GitHub App private key (PEM format) - loaded from Secrets Manager',
      riskClass: RiskClass.CRITICAL,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: true,
      source: 'runtime',
      tags: ['github', 'auth', 'secret'],
    },
    {
      key: 'GITHUB_APP_WEBHOOK_SECRET',
      type: ConfigType.STRING,
      description: 'GitHub App webhook secret for signature verification',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: true,
      source: 'runtime',
      tags: ['github', 'auth', 'secret'],
    },
    {
      key: 'GITHUB_OWNER',
      type: ConfigType.STRING,
      description: 'Default GitHub organization/owner for operations',
      riskClass: RiskClass.MEDIUM,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: true,
      source: 'runtime',
      tags: ['github', 'config'],
    },
    {
      key: 'GITHUB_REPO',
      type: ConfigType.STRING,
      description: 'Default GitHub repository name',
      riskClass: RiskClass.MEDIUM,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['github', 'config'],
    },
    {
      key: 'GITHUB_REPO_ALLOWLIST',
      type: ConfigType.JSON,
      description: 'JSON allowlist for repositories accessible via GitHub App',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['github', 'security', 'policy'],
    },

    // === LLM Configuration ===
    {
      key: 'OPENAI_API_KEY',
      type: ConfigType.STRING,
      description: 'OpenAI API key for GPT models',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['llm', 'secret'],
    },
    {
      key: 'ANTHROPIC_API_KEY',
      type: ConfigType.STRING,
      description: 'Anthropic API key for Claude models',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['llm', 'secret'],
    },
    {
      key: 'DEEPSEEK_API_KEY',
      type: ConfigType.STRING,
      description: 'DeepSeek API key',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['llm', 'secret'],
    },

    // === AWS Configuration ===
    {
      key: 'AWS_REGION',
      type: ConfigType.STRING,
      description: 'AWS region for services (Secrets Manager, ECS, RDS)',
      riskClass: RiskClass.HIGH,
      defaultValue: 'eu-central-1',
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: true,
      source: 'runtime',
      tags: ['aws', 'infrastructure'],
    },

    // === Database Configuration ===
    {
      key: 'DATABASE_ENABLED',
      type: ConfigType.BOOLEAN,
      description: 'Enable/disable database connectivity checks',
      riskClass: RiskClass.MEDIUM,
      defaultValue: false,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['database', 'feature-toggle'],
    },
    {
      key: 'DATABASE_HOST',
      type: ConfigType.STRING,
      description: 'PostgreSQL database host',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['database', 'infrastructure'],
    },
    {
      key: 'DATABASE_PORT',
      type: ConfigType.NUMBER,
      description: 'PostgreSQL database port',
      riskClass: RiskClass.MEDIUM,
      defaultValue: 5432,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['database', 'infrastructure'],
    },
    {
      key: 'DATABASE_NAME',
      type: ConfigType.STRING,
      description: 'PostgreSQL database name',
      riskClass: RiskClass.MEDIUM,
      defaultValue: 'afu9',
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['database', 'infrastructure'],
    },
    {
      key: 'DATABASE_USER',
      type: ConfigType.STRING,
      description: 'PostgreSQL database user',
      riskClass: RiskClass.HIGH,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['database', 'secret'],
    },
    {
      key: 'DATABASE_PASSWORD',
      type: ConfigType.STRING,
      description: 'PostgreSQL database password',
      riskClass: RiskClass.CRITICAL,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['database', 'secret'],
    },

    // === Application Configuration ===
    {
      key: 'NODE_ENV',
      type: ConfigType.STRING,
      description: 'Node.js environment (development, production)',
      riskClass: RiskClass.HIGH,
      defaultValue: 'development',
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: true,
      source: 'runtime',
      tags: ['app', 'environment'],
    },
    {
      key: 'PORT',
      type: ConfigType.NUMBER,
      description: 'HTTP server port',
      riskClass: RiskClass.LOW,
      defaultValue: 3000,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['app', 'infrastructure'],
    },
    {
      key: 'NEXT_PUBLIC_APP_URL',
      type: ConfigType.STRING,
      description: 'Public URL for the application (used for self-health checks)',
      riskClass: RiskClass.MEDIUM,
      defaultValue: 'http://localhost:3000',
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['app', 'infrastructure'],
    },

    // === Feature Flags ===
    {
      key: 'AFU9_DEBUG_MODE',
      type: ConfigType.BOOLEAN,
      description: 'Enable verbose debug logging for workflows, agents, and MCP calls',
      riskClass: RiskClass.LOW,
      defaultValue: false,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['feature-flag', 'debug', 'observability'],
    },
    {
      key: 'AFU9_INTENT_ENABLED',
      type: ConfigType.BOOLEAN,
      description: 'Enable INTENT Agent MVP (guardrailed LLM responses). When disabled, INTENT endpoints return 404 (fail-closed)',
      riskClass: RiskClass.MEDIUM,
      defaultValue: false,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['feature-flag', 'intent', 'llm'],
    },
    {
      key: 'AFU9_INTENT_DEV_MODE',
      type: ConfigType.BOOLEAN,
      description: 'Enable INTENT dev mode for staging. Relaxes DISCUSS mode guardrails for allowlisted tools (save/validate/commit draft). Requires admin user. No effect in production.',
      riskClass: RiskClass.MEDIUM,
      defaultValue: false,
      allowedEnvironments: [AllowedEnvironment.STAGING, AllowedEnvironment.DEVELOPMENT],
      required: false,
      source: 'runtime',
      tags: ['feature-flag', 'intent', 'dev-mode'],
    },

    // === MCP Server Endpoints ===
    {
      key: 'MCP_GITHUB_ENDPOINT',
      type: ConfigType.STRING,
      description: 'MCP GitHub server endpoint URL',
      riskClass: RiskClass.MEDIUM,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['mcp', 'infrastructure'],
    },
    {
      key: 'MCP_DEPLOY_ENDPOINT',
      type: ConfigType.STRING,
      description: 'MCP Deploy server endpoint URL',
      riskClass: RiskClass.MEDIUM,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['mcp', 'infrastructure'],
    },
    {
      key: 'MCP_OBSERVABILITY_ENDPOINT',
      type: ConfigType.STRING,
      description: 'MCP Observability server endpoint URL',
      riskClass: RiskClass.MEDIUM,
      defaultValue: null,
      allowedEnvironments: [AllowedEnvironment.ALL],
      required: false,
      source: 'runtime',
      tags: ['mcp', 'infrastructure'],
    },
  ],
};

/**
 * Get flag configuration by key
 */
export function getFlagConfig(key: string): FlagConfig | undefined {
  return FLAGS_CATALOG.flags.find(f => f.key === key);
}

/**
 * Get all flags by tag
 */
export function getFlagsByTag(tag: string): FlagConfig[] {
  return FLAGS_CATALOG.flags.filter(f => f.tags.includes(tag));
}

/**
 * Get all required flags
 */
export function getRequiredFlags(): FlagConfig[] {
  return FLAGS_CATALOG.flags.filter(f => f.required);
}

/**
 * Get all flags by risk class
 */
export function getFlagsByRiskClass(riskClass: RiskClass): FlagConfig[] {
  return FLAGS_CATALOG.flags.filter(f => f.riskClass === riskClass);
}
