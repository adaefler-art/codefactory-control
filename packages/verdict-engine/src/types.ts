/**
 * AFU-9 Verdict Engine v1.1 Types
 * 
 * Implements EPIC 2: Governance & Auditability
 * - Issue 2.1: Policy Snapshotting per Run
 * - Issue 2.2: Confidence Score Normalization
 * - EPIC B: Verdict Types for Decision Authority
 */

import { ErrorClass, FactoryAction, CfnFailureSignal } from '@codefactory/deploy-memory';

/**
 * Canonical Verdict Types for Decision Authority
 * 
 * These types represent the overall decision outcome/status of a verdict,
 * distinct from error classification and factory actions.
 * 
 * Based on industry standards from CI/CD systems (Jenkins, GitLab, Azure DevOps)
 * and automated decision-making governance frameworks.
 * 
 * @see docs/VERDICT_TYPES.md for complete documentation
 */
export enum VerdictType {
  /**
   * APPROVED - The deployment/change is safe and approved to proceed
   * 
   * Use when:
   * - No errors detected
   * - All checks passed successfully
   * - Automated approval criteria met
   * 
   * Typical factory actions: None needed
   */
  APPROVED = 'APPROVED',

  /**
   * REJECTED - The deployment/change must not proceed
   * 
   * Use when:
   * - Critical errors detected
   * - Security vulnerabilities found
   * - Policy violations identified
   * 
   * Typical factory actions: OPEN_ISSUE
   */
  REJECTED = 'REJECTED',

  /**
   * DEFERRED - Decision postponed, awaiting additional information or time
   * 
   * Use when:
   * - Transient conditions that may resolve (DNS propagation, etc.)
   * - Waiting for external dependencies
   * - Time-based delays needed
   * 
   * Typical factory actions: WAIT_AND_RETRY
   */
  DEFERRED = 'DEFERRED',

  /**
   * ESCALATED - Requires human intervention to make final decision
   * 
   * Use when:
   * - Ambiguous situation requiring human judgment
   * - High-risk changes needing manual approval
   * - Automated decision confidence too low
   * 
   * Typical factory actions: HUMAN_REQUIRED
   */
  ESCALATED = 'ESCALATED',

  /**
   * WARNING - Proceed with caution, issues detected but not critical
   * 
   * Use when:
   * - Minor issues that don't block deployment
   * - Deprecated patterns detected
   * - Sub-optimal configurations
   * 
   * Typical factory actions: OPEN_ISSUE (low priority)
   */
  WARNING = 'WARNING',

  /**
   * BLOCKED - Cannot proceed due to external constraints
   * 
   * Use when:
   * - Resource locks prevent action
   * - Missing prerequisites
   * - Conflicting operations in progress
   * 
   * Typical factory actions: WAIT_AND_RETRY or HUMAN_REQUIRED
   */
  BLOCKED = 'BLOCKED',

  /**
   * PENDING - Verdict generation in progress or not yet determined
   * 
   * Use when:
   * - Initial state before analysis
   * - Awaiting additional signals
   * - Classification ongoing
   * 
   * Typical factory actions: None yet
   */
  PENDING = 'PENDING',
}

/**
 * Policy snapshot containing immutable classification rules
 */
export interface PolicySnapshot {
  id: string;
  version: string;
  policies: {
    classification_rules: ClassificationRule[];
    playbooks: Record<ErrorClass, FactoryAction>;
    confidence_normalization: {
      scale: string;
      formula: string;
      deterministic: boolean;
    };
  };
  created_at: string;
  metadata?: Record<string, any>;
}

/**
 * Classification rule definition in policy
 */
export interface ClassificationRule {
  errorClass: ErrorClass;
  service: string;
  patterns: string[];
  confidence: number;
  tokens: string[];
}

/**
 * Verdict for a workflow execution failure
 * 
 * Immutable record of failure analysis with policy reference
 */
export interface Verdict {
  id: string;
  execution_id: string;
  policy_snapshot_id: string;
  fingerprint_id: string;
  error_class: ErrorClass;
  service: string;
  confidence_score: number; // Normalized 0-100
  proposed_action: FactoryAction;
  verdict_type: VerdictType; // Overall decision outcome
  tokens: string[];
  signals: CfnFailureSignal[];
  playbook_id?: string;
  created_at: string;
  metadata?: Record<string, any>;
}

/**
 * Input for creating a verdict
 */
export interface CreateVerdictInput {
  execution_id: string;
  policy_snapshot_id: string;
  signals: CfnFailureSignal[];
}

/**
 * Verdict with policy information for auditability
 */
export interface VerdictWithPolicy extends Verdict {
  policy_version: string;
  policy_definition: PolicySnapshot['policies'];
  workflow_id: string | null;
  execution_status: string;
  execution_started_at: string;
}

/**
 * Verdict statistics for KPI reporting
 */
export interface VerdictStatistics {
  error_class: ErrorClass;
  service: string;
  total_count: number;
  avg_confidence: number;
  min_confidence: number;
  max_confidence: number;
  most_common_action: FactoryAction;
  affected_executions: number;
}

/**
 * Verdict audit log entry
 */
export interface VerdictAuditEntry {
  id: string;
  verdict_id: string;
  event_type: 'created' | 'reviewed' | 'overridden' | 'archived';
  event_data?: Record<string, any>;
  created_at: string;
  created_by?: string;
}

/**
 * Query parameters for verdict retrieval
 */
export interface VerdictQueryParams {
  execution_id?: string;
  error_class?: ErrorClass;
  service?: string;
  min_confidence?: number;
  max_confidence?: number;
  proposed_action?: FactoryAction;
  verdict_type?: VerdictType;
  limit?: number;
  offset?: number;
}
