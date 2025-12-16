/**
 * AFU-9 Verdict Engine Constants
 * 
 * Centralized constants for the Verdict Engine
 */

/**
 * Factory actions that can be proposed by verdicts
 */
export const FACTORY_ACTIONS = [
  'WAIT_AND_RETRY',
  'OPEN_ISSUE',
  'HUMAN_REQUIRED',
] as const;

/**
 * API version for Factory Status API
 */
export const FACTORY_STATUS_API_VERSION = '1.1.0';

/**
 * Maximum limit for database query results
 */
export const MAX_QUERY_LIMIT = 500;

/**
 * Confidence score scale
 */
export const CONFIDENCE_SCALE = {
  MIN: 0,
  MAX: 100,
} as const;
