/**
 * Production Environment Control (Issue 3)
 * 
 * Centralized control for production environment access.
 * When ENABLE_PROD=false, all production deployments and write operations are blocked.
 */

/**
 * Check if production environment is enabled
 * 
 * @returns true if ENABLE_PROD=true, false otherwise (fail-closed)
 */
export function isProdEnabled(): boolean {
  const enableProd = process.env.ENABLE_PROD;
  return enableProd === 'true';
}

/**
 * Get the reason why production is disabled
 * 
 * @returns Reason string for logging/display
 */
export function getProdDisabledReason(): string {
  return 'Production environment is in cost-reduction mode (Issue 3). All work should be done in staging.';
}

/**
 * Check if a write operation should be allowed in production
 * 
 * @param environment - Current deployment environment ('production' | 'staging' | 'development')
 * @returns true if operation is allowed, false if blocked
 */
export function isWriteAllowedInProd(environment: string): boolean {
  if (environment === 'production' && !isProdEnabled()) {
    return false;
  }
  return true;
}
