/**
 * AFU-9 Verdict Engine v1.1 Types
 * 
 * Implements EPIC 2: Governance & Auditability
 * - Issue 2.1: Policy Snapshotting pro Run
 * - Issue 2.2: Confidence Score Normalisierung
 */

import { ErrorClass, FactoryAction, CfnFailureSignal } from '@codefactory/deploy-memory/src/types';

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
  limit?: number;
  offset?: number;
}
