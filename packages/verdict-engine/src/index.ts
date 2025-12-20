/**
 * AFU-9 Verdict Engine v1.1
 * 
 * Implements EPIC 2: Governance & Auditability
 * - Issue 2.1: Policy Snapshotting per Run
 * - Issue 2.2: Confidence Score Normalization
 * - EPIC B: Verdict Types for Decision Authority
 * - Issue B2: Simplified Verdict → Action Mapping
 * - Issue B3: Verdict als Gate vor Deploy
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
  // Issue B2: Simplified verdict functions
  toSimpleVerdict,
  getSimpleAction,
  getActionForVerdictType,
  validateSimpleVerdictMapping,
} from './engine';

// Issue B3: Deployment gate functions
export {
  checkDeploymentGate,
  validateDeploymentGate,
  isDeploymentAllowed,
  getDeploymentStatus,
} from './deployment-gate';

export type {
  DeploymentGateResult,
} from './deployment-gate';

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
  ESCALATION_CONFIDENCE_THRESHOLD,
  // Issue B2: Simplified verdict constants
  SIMPLE_VERDICT_TO_ACTION,
  VERDICT_TYPE_TO_SIMPLE,
  SIMPLE_VERDICTS,
  SIMPLE_ACTIONS,
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
export { 
  VerdictType,
  // Issue B2: Simplified verdict system
  SimpleVerdict,
  SimpleAction,
} from './types';
