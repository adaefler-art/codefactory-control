/**
 * Deployment Environment Detection
 * 
 * Detects whether the application is running in production, staging, or unknown.
 * Uses ENVIRONMENT env var (set in ECS task definition) as the canonical source.
 * 
 * Values:
 * - 'prod' or 'production' → production
 * - 'stage' or 'staging' → staging
 * - Missing/invalid → unknown (fail-closed for sensitive operations)
 */

export type DeploymentEnv = 'production' | 'staging' | 'unknown';

/**
 * Get current deployment environment.
 * 
 * Checks ENVIRONMENT env var (canonical in ECS).
 * Returns 'unknown' for missing/invalid values (fail-closed for sensitive ops).
 * 
 * @returns 'production' | 'staging' | 'unknown'
 */
export function getDeploymentEnv(): DeploymentEnv {
  const env = (process.env.ENVIRONMENT || '').toLowerCase().trim();
  
  // Production aliases
  if (env === 'prod' || env === 'production') {
    return 'production';
  }
  
  // Staging aliases
  if (env === 'stage' || env === 'staging') {
    return 'staging';
  }
  
  // Unknown/invalid (fail-closed for sensitive operations)
  return 'unknown';
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
 * @returns true if ENVIRONMENT is stage/staging (NOT if unset/unknown)
 */
export function isStaging(): boolean {
  return getDeploymentEnv() === 'staging';
}

/**
 * Check if running in unknown environment.
 * 
 * @returns true if ENVIRONMENT is missing or invalid
 */
export function isUnknown(): boolean {
  return getDeploymentEnv() === 'unknown';
}
