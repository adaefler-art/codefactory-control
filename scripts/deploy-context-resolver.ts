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
 * Resolves deploy context from environment variable.
 * FAIL-CLOSED: No defaults, no implicit production.
 * @throws Error if DEPLOY_ENV is missing or invalid
 */
export function resolveDeployContext(deployEnv?: string): DeployContext {
  const env = deployEnv || process.env.DEPLOY_ENV;

  if (!env) {
    throw new Error(
      'DEPLOY_ENV is required. Set to "staging" or "production". No default is provided (fail-closed).'
    );
  }

  if (env !== 'staging' && env !== 'production') {
    throw new Error(
      `Invalid DEPLOY_ENV: "${env}". Must be exactly "staging" or "production".`
    );
  }

  const context: DeployContext = {
    environment: env,
    cluster: env === 'production' ? 'afu9-cluster' : process.env.STAGING_ECS_CLUSTER || 'afu9-cluster',
    service: env === 'production' ? 'afu9-control-center' : 'afu9-control-center-staging',
    imageTagPrefix: env === 'production' ? 'prod' : 'stage',
    secretsPrefix: env === 'production' ? 'afu9' : 'afu9/stage',
    readyHost: env === 'production' ? 'afu-9.com' : 'stage.afu-9.com',
  };

  return context;
}

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
