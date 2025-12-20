/**
 * AFU-9 Verdict Engine Constants
 * 
 * Centralized constants for the Verdict Engine
 * - Issue B2: Simplified Verdict → Action Mapping
 */

import { VerdictType, SimpleVerdict, SimpleAction } from './types';
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

/**
 * Issue B2: Simplified Verdict → Action Mapping
 * 
 * Each verdict has exactly one action.
 * This provides a clear, deterministic mapping for operational decision-making.
 */

/**
 * Canonical mapping: SimpleVerdict → SimpleAction (1:1)
 * 
 * Each verdict type maps to exactly one action, ensuring deterministic behavior.
 */
export const SIMPLE_VERDICT_TO_ACTION: Record<SimpleVerdict, SimpleAction> = {
  [SimpleVerdict.GREEN]: SimpleAction.ADVANCE,
  [SimpleVerdict.RED]: SimpleAction.ABORT,
  [SimpleVerdict.HOLD]: SimpleAction.FREEZE,
  [SimpleVerdict.RETRY]: SimpleAction.RETRY_OPERATION,
} as const;

/**
 * Mapping: VerdictType → SimpleVerdict
 * 
 * Converts detailed VerdictType to simplified SimpleVerdict for operational use.
 * Multiple VerdictTypes can map to the same SimpleVerdict.
 */
export const VERDICT_TYPE_TO_SIMPLE: Record<VerdictType, SimpleVerdict> = {
  [VerdictType.APPROVED]: SimpleVerdict.GREEN,
  [VerdictType.WARNING]: SimpleVerdict.GREEN,    // Proceed with caution
  [VerdictType.REJECTED]: SimpleVerdict.RED,
  [VerdictType.ESCALATED]: SimpleVerdict.HOLD,
  [VerdictType.BLOCKED]: SimpleVerdict.HOLD,
  [VerdictType.DEFERRED]: SimpleVerdict.RETRY,
  [VerdictType.PENDING]: SimpleVerdict.RETRY,    // Retry if still in progress
} as const;

/**
 * List of all simple verdict types
 */
export const SIMPLE_VERDICTS = [
  SimpleVerdict.GREEN,
  SimpleVerdict.RED,
  SimpleVerdict.HOLD,
  SimpleVerdict.RETRY,
] as const;

/**
 * List of all simple action types
 */
export const SIMPLE_ACTIONS = [
  SimpleAction.ADVANCE,
  SimpleAction.ABORT,
  SimpleAction.FREEZE,
  SimpleAction.RETRY_OPERATION,
] as const;
