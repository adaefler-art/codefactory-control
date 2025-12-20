/**
 * AFU-9 Verdict Engine v1.1
 * 
 * Implements EPIC 2: Governance & Auditability
 * - Issue 2.1: Policy Snapshotting per Run
 * - Issue 2.2: Confidence Score Normalization
 * - EPIC B: Verdict Types for Decision Authority
 * 
 * Main exports for the Verdict Engine package
 */

// Core engine functions
export {
  normalizeConfidenceScore,
  generateVerdict,
  validateDeterminism,
  calculateConsistencyMetrics,
  auditVerdict,
  determineVerdictType,
} from './engine';

// Database layer
export {
  storePolicySnapshot,
  getLatestPolicySnapshot,
  getPolicySnapshot,
  storeVerdict,
  getVerdictsByExecution,
  queryVerdicts,
  getVerdictWithPolicy,
  getVerdictStatistics,
  logVerdictAudit,
} from './store';

// Constants
export {
  FACTORY_ACTIONS,
  FACTORY_STATUS_API_VERSION,
  MAX_QUERY_LIMIT,
  CONFIDENCE_SCALE,
  VERDICT_TYPES,
  ACTION_TO_VERDICT_TYPE,
} from './constants';

// Types
export type {
  PolicySnapshot,
  ClassificationRule,
  Verdict,
  CreateVerdictInput,
  VerdictWithPolicy,
  VerdictStatistics,
  VerdictQueryParams,
  VerdictAuditEntry,
} from './types';

// Enums
export { VerdictType } from './types';
