/**
 * Build Info Module
 * 
 * Single source of truth for build and deployment identity.
 * Reads environment variables set by the build system and ECS.
 * 
 * **AFU-9 Governance: Deterministic Deploy Identity**
 * - Never throws errors (graceful degradation with "unknown" fallbacks)
 * - Environment-based configuration (12-factor compliant)
 * - Used by /api/health and observability endpoints
 * 
 * Environment Variables:
 * - APP_VERSION: Semantic version (e.g., "0.5.0")
 * - GIT_SHA: Git commit SHA (7 chars, e.g., "a1b2c3d")
 * - BUILD_TIME: ISO 8601 timestamp (e.g., "2025-12-28T13:48:20Z")
 */

/**
 * Build information structure
 */
export type BuildInfo = {
  /** Application version (semver) */
  appVersion: string;
  
  /** Git commit SHA (7 chars) */
  gitSha: string;
  
  /** Build timestamp (ISO 8601) */
  buildTime: string;
};

/**
 * Get build information from environment variables.
 * 
 * Never throws - always returns a valid BuildInfo object.
 * Falls back to "unknown" for missing environment variables.
 * 
 * @returns Build information
 */
export function getBuildInfo(): BuildInfo {
  return {
    appVersion: process.env.APP_VERSION || 'unknown',
    gitSha: process.env.GIT_SHA || 'unknown',
    buildTime: process.env.BUILD_TIME || 'unknown',
  };
}
