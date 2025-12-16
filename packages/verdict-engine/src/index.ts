/**
 * AFU-9 Verdict Engine v1.1
 * 
 * Implements EPIC 2: Governance & Auditability
 * - Issue 2.1: Policy Snapshotting per Run
 * - Issue 2.2: Confidence Score Normalization
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
