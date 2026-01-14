/**
 * Sync Audit Contract Schema
 * E85.2: Bi-directional Sync (AFU-9 ↔ GitHub)
 * 
 * Defines contracts for sync audit events and conflict tracking.
 * 
 * MUST be kept in sync with database/migrations/064_bidirectional_sync_audit.sql
 */

/**
 * Sync event type enum
 */
export enum SyncEventType {
  AFU9_TO_GITHUB_LABEL = 'AFU9_TO_GITHUB_LABEL',
  AFU9_TO_GITHUB_STATUS_COMMENT = 'AFU9_TO_GITHUB_STATUS_COMMENT',
  AFU9_TO_GITHUB_ISSUE_CLOSE = 'AFU9_TO_GITHUB_ISSUE_CLOSE',
  GITHUB_TO_AFU9_PR_STATUS = 'GITHUB_TO_AFU9_PR_STATUS',
  GITHUB_TO_AFU9_REVIEW = 'GITHUB_TO_AFU9_REVIEW',
  GITHUB_TO_AFU9_CHECKS = 'GITHUB_TO_AFU9_CHECKS',
  GITHUB_TO_AFU9_LABEL = 'GITHUB_TO_AFU9_LABEL',
  GITHUB_TO_AFU9_ISSUE_STATE = 'GITHUB_TO_AFU9_ISSUE_STATE',
  SYNC_CONFLICT_DETECTED = 'SYNC_CONFLICT_DETECTED',
  SYNC_TRANSITION_BLOCKED = 'SYNC_TRANSITION_BLOCKED',
}

/**
 * Sync direction enum
 */
export enum SyncDirection {
  AFU9_TO_GITHUB = 'AFU9_TO_GITHUB',
  GITHUB_TO_AFU9 = 'GITHUB_TO_AFU9',
  CONFLICT = 'CONFLICT',
}

/**
 * Sync conflict type enum
 */
export enum SyncConflictType {
  STATE_DIVERGENCE = 'STATE_DIVERGENCE',
  MANUAL_OVERRIDE_BLOCKED = 'MANUAL_OVERRIDE_BLOCKED',
  TRANSITION_NOT_ALLOWED = 'TRANSITION_NOT_ALLOWED',
  EVIDENCE_MISSING = 'EVIDENCE_MISSING',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  CONCURRENT_MODIFICATION = 'CONCURRENT_MODIFICATION',
}

/**
 * Evidence type for state transitions
 */
export enum EvidenceType {
  PR_MERGE_COMMIT = 'pr_merge_commit',
  CI_STATUS = 'ci_status',
  TEST_RESULTS = 'test_results',
  CODE_REVIEW_APPROVAL = 'code_review_approval',
  CODE_COMMIT = 'code_commit',
  GITHUB_LABEL_CHANGE = 'github_label_change',
  GITHUB_PR_STATE = 'github_pr_state',
  GITHUB_CHECKS = 'github_checks',
  MANUAL_TRANSITION = 'manual_transition',
}

/**
 * Sync audit event input
 */
export interface SyncAuditEventInput {
  event_type: SyncEventType;
  issue_id?: string | null;
  github_owner?: string | null;
  github_repo?: string | null;
  github_issue_number?: number | null;
  sync_direction: SyncDirection;
  old_status?: string | null;
  new_status?: string | null;
  transition_allowed?: boolean | null;
  transition_blocked_reason?: string | null;
  evidence_type?: string | null;
  evidence_payload?: Record<string, unknown>;
  github_pr_state?: string | null;
  github_pr_merged?: boolean | null;
  github_checks_status?: string | null;
  github_review_status?: string | null;
  github_labels?: string[];
  dry_run?: boolean;
  conflict_detected?: boolean;
  conflict_reason?: string | null;
  sync_run_id?: string | null;
  created_by?: string | null;
}

/**
 * Sync audit event row
 */
export interface SyncAuditEventRow {
  id: string;
  event_hash: string;
  event_type: SyncEventType;
  issue_id: string | null;
  github_owner: string | null;
  github_repo: string | null;
  github_issue_number: number | null;
  sync_direction: SyncDirection;
  old_status: string | null;
  new_status: string | null;
  transition_allowed: boolean | null;
  transition_blocked_reason: string | null;
  evidence_type: string | null;
  evidence_payload: Record<string, unknown>;
  github_pr_state: string | null;
  github_pr_merged: boolean | null;
  github_checks_status: string | null;
  github_review_status: string | null;
  github_labels: string[];
  dry_run: boolean;
  conflict_detected: boolean;
  conflict_reason: string | null;
  sync_run_id: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * Sync conflict input
 */
export interface SyncConflictInput {
  issue_id: string;
  github_owner: string;
  github_repo: string;
  github_issue_number: number;
  conflict_type: SyncConflictType;
  afu9_status: string;
  github_status_raw?: string | null;
  github_pr_state?: string | null;
  description: string;
  resolution_required?: boolean;
  audit_event_id?: string | null;
}

/**
 * Sync conflict row
 */
export interface SyncConflictRow {
  id: string;
  issue_id: string;
  github_owner: string;
  github_repo: string;
  github_issue_number: number;
  conflict_type: SyncConflictType;
  afu9_status: string;
  github_status_raw: string | null;
  github_pr_state: string | null;
  description: string;
  resolution_required: boolean;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_action: string | null;
  resolution_notes: string | null;
  detected_at: string;
  audit_event_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Type guard for SyncEventType
 */
export function isValidSyncEventType(type: string): type is SyncEventType {
  return Object.values(SyncEventType).includes(type as SyncEventType);
}

/**
 * Type guard for SyncDirection
 */
export function isValidSyncDirection(direction: string): direction is SyncDirection {
  return Object.values(SyncDirection).includes(direction as SyncDirection);
}

/**
 * Type guard for SyncConflictType
 */
export function isValidSyncConflictType(type: string): type is SyncConflictType {
  return Object.values(SyncConflictType).includes(type as SyncConflictType);
}
