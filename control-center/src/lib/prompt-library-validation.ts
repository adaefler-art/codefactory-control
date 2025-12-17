/**
 * Validation utilities for Prompt & Action Library
 */

import { ChangeType } from './types/prompt-library';

/**
 * Valid change types for semantic versioning
 */
export const VALID_CHANGE_TYPES: ChangeType[] = ['major', 'minor', 'patch'];

/**
 * Validate change type
 * @param changeType - The change type to validate
 * @returns true if valid, false otherwise
 */
export function isValidChangeType(changeType: string): changeType is ChangeType {
  return VALID_CHANGE_TYPES.includes(changeType as ChangeType);
}

/**
 * Validate and throw error if change type is invalid
 * @param changeType - The change type to validate
 * @throws Error if invalid
 */
export function validateChangeType(changeType: string): asserts changeType is ChangeType {
  if (!isValidChangeType(changeType)) {
    throw new Error(`Invalid changeType. Must be one of: ${VALID_CHANGE_TYPES.join(', ')}`);
  }
}

/**
 * Breaking change detection threshold
 * Threshold for content change ratio to be considered breaking (0-1)
 * A value of 0.5 means if more than 50% of the content changed, it's likely breaking
 */
export const BREAKING_CHANGE_THRESHOLD = 0.5;

/**
 * Sanitize string for use in prompts
 * Removes control characters that could cause issues
 */
export function sanitizeString(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, '');
}
