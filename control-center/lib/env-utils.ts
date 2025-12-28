/**
 * Utility functions for environment variable parsing
 */

/**
 * Parse a boolean environment variable
 * Accepts: 'true', '1', 'TRUE', etc.
 * @param value - The environment variable value
 * @param defaultValue - Default value if env var is not set
 * @returns Parsed boolean value
 */
export function parseBooleanEnv(value: string | undefined, defaultValue: boolean = false): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}
