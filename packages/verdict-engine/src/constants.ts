/**
 * AFU-9 Verdict Engine Constants
 * 
 * Centralized constants for the Verdict Engine
 */

import { VerdictType } from './types';
import type { FactoryAction } from '@codefactory/deploy-memory';

/**
 * Factory actions that can be proposed by verdicts
 */
export const FACTORY_ACTIONS = [
  'WAIT_AND_RETRY',
  'OPEN_ISSUE',
  'HUMAN_REQUIRED',
] as const;

/**
 * Canonical verdict types for decision authority
 * 
 * Array of all valid verdict types in the system.
 * @see VerdictType enum in types.ts for detailed documentation
 */
export const VERDICT_TYPES = [
  VerdictType.APPROVED,
  VerdictType.REJECTED,
  VerdictType.DEFERRED,
  VerdictType.ESCALATED,
  VerdictType.WARNING,
  VerdictType.BLOCKED,
  VerdictType.PENDING,
] as const;

/**
 * Mapping of factory actions to verdict types
 * 
 * This mapping determines the verdict type based on the proposed factory action.
 * Can be overridden in special cases based on confidence or error class.
 */
export const ACTION_TO_VERDICT_TYPE: Record<FactoryAction, VerdictType> = {
  'WAIT_AND_RETRY': VerdictType.DEFERRED,
  'OPEN_ISSUE': VerdictType.REJECTED,
  'HUMAN_REQUIRED': VerdictType.ESCALATED,
} as const;

/**
 * Confidence threshold below which verdicts are escalated for human review
 * 
 * Verdicts with confidence scores below this threshold are automatically
 * assigned VerdictType.ESCALATED to ensure human oversight of uncertain decisions.
 */
export const ESCALATION_CONFIDENCE_THRESHOLD = 60;

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
