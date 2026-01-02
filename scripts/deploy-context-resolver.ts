#!/usr/bin/env ts-node
/**
 * Deploy Context Resolver (E7.0.1)
 * Single source of truth for deploy environment resolution.
 * Enforces explicit environment specification with no implicit defaults.
 */

export interface DeployContext {
  environment: 'staging' | 'production';
  cluster: string;
  service: string;
  imageTagPrefix: string;
  secretsPrefix: string;
  readyHost: string;
}

/**
 * Normalizes environment aliases to canonical values
 * @param env - Raw environment string
 * @returns Canonical environment or null if invalid
 */
function normalizeEnvironment(env: string): 'staging' | 'production' | null {
  const normalized = env.toLowerCase().trim();
  
  // Accept common aliases and normalize to canonical
  if (normalized === 'production' || normalized === 'prod') {
    return 'production';
  }
  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';
  }
  
  return null;
}

/**
 * Resolves deploy context from environment variable.
 * FAIL-CLOSED: No defaults, no implicit production.
 * Accepts aliases: prod|production, stage|staging
 * @throws Error if DEPLOY_ENV is missing or invalid
 */
export function resolveDeployContext(deployEnv?: string): DeployContext {
  const env = deployEnv || process.env.DEPLOY_ENV;

  if (!env) {
    throw new Error(
      'DEPLOY_ENV is required. Set to "staging" or "production" (or aliases: stage, prod). No default is provided (fail-closed).'
    );
  }

  const canonical = normalizeEnvironment(env);
  
  if (!canonical) {
    throw new Error(
      `Invalid DEPLOY_ENV: "${env}". Must be one of: staging, stage, production, prod.`
    );
  }

  const context: DeployContext = {
    environment: canonical,
    cluster: canonical === 'production' ? 'afu9-cluster' : process.env.STAGING_ECS_CLUSTER || 'afu9-cluster',
    service: canonical === 'production' ? 'afu9-control-center' : 'afu9-control-center-staging',
    imageTagPrefix: canonical === 'production' ? 'prod' : 'stage',
    secretsPrefix: canonical === 'production' ? 'afu9' : 'afu9/stage',
    readyHost: canonical === 'production' ? 'afu-9.com' : 'stage.afu-9.com',
  };

  return context;
}

export { normalizeEnvironment };

/**
 * CLI entry point for testing
 */
if (require.main === module) {
  try {
    const ctx = resolveDeployContext();
    console.log(JSON.stringify(ctx, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exit(1);
  }
}
