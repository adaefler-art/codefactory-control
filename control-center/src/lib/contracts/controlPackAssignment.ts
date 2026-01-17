/**
 * Control Pack Assignment Contract Schema
 * 
 * Defines contracts for control_pack_assignments table operations.
 * Manages Control Pack assignments for AFU-9 Issues.
 * 
 * AFU-9 Issue Lifecycle: Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence
 */

/**
 * Control Pack Assignment Status enum
 */
export enum ControlPackAssignmentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  REVOKED = 'revoked',
}

/**
 * Control Pack Assignment Row
 * Represents a row from the control_pack_assignments table
 */
export interface ControlPackAssignmentRow {
  id: string;
  issue_id: string;
  control_pack_id: string;
  control_pack_name: string;
  assigned_by: string | null;
  assignment_reason: string | null;
  status: ControlPackAssignmentStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Control Pack Assignment Input
 * For creating new CP assignments
 */
export interface ControlPackAssignmentInput {
  issue_id: string;
  control_pack_id: string;
  control_pack_name: string;
  assigned_by?: string;
  assignment_reason?: string;
  status?: ControlPackAssignmentStatus;
}

/**
 * Default Control Pack IDs
 */
export const DEFAULT_CONTROL_PACKS = {
  INTENT_ISSUE_AUTHORING: 'cp:intent-issue-authoring',
  ISSUE_LIFECYCLE: 'cp:issue-lifecycle',
  PUBLISH_ORCHESTRATOR: 'cp:publish-orchestrator',
} as const;

/**
 * Default Control Pack Names
 */
export const DEFAULT_CONTROL_PACK_NAMES = {
  [DEFAULT_CONTROL_PACKS.INTENT_ISSUE_AUTHORING]: 'INTENT Issue Authoring',
  [DEFAULT_CONTROL_PACKS.ISSUE_LIFECYCLE]: 'Issue Lifecycle Management',
  [DEFAULT_CONTROL_PACKS.PUBLISH_ORCHESTRATOR]: 'Publish Orchestrator',
} as const;

/**
 * Type guard for ControlPackAssignmentStatus
 */
export function isValidCpAssignmentStatus(status: string): status is ControlPackAssignmentStatus {
  return Object.values(ControlPackAssignmentStatus).includes(status as ControlPackAssignmentStatus);
}

/**
 * Validate CP assignment input
 */
export function validateCpAssignmentInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const data = input as Record<string, unknown>;

  if (!data.issue_id || typeof data.issue_id !== 'string') {
    return { valid: false, error: 'issue_id is required and must be a string (UUID)' };
  }

  if (!data.control_pack_id || typeof data.control_pack_id !== 'string') {
    return { valid: false, error: 'control_pack_id is required and must be a string' };
  }

  if (!data.control_pack_name || typeof data.control_pack_name !== 'string') {
    return { valid: false, error: 'control_pack_name is required and must be a string' };
  }

  if (data.assigned_by !== undefined && data.assigned_by !== null && typeof data.assigned_by !== 'string') {
    return { valid: false, error: 'assigned_by must be a string if provided' };
  }

  if (data.assignment_reason !== undefined && data.assignment_reason !== null && typeof data.assignment_reason !== 'string') {
    return { valid: false, error: 'assignment_reason must be a string if provided' };
  }

  if (data.status !== undefined && (typeof data.status !== 'string' || !isValidCpAssignmentStatus(data.status))) {
    return { valid: false, error: `status must be one of: ${Object.values(ControlPackAssignmentStatus).join(', ')}` };
  }

  return { valid: true };
}
