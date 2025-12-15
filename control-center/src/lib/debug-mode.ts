/**
 * Debug Mode Utility
 * 
 * Centralized debug mode detection logic for AFU-9 components.
 */

/**
 * Check if debug mode is enabled
 * 
 * Debug mode is enabled when:
 * - AFU9_DEBUG_MODE is explicitly set to 'true' or '1'
 * - In development environment and AFU9_DEBUG_MODE is not explicitly 'false'
 * 
 * @returns true if debug mode is enabled
 */
export function isDebugModeEnabled(): boolean {
  const debugMode = process.env.AFU9_DEBUG_MODE?.toLowerCase();
  const isProduction = process.env.NODE_ENV === 'production';
  
  return debugMode === 'true' || 
         debugMode === '1' || 
         (!isProduction && debugMode !== 'false');
}
