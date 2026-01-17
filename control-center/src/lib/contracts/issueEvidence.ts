/**
 * Issue Evidence Contract Schema
 * 
 * Defines contracts for issue_evidence table operations.
 * Records evidence for AFU-9 Issue lifecycle actions (publish receipts, audit trail).
 * 
 * AFU-9 Issue Lifecycle: Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence
 */

/**
 * Issue Evidence Type enum
 */
export enum IssueEvidenceType {
  PUBLISH_RECEIPT = 'PUBLISH_RECEIPT',
  GITHUB_MIRROR_RECEIPT = 'GITHUB_MIRROR_RECEIPT',
  CR_BINDING_RECEIPT = 'CR_BINDING_RECEIPT',
  CP_ASSIGNMENT_RECEIPT = 'CP_ASSIGNMENT_RECEIPT',
  STATE_TRANSITION_RECEIPT = 'STATE_TRANSITION_RECEIPT',
}

/**
 * Issue Evidence Row
 * Represents a row from the issue_evidence table
 */
export interface IssueEvidenceRow {
  id: string;
  issue_id: string;
  evidence_type: IssueEvidenceType;
  evidence_data: Record<string, unknown>;
  request_id: string | null;
  created_at: string;
}

/**
 * Issue Evidence Input
 * For creating new evidence records
 */
export interface IssueEvidenceInput {
  issue_id: string;
  evidence_type: IssueEvidenceType;
  evidence_data: Record<string, unknown>;
  request_id?: string;
}

/**
 * Publish Receipt Evidence Data
 * Structured data for PUBLISH_RECEIPT evidence type
 */
export interface PublishReceiptData {
  batch_id: string;
  github_issue_number: number;
  github_url: string;
  repo: string;
  action: 'created' | 'updated';
  published_at: string;
  rendered_hash?: string;
  labels_applied?: string[];
}

/**
 * GitHub Mirror Receipt Evidence Data
 * Structured data for GITHUB_MIRROR_RECEIPT evidence type
 */
export interface GithubMirrorReceiptData {
  github_issue_number: number;
  github_url: string;
  synced_at: string;
  batch_id?: string;
  mirror_status: string;
}

/**
 * CR Binding Receipt Evidence Data
 * Structured data for CR_BINDING_RECEIPT evidence type
 */
export interface CrBindingReceiptData {
  cr_id: string;
  cr_version?: string;
  bound_at: string;
  bound_by: string;
  previous_cr_id?: string;
}

/**
 * CP Assignment Receipt Evidence Data
 * Structured data for CP_ASSIGNMENT_RECEIPT evidence type
 */
export interface CpAssignmentReceiptData {
  control_pack_id: string;
  control_pack_name: string;
  assigned_at: string;
  assigned_by: string;
  assignment_reason?: string;
}

/**
 * Type guard for IssueEvidenceType
 */
export function isValidEvidenceType(type: string): type is IssueEvidenceType {
  return Object.values(IssueEvidenceType).includes(type as IssueEvidenceType);
}

/**
 * Validate evidence input
 */
export function validateEvidenceInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  if (!data.issue_id || typeof data.issue_id !== 'string') {
    return { valid: false, error: 'issue_id is required and must be a string (UUID)' };
  }

  if (!data.evidence_type || typeof data.evidence_type !== 'string' || !isValidEvidenceType(data.evidence_type)) {
    return { valid: false, error: `evidence_type must be one of: ${Object.values(IssueEvidenceType).join(', ')}` };
  }

  if (!data.evidence_data || typeof data.evidence_data !== 'object' || Array.isArray(data.evidence_data)) {
    return { valid: false, error: 'evidence_data is required and must be an object' };
  }

  if (data.request_id !== undefined && data.request_id !== null && typeof data.request_id !== 'string') {
    return { valid: false, error: 'request_id must be a string if provided' };
  }

  return { valid: true };
}
