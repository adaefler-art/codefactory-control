/**
 * Environment Utilities - Canonical Environment Normalization
 * 
 * Single source of truth for environment normalization in control-center.
 * Matches canonical values used across AFU-9 (deploy-context-resolver, image-matrix).
 * 
 * Canonical values: 'production' | 'staging'
 * Accepts aliases: prod/production, stage/staging
 */

export type DeployEnvironment = 'production' | 'staging';

/**
 * Normalize environment input to canonical value.
 * Accepts common aliases to avoid brittle exact-string matching.
 * 
 * @param input - Raw environment string (e.g., 'prod', 'production', 'stage', 'staging')
 * @returns Canonical environment value ('production' | 'staging')
 * @throws Error if input is not a recognized environment value
 * 
 * @example
 * normalizeEnvironment('prod') // returns 'production'
 * normalizeEnvironment('staging') // returns 'staging'
 * normalizeEnvironment('unknown') // throws Error
 */
export function normalizeEnvironment(input: string): DeployEnvironment {
  const normalized = input.toLowerCase().trim();
  
  // Production aliases
  if (normalized === 'production' || normalized === 'prod') {
    return 'production';
  }
  
  // Staging aliases
  if (normalized === 'staging' || normalized === 'stage') {
    return 'staging';
  }
  
  throw new Error(
    `Invalid environment: "${input}". Must be one of: production, prod, staging, stage`
  );
}

/**
 * Check if a string is a valid environment value (or alias)
 * 
 * @param input - String to check
 * @returns true if input can be normalized to a valid environment
 */
export function isValidEnvironment(input: string): boolean {
  try {
    normalizeEnvironment(input);
    return true;
  } catch {
    return false;
  }
}
