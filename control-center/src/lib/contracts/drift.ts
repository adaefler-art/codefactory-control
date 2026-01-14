/**
 * Drift Detection Contract Schema
 * E85.4: Drift Detection + Repair Suggestions
 * 
 * Defines contracts for drift detection between AFU-9 and GitHub.
 * Evidence-first, no auto-destructive changes.
 */

import { Afu9IssueStatus } from './afu9Issue';

/**
 * Drift type enum - what kind of drift was detected
 */
export enum DriftType {
  STATUS_MISMATCH = 'STATUS_MISMATCH',
  LABEL_MISMATCH = 'LABEL_MISMATCH',
  CHECK_MISMATCH = 'CHECK_MISMATCH',
  STATE_MISMATCH = 'STATE_MISMATCH',
  METADATA_MISMATCH = 'METADATA_MISMATCH',
}

/**
 * Drift severity enum
 */
export enum DriftSeverity {
  LOW = 'LOW',        // Minor inconsistency, no immediate action needed
  MEDIUM = 'MEDIUM',  // Notable drift, should be reviewed
  HIGH = 'HIGH',      // Significant drift, needs attention
  CRITICAL = 'CRITICAL', // Critical divergence, immediate review required
}

/**
 * Repair action direction
 */
export enum RepairDirection {
  AFU9_TO_GITHUB = 'AFU9_TO_GITHUB',   // Apply AFU-9 state to GitHub
  GITHUB_TO_AFU9 = 'GITHUB_TO_AFU9',   // Apply GitHub state to AFU-9
  MANUAL_REVIEW = 'MANUAL_REVIEW',     // Requires manual intervention
}

/**
 * Evidence for drift detection
 */
export interface DriftEvidence {
  /** Timestamp when evidence was collected */
  collected_at: string;
  
  /** AFU-9 state at detection time */
  afu9_status: Afu9IssueStatus;
  afu9_labels: string[];
  afu9_last_updated: string | null;
  
  /** GitHub state at detection time */
  github_pr_state: string | null;
  github_pr_merged: boolean | null;
  github_labels: string[];
  github_checks_status: string | null;
  github_review_status: string | null;
  github_last_updated: string | null;
  
  /** Raw GitHub data for audit */
  github_raw_data: Record<string, unknown>;
}

/**
 * Repair suggestion
 */
export interface RepairSuggestion {
  /** Unique ID for this suggestion */
  id: string;
  
  /** Direction of repair */
  direction: RepairDirection;
  
  /** Human-readable description */
  description: string;
  
  /** Detailed explanation */
  explanation: string;
  
  /** Evidence supporting this suggestion */
  evidence: string[];
  
  /** Risk level of applying this suggestion */
  risk_level: 'low' | 'medium' | 'high';
  
  /** Specific actions that would be taken */
  actions: RepairAction[];
  
  /** Whether this requires user confirmation */
  requires_confirmation: boolean;
  
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Specific repair action
 */
export interface RepairAction {
  /** Type of action */
  type: 'UPDATE_AFU9_STATUS' | 'UPDATE_GITHUB_LABELS' | 'UPDATE_GITHUB_STATE' | 'ADD_COMMENT' | 'MANUAL_INTERVENTION';
  
  /** Target of the action */
  target: string;
  
  /** Current value */
  current_value: string | null;
  
  /** New value to apply */
  new_value: string | null;
  
  /** Whether this action is reversible */
  reversible: boolean;
}

/**
 * Drift detection result
 */
export interface DriftDetectionResult {
  /** Unique ID for this detection */
  id: string;
  
  /** Issue being checked */
  issue_id: string;
  
  /** Whether drift was detected */
  drift_detected: boolean;
  
  /** Types of drift found */
  drift_types: DriftType[];
  
  /** Overall severity */
  severity: DriftSeverity;
  
  /** Evidence collected */
  evidence: DriftEvidence;
  
  /** Repair suggestions (ordered by confidence) */
  suggestions: RepairSuggestion[];
  
  /** Timestamp of detection */
  detected_at: string;
  
  /** GitHub repository info */
  github_owner: string;
  github_repo: string;
  github_issue_number: number;
  
  /** Whether this is a dry-run */
  dry_run: boolean;
}

/**
 * Drift detection input
 */
export interface DriftDetectionInput {
  issue_id: string;
  github_owner: string;
  github_repo: string;
  github_issue_number: number;
  dry_run?: boolean;
}

/**
 * Drift detection row (database)
 */
export interface DriftDetectionRow {
  id: string;
  issue_id: string;
  drift_detected: boolean;
  drift_types: DriftType[];
  severity: DriftSeverity;
  evidence: DriftEvidence;
  suggestions: RepairSuggestion[];
  detected_at: string;
  github_owner: string;
  github_repo: string;
  github_issue_number: number;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Drift resolution (when a suggestion is applied)
 */
export interface DriftResolution {
  id: string;
  drift_detection_id: string;
  suggestion_id: string;
  applied_by: string;
  applied_at: string;
  actions_applied: RepairAction[];
  result_success: boolean;
  result_message: string | null;
  audit_trail: Record<string, unknown>;
}

/**
 * Drift resolution input
 */
export interface DriftResolutionInput {
  drift_detection_id: string;
  suggestion_id: string;
  applied_by: string;
  confirmation: boolean; // Explicit confirmation required
}

/**
 * Type guard for DriftType
 */
export function isValidDriftType(type: string): type is DriftType {
  return Object.values(DriftType).includes(type as DriftType);
}

/**
 * Type guard for DriftSeverity
 */
export function isValidDriftSeverity(severity: string): severity is DriftSeverity {
  return Object.values(DriftSeverity).includes(severity as DriftSeverity);
}

/**
 * Type guard for RepairDirection
 */
export function isValidRepairDirection(direction: string): direction is RepairDirection {
  return Object.values(RepairDirection).includes(direction as RepairDirection);
}
