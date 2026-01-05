/**
 * Deployment Environment Detection
 * 
 * Detects whether the application is running in production, staging, development, or unknown.
 * Uses ENVIRONMENT env var (set in ECS task definition) as the canonical source.
 * 
 * Values:
 * - 'prod' or 'production' → production
 * - 'stage' or 'staging' → staging
 * - Missing/invalid + NODE_ENV=development → development (local dev)
 * - Missing/invalid + other NODE_ENV → unknown (fail-closed)
 */

export type DeploymentEnv = 'production' | 'staging' | 'development' | 'unknown';

/**
 * Get current deployment environment.
 * 
 * Checks ENVIRONMENT env var (canonical in ECS).
 * For missing/invalid ENVIRONMENT:
 * - If NODE_ENV=development → returns 'development' (local dev)
 * - Otherwise → returns 'unknown' (fail-closed for sensitive ops)
 * 
 * @returns 'production' | 'staging' | 'development' | 'unknown'
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
  
  // If ENVIRONMENT is missing/invalid, check NODE_ENV for local dev
  if (!env) {
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase().trim();
    if (nodeEnv === 'development') {
      return 'development';
    }
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
 * Check if running in development environment.
 * 
 * @returns true if in local development (NODE_ENV=development without ENVIRONMENT set)
 */
export function isDevelopment(): boolean {
  return getDeploymentEnv() === 'development';
}

/**
 * Check if running in unknown environment.
 * 
 * @returns true if ENVIRONMENT is missing or invalid (and not development)
 */
export function isUnknown(): boolean {
  return getDeploymentEnv() === 'unknown';
}
