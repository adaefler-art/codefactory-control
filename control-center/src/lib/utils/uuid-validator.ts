/**
 * Validation utilities for AFU9 Issues API
 */

/**
 * UUID v4 validation regex
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates if a string is a valid UUID v4
 * 
 * @param id - String to validate
 * @returns true if valid UUID v4, false otherwise
 */
export function isValidUUID(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}
