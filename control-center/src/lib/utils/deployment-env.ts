/**
 * Deployment Environment Detection
 * 
 * Detects whether the application is running in production or staging.
 * Uses ENVIRONMENT env var (set in ECS task definition) as the canonical source.
 * 
 * Values:
 * - 'prod' or 'production' → production
 * - 'stage' or 'staging' → staging
 * - Missing/invalid → defaults to staging (fail-safe for non-production environments)
 */

export type DeploymentEnv = 'production' | 'staging';

/**
 * Get current deployment environment.
 * 
 * Checks ENVIRONMENT env var (canonical in ECS).
 * Falls back to staging for safety (fail-safe default for non-production).
 * 
 * @returns 'production' | 'staging'
 */
export function getDeploymentEnv(): DeploymentEnv {
  const env = (process.env.ENVIRONMENT || '').toLowerCase().trim();
  
  // Production aliases
  if (env === 'prod' || env === 'production') {
    return 'production';
  }
  
  // Default to staging (fail-safe for dev/test environments)
  return 'staging';
}

/**
 * Check if running in production.
 * 
 * @returns true if ENVIRONMENT is prod/production
 */
export function isProduction(): boolean {
  return getDeploymentEnv() === 'production';
}

/**
 * Check if running in staging.
 * 
 * @returns true if ENVIRONMENT is stage/staging or unset
 */
export function isStaging(): boolean {
  return getDeploymentEnv() === 'staging';
}
